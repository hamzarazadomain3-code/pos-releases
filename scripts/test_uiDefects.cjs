#!/usr/bin/env node
/**
 * Phase 0 item 0.14 — the four UI defects, driven in the REAL renderer.
 *
 * This suite boots the REAL built renderer (`dist/renderer`) in a real
 * BrowserWindow with the real preload and the real IPC handlers, then drives
 * the four screens the owner complained about:
 *
 *   1. THE EMPTY-CART CHECKOUT — with an empty cart the checkout button was
 *      disabled but still looked like the bright green primary action and
 *      still said "Pay & Save". Now it says the cart is empty AND it is
 *      dimmed, and it comes back to life the moment an item is in the cart.
 *
 *   2. THE PO SUPPLIER DROPDOWN — changing the supplier with lines already in
 *      the order used to re-label the whole order silently (the items added
 *      for supplier A were created against supplier B). Now the owner is asked
 *      what should happen to those lines and the order cannot be created
 *      until that is settled.
 *
 *   3. THE DUPLICATE ROWS — two places could put the same product on two
 *      rows: the cart's Undo (it re-inserted the removed line blindly) and the
 *      PO modal's per-row product cell. Both now MERGE the quantity instead of
 *      showing a twin.
 *
 *   4. THE MINIMIZED CARD — the assistant drawer (z-index 60) sat above the
 *      modal overlay (50), so the docked (minimized) card disappeared behind
 *      the drawer and could not be restored. The modal is now above the
 *      drawer, and the docked card is proven to be the thing the mouse hits.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_uiDefects.cjs
 *
 * Exit code 0 = every check passed. PowerShell can still report 1 because of
 * Electron's stderr banner; trust the "ALL PASSED" line and $LASTEXITCODE.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-ui-defects-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'ui-defects.db');
// A fresh userData per run: Electron persists localStorage there, and a saved
// session from an earlier run would skip the login screen this suite drives.
app.setPath('userData', path.join(tmpDir, 'userdata'));

const PROOF_DIR = process.env.ROKAR_PROOF_DIR || 'E:\\temp\\proof';
try {
  fs.mkdirSync(PROOF_DIR, { recursive: true });
} catch {
  /* the screenshots are evidence, not a requirement */
}

let checks = 0;
let failures = 0;
let win;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Injected into the page; every step drives the real DOM through it. */
const HELPERS = `
window.__ui = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__ui.loginRoot(); return b ? b.innerText : ''; },
  hasLogin: () => {
    const b = window.__ui.loginRoot();
    if (!b) return false;
    const inputs = b.querySelectorAll('input');
    return inputs.length >= 2 && /sign in/i.test(b.innerText);
  },
  loginInputs: () => { const b = window.__ui.loginRoot(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  setLogin: (i, v) => {
    const el = window.__ui.loginInputs()[i];
    if (!el) throw new Error('no login input at ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  clickLogin: (label) => {
    const b = window.__ui.loginRoot();
    const btn = b && Array.from(b.querySelectorAll('button'))
      .find((x) => (x.innerText || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!btn) throw new Error('no login button matching: ' + label);
    btn.click();
    return true;
  },

  exists: (sel) => !!document.querySelector(sel),
  count: (sel) => document.querySelectorAll(sel).length,
  textOf: (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : null;
  },
  valueOf: (sel) => {
    const el = document.querySelector(sel);
    return el ? el.value : null;
  },
  disabled: (sel) => {
    const el = document.querySelector(sel);
    return el ? !!el.disabled : null;
  },
  opacity: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return Number(window.getComputedStyle(el).opacity);
  },
  rect: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
  },
  viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),

  setVal: (sel, v) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element: ' + sel);
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  },
  setSelect: (sel, v) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element: ' + sel);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  },
  press: (sel, key, opts) => {
    const el = document.querySelector(sel) || document.body;
    el.focus();
    const o = opts || {};
    const ev = new KeyboardEvent('keydown', {
      key: key,
      code: o.code || key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!o.ctrl,
      shiftKey: !!o.shift,
      altKey: !!o.alt,
      metaKey: !!o.meta,
    });
    el.dispatchEvent(ev);
    return true;
  },
  pressWindow: (key, opts) => {
    const o = opts || {};
    const ev = new KeyboardEvent('keydown', {
      key: key,
      code: o.code || key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!o.ctrl,
      shiftKey: !!o.shift,
      altKey: !!o.alt,
      metaKey: !!o.meta,
    });
    window.dispatchEvent(ev);
    return true;
  },
  click: (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element: ' + sel);
    el.click();
    return true;
  },
  clickText: (sel, text) => {
    const el = Array.from(document.querySelectorAll(sel)).find(
      (b) => (b.innerText || '').trim().toLowerCase() === String(text).toLowerCase()
    ) || Array.from(document.querySelectorAll(sel)).find(
      (b) => (b.innerText || '').trim().toLowerCase().includes(String(text).toLowerCase())
    );
    if (!el) throw new Error('no ' + sel + ' matching: ' + text);
    el.click();
    return true;
  },
  nav: (route) => {
    const el = document.querySelector('[data-guide-id="nav.' + route + '"]');
    if (!el) throw new Error('no nav button: ' + route);
    el.click();
    return true;
  },

  /* ── the bill ── */
  checkoutLabel: () => {
    const b = document.querySelector('.action-btn-pay-save');
    return b ? (b.innerText || '').trim() : null;
  },
  checkoutTitle: () => {
    const b = document.querySelector('.action-btn-pay-save');
    return b ? b.getAttribute('title') : null;
  },
  cartRows: () => Array.from(document.querySelectorAll('.cart-row')).map((r) => ({
    name: (r.querySelector('.cart-info strong') || {}).innerText || '',
    qty: (() => {
      const q = r.querySelector('.qty-val') || r.querySelector('.line-qty-input');
      return q ? Number(q.value) : null;
    })(),
  })),
  browseItem: (name) => {
    const el = Array.from(document.querySelectorAll('.browse-item')).find(
      (b) => ((b.querySelector('.browse-item-name') || {}).innerText || '').trim().toLowerCase() === String(name).toLowerCase()
    );
    if (!el) throw new Error('no browse item: ' + name);
    el.click();
    return true;
  },

  /* ── the modal ── */
  modal: () => document.querySelector('.modal'),
  winButtons: () => Array.from(document.querySelectorAll('.modal .modal-win-btn')).map((b) => b.getAttribute('aria-label')),
  clickWinButton: (label) => {
    const b = Array.from(document.querySelectorAll('.modal .modal-win-btn')).find(
      (x) => (x.getAttribute('aria-label') || '').toLowerCase() === String(label).toLowerCase()
    );
    if (!b) throw new Error('no window button: ' + label);
    b.click();
    return true;
  },
  minimized: () => !!document.querySelector('.modal[data-minimized="true"]'),
  /** What the mouse would hit at the centre of a box. */
  topAt: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    return {
      tag: hit.tagName,
      cls: hit.className || '',
      inModal: !!hit.closest('.modal'),
      inAssistant: !!hit.closest('.assistant-panel'),
      text: (hit.innerText || '').trim().slice(0, 60),
    };
  },
  assistantOpen: () => !!document.querySelector('.assistant-panel'),
  openAssistant: () => {
    const b = document.querySelector('.sidebar-bottom-actions .sidebar-footer-btn');
    if (!b) throw new Error('no assistant button');
    b.click();
    return true;
  },
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__ui').catch(() => false);
  if (!present) await js(HELPERS);
}

async function waitUntil(expr, desc, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await js(expr)) return true;
    } catch {
      await ensureHelpers();
    }
    await sleep(120);
  }
  let extra = '';
  try {
    extra = `page: ${JSON.stringify((await js('document.body ? document.body.innerText.slice(0, 300) : ""')))}`;
  } catch {
    extra = 'page unavailable';
  }
  throw new Error(`timed out waiting for ${desc} (${extra})`);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitUntil('window.__ui.hasLogin()', 'the login screen', 25000);
  await js(`window.__ui.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__ui.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__ui.clickLogin('Login')");
  await waitUntil(
    "!window.__ui.hasLogin() || /owner password/i.test(window.__ui.loginText())",
    `login as ${username}`,
    20000
  );
  if (await js("/owner password/i.test(window.__ui.loginText())")) {
    await js("window.__ui.setLogin(0, 'OwnerPass1')");
    await js("window.__ui.setLogin(1, 'OwnerPass1')");
    await js("window.__ui.clickLogin('Save')");
    await waitUntil('!window.__ui.hasLogin()', 'the forced password modal to close', 20000);
  }
}

/** A screenshot is evidence — it is written next to the test output. */
async function shot(name) {
  const file = path.join(PROOF_DIR, `p0_0.14_${name}.png`);
  try {
    // The window is off-screen, so the compositor can hand back a STALE frame.
    // Let it settle, then take the LAST of two captures.
    await sleep(600);
    let image = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        image = await win.webContents.capturePage();
        if (image && !image.isEmpty()) break;
      } catch (e) {
        if (attempt === 2) throw e;
      }
      await sleep(500);
    }
    if (!image) throw new Error('empty capture');
    await sleep(300);
    try {
      image = await win.webContents.capturePage();
    } catch {
      /* keep the first one */
    }
    fs.writeFileSync(file, image.toPNG());
    console.log(`  [shot] ${file}`);
  } catch (e) {
    console.log(`  [shot] could not capture ${name}: ${String(e).slice(0, 120)}`);
  }
}

async function run() {
  // safeStorage / BrowserWindow need a ready app.
  if (typeof app.whenReady === 'function') {
    try {
      await app.whenReady();
    } catch {
      /* already ready */
    }
  }
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');

  await initDatabase();
  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  settings.setSetting('shop_name', 'UI Defects Shop');
  auth.setSessionUser(1);

  const alpha = purchases.createSupplier('Alpha Wholesale', '0300-1111111', 'Lahore');
  const beta = purchases.createSupplier('Beta Traders', '0300-2222222', 'Karachi');
  const widget = inventory.createProduct({
    name: 'Defect Widget',
    sku: 'DEF-1',
    barcode: '8200000000001',
    cost_price: 60,
    sale_price: 100,
    stock_qty: 40,
    low_stock_threshold: 3,
    min_stock_level: 3,
    reorder_qty: 10,
    tax_rate: 0,
  });
  const gadget = inventory.createProduct({
    name: 'Defect Gadget',
    sku: 'DEF-2',
    barcode: '8200000000002',
    cost_price: 120,
    sale_price: 200,
    stock_qty: 12,
    low_stock_threshold: 2,
    min_stock_level: 2,
    reorder_qty: 5,
    tax_rate: 0,
  });
  inventory.recordMovement(widget.id, 40, 'Opening stock', 'manual', null);
  inventory.recordMovement(gadget.id, 12, 'Opening stock', 'manual', null);

  registerIpcHandlers();
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - the four UI defects (end-to-end) ===');

  win = new BrowserWindow({
    // On-screen: an off-screen window does not always get a fresh composited
    // frame, and capturePage() would then hand back a STALE screenshot.
    x: 0,
    y: 0,
    width: 1360,
    height: 900,
    show: true,
    frame: false,
    backgroundThrottling: false,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  section('Boot + sign in');
  await signIn('admin', 'admin123');
  check('the owner is inside the app', !(await js('window.__ui.hasLogin()')));
  // The registry defaults (F4 = the bill edit) so the keyboard paths work.
  await js('window.api.admin.shortcuts.reset()').catch(() => undefined);

  // ── 1. The empty-cart checkout ───────────────────────────────────────────
  section('1 - the empty cart never shows a live-looking checkout');
  // An open shift, so the button's ONLY problem is the empty cart.
  const shift = await js('window.api.shifts.open(1000).then((s) => ({ ok: true, id: s && s.id })).catch((e) => ({ ok: false, err: String(e) }))');
  check('the shift is open (so the empty cart is the only blocker)', shift && shift.ok === true, JSON.stringify(shift));
  // Mount Billing fresh so it reads the open shift.
  await js("window.__ui.nav('dashboard')").catch(() => undefined);
  await sleep(500);
  await js("window.__ui.nav('billing')");
  await waitUntil("window.__ui.exists('.action-btn-pay-save')", 'the Billing page', 25000);
  await waitUntil("window.__ui.exists('.browse-item')", 'the product grid', 20000);

  const emptyLabel = await js('window.__ui.checkoutLabel()');
  const emptyDisabled = await js("window.__ui.disabled('.action-btn-pay-save')");
  const emptyOpacity = await js("window.__ui.opacity('.action-btn-pay-save')");
  check('the checkout button is disabled with an empty cart', emptyDisabled === true, String(emptyDisabled));
  check(
    'the checkout button does NOT claim a sale is ready',
    !!emptyLabel && !/pay\s*&\s*save/i.test(emptyLabel),
    String(emptyLabel)
  );
  check('the checkout button says the cart is empty', /add items/i.test(String(emptyLabel)), String(emptyLabel));
  check(
    'the checkout button explains why (the title)',
    /empty/i.test(String(await js('window.__ui.checkoutTitle()'))),
    String(await js('window.__ui.checkoutTitle()'))
  );
  check(
    'the disabled checkout button is DIMMED (it does not look live)',
    typeof emptyOpacity === 'number' && emptyOpacity < 0.9,
    String(emptyOpacity)
  );
  await shot('01_empty_cart');

  // The label comes back when the cart has something in it.
  await js("window.__ui.browseItem('Defect Widget')");
  await waitUntil('window.__ui.cartRows().length === 1', 'the product in the cart', 10000);
  await sleep(300);
  const fullLabel = await js('window.__ui.checkoutLabel()');
  const fullDisabled = await js("window.__ui.disabled('.action-btn-pay-save')");
  check('with an item in the cart the button says "Pay & Save"', /pay\s*&\s*save/i.test(String(fullLabel)), String(fullLabel));
  check('with an item in the cart the button is live', fullDisabled === false, String(fullDisabled));
  await shot('02_cart_with_item');

  // ── 3a. The duplicate row in the cart (the Undo) ─────────────────────────
  section('3 - the cart never shows the same product on two rows');
  const beforeUndo = await js('window.__ui.cartRows()');
  check('the cart holds the one product', beforeUndo.length === 1, JSON.stringify(beforeUndo));

  // Bill-edit mode (F4) + Delete removes the row and offers the Undo.
  await js("window.__ui.pressWindow('F4', { code: 'F4' })");
  await waitUntil("window.__ui.exists('.cart-row-billedit')", 'the bill-edit mode', 10000);
  check('F4 opened the bill-edit mode', true);
  await js("window.__ui.pressWindow('Delete', { code: 'Delete' })");
  await waitUntil('window.__ui.cartRows().length === 0', 'the removed row', 10000);
  check('the row was removed', (await js('window.__ui.cartRows()')).length === 0);

  // The same product goes back into the cart BEFORE the undo.
  await js("window.__ui.browseItem('Defect Widget')");
  await waitUntil('window.__ui.cartRows().length === 1', 'the product back in the cart', 10000);
  await sleep(250);
  const undoBtn = await js(
    "Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === 'Undo')"
  );
  check('the undo offer is on screen', undoBtn === true);

  await js("window.__ui.clickText('button', 'Undo')");
  await sleep(400);
  const afterUndo = await js('window.__ui.cartRows()');
  check(
    'the undo did NOT bring back a twin row (one row for the product)',
    afterUndo.length === 1,
    JSON.stringify(afterUndo)
  );
  check(
    'the undo put the quantity back into that one row',
    afterUndo.length === 1 && Number(afterUndo[0].qty) === 2,
    JSON.stringify(afterUndo)
  );
  await shot('03_cart_after_undo');

  // Leave the cart empty for the next checks.
  await js("window.__ui.clickText('.cart-row .btn-danger', '×')").catch(() => undefined);
  await sleep(200);

  // ── 2. The PO supplier dropdown ──────────────────────────────────────────
  section('2 - the PO supplier dropdown never re-labels an order silently');
  await js("window.__ui.nav('purchases')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('.tab-btn')).find((b) => /purchase orders/i.test(b.innerText))",
    'the Purchases screen',
    25000
  );
  await js("window.__ui.clickText('.tab-btn', 'Purchase Orders')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('button')).find((b) => /new purchase order/i.test(b.innerText))",
    'the New Purchase Order button',
    15000
  );
  await js("window.__ui.clickText('button', 'New Purchase Order')");
  await waitUntil("window.__ui.exists('.modal.modal-po')", 'the Purchase Order modal', 15000);

  // Supplier A + one line.
  await js(`window.__ui.setSelect('[data-testid="po-supplier"]', '${alpha.id}')`);
  await waitUntil("window.__ui.exists('[data-testid=\"po-body\"]')", 'the modal body', 10000);
  await js("window.__ui.setVal('[data-testid=\"po-search\"]', 'Defect Widget')");
  await waitUntil("window.__ui.count('.search-result-item') > 0", 'the search dropdown', 10000);
  await js("window.__ui.press('[data-testid=\"po-search\"]', 'Enter')");
  await js("window.__ui.press('[data-testid=\"po-search\"]', 'Enter')");
  await waitUntil("window.__ui.exists('.quantity-input-box')", 'the qty box', 10000);
  await js("window.__ui.setVal('.quantity-input-box input', '3')");
  await js("window.__ui.press('.quantity-input-box input', 'Enter')");
  await waitUntil("window.__ui.count('[data-po-line]') === 1", 'the PO line', 10000);
  check('the PO has one line for Alpha Wholesale', (await js("window.__ui.count('[data-po-line]')")) === 1);

  // Now swap the supplier — the order still carries Alpha's item.
  await js(`window.__ui.setSelect('[data-testid="po-supplier"]', '${beta.id}')`);
  await waitUntil("window.__ui.exists('[data-testid=\"po-supplier-switch\"]')", 'the supplier warning', 10000);
  const warning = await js("window.__ui.textOf('[data-testid=\"po-supplier-switch\"]')");
  check('the owner is told the supplier changed', !!warning && /Alpha Wholesale/.test(warning), String(warning).slice(0, 160));
  check(
    'the order cannot be created while the question is open',
    (await js("window.__ui.disabled('[data-testid=\"po-create\"]')")) === true
  );
  await shot('04_po_supplier_switch');

  // The owner keeps the items for the new supplier.
  await js("window.__ui.click('[data-testid=\"po-supplier-keep-new\"]')");
  await waitUntil("!window.__ui.exists('[data-testid=\"po-supplier-switch\"]')", 'the warning to clear', 10000);
  check('the warning is gone after the owner decides', true);
  check(
    'the order can be created again',
    (await js("window.__ui.disabled('[data-testid=\"po-create\"]')")) === false
  );
  check('the line was NOT lost', (await js("window.__ui.count('[data-po-line]')")) === 1);

  // ── 3b. The duplicate row in the PO modal (the per-row product cell) ──────
  section('3 - the PO modal never puts the same product on two rows');
  // A second line, then re-pick the FIRST product on it.
  await js("window.__ui.setVal('[data-testid=\"po-search\"]', 'Defect Gadget')");
  await waitUntil("window.__ui.count('.search-result-item') > 0", 'the second product', 10000);
  await js("window.__ui.press('[data-testid=\"po-search\"]', 'Enter')");
  await js("window.__ui.press('[data-testid=\"po-search\"]', 'Enter')");
  await waitUntil("window.__ui.exists('.quantity-input-box')", 'the qty box', 10000);
  await js("window.__ui.setVal('.quantity-input-box input', '2')");
  await js("window.__ui.press('.quantity-input-box input', 'Enter')");
  await waitUntil("window.__ui.count('[data-po-line]') === 2", 'the second PO line', 10000);
  check('the PO now has two different products', (await js("window.__ui.count('[data-po-line]')")) === 2);

  // Re-pick "Defect Widget" on the SECOND row — it is already on the first.
  await js("window.__ui.click('[data-testid=\"po-pick-open-1\"]')");
  await waitUntil("window.__ui.exists('[data-testid=\"po-pick-1\"]')", 'the per-row search', 10000);
  await js("window.__ui.setVal('[data-testid=\"po-pick-search-1\"]', 'Defect Widget')");
  await waitUntil("window.__ui.count('[data-testid=\"po-pick-option-1-0\"]') > 0", 'the pick options', 10000);
  await js("window.__ui.click('[data-testid=\"po-pick-option-1-0\"]')");
  await sleep(400);
  const poLines = await js(
    "Array.from(document.querySelectorAll('[data-po-line]')).map((l) => (l.innerText || '').slice(0, 60))"
  );
  check(
    'the duplicate product was MERGED (the order still has one row for it)',
    (await js("window.__ui.count('[data-po-line]')")) === 1,
    JSON.stringify(poLines)
  );
  const mergedQty = await js("window.__ui.valueOf('[data-testid=\"po-qty-0\"]')");
  check('the merged row carries BOTH quantities (3 + 2 = 5)', Number(mergedQty) === 5, String(mergedQty));
  await shot('05_po_merged_rows');

  // ── 4. The minimized card ────────────────────────────────────────────────
  section('4 - the minimized card stays on top and can be restored');
  // The assistant drawer is the thing that used to cover it.
  await js('window.__ui.openAssistant()').catch(() => undefined);
  await sleep(400);
  check('the assistant drawer is open', (await js('window.__ui.assistantOpen()')) === true);

  const topInModal = await js("window.__ui.topAt('.modal.modal-po')");
  check(
    'the dialog is ON TOP of the assistant drawer',
    !!topInModal && topInModal.inModal === true && topInModal.inAssistant === false,
    JSON.stringify(topInModal)
  );

  // Minimize it — the docked card must be visible and clickable.
  await js("window.__ui.clickWinButton('Minimize')");
  await waitUntil('window.__ui.minimized()', 'the dialog to dock', 10000);
  check('the dialog docked', (await js('window.__ui.minimized()')) === true);
  const cardRect = await js("window.__ui.rect('.modal[data-minimized=\"true\"]')");
  const viewport = await js('window.__ui.viewport()');
  check(
    'the docked card is inside the window',
    !!cardRect && cardRect.right <= viewport.w + 1 && cardRect.bottom <= viewport.h + 1 && cardRect.w > 40,
    `card ${JSON.stringify(cardRect)} viewport ${JSON.stringify(viewport)}`
  );
  const topAtCard = await js("window.__ui.topAt('.modal[data-minimized=\"true\"]')");
  check(
    'the docked card is what the mouse hits (the drawer does NOT cover it)',
    !!topAtCard && topAtCard.inModal === true && topAtCard.inAssistant === false,
    JSON.stringify(topAtCard)
  );
  await shot('06_minimized_card');

  // And it can be restored.
  await js("window.__ui.click('.modal[data-minimized=\"true\"] .modal-header')");
  await waitUntil('!window.__ui.minimized()', 'the dialog to restore', 10000);
  check('the docked card restores the dialog', !(await js('window.__ui.minimized()')));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('ALL PASSED');
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
