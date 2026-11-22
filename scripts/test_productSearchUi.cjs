#!/usr/bin/env node
/**
 * Product search by CODE — END-TO-END UI suite.
 *
 * Boots the REAL built renderer (`dist/renderer`) in a real BrowserWindow with the
 * real preload and the real IPC handlers, then types into the actual Billing search
 * box a shop owner would type into:
 *
 *   type "SKU-ALPHA"  -> the dropdown ranks the exact code first and SHOWS the code
 *   press Enter       -> the exact code match lands in the cart
 *   type a barcode    -> Enter selects that product
 *   type "Alph"       -> name prefix ranks, code still displayed
 *   click a row       -> the clicked product is added
 *
 * This is the phase the pure suite (`npm run test:productSearch`) cannot cover:
 * that `matchProducts` is actually wired into the search effect, that the dropdown
 * renders the code (`.psr-code`), that Enter reaches `findExactCodeMatch`, and that
 * the Quick Sale grid filters by code too.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_productSearchUi.cjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-product-search-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'product-search-ui.db');
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
  exists: (sel) => !!document.querySelector(sel),
  count: (sel) => document.querySelectorAll(sel).length,

  // ── Sidebar navigation ────────────────────────────────────────────────
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

  // ── Billing product search ────────────────────────────────────────────
  // The Billing search box. onFocus sets searchOpen, so focus BEFORE typing or
  // the dropdown never renders.
  searchInput: () => {
    const el = document.querySelector('.billing-search');
    if (!el) throw new Error('no .billing-search input');
    return el;
  },
  focusSearch: () => {
    const el = window.__a.searchInput();
    el.focus();
    // React's onFocus listens for focusin at the root; a synthetic bubbling
    // focusin reaches it even though the window is never shown.
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return true;
  },
  setSearch: (v) => {
    const el = window.__a.searchInput();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  searchValue: () => window.__a.searchInput().value,
  pressSearchEnter: () => {
    const el = window.__a.searchInput();
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
    }));
    return true;
  },
  // Everything the dropdown currently shows: rows, their names (the code is a
  // nested span, so the name is the first text node) and their codes.
  // SCOPED to .billing-search-wrap: CustomerCombobox renders its own
  // .product-search-dropdown / .product-search-result rows for the customer
  // picker, and those are on screen the whole time.
  dropdown: () => {
    const rows = Array.from(document.querySelectorAll('.billing-search-wrap .product-search-dropdown .product-search-result'));
    return {
      open: !!document.querySelector('.billing-search-wrap .product-search-dropdown'),
      count: rows.length,
      firstActive: rows[0] ? rows[0].classList.contains('active') : false,
      names: rows.map((r) => {
        const n = r.querySelector('.psr-name');
        if (!n) return '';
        const first = n.firstChild;
        const t = first && first.nodeType === 3 ? first.textContent : n.textContent;
        return (t || '').trim();
      }),
      codes: rows.map((r) => {
        const c = r.querySelector('.psr-code');
        return c ? c.textContent.trim() : '';
      }),
    };
  },
  psdEmpty: () => !!document.querySelector('.billing-search-wrap .psd-empty'),

  // ── The Billing cart ──────────────────────────────────────────────────
  cartCount: () => document.querySelectorAll('.cart-list .cart-row').length,
  cartNames: () => Array.from(document.querySelectorAll('.cart-list .cart-row')).map((r) => {
    const s = r.querySelector('.cart-info strong');
    return s ? s.textContent.trim() : '';
  }),

  // ── Quick Sale grid ───────────────────────────────────────────────────
  qsInput: () => {
    const el = document.querySelector('input[placeholder="Search products..."]');
    if (!el) throw new Error('no Quick Sale search input');
    return el;
  },
  setQsSearch: (v) => {
    const el = window.__a.qsInput();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  pressQsEnter: () => {
    const el = window.__a.qsInput();
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
    }));
    return true;
  },
  qsGrid: () => {
    const tiles = Array.from(document.querySelectorAll('[data-index]'));
    // The tile's product name is the div carrying font-weight: 600; the first
    // line of innerText is the 📦 placeholder instead.
    const countEl = Array.from(document.querySelectorAll('.muted'))
      .find((e) => (e.textContent || '').indexOf('products') >= 0);
    return {
      tiles: tiles.length,
      names: tiles.map((t) => {
        const named = Array.from(t.querySelectorAll('div'))
          .find((d) => (d.getAttribute('style') || '').indexOf('font-weight: 600') >= 0);
        if (named) return named.textContent.trim();
        return (t.innerText || '').split('\\n')[0].trim();
      }),
      countText: countEl ? countEl.textContent.trim() : '',
    };
  },
  qsHighlighted: () => {
    const h = document.querySelector('.search-result-item.highlighted .psr-name');
    return h ? h.textContent.trim() : null;
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
    const page = await js('document.body ? document.body.innerText.slice(0, 200) : ""');
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
  // Either the app mounts, or a fresh database forces the owner to replace the
  // default password first.
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

/** Focus the search box, type a query and wait for the debounced results. */
async function typeSearch(value) {
  await js('window.__a.focusSearch()');
  await js(`window.__a.setSearch(${JSON.stringify(value)})`);
}

/**
 * Type a query and wait until the dropdown has SETTLED on the expected rows.
 *
 * The search effect is debounced by 250ms plus an IPC round trip, and the query
 * an Enter just cleared briefly loads ALL products. Waiting only for the target
 * row to be present would race that stale set (it contains every product), so
 * this waits for the exact count AND the exact first row.
 */
async function typeAndWait(query, expectedRow, expectedCount = 1) {
  await typeSearch(query);
  await waitUntil(
    `(function () { var d = window.__a.dropdown(); return d.count === ${expectedCount} && d.names[0] === ${JSON.stringify(expectedRow)}; })()`,
    `the dropdown to settle on ${expectedRow}`,
    10000
  );
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');

  await initDatabase();
  const db = getDb();

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  // A shop with no name would send the renderer to the First-Run Wizard instead
  // of the login screen.
  settings.setSetting('shop_name', 'Product Search UI Shop');

  auth.setSessionUser(1);

  // Four products with an EXPLICIT sku and barcode, so the code is deterministic.
  // createProduct generates one when the field is left empty, so these must be set.
  const alpha = inventory.createProduct({
    name: 'Alpha Widget',
    sku: 'SKU-ALPHA',
    barcode: '7000000000001',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 50,
    tax_rate: 0,
  });
  const beta = inventory.createProduct({
    name: 'Beta Gadget',
    sku: 'SKU-BETA',
    barcode: '7000000000002',
    sale_price: 200,
    cost_price: 120,
    stock_qty: 50,
    tax_rate: 0,
  });
  const gamma = inventory.createProduct({
    name: 'Gamma Thing',
    sku: 'SKU-GAMMA',
    barcode: '7000000000003',
    sale_price: 300,
    cost_price: 180,
    stock_qty: 50,
    tax_rate: 0,
  });
  const delta = inventory.createProduct({
    name: 'Delta Part',
    sku: 'SKU-DELTA',
    barcode: '7000000000004',
    sale_price: 400,
    cost_price: 240,
    stock_qty: 50,
    tax_rate: 0,
  });

  registerIpcHandlers();

  // Channels main.ts / updater.ts / licensing.ts register in the real app.
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS - Product search by code (end-to-end UI) ===');

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

  let dd;

  // ── Searching by SKU shows the code in the dropdown ─────────────────────
  section('Typing a SKU ranks the exact code first and shows the code');
  await typeAndWait('SKU-ALPHA', 'Alpha Widget');
  dd = await js('window.__a.dropdown()');
  check('the dropdown opens for a code query', dd.open);
  check('the exact SKU is the first row', dd.names[0] === 'Alpha Widget', dd.names[0]);
  check('the first row displays the product code', dd.codes[0] === 'SKU-ALPHA', dd.codes[0]);
  check('the first row is the highlighted one (Enter would pick it)', dd.firstActive === true);

  // ── Enter selects the exact code match ──────────────────────────────────
  section('Enter on an exact code match adds that product');
  await js('window.__a.pressSearchEnter()');
  await waitUntil('window.__a.cartCount() >= 1', 'the first cart line');
  check('the product landed in the cart', (await js('window.__a.cartNames()'))[0] === 'Alpha Widget',
    JSON.stringify(await js('window.__a.cartNames()')));
  check('the search box is cleared for the next product', (await js('window.__a.searchValue()')) === '');

  // ── Enter on an exact barcode match ─────────────────────────────────────
  section('Typing an exact barcode and pressing Enter selects it');
  await typeAndWait(beta.barcode, 'Beta Gadget');
  dd = await js('window.__a.dropdown()');
  check('the barcode query ranks the exact barcode first', dd.names[0] === 'Beta Gadget', dd.names[0]);
  // getProductCode prefers the SKU, so the row shows the product's own code
  // even though the query was the barcode.
  check('the first row shows the product code', dd.codes[0] === 'SKU-BETA', dd.codes[0]);
  await js('window.__a.pressSearchEnter()');
  await waitUntil('window.__a.cartCount() >= 2', 'the second cart line');
  const namesAfterBarcode = await js('window.__a.cartNames()');
  check('the barcode product is in the cart', namesAfterBarcode.includes('Beta Gadget'),
    JSON.stringify(namesAfterBarcode));

  // ── Name prefix search still ranks and still shows the code ─────────────
  section('A name prefix ranks by name and keeps the code visible');
  await typeAndWait('Alph', 'Alpha Widget');
  dd = await js('window.__a.dropdown()');
  check('the name prefix finds Alpha Widget first', dd.names[0] === 'Alpha Widget', dd.names[0]);
  check('the code is shown next to the name', dd.codes[0] === 'SKU-ALPHA', dd.codes[0]);

  // ── Single result: Enter picks it ───────────────────────────────────────
  section('A query with exactly one result is picked by Enter');
  await typeAndWait('GAMMA', 'Gamma Thing');
  dd = await js('window.__a.dropdown()');
  check('the query narrows to one product', dd.count === 1, `count=${dd.count}`);
  check('that product is Gamma Thing', dd.names[0] === 'Gamma Thing', dd.names[0]);
  await js('window.__a.pressSearchEnter()');
  await waitUntil('window.__a.cartCount() >= 3', 'the third cart line');
  const namesAfterSingle = await js('window.__a.cartNames()');
  check('the single result landed in the cart', namesAfterSingle.includes('Gamma Thing'),
    JSON.stringify(namesAfterSingle));

  // ── Clicking a dropdown row adds the clicked product ────────────────────
  section('Clicking a dropdown row adds that product');
  await typeAndWait('DELTA', 'Delta Part');
  await js("document.querySelector('.billing-search-wrap .product-search-dropdown .product-search-result').click()");
  await waitUntil('window.__a.cartCount() >= 4', 'the fourth cart line');
  const namesAfterClick = await js('window.__a.cartNames()');
  check('the clicked row added Delta Part', namesAfterClick.includes('Delta Part'),
    JSON.stringify(namesAfterClick));
  check('the search box clears after a click', (await js('window.__a.searchValue()')) === '');

  // ── Quick Sale grid filters by code too ─────────────────────────────────
  section('Quick Sale grid filters by product code');
  check('the Quick Sale page is in the sidebar', await js("window.__a.navExists('Quick Sale')"));
  await js("window.__a.clickNav('Quick Sale')");
  await waitUntil(
    "!!document.querySelector('input[placeholder=\"Search products...\"]')",
    'the Quick Sale search box',
    20000
  );
  await js('window.__a.setQsSearch("SKU-ALPHA")');
  await waitUntil(
    "window.__a.qsGrid().tiles > 0 && window.__a.qsGrid().tiles < 4",
    'the Quick Sale grid to narrow by code',
    20000
  );
  const grid = await js('window.__a.qsGrid()');
  check('the grid narrows to the code match', grid.tiles === 1, `tiles=${grid.tiles}`);
  check('the remaining tile is Alpha Widget', grid.names[0] === 'Alpha Widget', grid.names[0]);
  check('the counter reflects the filtered list', /1 products/.test(grid.countText), grid.countText);

  await js('window.__a.pressQsEnter()');
  await waitUntil(
    "window.__a.qsHighlighted() !== null",
    'the Quick Sale staged selection',
    10000
  );
  check('Enter stages the code match as the selection',
    (await js('window.__a.qsHighlighted()')) === 'Alpha Widget',
    String(await js('window.__a.qsHighlighted()')));

  // ── A code that matches nothing ─────────────────────────────────────────
  section('A code that matches nothing shows the empty state');
  await js('window.__a.clickNav("Billing")');
  await waitUntil(
    "!!document.querySelector('.billing-search')",
    'the Billing search box again',
    20000
  );
  await typeSearch('NO-SUCH-CODE');
  await waitUntil('window.__a.psdEmpty()', 'the empty state for an unknown code', 10000);
  dd = await js('window.__a.dropdown()');
  check('an unknown code yields no rows', dd.count === 0, `count=${dd.count}`);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_productSearchUi crashed:', e);
  app.exit(1);
});

// A UI test that never finishes is a failure, not a hang for the operator.
setTimeout(() => {
  console.error('WATCHDOG: the UI suite did not finish in 240s');
  app.exit(2);
}, 240000);
