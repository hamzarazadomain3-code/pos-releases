#!/usr/bin/env node
/**
 * Keyboard-navigation END-TO-END smoke test.
 *
 * Boots the real renderer (built dist/renderer) in a real BrowserWindow with the
 * real preload and the real IPC handlers, then drives the actual DOM with
 * synthetic keydown events — the same events the global KeyboardProvider
 * listens for. This covers what a typecheck cannot: that the shortcuts are
 * actually wired, that page scopes register, that Ctrl+N opens the right modal,
 * that Escape closes it, and that arrow keys move a real table highlight.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/keyboard_smoke.js     # or: npm run test:keyboard
 *
 * Covers the automated half of the keyboard rollout checklist: the global layer
 * (Ctrl+K / F1 / Escape), the migrated VERIFY pages (Inventory, Purchases,
 * Expenses, Udhaar, Transfers, Returns, Audits) and the wider rollout pages
 * (Promotions, Commissions, Branches, Quotations, Users, Custom Reports,
 * Invoice Designer, Barcode Labels, Reports, FIFO Stock Report).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-kb-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'keyboard.db');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let checks = 0;
let failures = 0;
let win;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Injected into the page. `__t` drives the login/forced-password boxes (shared
 * with test_recovery_ui.js); `__kb` presses keys and inspects the DOM.
 */
const HELPERS = `
window.__t = {
  all: () => Array.from(document.querySelectorAll('.lock-box')),
  top: () => { const a = window.__t.all(); return a.length ? a[a.length - 1] : null; },
  text: () => { const b = window.__t.top(); return b ? b.innerText : ''; },
  inputs: () => { const b = window.__t.top(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  hasLoginBox: () => !!document.querySelector('.lock-box'),
  heading: () => { const b = window.__t.top(); const h = b && b.querySelector('h2'); return h ? h.innerText : ''; },
  set: (i, v) => {
    const el = window.__t.inputs()[i];
    if (!el) throw new Error('no input at index ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  click: (label) => {
    const b = window.__t.top();
    const btn = b && Array.from(b.querySelectorAll('button'))
      .find((x) => x.innerText.trim().toLowerCase().includes(label.toLowerCase()));
    if (!btn) throw new Error('no button matching: ' + label);
    btn.click();
    return true;
  },
};

window.__kb = {
  /** Fire a synthetic keydown on the focused element so it bubbles to window. */
  press(combo) {
    const parts = String(combo).split('+');
    const keyName = parts.pop();
    const o = { key: keyName, code: '', bubbles: true, cancelable: true,
                ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    for (const p of parts) {
      const l = p.toLowerCase();
      if (l === 'ctrl' || l === 'control') o.ctrlKey = true;
      else if (l === 'shift') o.shiftKey = true;
      else if (l === 'alt') o.altKey = true;
      else if (l === 'meta') o.metaKey = true;
    }
    if (/^[A-Za-z]$/.test(keyName)) { o.code = 'Key' + keyName.toUpperCase(); o.key = keyName.toLowerCase(); }
    else if (/^F\\d+$/.test(keyName)) { o.code = keyName; o.key = keyName; }
    else if (keyName === 'ArrowUp' || keyName === 'ArrowDown') { o.code = keyName; o.key = keyName; }
    else if (keyName === 'Escape' || keyName === 'Enter' ||
             keyName === 'Delete' || keyName === 'Home' || keyName === 'End' ||
             keyName === 'PageUp' || keyName === 'PageDown') { o.code = keyName; o.key = keyName; }
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', o));
    return o.key;
  },
  hasModal: () => !!document.querySelector('.modal-overlay'),
  modalTitle: () => { const h = document.querySelector('.modal-header h3'); return h ? h.innerText.trim() : ''; },
  focusedInModal: () => { const m = document.querySelector('.modal'); return !!(m && m.contains(document.activeElement)); },
  paletteOpen: () => !!document.querySelector('.palette-search'),
  helpOpen: () => !!document.querySelector('.modal.kb-help'),
  helpHeading: () => { const h = document.querySelector('.modal.kb-help .kb-help-heading'); return h ? h.innerText.trim() : ''; },
  pageTitle: () => { const h = document.querySelector('.page-header h1') || document.querySelector('h1'); return h ? h.innerText.trim() : ''; },
  activeNavLabel: () => { const b = document.querySelector('.nav-btn.active'); return b ? (b.getAttribute('data-label') || b.innerText || '').trim() : ''; },
  nav(label) {
    const btns = Array.from(document.querySelectorAll('.nav-btn'));
    const b = btns.find((x) => ((x.getAttribute('data-label') || x.innerText || '').trim().toLowerCase() === label.toLowerCase()));
    if (!b) throw new Error('no nav button "' + label + '" (have: ' + btns.map((x) => x.getAttribute('data-label')).join(', ') + ')');
    b.click();
    return true;
  },
  focusProductsTable: () => {
    const c = document.querySelector('.table-wrap[tabindex="0"]');
    if (!c) return false;
    c.focus();
    return true;
  },
  activeRow: () => document.querySelector('[data-kb-active="true"]'),
  focusedPlaceholder: () => {
    const a = document.activeElement;
    return a && a.getAttribute ? (a.getAttribute('placeholder') || '') : '';
  },
  focusedTag: () => { const a = document.activeElement; return a ? a.tagName : ''; },
  countCells: () => document.querySelectorAll('[data-kb-cell]').length,
  // ── Window-style dialog controls (min / max / close) ──
  modalWinBtnCount: () => document.querySelectorAll('.modal .modal-win-btn').length,
  modalMaximized: () => !!document.querySelector('.modal[data-maximized="true"]'),
  modalMinimized: () => !!document.querySelector('.modal[data-minimized="true"]'),
  /** Index 0 = minimize, 1 = maximize/restore. */
  clickModalWin: (i) => {
    const b = document.querySelectorAll('.modal .modal-win-btn')[i];
    if (!b) return false;
    b.click();
    return true;
  },
  /** Click a docked bar's title to restore it (not a button). */
  restoreDocked: () => {
    const m = document.querySelector('.modal[data-minimized="true"]');
    if (!m) return false;
    const h = m.querySelector('.modal-header h3');
    if (h) h.click();
    return true;
  },
  /** True when every non-header child of the docked modal is hidden. */
  dockedBodyHidden: () => {
    const m = document.querySelector('.modal[data-minimized="true"]');
    if (!m) return false;
    return Array.from(m.children).every(
      (c) => c.classList.contains('modal-header') || c.offsetParent === null,
    );
  },
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__kb').catch(() => false);
  if (!present) await js(HELPERS);
  return true;
}

async function waitUntil(expr, desc, timeoutMs = 12000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js(expr);
      if (last) return true;
    } catch {
      await ensureHelpers();
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${desc}`);
}

async function waitFor(label, timeoutMs = 15000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js('window.__t.text()');
      if (last && last.toLowerCase().includes(label.toLowerCase())) return true;
    } catch {
      await ensureHelpers();
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for "${label}" (last: ${JSON.stringify(String(last).slice(0, 140))})`);
}

async function mustChangePwVisible() {
  const heading = await js('window.__t.heading()').catch(() => '');
  return heading.toLowerCase().includes('owner password');
}

async function clearDefaultPasswordModal(newPassword) {
  await waitUntil("window.__t.heading().toLowerCase().includes('owner password')", 'default-password modal');
  await js(`window.__t.set(0, ${JSON.stringify(newPassword)})`);
  await js(`window.__t.set(1, ${JSON.stringify(newPassword)})`);
  await js("window.__t.click('Save')");
  await waitUntil('!window.__t.hasLoginBox()', 'the modal to close', 10000);
}

async function goToLoginScreen() {
  if (await mustChangePwVisible()) await clearDefaultPasswordModal('OwnerPass1');
  await js('window.api.auth.logout()').catch(() => undefined);
  await js('localStorage.clear()');
  await js("localStorage.setItem('i18nextLng', 'en')");
  await js('window.location.reload()');
  await sleep(1000);
  await ensureHelpers();
  await waitFor('Rokar POS', 20000);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitFor('Rokar POS');
  await js(`window.__t.set(0, ${JSON.stringify(username)})`);
  await js(`window.__t.set(1, ${JSON.stringify(password)})`);
  await js("window.__t.click('Login')");
  const outcome = await waitUntil(
    "!window.__t.hasLoginBox() || window.__t.heading().toLowerCase().includes('owner password')",
    `login as ${username} to complete`,
    15000,
  ).then(() => 'ok').catch(() => 'timeout');
  if (outcome === 'timeout') {
    throw new Error(`login did not complete for ${username}`);
  }
  if (await mustChangePwVisible()) {
    await clearDefaultPasswordModal('OwnerPass1');
    await goToLoginScreen();
    return signIn(username, 'OwnerPass1');
  }
}

/** Click a sidebar nav item and wait for its page header to render. */
async function navigate(label, title) {
  await ensureHelpers();
  await js(`window.__kb.nav(${JSON.stringify(label)})`);
  await waitUntil(`window.__kb.activeNavLabel() === ${JSON.stringify(label)}`, `nav "${label}" to activate`);
  try {
    await waitUntil(`window.__kb.pageTitle() === ${JSON.stringify(title)}`, `page "${title}" to render`, 20000);
  } catch {
    const actual = await js('window.__kb.pageTitle()').catch(() => '?');
    const body = await js('document.body.innerText.slice(0, 220)').catch(() => '?');
    throw new Error(`page "${title}" not rendered; actual h1="${actual}"; body="${body}"`);
  }
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');

  await initDatabase();
  registerIpcHandlers();

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS — Keyboard navigation (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  [renderer]', String(message).slice(0, 300));
  });
  await js(HELPERS);

  // ── Boot + login, then seed the shortcut table and a product ──────────────
  section('Boot + login');
  await waitFor('Rokar POS', 15000);
  await signIn('admin', 'admin123');
  check('owner signed in', true);

  // Seed the default shortcut bindings so Ctrl+F / Ctrl+S resolve, then reload
  // so App.tsx reads the fresh map on mount.
  await js('window.api.admin.shortcuts.reset()');
  await goToLoginScreen();
  await signIn('admin', 'OwnerPass1');
  check('signed in after seeding shortcut defaults', true);

  // One active product gives the tables/audits something to navigate.
  const product = await js("window.api.inventory.create({ name: 'Keyboard Smoke Widget', sale_price: 100, cost_price: 60, stock_qty: 25, low_stock_threshold: 3 })");
  check('seeded a product for row navigation', !!product && !!product.id, product && `#${product.id}`);

  // ── Global layer ──────────────────────────────────────────────────────────
  section('Global layer (Ctrl+K / F1 / Escape)');
  await js("window.__kb.press('Ctrl+k')");
  await waitUntil('window.__kb.paletteOpen()', 'command palette to open');
  check('Ctrl+K opens the command palette', true);

  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.paletteOpen()', 'command palette to close');
  check('Escape closes the command palette', true);

  await js("window.__kb.press('F1')");
  await waitUntil('window.__kb.helpOpen()', 'keyboard help to open');
  check('F1 opens the keyboard help overlay', true);

  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.helpOpen()', 'keyboard help to close');
  check('Escape closes the keyboard help overlay', true);

  // ── Inventory: Ctrl+F search, arrows, Enter edit, Ctrl+N add, Esc close ───
  section('Inventory');
  await navigate('Inventory', 'Inventory');
  check('Inventory page mounted', (await js('window.__kb.pageTitle()')) === 'Inventory');

  await js("window.__kb.press('Ctrl+f')");
  await sleep(150);
  check('Ctrl+F focuses the product search box',
    (await js('window.__kb.focusedPlaceholder()')).toLowerCase().includes('search name'),
    await js('window.__kb.focusedPlaceholder()'));

  await js('window.__kb.focusProductsTable()');
  await js("window.__kb.press('ArrowDown')");
  await waitUntil('!!window.__kb.activeRow()', 'first row to highlight');
  check('ArrowDown highlights a product row', true);

  await js("window.__kb.press('Enter')");
  await waitUntil('window.__kb.hasModal()', 'Edit Product modal to open');
  check('Enter on a highlighted row opens the Edit Product modal',
    (await js('window.__kb.modalTitle()')).includes('Edit Product'),
    await js('window.__kb.modalTitle()'));
  check('a field inside the modal is focused', (await js('window.__kb.focusedInModal()')) === true);

  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'Edit Product modal to close');
  check('Escape closes the Edit Product modal', true);

  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.hasModal()', 'Add Product modal to open');
  check('Ctrl+N opens the Add Product modal',
    (await js('window.__kb.modalTitle()')).includes('Add Product'),
    await js('window.__kb.modalTitle()'));

  // ── Window-style dialog controls: min / max / close ──────────────────────
  check('the dialog header exposes minimize + maximize + close',
    (await js('window.__kb.modalWinBtnCount()')) === 2 &&
    (await js("!!document.querySelector('.modal .btn-icon[aria-label=\"Close\"]')")) === true,
    `winBtns=${await js('window.__kb.modalWinBtnCount()')}`);

  await js('window.__kb.clickModalWin(1)');
  await waitUntil('window.__kb.modalMaximized()', 'dialog to maximize');
  check('maximize expands the dialog', (await js('window.__kb.modalMaximized()')) === true);
  await js('window.__kb.clickModalWin(1)');
  await waitUntil('!window.__kb.modalMaximized()', 'dialog to restore');
  check('maximize toggles back to the normal size', (await js('window.__kb.modalMaximized()')) === false);

  await js('window.__kb.clickModalWin(0)');
  await waitUntil('window.__kb.modalMinimized()', 'dialog to dock');
  check('minimize docks the dialog to a bar', (await js('window.__kb.modalMinimized()')) === true);
  check('the docked bar hides the form body', (await js('window.__kb.dockedBodyHidden()')) === true);
  // The modal scope is withdrawn while docked, so the page handles its own keys.
  await js("window.__kb.press('Ctrl+f')");
  await sleep(180);
  check('Ctrl+F reaches the page while the dialog is docked',
    (await js('window.__kb.focusedPlaceholder()')).toLowerCase().includes('search name') &&
    (await js('window.__kb.focusedInModal()')) === false,
    await js('window.__kb.focusedPlaceholder()'));
  await js('window.__kb.restoreDocked()');
  await waitUntil('!window.__kb.modalMinimized()', 'dialog to restore from the dock');
  await waitUntil('window.__kb.focusedInModal()', 'focus to return to the restored dialog');
  check('clicking the docked bar restores the dialog and refocuses it',
    (await js('window.__kb.focusedInModal()')) === true);

  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'Add Product modal to close');
  check('Escape closes the Add Product modal', true);

  // ── Purchases: Ctrl+N opens Add Supplier ─────────────────────────────────
  section('Purchases');
  await navigate('Purchases', 'Purchases & Suppliers');
  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.hasModal()', 'supplier modal to open');
  check('Ctrl+N opens the Add Supplier modal',
    (await js('window.__kb.modalTitle()')).includes('Supplier'),
    await js('window.__kb.modalTitle()'));
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'supplier modal to close');
  check('Escape closes the Add Supplier modal', true);

  // ── Expenses ──────────────────────────────────────────────────────────────
  section('Expenses');
  await navigate('Expenses', 'Expenses');
  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.hasModal()', 'expense modal to open');
  check('Ctrl+N opens the Add Expense modal', true);
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'expense modal to close');
  check('Escape closes the Add Expense modal', true);

  // ── Udhaar ────────────────────────────────────────────────────────────────
  section('Udhaar / Khata');
  await navigate('Udhaar', 'Udhaar / Khata');
  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.hasModal()', 'customer modal to open');
  check('Ctrl+N opens the Add Customer modal', true);
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'customer modal to close');
  check('Escape closes the Add Customer modal', true);

  // ── Transfers ─────────────────────────────────────────────────────────────
  section('Transfers');
  await navigate('Transfers', 'Transfers');
  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.hasModal()', 'transfer modal to open');
  check('Ctrl+N opens the new-transfer modal', true);
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'transfer modal to close');
  check('Escape closes the new-transfer modal', true);

  // ── Returns: Ctrl+F focuses the search box ───────────────────────────────
  section('Returns');
  await navigate('Returns', 'Returns / Refunds');
  await js("window.__kb.press('Ctrl+f')");
  await sleep(150);
  check('Ctrl+F focuses the Returns search box', (await js('window.__kb.focusedTag()')) === 'INPUT',
    await js('window.__kb.focusedTag()'));

  // ── Audits: Ctrl+N starts an audit and shows the count cells ─────────────
  section('Audits');
  await navigate('Audits', 'Stock Audit');
  await js("window.__kb.press('Ctrl+n')");
  await waitUntil('window.__kb.countCells() > 0', 'the audit count table to appear');
  check('Ctrl+N starts a new audit with focusable count cells', true);
  check('focusing a count cell is possible (data-kb-cell present)',
    (await js('window.__kb.countCells()')) >= 1,
    `${await js('window.__kb.countCells()')} cell(s)`);

  // ── Newly migrated pages: Ctrl+N opens each page's primary modal ─────────
  const newRecordPages = [
    ['Promotions', 'Promotions', 'New Promotion'],
    ['Commissions', 'Salesman Commissions', 'New Commission Rule'],
    ['Branches', 'Branches', 'New Branch'],
    ['Quotations', 'Quotations', 'New Quotation'],
    ['Users', 'Users & Roles', 'Add User'],
    ['Custom Reports', 'Custom Reports', 'New Report'],
    ['Invoice Designer', 'Invoice Templates', 'New Template'],
  ];
  for (const [nav, title, modal] of newRecordPages) {
    section(title);
    await navigate(nav, title);
    check(`${title} page mounted`, (await js('window.__kb.pageTitle()')) === title,
      await js('window.__kb.pageTitle()'));
    await js("window.__kb.press('Ctrl+n')");
    await waitUntil('window.__kb.hasModal()', `${title} new-record modal to open`);
    check(`Ctrl+N opens the ${title} modal`,
      (await js('window.__kb.modalTitle()')).includes(modal),
      await js('window.__kb.modalTitle()'));
    await js("window.__kb.press('Escape')");
    await waitUntil('!window.__kb.hasModal()', `${title} modal to close`);
    check(`Escape closes the ${title} modal`, true);
  }

  // ── Barcode Labels: Ctrl+F focuses the product search box ────────────────
  section('Barcode Labels');
  await navigate('Barcode Labels', 'Barcode Label Printer');
  await js("window.__kb.press('Ctrl+f')");
  await sleep(150);
  check('Ctrl+F focuses the Barcode search box', (await js('window.__kb.focusedTag()')) === 'INPUT',
    await js('window.__kb.focusedTag()'));

  // ── Label Studio: must not crash with a stale lastUsed id, corrupt saved
  //    templates, or the legacy labelPaper ("38x25") reaching activeTemplateId.
  //    Pre-fix this page threw "Cannot read properties of undefined (reading
  //    'size')" on EVERY open (the printer fallback always reports '38x25',
  //    which is a paper size key, not a template id). ────────────────────────
  section('Label Studio (no-template crash regression)');
  await js("localStorage.setItem('labelStudio.lastUsed', JSON.stringify({ templateId: 'builtin-ghost' }))");
  await js("localStorage.setItem('labelStudio.templates', JSON.stringify([{ name: 'Broken legacy' }]))");
  await navigate('Label Studio', 'Label Studio');
  check('Label Studio mounts despite a stale saved template',
    (await js('window.__kb.pageTitle()')) === 'Label Studio',
    await js('window.__kb.pageTitle()'));
  check('no modal overlay is open on page load (all 7 modals used to render unconditionally)',
    !(await js('window.__kb.hasModal()')),
    await js('window.__kb.hasModal()'));
  check('page warns that the saved template was not found',
    (await js("(document.querySelector('.notice')||{}).innerText||''")).includes('was not found'),
    await js("(document.querySelector('.notice')||{}).innerText||''"));
  const searchTag = await js("(() => { const i = document.querySelector('.product-picker .search-input'); if (!i) return 'NO-INPUT'; i.focus(); return document.activeElement.tagName; })()");
  check('product search input exists and is focusable', searchTag === 'INPUT', searchTag);
  // Open the Template Manager: a corrupt legacy template must render there too
  // (TemplateManager reads `tpl.size`, so this proves the saved-template
  // normalisation really repaired the broken entry).
  await js("Array.from(document.querySelectorAll('.page-header .toolbar button')).find(b => b.innerText.trim() === 'Templates')?.click()");
  await waitUntil('window.__kb.hasModal()', 'Template Manager modal to open');
  check('Template Manager opens and renders the legacy template without crashing',
    (await js('window.__kb.modalTitle()')).includes('Template Manager'),
    await js('window.__kb.modalTitle()'));
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'Template Manager modal to close');
  // Ctrl+F must land on the product search input once the page is clean. This
  // failed pre-2.15.1 only because every modal was mounted and a modal scope
  // (above the page scope) held focus on one of its buttons.
  await js("window.__kb.press('Ctrl+f')");
  await sleep(150);
  check('Ctrl+F focuses the Label Studio product search',
    (await js('window.__kb.focusedTag()')) === 'INPUT',
    await js('window.__kb.focusedTag()'));

  // ── Reports / FIFO: page scope registers (F1 shows the page heading) ──────
  for (const [nav, title, scopeLabel] of [['Reports', 'Reports & Analytics', 'Reports'], ['FIFO Stock Report', 'FIFO Stock Report', 'FIFO Stock Report']]) {
    section(title);
    await navigate(nav, title);
    check(`${title} page mounted`, (await js('window.__kb.pageTitle()')) === title,
      await js('window.__kb.pageTitle()'));
    await js("window.__kb.press('F1')");
    await waitUntil('window.__kb.helpOpen()', `help to open on ${title}`);
    const heading = await js('window.__kb.helpHeading()');
    check(`F1 shows the ${title} page scope`, heading.toLowerCase() === scopeLabel.toLowerCase(), heading);
    await js("window.__kb.press('Escape')");
    await waitUntil('!window.__kb.helpOpen()', 'help to close');
  }

  // ── Billing: registry-driven footer + Return/Refund wiring ────────────────
  section('Billing keyboard');
  await js("window.__kb.nav('Billing')");
  await waitUntil("window.__kb.activeNavLabel() === 'Billing'", 'nav "Billing" to activate');
  await waitUntil("!!document.querySelector('.shortcuts')", 'Billing to render');
  check('Billing page mounted', (await js("!!document.querySelector('.shortcuts')")) === true);

  // The one-line footer hint bar is generated from the shared shortcut registry.
  const footer = await js("(document.querySelector('.shortcuts')?.innerText || '').replace(/\\s+/g, ' ')");
  check('Billing footer lists Ctrl+Shift+R return',
    /Ctrl\+Shift\+R return/i.test(footer), footer.trim().slice(0, 140));
  check('Billing footer lists save / save+print / print',
    /Ctrl\+S save/i.test(footer) && /Ctrl\+Shift\+S save\+print/i.test(footer) && /Ctrl\+P print/i.test(footer));

  // Ctrl+F focuses the search / barcode input.
  await js("window.__kb.press('Ctrl+f')");
  await sleep(150);
  check('Ctrl+F focuses the Billing search input',
    (await js('window.__kb.focusedTag()')) === 'INPUT', await js('window.__kb.focusedTag()'));

  // Ctrl+Shift+R opens Return / Refund. Pre-2.16 this combo matched an unhandled
  // action (toast) and/or Electron's forceReload; it must open the modal now.
  await js("window.__kb.press('Ctrl+Shift+r')");
  await waitUntil('window.__kb.hasModal()', 'Return / Refund modal to open');
  const retTitle = await js('window.__kb.modalTitle()');
  check('Ctrl+Shift+R opens the Return / Refund modal', /Return\s*\/\s*Refund/i.test(retTitle), retTitle);
  await js("window.__kb.press('Escape')");
  await waitUntil('!window.__kb.hasModal()', 'Return / Refund modal to close');
  check('Escape closes the Return / Refund modal', true);

  // F2 is the registry-defined "focus search" key for the billing screen.
  await js("window.__kb.press('F2')");
  await sleep(120);
  check('F2 focuses the Billing search input',
    (await js('window.__kb.focusedTag()')) === 'INPUT', await js('window.__kb.focusedTag()'));

  // ── Login: Enter advances from username to password ──────────────────────
  section('Login keyboard');
  await goToLoginScreen();
  await js("window.__t.set(0, 'admin')");
  // Focus the username box, then Enter must move focus to the password box.
  await js("window.__t.inputs()[0].focus()");
  await js("window.__kb.press('Enter')");
  await sleep(120);
  check('Enter on the username field moves focus to the password field',
    (await js('document.activeElement === window.__t.inputs()[1]')) === true);

  await js("window.__t.set(1, 'OwnerPass1')");
  await js("window.__kb.press('Enter')");
  await waitUntil('!window.__t.hasLoginBox()', 'login to complete', 12000);
  check('Enter on the password field submits the login', true);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('keyboard_smoke crashed:', e);
  app.exit(1);
});
