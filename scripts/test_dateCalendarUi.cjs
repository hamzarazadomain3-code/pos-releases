#!/usr/bin/env node
/**
 * The date picker — END-TO-END UI suite.
 *
 * Boots the REAL built renderer (`dist/renderer`) in a real BrowserWindow with
 * the real preload and the real IPC handlers, then uses the calendar the way
 * the shop owner does:
 *
 *   - clicking a date field opens a real calendar (not the browser's OS widget),
 *   - the popup is portalled to document.body, so the scrolling body of the
 *     Purchase Order modal can NEVER clip it — and it is fully inside the
 *     window even when the window is only 430px tall (it flips / clamps),
 *   - the month pages back and forth across the year,
 *   - picking a day fills the field and closes the popup; reopening marks the
 *     picked day,
 *   - Today / Clear work,
 *   - Esc closes the CALENDAR and leaves the modal open; an outside click
 *     closes it too,
 *   - the keyboard path works (ArrowDown opens, arrows move, Enter picks),
 *   - a typed date still commits (the old behaviour is not lost),
 *   - the picked date really reaches the saved order (`delivery_date`),
 *   - a page-level field (Expenses -> From) gets the same calendar.
 *
 * The pure grid maths is covered by `npm run test:calendar`; this suite covers
 * the SCREEN and the wiring.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_dateCalendarUi.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-datecal-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'datecal-ui.db');
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
window.__cal = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__cal.loginRoot(); return b ? b.innerText : ''; },
  hasLogin: () => {
    const b = window.__cal.loginRoot();
    if (!b) return false;
    const inputs = b.querySelectorAll('input');
    return inputs.length >= 2 && /sign in/i.test(b.innerText);
  },
  loginInputs: () => { const b = window.__cal.loginRoot(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  setLogin: (i, v) => {
    const el = window.__cal.loginInputs()[i];
    if (!el) throw new Error('no login input at ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  clickLogin: (label) => {
    const b = window.__cal.loginRoot();
    const btn = b && Array.from(b.querySelectorAll('button'))
      .find((x) => (x.innerText || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!btn) throw new Error('no login button matching: ' + label);
    btn.click();
    return true;
  },

  exists: (sel) => !!document.querySelector(sel),
  count: (sel) => document.querySelectorAll(sel).length,
  textOf: (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : null; },
  valueOf: (sel) => { const el = document.querySelector(sel); return el ? el.value : null; },
  rect: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
  },
  viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
  calParentIsBody: () => {
    const el = document.querySelector('.datecal');
    return !!el && el.parentElement === document.body;
  },
  dayCount: () => document.querySelectorAll('.datecal-grid .datecal-day').length,
  weekdayCount: () => document.querySelectorAll('.datecal-week .datecal-wd').length,
  cellDate: (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('data-date') : null; },
  focusDate: () => window.__cal.cellDate('.datecal-focus'),
  selDate: () => window.__cal.cellDate('.datecal-sel'),
  todayDate: () => window.__cal.cellDate('.datecal-today'),
  dayExists: (iso) => !!document.querySelector('[data-testid="datecal-day-' + iso + '"]'),

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
      key: key, code: o.code || key, bubbles: true, cancelable: true,
      ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta,
    });
    el.dispatchEvent(ev);
    return true;
  },
  pressWindow: (key, opts) => {
    const o = opts || {};
    const ev = new KeyboardEvent('keydown', {
      key: key, code: o.code || key, bubbles: true, cancelable: true,
      ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta,
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
  clickOutside: () => {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return true;
  },
  nav: (route) => {
    const el = document.querySelector('[data-guide-id="nav.' + route + '"]');
    if (!el) throw new Error('no nav button: ' + route);
    el.click();
    return true;
  },
  modalOpen: () => !!document.querySelector('.modal.modal-po'),
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__cal').catch(() => false);
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
  await waitUntil('window.__cal.hasLogin()', 'the login screen', 25000);
  await js(`window.__cal.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__cal.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__cal.clickLogin('Login')");
  await waitUntil(
    "!window.__cal.hasLogin() || /owner password/i.test(window.__cal.loginText())",
    `login as ${username}`,
    20000
  );
  if (await js("/owner password/i.test(window.__cal.loginText())")) {
    await js("window.__cal.setLogin(0, 'OwnerPass1')");
    await js("window.__cal.setLogin(1, 'OwnerPass1')");
    await js("window.__cal.clickLogin('Save')");
    await waitUntil('!window.__cal.hasLogin()', 'the forced password modal to close', 20000);
  }
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');
  const grid = require('../dist/shared/calendarGrid.js');
  const dateParse = require('../dist/shared/dateParse.js');

  await initDatabase();
  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  settings.setSetting('shop_name', 'Date Calendar UI Shop');
  auth.setSessionUser(1);

  const supplier = purchases.createSupplier('Calendar Wholesale', '0300-4444444', 'Lahore');
  const product = inventory.createProduct({
    name: 'Calendar Sugar',
    sku: 'CAL-SUGAR',
    barcode: '8200000000001',
    cost_price: 130,
    sale_price: 160,
    low_stock_threshold: 10,
    tax_rate: 0,
  });
  inventory.recordMovement(product.id, 10, 'Opening stock', 'manual', null);

  registerIpcHandlers();
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  // The local clock the popup shows, computed with the SAME pure module.
  const today = grid.todayIso();
  const parts = grid.isoParts(today);
  const midIso = grid.toIso(parts.year, parts.month, 15);
  const monthTitle = grid.monthLabel(parts.year, parts.month);
  const nextView = grid.shiftMonth(parts.year, parts.month, 1);
  const nextTitle = grid.monthLabel(nextView.year, nextView.month);
  const prevMonth = grid.shiftMonth(parts.year, parts.month, -1);
  const prevTitle = grid.monthLabel(prevMonth.year, prevMonth.month);

  /** The displayed text parsed back with the REAL helper, in any of the three formats. */
  const parseBack = (text) => {
    for (const fmt of ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']) {
      const iso = dateParse.parseInputDate(String(text || ''), fmt);
      if (iso) return iso;
    }
    return null;
  };

  console.log('=== Rokar POS - the date picker (end-to-end UI) ===');

  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ── Boot + the PO modal ──────────────────────────────────────────────────
  section('Boot, sign in and open the Purchase Order modal');
  await signIn('admin', 'admin123');
  check('the owner lands inside the app', !(await js('window.__cal.hasLogin()')));
  await js("window.__cal.nav('purchases')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('.tab-btn')).find((b) => /purchase orders/i.test(b.innerText))",
    'the Purchases screen',
    25000
  );
  await js("window.__cal.clickText('.tab-btn', 'Purchase Orders')");
  await waitUntil(
    "!!Array.from(document.querySelectorAll('button')).find((b) => /new purchase order/i.test(b.innerText))",
    'the New Purchase Order button',
    15000
  );
  await js("window.__cal.clickText('button', 'New Purchase Order')");
  await waitUntil("window.__cal.modalOpen()", 'the Purchase Order modal', 15000);
  check('the Purchase Order modal is open', true);

  // ── The calendar opens on click ──────────────────────────────────────────
  section('Clicking a date field opens a real calendar');
  check('no calendar is shown before the click', (await js("window.__cal.exists('.datecal')")) === false);
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar popup', 10000);
  check('the calendar opened', true);
  check('it is portalled to document.body (a modal cannot clip it)', await js('window.__cal.calParentIsBody()'));
  const title = await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')");
  check('the title shows the current month', title === monthTitle, `${title} vs ${monthTitle}`);
  check('the grid draws 42 day cells (6 weeks)', (await js('window.__cal.dayCount()')) === 42, String(await js('window.__cal.dayCount()')));
  check('the weekday header has 7 columns', (await js('window.__cal.weekdayCount()')) === 7, String(await js('window.__cal.weekdayCount()')));
  const calRect = await js("window.__cal.rect('.datecal')");
  const vp = await js('window.__cal.viewport()');
  check(
    'the popup is fully inside the 1280x720 window',
    !!calRect && calRect.top >= 0 && calRect.bottom <= vp.h + 1 && calRect.left >= 0 && calRect.right <= vp.w + 1,
    `popup ${JSON.stringify(calRect)} viewport ${JSON.stringify(vp)}`
  );
  check('today is marked in the grid', (await js('window.__cal.todayDate()')) === today, String(await js('window.__cal.todayDate()')));

  // ── Paging ───────────────────────────────────────────────────────────────
  section('The month pages back and forth');
  await js("window.__cal.click('[data-testid=\"datecal-next\"]')");
  check('next shows the next month', (await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")) === nextTitle, String(await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")));
  await js("window.__cal.click('[data-testid=\"datecal-prev\"]')");
  check('prev returns to the current month', (await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")) === monthTitle);
  await js("window.__cal.click('[data-testid=\"datecal-prev\"]')");
  check('prev again shows the previous month', (await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")) === prevTitle, String(await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")));
  await js("window.__cal.click('[data-testid=\"datecal-next\"]')");
  check('next brings it back', (await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")) === monthTitle);

  // ── Picking a day ────────────────────────────────────────────────────────
  section('Picking a day fills the field and closes the popup');
  check('the 15th of the month is on the grid', await js(`window.__cal.dayExists('${midIso}')`));
  await js(`window.__cal.click('[data-testid="datecal-day-${midIso}"]')`);
  await waitUntil("!window.__cal.exists('.datecal')", 'the popup to close after a pick', 10000);
  check('the calendar closed after the pick', true);
  const shown = await js("window.__cal.valueOf('[data-testid=\"po-expected-date\"]')");
  check('the field shows the picked date', parseBack(shown) === midIso, `"${shown}" -> ${parseBack(shown)}`);
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar to reopen', 10000);
  check('reopening marks the picked day as selected', (await js('window.__cal.selDate()')) === midIso, String(await js('window.__cal.selDate()')));
  check('reopening shows the month of the picked date', (await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')")) === monthTitle);

  // ── Today / Clear ────────────────────────────────────────────────────────
  section('Today and Clear');
  await js("window.__cal.click('[data-testid=\"datecal-today-btn\"]')");
  await waitUntil("!window.__cal.exists('.datecal')", 'the popup to close after Today', 10000);
  const todayShown = await js("window.__cal.valueOf('[data-testid=\"po-expected-date\"]')");
  check('Today fills today\'s local date', parseBack(todayShown) === today, `"${todayShown}" -> ${parseBack(todayShown)}`);
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar to reopen for Clear', 10000);
  await js("window.__cal.click('[data-testid=\"datecal-clear-btn\"]')");
  await waitUntil("!window.__cal.exists('.datecal')", 'the popup to close after Clear', 10000);
  check('Clear empties the field', (await js("window.__cal.valueOf('[data-testid=\"po-expected-date\"]')")) === '');

  // ── Closing without picking ──────────────────────────────────────────────
  section('Esc closes the calendar, NOT the modal');
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar for Esc', 10000);
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'Escape')");
  await waitUntil("!window.__cal.exists('.datecal')", 'the calendar to close on Esc', 10000);
  check('Esc closed the calendar', true);
  check('the Purchase Order modal is still open', await js('window.__cal.modalOpen()'));

  section('An outside click closes the calendar too');
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar for the outside click', 10000);
  await js('window.__cal.clickOutside()');
  await waitUntil("!window.__cal.exists('.datecal')", 'the calendar to close on an outside click', 10000);
  check('an outside click closed the calendar', true);
  check('the modal is still open', await js('window.__cal.modalOpen()'));

  // ── The short window (the flip / clamp) ──────────────────────────────────
  section('The popup stays inside a short window (it flips / clamps)');
  win.setSize(1280, 430);
  await waitUntil('window.innerHeight <= 440', 'the short window', 10000);
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar in the short window', 10000);
  const shortRect = await js("window.__cal.rect('.datecal')");
  const shortVp = await js('window.__cal.viewport()');
  check(
    'the popup is still fully inside the 1280x430 window',
    !!shortRect && shortRect.top >= 0 && shortRect.bottom <= shortVp.h + 1 && shortRect.left >= 0 && shortRect.right <= shortVp.w + 1,
    `popup ${JSON.stringify(shortRect)} viewport ${JSON.stringify(shortVp)}`
  );
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'Escape')");
  await waitUntil("!window.__cal.exists('.datecal')", 'the calendar to close', 10000);
  win.setSize(1280, 720);
  await waitUntil(`window.innerHeight >= ${vp.h - 4}`, 'the normal window', 10000);
  check('the window is back to the normal height', (await js('window.innerHeight')) >= vp.h - 4, String(await js('window.innerHeight')));

  // ── The keyboard path ────────────────────────────────────────────────────
  section('The keyboard path (ArrowDown opens, arrows move, Enter picks)');
  await js("window.__cal.focus('[data-testid=\"po-expected-date\"]')");
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'ArrowDown')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar on ArrowDown', 10000);
  check('ArrowDown opened the calendar', true);
  const startFocus = await js('window.__cal.focusDate()');
  check('the focus starts on today', startFocus === today, String(startFocus));
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'ArrowRight')");
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'ArrowRight')");
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'ArrowRight')");
  const moved = await js('window.__cal.focusDate()');
  check('three ArrowRight presses move the focus three days', moved === grid.addDays(today, 3), `${moved} vs ${grid.addDays(today, 3)}`);
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'Enter')");
  await waitUntil("!window.__cal.exists('.datecal')", 'the popup to close on Enter', 10000);
  const keyShown = await js("window.__cal.valueOf('[data-testid=\"po-expected-date\"]')");
  check('Enter picked the focused day', parseBack(keyShown) === grid.addDays(today, 3), `"${keyShown}" -> ${parseBack(keyShown)}`);

  // ── Typing still works ───────────────────────────────────────────────────
  section('A typed date still commits (the old behaviour is kept)');
  await js("window.__cal.focus('[data-testid=\"po-expected-date\"]')");
  await js("window.__cal.setVal('[data-testid=\"po-expected-date\"]', '23/11/2026')");
  await js("window.__cal.press('[data-testid=\"po-expected-date\"]', 'Enter')");
  const typedShown = await js("window.__cal.valueOf('[data-testid=\"po-expected-date\"]')");
  check('the typed date is committed as 2026-11-23', parseBack(typedShown) === '2026-11-23', `"${typedShown}" -> ${parseBack(typedShown)}`);

  // ── The picked date reaches the saved order ──────────────────────────────
  section('The picked date reaches the saved order');
  await waitUntil("!window.__cal.exists('.datecal')", 'the calendar to be closed before creating', 10000);
  await js(`window.__cal.setSelect('[data-testid="po-supplier"]', '${supplier.id}')`);
  await js("window.__cal.setVal('[data-testid=\"po-search\"]', 'Calendar Sugar')");
  await waitUntil("window.__cal.count('.search-result-item') > 0", 'the search dropdown', 10000);
  await js("window.__cal.press('[data-testid=\"po-search\"]', 'Enter')");
  await js("window.__cal.press('[data-testid=\"po-search\"]', 'Enter')");
  await waitUntil("window.__cal.exists('.quantity-input-box')", 'the qty box', 10000);
  await js("window.__cal.setVal('.quantity-input-box input', '1')");
  await js("window.__cal.press('.quantity-input-box input', 'Enter')");
  await waitUntil("window.__cal.count('[data-po-line]') === 1", 'the added line', 10000);
  // The calendar's own pick, right before saving.
  await js("window.__cal.click('[data-testid=\"po-expected-date\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar before saving', 10000);
  await js(`window.__cal.click('[data-testid="datecal-day-${midIso}"]')`);
  await waitUntil("!window.__cal.exists('.datecal')", 'the popup to close', 10000);
  const createDisabled = await js("document.querySelector('[data-testid=\"po-create\"]')?.disabled");
  check('the Create button is enabled for the valid order', createDisabled === false, String(createDisabled));
  await js("window.__cal.click('[data-testid=\"po-create\"]')");
  await waitUntil("!window.__cal.modalOpen()", 'the modal to close after creating', 20000);
  const orders = purchases.listPurchaseOrders();
  const created = orders && orders.length ? orders.find((o) => o.supplier_id === supplier.id) : null;
  check('the order was created', !!created, created ? `id ${created.id}` : 'none');
  check('the order carries the picked delivery date', !!created && created.delivery_date === midIso, created ? `${created.delivery_date} vs ${midIso}` : 'no order');

  // ── A page-level field gets the same calendar ────────────────────────────
  section('A page-level date field gets the same calendar');
  await js("window.__cal.nav('expenses')");
  // Wait for the Expenses page to BE the active page: the Purchases page also
  // has From/To date fields, and the old page is still mounted while the new
  // one lazy-loads — clicking then would open the calendar on a page that is
  // about to unmount.
  await waitUntil(
    "!!Array.from(document.querySelectorAll('button')).find((b) => /new expense/i.test(b.innerText))",
    'the Expenses page',
    25000
  );
  await waitUntil(
    "!Array.from(document.querySelectorAll('button')).find((b) => /new purchase order/i.test(b.innerText))",
    'the Purchases page to unmount',
    15000
  );
  await waitUntil("window.__cal.exists('input[placeholder=\"From\"]')", 'the Expenses From field', 10000);
  await js("window.__cal.click('input[placeholder=\"From\"]')");
  await waitUntil("window.__cal.exists('.datecal')", 'the calendar on the Expenses page', 10000);
  check('the Expenses From field opened a calendar too', true);
  const expTitle = await js("window.__cal.textOf('[data-testid=\"datecal-title\"]')");
  check('its title is a real month label', /^[A-Za-z]+ \d{4}$/.test(String(expTitle)), String(expTitle));
  await js(`window.__cal.click('[data-testid="datecal-day-${midIso}"]')`);
  await waitUntil("!window.__cal.exists('.datecal')", 'the calendar to close', 10000);
  const expShown = await js("window.__cal.valueOf('input[placeholder=\"From\"]')");
  check('the page-level field shows the picked date', parseBack(expShown) === midIso, `"${expShown}" -> ${parseBack(expShown)}`);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILED'}: ${checks - failures}/${checks} checks passed`);
  return failures === 0 ? 0 : 1;
}

app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await run();
  } catch (e) {
    failures++;
    console.error('CRASH:', e && e.stack ? e.stack : e);
    code = 1;
  }
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch {}
  app.exit(code);
});
