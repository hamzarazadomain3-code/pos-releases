#!/usr/bin/env node
/**
 * Reports — Amend Bill from the period's bill list (end-to-end UI).
 *
 * Boots the REAL built renderer, signs in, opens Reports, and checks the
 * "Bills in this period" panel: the bill is listed, it carries an Amend
 * button, and clicking it opens the BillAmendModal for that bill.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_reportsAmendUi.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-reports-amend-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'reports-amend-ui.db');
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

const HELPERS = `
window.__a = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__a.loginRoot(); return b ? b.innerText : ''; },
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
  clickNav: (label) => {
    const el = Array.from(document.querySelectorAll('.nav-btn')).find(
      (b) => (b.getAttribute('data-label') || '').toLowerCase() === label.toLowerCase()
    );
    if (!el) throw new Error('no nav button: ' + label);
    el.click();
    return true;
  },
  navExists: (label) => Array.from(document.querySelectorAll('.nav-btn')).some(
    (b) => (b.getAttribute('data-label') || '').toLowerCase() === label.toLowerCase()
  ),
  exists: (sel) => !!document.querySelector(sel),
  count: (sel) => document.querySelectorAll(sel).length,
  billsPanelText: () => {
    const p = Array.from(document.querySelectorAll('.panel'))
      .find((x) => (x.innerText || '').toLowerCase().indexOf('bills in this period') >= 0);
    return p ? p.innerText : '';
  },
  billsPanelExists: () => Array.from(document.querySelectorAll('.panel'))
    .some((x) => (x.innerText || '').toLowerCase().indexOf('bills in this period') >= 0),
  amendButtons: () => document.querySelectorAll('[data-testid="reports-amend"]').length,
  clickAmend: (idx) => {
    const btns = Array.from(document.querySelectorAll('[data-testid="reports-amend"]'));
    if (!btns[idx]) throw new Error('no amend button at index ' + idx);
    btns[idx].click();
    return true;
  },
  amendModalText: () => {
    const m = Array.from(document.querySelectorAll('.modal[role="dialog"]'))
      .find((x) => (x.innerText || '').indexOf('Amend Bill') >= 0);
    return m ? m.innerText : '';
  },
  amendModalExists: () => Array.from(document.querySelectorAll('.modal[role="dialog"]'))
    .some((x) => (x.innerText || '').indexOf('Amend Bill') >= 0),
  modalClose: () => {
    const modals = Array.from(document.querySelectorAll('.modal[role="dialog"]'));
    const el = modals.length ? modals[modals.length - 1] : document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    return true;
  },
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
    const page = await js('document.body ? document.body.innerText.slice(0, 300) : ""');
    extra = `page: ${JSON.stringify(page)}`;
  } catch {
    extra = 'page unavailable';
  }
  throw new Error(`timed out waiting for ${desc} (${extra})`);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitUntil('window.__a.hasLogin()', 'the login screen', 25000);
  await js(`window.__a.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__a.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__a.clickLogin('Login')");
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

  await initDatabase();
  const db = getDb();

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  settings.setSetting('shop_name', 'Reports Amend UI Shop');

  auth.setSessionUser(1);

  const product = inventory.createProduct({
    name: 'Reports Amend Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 100,
    tax_rate: 0,
  });
  const customerA = sales.createCustomer('Reports Amend Customer');
  shifts.openShift(1000);

  const sale = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerA.id,
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const invoiceNo = sale.sale.invoice_no;

  registerIpcHandlers();

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - Reports Amend (end-to-end UI) ===');

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
  await waitUntil("window.__a.navExists('Reports')", 'the Reports nav button', 25000);

  // ── Open Reports ─────────────────────────────────────────────────────────
  section('Open Reports and the bills panel');
  await js("window.__a.clickNav('Reports')");
  await waitUntil('window.__a.billsPanelExists()', "the 'Bills in this period' panel", 25000);
  const panelText = await js('window.__a.billsPanelText()');
  check('the panel lists the period\'s bill', panelText.includes(invoiceNo), invoiceNo);
  check('the panel shows the customer', panelText.includes('Reports Amend Customer'));
  check('the panel shows the bill total', /100/.test(panelText));

  // ── The Amend button ─────────────────────────────────────────────────────
  section('The bill row carries an Amend button');
  const amendCount = await js('window.__a.amendButtons()');
  check('exactly one Amend button (the one completed bill)', amendCount === 1, `count=${amendCount}`);

  // ── Click Amend → BillAmendModal opens with the right invoice ───────────
  section('Clicking Amend opens the BillAmendModal for that bill');
  await js('window.__a.clickAmend(0)');
  await waitUntil('window.__a.amendModalExists()', 'the BillAmendModal', 10000);
  const amendText = await js('window.__a.amendModalText()');
  check('the modal is titled Amend Bill', (amendText || '').indexOf('Amend Bill') >= 0);
  check('the modal mentions the invoice number', (amendText || '').includes(invoiceNo), invoiceNo);
  check('the Customer tab exists', /Customer/.test(amendText));
  check('the Notes tab exists', /\bNotes\b/.test(amendText));
  check('the Payments & Udhaar tab exists', /Payments & Udhaar/.test(amendText));
  check('the Return items tab exists', /Return items/.test(amendText));
  check('the Reprint tab exists', /Reprint/.test(amendText));

  // ── Esc closes it ────────────────────────────────────────────────────────
  section('Esc closes the amend modal');
  await js('window.__a.modalClose()');
  await waitUntil('!window.__a.amendModalExists()', 'the amend modal to close', 5000);
  check('Esc closed the amend modal', true);
  check('the Reports page is still there', await js('window.__a.billsPanelExists()'));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_reportsAmendUi crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the UI suite did not finish in 240s');
  app.exit(2);
}, 240000);
