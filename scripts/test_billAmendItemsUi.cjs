#!/usr/bin/env node
/**
 * Bill amendment — the ITEMS tab, END-TO-END UI suite.
 *
 * Boots the REAL built renderer (`dist/renderer`) in a real BrowserWindow with
 * the real preload and the real IPC handlers, then drives the actual Items tab:
 *
 *   Billing -> History -> Amend -> Items -> change the qty -> Save Items
 *
 * This is the phase the service suite cannot cover: that the Items tab exists
 * and renders the bill's lines, that the qty / price inputs are wired, that the
 * before -> after preview shows the NEW total, that a product can be added and
 * removed, and that the IPC channel name lines up end to end — so the stock and
 * the FIFO really move when the owner saves.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_billAmendItemsUi.cjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-bill-amend-items-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'bill-amend-items-ui.db');
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
  textOf: (sel) => { const el = document.querySelector(sel); return el ? el.innerText : null; },
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
    extra = `top modal: ${JSON.stringify((await js('window.__a.modalText()')).slice(0, 200))}`;
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

/**
 * Open one specific bill from Sales History.
 *
 * The history list is newest first, so "the first row" is NOT a stable way to
 * reach a given bill — the invoice number is.
 */
async function openBillByInvoice(invoiceNo) {
  await js("window.__a.click('History')");
  await waitUntil('window.__a.count(\'[data-testid="history-open-bill"]\') > 0', 'the sale rows in Sales History');
  const opened = await js(`
    (() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="history-open-bill"]'));
      for (const r of rows) {
        const row = r.closest('tr') || r.closest('.history-row') || r.parentElement;
        if (row && row.innerText && row.innerText.includes(${JSON.stringify(invoiceNo)})) {
          r.click();
          return true;
        }
      }
      return false;
    })()
  `);
  if (opened !== true) throw new Error(`the invoice ${invoiceNo} is not in the history list`);
  await waitUntil('window.__a.hasModalTitled("Sale Detail")', 'the Sale Detail modal');
  await js('window.__a.clickSelector(\'[data-testid="amend-open"]\')');
  await waitUntil('window.__a.exists(\'[data-testid="amend-summary"]\')', 'the amend modal body');
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const sales = require('../dist/main/services/sales.js');
  const shifts = require('../dist/main/services/shifts.js');
  const returns = require('../dist/main/services/returns.js');

  await initDatabase();
  const db = getDb();

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  settings.setSetting('shop_name', 'UI Items Shop');

  auth.setSessionUser(1);
  const widget = inventory.createProduct({
    name: 'UI Items Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 100,
    tax_rate: 0,
  });
  const gadget = inventory.createProduct({
    name: 'UI Items Gadget',
    sale_price: 50,
    cost_price: 20,
    stock_qty: 40,
    tax_rate: 0,
  });
  const spare = inventory.createProduct({
    name: 'UI Items Spare',
    sale_price: 25,
    cost_price: 5,
    stock_qty: 30,
    tax_rate: 0,
  });
  const customer = sales.createCustomer('UI Items Customer');
  shifts.openShift(1000);

  // The bill: 2 widgets + 1 gadget = 250, paid in cash.
  const sale = sales.createSale({
    items: [
      { product_id: widget.id, qty: 2, price: 100, line_discount: 0, tax_rate: 0 },
      { product_id: gadget.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 },
    ],
    customer_id: customer.id,
    payments: [{ mode: 'cash', amount: 250 }],
  });
  const saleId = sale.sale.id;
  const invoiceNo = sale.sale.invoice_no;

  // A second bill that has a return — its items must be locked.
  const returnedSale = sales.createSale({
    items: [{ product_id: widget.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const returnedRow = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(returnedSale.sale.id);
  returns.createReturn({
    sale_id: returnedSale.sale.id,
    reason: 'customer sent it back',
    refund_mode: 'cash',
    restock: true,
    items: [{ sale_item_id: returnedRow.id, qty: 1, unit_price: 100 }],
  });

  registerIpcHandlers();
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - Bill Amendment Items UI (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  section('Boot and sign in as the owner');
  await signIn('admin', 'admin123');
  check('the owner lands inside the app', !(await js('window.__a.hasLogin()')));
  await waitUntil(
    "window.__a.buttons().some((b) => (b.innerText || '').trim() === 'History')",
    'the Billing screen (History button)',
    25000
  );

  // ── Open the bill's amend modal ──────────────────────────────────────────
  section('Open the Items tab of a finished bill');
  await openBillByInvoice(invoiceNo);

  const tabs = await js('window.__a.modalText()');
  check('the Items tab exists', /Items/.test(tabs), tabs.slice(0, 80));

  await js("window.__a.click('Items')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-items-tab"]\')', 'the Items tab body');
  check('the Items tab renders', true);
  const qtyInputs = '[data-testid^="amend-item-qty-"]';
  check(
    'both lines of the bill are listed',
    (await js(`window.__a.count(${JSON.stringify(qtyInputs)})`)) === 2,
    String(await js(`window.__a.count(${JSON.stringify(qtyInputs)})`))
  );
  check(
    'the qty input carries the billed quantity',
    (await js(`window.__a.value('[data-testid="amend-item-qty-${widget.id}"]')`)) === '2',
    String(await js(`window.__a.value('[data-testid="amend-item-qty-${widget.id}"]')`))
  );
  check(
    'the price input carries the billed price',
    (await js(`window.__a.value('[data-testid="amend-item-price-${widget.id}"]')`)) === '100',
    String(await js(`window.__a.value('[data-testid="amend-item-price-${widget.id}"]')`))
  );

  // ── The preview shows the NEW total and the stock delta ──────────────────
  section('The preview shows the new total and the stock delta');
  check('there is no preview before a change', !(await js('window.__a.exists(\'[data-testid="amend-preview"]\')')));
  await js(`window.__a.set('[data-testid="amend-item-qty-${widget.id}"]', '1')`);
  await waitUntil('window.__a.exists(\'[data-testid="amend-preview"]\')', 'the items preview');
  const newTotal = await js('window.__a.textOf(\'[data-testid="amend-items-new-total"]\')');
  check('the preview shows the new total (150)', /150/.test(newTotal || ''), String(newTotal));
  const stockLine = await js('window.__a.textOf(\'[data-testid="amend-stock-' + widget.id + '"]\')');
  check('the preview says the stock comes back', /stock \+1/.test(stockLine || ''), String(stockLine));

  // ── Saving really moves the stock and rewrites the bill ──────────────────
  section('Saving the Items amendment');
  const stockBefore = Number(inventory.getProduct(widget.id).stock_qty);
  await js("window.__a.set('[data-testid=\"amend-reason\"]', 'the customer took one, not two')");
  await js("window.__a.click('Save Items')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-saved"]\')', 'the saved notice');
  check('the modal confirms the save', true);

  const itemsRow = db
    .prepare("SELECT * FROM sale_amendments WHERE sale_id = ? AND kind = 'items' ORDER BY id DESC LIMIT 1")
    .get(saleId);
  check('the real service wrote an items amendment', !!itemsRow, itemsRow ? `kind=${itemsRow.kind}` : 'missing');
  check(
    'the reason reached the database',
    itemsRow && itemsRow.reason === 'the customer took one, not two',
    itemsRow && itemsRow.reason
  );
  const stockAfter = Number(inventory.getProduct(widget.id).stock_qty);
  check('the stock came back', stockAfter === stockBefore + 1, `${stockBefore} -> ${stockAfter}`);
  check('the bill total is 150 now', Math.abs(Number(sales.getSale(saleId).total_amount) - 150) < 0.005, String(sales.getSale(saleId).total_amount));
  const itemTotal = Number(
    db.prepare('SELECT COALESCE(SUM(line_total), 0) AS t FROM sale_items WHERE sale_id = ?').get(saleId).t
  );
  check('the items add up to the bill', Math.abs(itemTotal - 150) < 0.005, String(itemTotal));
  const qtyNow = Number(
    db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM sale_items WHERE sale_id = ? AND product_id = ?')
      .get(saleId, widget.id).q
  );
  check('the billed quantity is 1 now', qtyNow === 1, String(qtyNow));

  // ── Adding a product from the search ─────────────────────────────────────
  section('Adding a product to the bill');
  await js("window.__a.set('[data-testid=\"amend-item-search\"]', 'Spare')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-item-results"]\')', 'the product search results');
  check('the search found the product', true);
  await js(`window.__a.clickSelector('[data-testid="amend-item-add-${spare.id}"]')`);
  await waitUntil(
    `window.__a.exists('[data-testid="amend-item-qty-${spare.id}"]')`,
    'the added line in the Items tab'
  );
  check('the added line is in the tab', true);
  check('the tab now lists three lines', (await js(`window.__a.count(${JSON.stringify(qtyInputs)})`)) === 3);
  const addedTotal = await js('window.__a.textOf(\'[data-testid="amend-items-new-total"]\')');
  check('the preview counts the added line (175)', /175/.test(addedTotal || ''), String(addedTotal));

  // ── Removing a line ──────────────────────────────────────────────────────
  section('Removing a line');
  await js(`window.__a.clickSelector('[data-testid="amend-item-remove-${gadget.id}"]')`);
  await waitUntil(
    `!window.__a.exists('[data-testid="amend-item-qty-${gadget.id}"]')`,
    'the removed line to disappear'
  );
  check('the line is gone from the tab', true);
  check('the tab lists two lines now', (await js(`window.__a.count(${JSON.stringify(qtyInputs)})`)) === 2);

  // ── A blank reason is still refused ──────────────────────────────────────
  section('A reason is still required for an items amendment');
  const rowsBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  await js("window.__a.click('Save Items')");
  await waitUntil('window.__a.modalText().includes("reason is required")', 'the reason error');
  check('the UI refuses a blank reason', true);
  const rowsAfter = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c);
  check('a refused save writes no amendment row', rowsAfter === rowsBefore, `${rowsBefore} -> ${rowsAfter}`);

  // ── A refunded bill locks its items ──────────────────────────────────────
  section('A refunded bill locks its items');
  await js('window.__a.escape()');
  await waitUntil('!window.__a.exists(\'[data-testid="amend-summary"]\')', 'the amend modal to close');
  await openBillByInvoice(returnedSale.sale.invoice_no);
  await js("window.__a.click('Items')");
  await waitUntil('window.__a.exists(\'[data-testid="amend-items-tab"]\')', 'the Items tab of the returned bill');
  check('the Items tab explains why it is locked', await js('window.__a.exists(\'[data-testid="amend-items-blocked"]\')'));
  const lockedText = await js('window.__a.textOf(\'[data-testid="amend-items-blocked"]\')');
  check('the message names the return', /return/i.test(lockedText || ''), String(lockedText));
  check(
    'there is no Save Items button',
    !(await js('window.__a.buttons().some((b) => (b.innerText || "").trim() === "Save Items")'))
  );

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_billAmendItemsUi crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the items-amendment UI suite did not finish in 240s');
  app.exit(2);
}, 240000);
