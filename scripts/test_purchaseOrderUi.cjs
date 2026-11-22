#!/usr/bin/env node
/**
 * The Purchase Order screen — END-TO-END UI suite.
 *
 * Boots the REAL built renderer (`dist/renderer`) in a real BrowserWindow with
 * the real preload and the real IPC handlers, then drives the Purchase Order
 * modal the way the shop owner does:
 *
 *   - the modal opens, its body SCROLLS and its footer (Total / Create /
 *     Cancel) is ALWAYS visible — the layout bug this work fixed,
 *   - no empty rows are prefilled; the owner adds what they want,
 *   - the staged search still works: Enter 1x select, 2x qty, 3x add,
 *   - the row auto-fills (the cost, the qty, the tax) and shows the LIVE
 *     inventory (the stock, the last purchase cost, the unit conversion),
 *   - the cost-change warning and the margin warning appear,
 *   - the validation is visible and the Create button is disabled while the
 *     order is broken,
 *   - Delete removes a row and the undo brings it back,
 *   - Ctrl+S saves a draft, Ctrl+Enter creates the order,
 *   - the created order shows up in the list with its status chip.
 *
 * The service + pure maths are covered by `npm run test:purchaseEnhance` and
 * `npm run test:purchaseInventoryLink`; this suite covers the SCREEN.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_purchaseOrderUi.cjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-po-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'po-ui.db');
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
window.__po = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__po.loginRoot(); return b ? b.innerText : ''; },
  hasLogin: () => {
    const b = window.__po.loginRoot();
    if (!b) return false;
    const inputs = b.querySelectorAll('input');
    return inputs.length >= 2 && /sign in/i.test(b.innerText);
  },
  loginInputs: () => { const b = window.__po.loginRoot(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  setLogin: (i, v) => {
    const el = window.__po.loginInputs()[i];
    if (!el) throw new Error('no login input at ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  clickLogin: (label) => {
    const b = window.__po.loginRoot();
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
  rect: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
  },
  scroll: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop };
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
  focus: (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element: ' + sel);
    el.focus();
    return document.activeElement === el;
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
  modal: () => document.querySelector('.modal.modal-po') || document.querySelector('.modal'),
  footer: () => {
    const m = window.__po.modal();
    return m ? m.querySelector('.modal-footer') : null;
  },
  body: () => {
    const m = window.__po.modal();
    return m ? m.querySelector('.modal-body') : null;
  },
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__po').catch(() => false);
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
    extra = `page: ${JSON.stringify((await js('document.body ? document.body.innerText.slice(0, 300) : ""')))}`;
  } catch {
    extra = 'page unavailable';
  }
  throw new Error(`timed out waiting for ${desc} (${extra})`);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitUntil('window.__po.hasLogin()', 'the login screen', 25000);
  await js(`window.__po.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__po.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__po.clickLogin('Login')");
  await waitUntil(
    "!window.__po.hasLogin() || /owner password/i.test(window.__po.loginText())",
    `login as ${username}`,
    20000
  );
  if (await js("/owner password/i.test(window.__po.loginText())")) {
    await js("window.__po.setLogin(0, 'OwnerPass1')");
    await js("window.__po.setLogin(1, 'OwnerPass1')");
    await js("window.__po.clickLogin('Save')");
    await waitUntil('!window.__po.hasLogin()', 'the forced password modal to close', 20000);
  }
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');

  await initDatabase();
  const db = getDb();

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  // A shop with no name would send the renderer to the First-Run Wizard.
  settings.setSetting('shop_name', 'Purchase Order UI Shop');

  auth.setSessionUser(1);

  const supplier = purchases.createSupplier('UI Wholesale', '0300-3333333', 'Lahore');
  // The costing switch is OFF for this suite, so a received purchase records
  // the LAST purchase cost but leaves the product's own cost_price alone —
  // exactly what the live link has to show.
  settings.setSetting('po_update_cost_price', '0');
  // A product bought in CARTONS: 1 carton = 12 pieces.
  const oil = inventory.createProduct({
    name: 'UI Cooking Oil',
    sku: 'UI-OIL',
    barcode: '8100000000001',
    cost_price: 1200,
    sale_price: 1500,
    low_stock_threshold: 10,
    min_stock_level: 10,
    reorder_qty: 24,
    tax_rate: 5,
    units: [
      { level: 0, name: 'Piece', quantity_in_base_units: 1, is_base: true },
      { level: 1, name: 'Carton', quantity_in_base_units: 12, is_base: false },
    ],
  });
  const sugar = inventory.createProduct({
    name: 'UI Sugar',
    sku: 'UI-SUGAR',
    barcode: '8100000000002',
    cost_price: 130,
    sale_price: 160,
    low_stock_threshold: 20,
    min_stock_level: 20,
    reorder_qty: 50,
    tax_rate: 0,
  });
  inventory.recordMovement(oil.id, 4, 'Opening stock', 'manual', null);
  inventory.recordMovement(sugar.id, 4, 'Opening stock', 'manual', null);

  // The sugar has a purchase history: its LAST purchase cost (140) differs
  // from the product's own cost price (130) — the row must show BOTH.
  const historyPo = purchases.createPurchaseOrder(supplier.id, [
    { product_id: sugar.id, qty: 1, unit_cost: 140, units_in_base: 1, unit_name: 'Piece', tax_pct: 0 },
  ], { status: 'ordered' });
  purchases.receivePurchaseOrder(historyPo.id);

  registerIpcHandlers();

  // The channels main.ts / updater.ts / licensing.ts register in the real app.
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - Purchase Order screen (end-to-end UI) ===');

  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ── Login + navigate ─────────────────────────────────────────────────────
  section('Boot, sign in and open the Purchase Orders screen');
  await signIn('admin', 'admin123');
  check('the owner lands inside the app', !(await js('window.__po.hasLogin()')));

  await js("window.__po.nav('purchases')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('.tab-btn')).find((b) => /purchase orders/i.test(b.innerText))",
    'the Purchases screen',
    25000
  );
  await js("window.__po.clickText('.tab-btn', 'Purchase Orders')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('button')).find((b) => /new purchase order/i.test(b.innerText))",
    'the New Purchase Order button',
    15000
  );
  check('the Purchase Orders tab is open', true);

  // ── The modal opens ──────────────────────────────────────────────────────
  section('The modal opens — the body scrolls, the footer never clips');
  await js("window.__po.clickText('button', 'New Purchase Order')");
  await waitUntil("window.__po.exists('.modal.modal-po')", 'the Purchase Order modal', 15000);
  check('the Purchase Order modal is open', true);
  await waitUntil("window.__po.exists('[data-testid=\"po-body\"]')", 'the modal body', 10000);

  const footerRect = await js('window.__po.rect(\'.modal.modal-po .modal-footer\')');
  const viewport = await js('window.__po.viewport()');
  check('the footer exists', !!footerRect, JSON.stringify(footerRect));
  check(
    'the footer is fully inside the window (it is NOT clipped)',
    !!footerRect && footerRect.bottom <= viewport.h + 1 && footerRect.top >= 0 && footerRect.h > 20,
    `footer ${JSON.stringify(footerRect)} viewport ${JSON.stringify(viewport)}`
  );
  const bodyScroll = await js('window.__po.scroll(\'[data-testid="po-body"]\')');
  check('the modal body is a scroll area', !!bodyScroll && bodyScroll.scrollHeight >= bodyScroll.clientHeight, JSON.stringify(bodyScroll));

  check('no empty rows are prefilled', (await js("window.__po.count('[data-po-line]')")) === 0);
  check('the empty state tells the owner what to do', !!(await js("window.__po.textOf('[data-testid=\"po-empty\"]')")));
  check('the Create button is disabled while the order is empty', (await js("window.__po.disabled('[data-testid=\"po-create\"]')")) === true);
  const validationText = await js("window.__po.textOf('[data-testid=\"po-validation\"]')");
  check('the reason is visible', !!validationText && validationText.length > 0, validationText);

  // ── The supplier-aware buttons ───────────────────────────────────────────
  section('The supplier decides what the owner can add');
  await js(`window.__po.setSelect('[data-testid="po-supplier"]', '${supplier.id}')`);
  await waitUntil("window.__po.exists('[data-testid=\"po-add-low-stock\"]')", 'the low-stock button', 10000);
  check('the low-stock button appears once a supplier is chosen', true);
  check(
    'the supplier-products button appears once a supplier is chosen',
    !!(await js("window.__po.exists('[data-testid=\"po-add-supplier-products\"]')"))
  );
  const lowBtnDisabled = await js("window.__po.disabled('[data-testid=\"po-add-low-stock\"]')");
  check('the low-stock button is enabled', lowBtnDisabled === false, String(lowBtnDisabled));

  // The suggestion list carries the SUGGESTED quantity (the reorder qty, else
  // the gap to the reorder level).
  await js("window.__po.click('[data-testid=\"po-add-low-stock\"]')");
  await waitUntil("window.__po.exists('[data-testid=\"po-suggestions\"]')", 'the suggestion list', 10000);
  const suggestionText = await js("window.__po.textOf('[data-testid=\"po-suggestions\"]')");
  check('the suggestion list is shown', !!suggestionText, String(suggestionText).slice(0, 120));
  check('the suggestion list carries the suggested qty (24)', /suggested\s*24/.test(suggestionText), String(suggestionText).slice(0, 220));
  check('the suggestion list carries the live stock', /stock\s*4\s*\/\s*min\s*10/.test(suggestionText), String(suggestionText).slice(0, 220));
  check('no rows were added by the suggestion list yet (the owner confirms)', (await js("window.__po.count('[data-po-line]')")) === 0);
  await js("window.__po.clickText('[data-testid=\"po-suggestions\"] button', 'Close')");
  await waitUntil("!window.__po.exists('[data-testid=\"po-suggestions\"]')", 'the suggestion list to close', 10000);
  check('the suggestion list can be closed without adding anything', true);

  // ── The staged search (Enter 1x select, 2x qty, 3x add) ──────────────────
  section('The staged search still works: Enter 1x select, 2x qty, 3x add');
  await js("window.__po.setVal('[data-testid=\"po-search\"]', 'UI Cooking Oil')");
  await waitUntil("window.__po.count('.search-result-item') > 0", 'the search dropdown', 10000);
  check('the dropdown lists the product', (await js("window.__po.count('.search-result-item')")) > 0);

  await js("window.__po.press('[data-testid=\"po-search\"]', 'Enter')"); // 1x -> select
  await js("window.__po.press('[data-testid=\"po-search\"]', 'Enter')"); // 2x -> qty
  await waitUntil("window.__po.exists('.quantity-input-box')", 'the qty box', 10000);
  check('the second Enter opens the qty box', true);

  await js("window.__po.setVal('.quantity-input-box input', '2')");
  await js("window.__po.press('.quantity-input-box input', 'Enter')"); // 3x -> add
  await waitUntil("window.__po.count('[data-po-line]') === 1", 'the added line', 10000);
  check('the third Enter adds the line', (await js("window.__po.count('[data-po-line]')")) === 1);

  const lineName = await js("window.__po.textOf('[data-testid=\"po-line-0\"] .po-line-name')");
  check('the line shows the product', !!lineName && lineName.indexOf('UI Cooking Oil') >= 0, String(lineName));

  // ── The auto-fill + the live inventory ───────────────────────────────────
  section('The row auto-fills and shows the LIVE inventory');
  const cost = await js("window.__po.valueOf('[data-testid=\"po-cost-0\"]')");
  check('the cost was auto-filled from the product', Number(cost) === 1200, String(cost));
  const qty = await js("window.__po.valueOf('[data-testid=\"po-qty-0\"]')");
  check('the qty the owner typed wins (2)', Number(qty) === 2, String(qty));
  const tax = await js("window.__po.valueOf('[data-testid=\"po-tax-0\"]')");
  check('the tax was auto-filled from the product', Number(tax) === 5, String(tax));
  const lineText = await js("window.__po.textOf('[data-testid=\"po-line-0\"]')");
  check('the line shows the live stock', /stock/i.test(lineText), lineText.slice(0, 160));
  check('the line shows the product own cost price', /cost 1200/.test(lineText), lineText.slice(0, 160));

  // The unit conversion: the base unit was chosen (Piece), so pick the carton.
  const unitOptions = await js(
    "Array.from(document.querySelectorAll('[data-testid=\"po-unit-0\"] option')).map((o) => ({ v: o.value, t: o.textContent.trim() }))"
  );
  check('the unit dropdown offers the pack as well', unitOptions.length >= 2, JSON.stringify(unitOptions));
  const carton = unitOptions.find((o) => /carton/i.test(o.t));
  check('the carton is offered', !!carton, JSON.stringify(unitOptions));
  if (carton) {
    await js(`window.__po.setSelect('[data-testid="po-unit-0"]', '${carton.v}')`);
    await waitUntil("window.__po.exists('[data-testid=\"po-conversion-0\"]')", 'the conversion', 10000);
    const conversion = await js("window.__po.textOf('[data-testid=\"po-conversion-0\"]')");
    check('the conversion is shown (qty = base qty)', /=\s*\d+\s*pcs/.test(conversion), String(conversion));
    check('the per-base cost is shown', /per base unit/.test(conversion), String(conversion));
  }

  // ── The totals ───────────────────────────────────────────────────────────
  section('The totals block is exact');
  const grand = await js("window.__po.textOf('[data-testid=\"po-total-grand\"]')");
  const lineTotal = await js("window.__po.textOf('[data-testid=\"po-line-total-0\"]')");
  const subtotal = await js("window.__po.textOf('[data-testid=\"po-subtotal\"]')");
  const taxTotal = await js("window.__po.textOf('[data-testid=\"po-tax-total\"]')");
  check('the subtotal is shown', subtotal !== null, String(subtotal));
  check('the tax is shown', taxTotal !== null, String(taxTotal));
  check('the grand total is shown', grand !== null, String(grand));
  const grandNum = Number(grand);
  const lineNum = Number(lineTotal);
  const taxNum = Number(taxTotal);
  const subtotalNum = Number(subtotal);
  check('the line total already carries the tax', Math.abs(lineNum - (subtotalNum + taxNum)) < 0.02, `line ${lineTotal} subtotal ${subtotal} tax ${taxTotal}`);
  check(
    'the grand total is the line total (the discount and the freight are 0)',
    Math.abs(grandNum - lineNum) < 0.02,
    `grand ${grand} line ${lineTotal}`
  );

  // ── The cost-change warning ──────────────────────────────────────────────
  section('The cost-change warning appears when the cost moves');
  check('no warning at the product cost', !(await js("window.__po.exists('[data-testid=\"po-cost-warning-0\"]')")));
  await js("window.__po.setVal('[data-testid=\"po-cost-0\"]', '1500')");
  await waitUntil("window.__po.exists('[data-testid=\"po-cost-warning-0\"]')", 'the cost warning', 10000);
  const warning = await js("window.__po.textOf('[data-testid=\"po-cost-warning-0\"]')");
  check('the warning shows the old and the new cost', /1200/.test(warning) && /1500/.test(warning), String(warning));
  check('the warning shows the % change', /%/.test(warning), String(warning));

  // ── The margin warning ───────────────────────────────────────────────────
  section('The margin is shown on the row');
  const margin = await js("window.__po.textOf('[data-testid=\"po-margin-0\"]')");
  check('the margin % is shown', !!margin && /margin/.test(margin), String(margin));

  // ── The validation ───────────────────────────────────────────────────────
  section('A broken order cannot be created — and the reason is visible');
  await js("window.__po.setVal('[data-testid=\"po-qty-0\"]', '0')");
  await waitUntil("window.__po.disabled('[data-testid=\"po-create\"]') === true", 'the Create button to be disabled', 10000);
  check('the Create button is disabled for a zero qty', true);
  const reason = await js("window.__po.textOf('[data-testid=\"po-validation\"]')");
  check('the reason is visible to the owner', !!reason && reason.length > 0, String(reason));
  await js("window.__po.setVal('[data-testid=\"po-qty-0\"]', '2')");
  await waitUntil("window.__po.disabled('[data-testid=\"po-create\"]') === false", 'the Create button to come back', 10000);
  check('a valid order can be created again', true);

  // ── Delete + undo ────────────────────────────────────────────────────────
  section('Delete removes the row and the undo brings it back');
  await js("window.__po.focus('[data-testid=\"po-qty-0\"]')");
  await js("window.__po.press('[data-testid=\"po-qty-0\"]', 'Delete', { code: 'Delete' })");
  await waitUntil("window.__po.count('[data-po-line]') === 0", 'the removed row', 10000);
  check('Delete removed the row', (await js("window.__po.count('[data-po-line]')")) === 0);
  check('the undo banner is shown', !!(await js("window.__po.exists('[data-testid=\"po-undo-banner\"]')")));
  await js("window.__po.click('[data-testid=\"po-undo\"]')");
  await waitUntil("window.__po.count('[data-po-line]') === 1", 'the restored row', 10000);
  check('the undo restored the row', (await js("window.__po.count('[data-po-line]')")) === 1);

  // ── The per-row searchable product cell ──────────────────────────────────
  section("The row's product cell is searchable");
  await js("window.__po.click('[data-testid=\"po-pick-open-0\"]')");
  await waitUntil("window.__po.exists('[data-testid=\"po-pick-0\"]')", 'the per-row search', 10000);
  check('the product cell opens a search INSIDE the row', true);
  await js("window.__po.setVal('[data-testid=\"po-pick-search-0\"]', 'UI Sugar')");
  await waitUntil("window.__po.count('[data-testid=\"po-pick-option-0-0\"]') > 0", 'the pick options', 10000);
  const pickName = await js("window.__po.textOf('[data-testid=\"po-pick-option-0-0\"] .psr-name')");
  check('the row search finds the product by its name', pickName === 'UI Sugar', String(pickName));
  await js("window.__po.click('[data-testid=\"po-pick-option-0-0\"]')");
  await waitUntil("!window.__po.exists('[data-testid=\"po-pick-0\"]')", 'the picker to close', 10000);
  const pickedName = await js("window.__po.textOf('[data-testid=\"po-pick-open-0\"]')");
  check('the row now shows the picked product', pickedName === 'UI Sugar', String(pickedName));
  const pickedCost = await js("window.__po.valueOf('[data-testid=\"po-cost-0\"]')");
  check('the picked product re-fills the cost from its LAST purchase', Number(pickedCost) === 140, String(pickedCost));
  // Back to the oil, so the draft below is the oil order.
  await js("window.__po.click('[data-testid=\"po-pick-open-0\"]')");
  await js("window.__po.setVal('[data-testid=\"po-pick-search-0\"]', 'UI Cooking Oil')");
  await waitUntil("window.__po.exists('[data-testid=\"po-pick-option-0-0\"]')", 'the oil option', 10000);
  await js("window.__po.click('[data-testid=\"po-pick-option-0-0\"]')");
  await waitUntil("!window.__po.exists('[data-testid=\"po-pick-0\"]')", 'the picker to close again', 10000);
  const backCost = await js("window.__po.valueOf('[data-testid=\"po-cost-0\"]')");
  check('switching back re-fills the product cost', Number(backCost) === 1200, String(backCost));

  // ── Ctrl+S = Save draft ──────────────────────────────────────────────────
  section('Ctrl+S saves a draft');
  // The key is pressed INSIDE the modal: the modal's own handler claims it
  // (and stops it from reaching the window), exactly like a real key press.
  await js("window.__po.press('[data-testid=\"po-body\"]', 's', { ctrl: true, code: 'KeyS' })");
  await waitUntil("!window.__po.exists('.modal.modal-po')", 'the modal to close after the draft', 15000);
  const draftCount = Number(
    db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE status = 'draft'").get().c
  );
  check('the draft was written to the database', draftCount === 1, String(draftCount));
  const draftTotal = Number(
    db.prepare("SELECT total_amount FROM purchase_orders WHERE status = 'draft' LIMIT 1").get().total_amount
  );
  check('a draft costs nothing', draftTotal === 0, String(draftTotal));

  // ── Ctrl+Enter = Create ──────────────────────────────────────────────────
  section('Ctrl+Enter creates the order and the list shows it');
  await js("window.__po.clickText('button', 'New Purchase Order')");
  await waitUntil("window.__po.exists('.modal.modal-po')", 'the modal again', 15000);
  await js(`window.__po.setSelect('[data-testid="po-supplier"]', '${supplier.id}')`);
  await js("window.__po.setVal('[data-testid=\"po-search\"]', 'UI Sugar')");
  await waitUntil("window.__po.count('.search-result-item') > 0", 'the sugar dropdown', 10000);
  await js("window.__po.press('[data-testid=\"po-search\"]', 'Enter')");
  await js("window.__po.press('[data-testid=\"po-search\"]', 'Enter')");
  await waitUntil("window.__po.exists('.quantity-input-box')", 'the qty box', 10000);
  await js("window.__po.setVal('.quantity-input-box input', '5')");
  await js("window.__po.press('.quantity-input-box input', 'Enter')");
  await waitUntil("window.__po.count('[data-po-line]') === 1", 'the sugar line', 10000);

  // The LIVE link: the row shows the last purchase cost (140) next to the
  // product's own cost price (130).
  const sugarText = await js("window.__po.textOf('[data-testid=\"po-line-0\"]')");
  check('the row shows the last purchase cost', /last cost 140/.test(sugarText), sugarText.slice(0, 200));
  check('the row shows the product own cost price', /cost 130/.test(sugarText), sugarText.slice(0, 200));
  const sugarCost = await js("window.__po.valueOf('[data-testid=\"po-cost-0\"]')");
  check('the cost was auto-filled from the LAST purchase cost', Number(sugarCost) === 140, String(sugarCost));

  await js("window.__po.press('[data-testid=\"po-body\"]', 'Enter', { ctrl: true, code: 'Enter' })");
  await waitUntil("!window.__po.exists('.modal.modal-po')", 'the modal to close after the create', 15000);
  const ordered = Number(
    db.prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE status = 'ordered'").get().c
  );
  check('the order was created', ordered === 1, String(ordered));
  await waitUntil("window.__po.count('.po-status-chip') > 0", 'the status chips in the list', 15000);
  const chips = await js("Array.from(document.querySelectorAll('.po-status-chip')).map((c) => c.textContent.trim())");
  check('the list shows the status chip', chips.indexOf('Ordered') >= 0, JSON.stringify(chips));
  check('the list shows the draft chip too', chips.indexOf('Draft') >= 0, JSON.stringify(chips));
  const listTotal = await js("window.__po.textOf('[data-testid=\"po-list-total\"]')");
  check('the list shows the order total', !!listTotal && Number(listTotal) > 0, String(listTotal));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_purchaseOrderUi crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the purchase-order UI suite did not finish in 240s');
  app.exit(2);
}, 240000);
