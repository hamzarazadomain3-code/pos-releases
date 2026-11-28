#!/usr/bin/env node
/**
 * Bill amendment — END-TO-END UI suite.
 *
 * Boots the REAL built renderer (`dist/renderer`) in a real BrowserWindow with the
 * real preload and the real IPC handlers, then clicks the actual buttons a shop
 * owner would click:
 *
 *   Billing -> History -> Amend -> Notes -> type -> Ctrl+Enter -> saved
 *
 * This is the phase the service suite cannot cover: that the Amend button exists
 * for the right role, that the tabbed modal renders, that Ctrl+Enter is wired,
 * that the IPC channel names line up end to end, and that the service's refusal
 * reaches the operator verbatim.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_billAmendUi.cjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-bill-amend-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'bill-amend-ui.db');
// A fresh userData per run: Electron persists localStorage there, and a saved
// session from an earlier run would skip the login screen this suite drives.
app.setPath('userData', path.join(tmpDir, 'userdata'));

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

/** Injected into the page; every step drives the real DOM through it. */
const HELPERS = `
window.__a = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__a.loginRoot(); return b ? b.innerText : ''; },
  // The "Restoring session..." spinner is ALSO a .lock-box with no fields, so a
  // bare element check would race it. The login screen is the one with the form.
  hasLogin: () => {
    const b = window.__a.loginRoot();
    if (!b) return false;
    const inputs = b.querySelectorAll('input');
    return inputs.length >= 2 && /sign in/i.test(b.innerText);
  },
  loginInputs: () => { const b = window.__a.loginRoot(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  setLogin: (i, v) => {
    const el = window.__a.loginInputs()[i];
    if (!el) throw new Error('no login input at ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  clickLogin: (label) => {
    const b = window.__a.loginRoot();
    const btn = b && Array.from(b.querySelectorAll('button'))
      .find((x) => (x.innerText || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!btn) throw new Error('no login button matching: ' + label);
    btn.click();
    return true;
  },
  buttons: () => Array.from(document.querySelectorAll('button')),
  click: (label) => {
    const all = window.__a.buttons();
    const el = all.find((b) => (b.innerText || '').trim().toLowerCase() === label.toLowerCase())
      || all.find((b) => (b.innerText || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!el) throw new Error('no button matching: ' + label);
    el.click();
    return true;
  },
  clickSelector: (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element: ' + sel);
    el.click();
    return true;
  },
  set: (sel, v) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no field: ' + sel);
    const proto = el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  },
  value: (sel) => { const el = document.querySelector(sel); return el ? el.value : null; },
  ctrlEnter: (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no field for Ctrl+Enter: ' + sel);
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    return true;
  },
  escape: () => {
    const modals = Array.from(document.querySelectorAll('.modal[role="dialog"]'));
    const el = modals.length ? modals[modals.length - 1] : document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    return true;
  },
  exists: (sel) => !!document.querySelector(sel),
  count: (sel) => document.querySelectorAll(sel).length,
  modalText: () => {
    const modals = Array.from(document.querySelectorAll('.modal[role="dialog"]'));
    const m = modals[modals.length - 1];
    return m ? m.innerText : '';
  },
  hasModalTitled: (needle) => window.__a.modalText().toLowerCase().includes(needle.toLowerCase()),
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__a').catch(() => false);
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
    await new Promise((r) => setTimeout(r, 120));
  }
  let extra = '';
  try {
    const modal = await js('window.__a ? window.__a.modalText().slice(0, 200) : "no helpers"');
    const page = await js('document.body ? document.body.innerText.slice(0, 160) : ""');
    extra = `top modal: ${JSON.stringify(modal)}; page: ${JSON.stringify(page)}`;
  } catch {
    extra = 'page unavailable';
  }
  throw new Error(`timed out waiting for ${desc} (${extra})`);
}

async function waitText(needle, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const t = await js('window.__a.text()');
      if (t && t.toLowerCase().includes(needle.toLowerCase())) return true;
    } catch {
      await ensureHelpers();
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out waiting for text "${needle}"`);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitUntil('window.__a.hasLogin()', 'the login screen', 25000);
  await js(`window.__a.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__a.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__a.clickLogin('Login')");
  // Either the app mounts, or a fresh database forces the owner to replace the
  // default password first (the same modal the recovery suite clears).
  await waitUntil(
    "!window.__a.hasLogin() || /owner password/i.test(window.__a.loginText())",
    `login as ${username}`,
    20000
  );
  if (await js("/owner password/i.test(window.__a.loginText())")) {
    await js("window.__a.setLogin(0, 'OwnerPass1')");
    await js("window.__a.setLogin(1, 'OwnerPass1')");
    await js("window.__a.clickLogin('Save')");
    await waitUntil('!window.__a.hasLogin()', 'the forced password modal to close', 20000);
  }
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const sales = require('../dist/main/services/sales.js');
  const shifts = require('../dist/main/services/shifts.js');
  const admin = require('../dist/main/services/admin.js');

  await initDatabase();
  const db = getDb();

  // The amendment runs through the REAL service, so this shop has to be licensed
  // the same way seed_demo makes it (a sale is refused without a licence).
  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  // A shop with no name would send the renderer to the First-Run Wizard instead
  // of the login screen (App.tsx restore-session effect), which this suite does
  // not exercise.
  settings.setSetting('shop_name', 'UI Amend Shop');

  auth.setSessionUser(1);
  const product = inventory.createProduct({
    name: 'UI Amend Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 100,
    tax_rate: 0,
  });
  const customerA = sales.createCustomer('UI Amend Customer A');
  shifts.openShift(1000);
  const sale = sales.createSale({
    items: [{ product_id: product.id, qty: 2, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerA.id,
    payments: [{ mode: 'cash', amount: 200 }],
  });
  const saleId = sale.sale.id;
  const invoiceNo = sale.sale.invoice_no;

  // A manager, for the "amend_allow_manager = 0" refusal screen.
  auth.createUser({ username: 'amend_manager', password: 'Manager123', pin: '2222', role: 'manager' });

  registerIpcHandlers();

  // Channels main.ts / updater.ts / licensing.ts register in the real app.
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - Bill Amendment UI (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ── Login ────────────────────────────────────────────────────────────────
  section('Boot and sign in as the owner');
  await signIn('admin', 'admin123');
  check('the owner lands inside the app', !(await js('window.__a.hasLogin()')));
  await waitUntil(
    "window.__a.buttons().some((b) => (b.innerText || '').trim() === 'History')",
    'the Billing screen (History button)',
    25000
  );
  check('Billing mounted for the owner', true);

  // ── The finished bill is reachable, and the owner sees Amend ─────────────
  section('The finished bill is in Sales History, with an Amend button');
  await js("window.__a.click('History')");
  await waitUntil('window.__a.count(\'[data-testid="history-open-bill"]\') > 0', 'the sale row in Sales History');
  check('the amended-disabled bill row has a "Bill" opener', true);
  await waitUntil('window.__a.count(\'[data-testid="history-amend"]\') > 0', 'the owner-only Amend button');
  check('the owner sees the Amend button', true);

  // ── The "Bill" path reaches the Sale Detail, which also offers Amend ─────
  section('Sale Detail also offers Amend Bill');
  await js('window.__a.clickSelector(\'[data-testid="history-open-bill"]\')');
  await waitUntil('window.__a.hasModalTitled("Sale Detail")', 'the Sale Detail modal');
  check('Sale Detail opened from the history row', true);
  check('Sale Detail has an Amend Bill button', await js('window.__a.exists(\'[data-testid="amend-open"]\')'));

  // ── The amend modal ─────────────────────────────────────────────────────
  section('The tabbed amend modal');
  await js('window.__a.clickSelector(\'[data-testid="amend-open"]\')');
  await waitUntil('window.__a.exists(\'[data-testid="amend-summary"]\')', 'the amend modal body');
  const tabs = await js('window.__a.modalText()');
  check('the title names the bill', /Amend Bill/i.test(tabs) && tabs.includes(invoiceNo), invoiceNo);
  check('the Customer tab exists', /Customer/.test(tabs));
  check('the Payments & Udhaar tab exists', /Payments & Udhaar/.test(tabs));
  check('the Notes tab exists', /\bNotes\b/.test(tabs));
  check('the Return items tab exists', /Return items/.test(tabs));
  check('the Reprint tab exists', /Reprint/.test(tabs));
  check('the summary shows the bill total', /200/.test(tabs));
  check('the keyboard hint is shown', /Ctrl\+Enter saves/.test(tabs));

  // ── A blank reason is refused, and nothing is written ───────────────────
  section('A reason is required — refused in the UI before any write');
  await js("window.__a.click('Notes')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-notes"]\')', 'the Notes tab');
  await js('window.__a.set(\'[data-testid="amend-notes"]\', \'Customer called - address fixed\')');
  const amendmentsBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  await js("window.__a.click('Save Notes')");
  await waitUntil('window.__a.modalText().includes("reason is required")', 'the reason error');
  check('the UI refuses a blank reason', true);
  const amendmentsAfterBlank = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  check('a refused save writes no amendment row', amendmentsAfterBlank === amendmentsBefore, `${amendmentsBefore} -> ${amendmentsAfterBlank}`);

  // ── Ctrl+Enter saves the notes amendment ────────────────────────────────
  section('Ctrl+Enter saves a notes amendment');
  await js('window.__a.set(\'[data-testid="amend-reason"]\', \'customer called on the phone\')');
  await js('window.__a.ctrlEnter(\'[data-testid="amend-reason"]\')');
  await waitUntil('window.__a.exists(\'[data-testid="amend-saved"]\')', 'the saved notice');
  check('the modal confirms the save', true);
  const notesRow = db
    .prepare("SELECT * FROM sale_amendments WHERE sale_id = ? AND kind = 'notes' ORDER BY id DESC LIMIT 1")
    .get(saleId);
  check('the real service wrote the notes amendment', !!notesRow, notesRow ? `kind=${notesRow.kind}` : 'missing');
  check('the reason reached the database', notesRow && notesRow.reason === 'customer called on the phone', notesRow && notesRow.reason);
  check(
    'the sale carries the new notes',
    sales.getSale(saleId).notes === 'Customer called - address fixed',
    String(sales.getSale(saleId).notes)
  );
  await waitUntil('window.__a.count(\'[data-testid="amend-history-row"]\') > 0', 'the amendment history row');
  check('the modal lists the amendment in its history', true);

  // ── A split that does not add up is refused; a correct one saves ────────
  section('Payments & Udhaar: the split must add up');
  await js("window.__a.click('Payments & Udhaar')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-split-credit"]\')', 'the split fields');
  await js('window.__a.set(\'[data-testid="amend-split-cash"]\', \'50\')');
  await js('window.__a.set(\'[data-testid="amend-split-credit"]\', \'50\')');
  await js('window.__a.set(\'[data-testid="amend-reason"]\', \'half on udhaar\')');
  await js("window.__a.click('Save Split')");
  await waitUntil('window.__a.modalText().toLowerCase().includes("must add up")', 'the split-total refusal');
  check('a split that does not add up is refused', true);
  const rowsAfterBadSplit = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  check('the refused split wrote nothing', rowsAfterBadSplit === amendmentsAfterBlank + 1, String(rowsAfterBadSplit));

  await js('window.__a.set(\'[data-testid="amend-split-cash"]\', \'50\')');
  await js('window.__a.set(\'[data-testid="amend-split-credit"]\', \'150\')');
  await waitUntil(
    'window.__a.exists(\'[data-testid="amend-preview"]\') && /150/.test(window.__a.modalText())',
    'the live before -> after preview'
  );
  check('the live before -> after preview shows the new udhaar', true);
  const splitTotalText = await js('window.__a.text()');
  check(
    'the running total says the split adds up',
    await js('window.__a.exists(\'[data-testid="amend-split-total"]\') && window.__a.modalText().includes("Adds up to")'),
    splitTotalText.includes('Adds up to 200') ? 'adds up to 200' : ''
  );
  await js('window.__a.ctrlEnter(\'[data-testid="amend-reason"]\')');
  await waitUntil(
    "window.__a.count('[data-testid=\"amend-saved\"]') > 0",
    'the payments amendment to save'
  );
  const payRow = db
    .prepare("SELECT * FROM sale_amendments WHERE sale_id = ? AND kind = 'payments' ORDER BY id DESC LIMIT 1")
    .get(saleId);
  check('the payments amendment was written', !!payRow);
  check('the cash effect is -150 (the drawer gave 150 back)', payRow && Math.abs(Number(payRow.cash_effect) + 150) < 0.005, payRow && String(payRow.cash_effect));
  check('the credit effect is +150 (the customer owes it)', payRow && Math.abs(Number(payRow.credit_effect) - 150) < 0.005, payRow && String(payRow.credit_effect));
  check(
    'the ledger row moves the udhaar',
    Math.abs(Number(db.prepare("SELECT balance FROM customers WHERE id = ?").get(customerA.id).balance) - 150) < 0.005,
    String(db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerA.id).balance)
  );
  check('the bill total never changed', Math.abs(Number(sales.getSale(saleId).total_amount) - 200) < 0.005);

  // ── Esc closes the modal ────────────────────────────────────────────────
  section('Esc closes the amend modal');
  await js('window.__a.escape()');
  await waitUntil('!window.__a.exists(\'[data-testid="amend-summary"]\')', 'the amend modal to close');
  check('Esc closed the amend modal', true);
  await js('window.__a.escape()');
  await waitUntil('!window.__a.hasModalTitled("Sale Detail")', 'the Sale Detail to close');
  check('Esc closed the Sale Detail underneath', true);

  // ── The settings the owner can change ───────────────────────────────────
  section('The two owner settings are exposed to the Settings screen');
  const allSettings = await js('window.api.admin.settings.getAll()');
  check('amend_allow_manager is readable', allSettings && typeof allSettings.amend_allow_manager === 'string', allSettings && allSettings.amend_allow_manager);
  check('amend_max_days_back is readable', allSettings && typeof allSettings.amend_max_days_back === 'string', allSettings && allSettings.amend_max_days_back);

  // ── A manager is refused when the owner switches the setting off ────────
  section('A manager sees the service refusal verbatim when the setting is off');
  admin.setAdminSetting('amend_allow_manager', '0');
  await js('window.api.auth.logout()');
  await js('localStorage.clear()');
  await js('window.location.reload()');
  await new Promise((r) => setTimeout(r, 900));
  await signIn('amend_manager', 'Manager123');
  await waitUntil(
    "window.__a.buttons().some((b) => (b.innerText || '').trim() === 'History')",
    'Billing mounted for the manager',
    25000
  );
  await js("window.__a.click('History')");
  await waitUntil('window.__a.count(\'[data-testid="history-amend"]\') > 0', 'the manager\'s Amend button');
  check('a manager does get the Amend button (the setting decides, server-side)', true);
  await js('window.__a.clickSelector(\'[data-testid="history-amend"]\')');
  await waitUntil('window.__a.exists(\'[data-testid="amend-blocked"]\')', 'the blocked notice');
  const blockedText = await js('window.__a.modalText()');
  check('the modal shows the refusal', /cannot amend bills in this shop/i.test(blockedText), blockedText.slice(0, 120));
  check('the blocked screen offers no save button', !/Save (Customer|Split|Notes)/.test(blockedText));
  const rowsAtEnd = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  check('the refused manager wrote nothing', rowsAtEnd === 2, String(rowsAtEnd));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_billAmendUi crashed:', e);
  app.exit(1);
});

// A UI test that never finishes is a failure, not a hang for the operator.
setTimeout(() => {
  console.error('WATCHDOG: the UI suite did not finish in 240s');
  app.exit(2);
}, 240000);
