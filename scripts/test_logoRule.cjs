#!/usr/bin/env node
/**
 * The LOGO RULE — end-to-end.
 *
 *   POS app UI (login, lock, recovery, sidebar)  -> the APP's own logo only
 *   printed / exported documents                  -> the SHOP's logo only
 *   no shop logo set                              -> print NOTHING
 *                                                    (never the app logo)
 *
 * The check is split in two, because the two halves have different failure
 * modes:
 *
 *  1. PRINT — calls the REAL `dist` services (`buildReceiptJob`,
 *     `buildInvoiceHtml`, `buildDesignedReceiptAsync`, and the real
 *     `buildReceiptJobAsync` with the Receipt Designer switched on) and reads
 *     the generated HTML back. A fallback to the app logo would be caught even
 *     if the screen looked right.
 *
 *  2. SCREEN — boots the REAL built renderer (`dist/renderer`) in a real
 *     BrowserWindow with the real preload and the real IPC handlers, against a
 *     database whose `shop_logo` is a distinctive data URL, and asserts that
 *     URL never appears as an app image while the app logo does.
 *
 * Usage (after `npm run build` — it loads dist/renderer):
 *   npx electron scripts/test_logoRule.cjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-logo-rule-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'logo-rule.db');
// A fresh userData: a saved session from an earlier run would skip the login
// screen this suite asserts on.
app.setPath('userData', path.join(tmpDir, 'userdata'));

/** A 1x1 red PNG. Distinctive enough that no bundled asset can equal it. */
const SHOP_LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

/** Injected into the page; every UI step drives the real DOM through it. */
const HELPERS = `
window.__l = {
  text: () => (document.body ? document.body.innerText : ''),
  loginRoot: () => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    return boxes.length ? boxes[boxes.length - 1] : null;
  },
  loginText: () => { const b = window.__l.loginRoot(); return b ? b.innerText : ''; },
  // The "Restoring session..." spinner is ALSO a .lock-box with no fields.
  hasLogin: () => {
    const b = window.__l.loginRoot();
    if (!b) return false;
    return b.querySelectorAll('input').length >= 2 && /sign in/i.test(b.innerText);
  },
  loginInputs: () => { const b = window.__l.loginRoot(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  setLogin: (i, v) => {
    const el = window.__l.loginInputs()[i];
    if (!el) throw new Error('no login input at ' + i);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  clickLogin: (label) => {
    const b = window.__l.loginRoot();
    const btn = b && Array.from(b.querySelectorAll('button'))
      .find((x) => (x.innerText || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!btn) throw new Error('no login button matching: ' + label);
    btn.click();
    return true;
  },
  buttons: () => Array.from(document.querySelectorAll('button')),
  // The sidebar can be an icon-only rail (labels are display:none), so match on
  // textContent - innerText would be empty for the hidden label.
  label: (b) => (b.textContent || '').replace(/\\s+/g, ' ').trim(),
  click: (label) => {
    const all = window.__l.buttons();
    const needle = label.toLowerCase();
    const el = all.find((b) => window.__l.label(b).toLowerCase() === needle)
      || all.find((b) => window.__l.label(b).toLowerCase().includes(needle));
    if (!el) {
      throw new Error(
        'no button matching: ' + label + ' | have: '
        + all.map((b) => window.__l.label(b)).filter(Boolean).slice(0, 40).join(' / ')
      );
    }
    el.click();
    return true;
  },
  images: () => Array.from(document.images).map((i) => ({ src: i.src, alt: i.alt })),
  loginImages: () => {
    const b = window.__l.loginRoot();
    return b ? Array.from(b.querySelectorAll('img')).map((i) => ({ src: i.src, alt: i.alt })) : [];
  },
  sidebarImage: () => {
    const i = document.querySelector('.sidebar-brand img');
    return i ? { src: i.src, alt: i.alt } : null;
  },
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

async function ensureHelpers() {
  const present = await js('!!window.__l').catch(() => false);
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
    const page = await js('document.body ? document.body.innerText.slice(0, 160) : ""');
    extra = `; page: ${JSON.stringify(page)}`;
  } catch {
    extra = '. page unavailable';
  }
  throw new Error(`timed out waiting for ${desc}${extra}`);
}

async function waitText(needle, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const t = await js('window.__l.text()');
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
  await waitUntil('window.__l.hasLogin()', 'the login screen', 25000);
  await js(`window.__l.setLogin(0, ${JSON.stringify(username)})`);
  await js(`window.__l.setLogin(1, ${JSON.stringify(password)})`);
  await js("window.__l.clickLogin('Login')");
  await waitUntil(
    "!window.__l.hasLogin() || /owner password/i.test(window.__l.loginText())",
    `login as ${username}`,
    20000
  );
  if (await js("/owner password/i.test(window.__l.loginText())")) {
    await js("window.__l.setLogin(0, 'OwnerPass1')");
    await js("window.__l.setLogin(1, 'OwnerPass1')");
    await js("window.__l.clickLogin('Save')");
    await waitUntil('!window.__l.hasLogin()', 'the forced password modal to close', 20000);
  }
}

/** A logo `<img>` emitted by the real renderers (class="logo"). */
const LOGO_IMG = /<img[^>]+class="logo"/;
/** Any bundled Rokar asset name — a fallback would have to use one of these. */
const APP_ASSET = /rokar-pos-logo|rokar-pos-mark|rokar-sidebar-icon/i;

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const sales = require('../dist/main/services/sales.js');
  const shifts = require('../dist/main/services/shifts.js');
  const admin = require('../dist/main/services/admin.js');
  const printing = require('../dist/main/services/printing.js');
  const printDocs = require('../dist/main/services/printDocs.js');
  const receiptDesigner = require('../dist/main/services/receiptDesigner.js');
  const sharedDesign = require('../dist/shared/receiptDesign.js');

  await initDatabase();

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  settings.setSetting('shop_name', 'Logo Rule Shop');
  settings.setSetting('shop_logo', SHOP_LOGO);

  auth.setSessionUser(1);
  const product = inventory.createProduct({
    name: 'Logo Rule Widget',
    sale_price: 250,
    cost_price: 100,
    stock_qty: 10,
    tax_rate: 0,
  });
  const customer = sales.createCustomer('Logo Rule Customer');
  shifts.openShift(500);
  const sale = sales.createSale({
    items: [{ product_id: product.id, qty: 2, price: 250, line_discount: 0, tax_rate: 0 }],
    customer_id: customer.id,
    payments: [{ mode: 'cash', amount: 500 }],
  });
  const saleId = sale.sale.id;

  registerIpcHandlers();
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));
  ipcMain.handle('licensing:trialStatus', () => ({
    isTrial: false,
    active: false,
    daysLeft: 0,
    totalDays: 0,
    startedAt: '',
    expiresAt: '',
    serverAnchored: false,
  }));

  console.log('=== Rokar POS — the logo rule (end-to-end) ===');

  // ── The built app ships its own logo ─────────────────────────────────────
  section('The built app ships the APP logo');
  const assetDir = path.join(PROJECT_ROOT, 'dist', 'renderer', 'assets');
  const lockup = fs.readdirSync(assetDir).filter((f) => /^rokar-pos-logo-light.*\.png$/.test(f));
  const mark = fs.readdirSync(assetDir).filter((f) => /^rokar-pos-mark-dark.*\.png$/.test(f));
  check('the renderer bundle ships the app lockup', lockup.length === 1, lockup.join(', '));
  check('the renderer bundle ships the app mark', mark.length === 1, mark.join(', '));
  check(
    'the lockup is a real image (not an empty placeholder)',
    lockup.length === 1 && fs.statSync(path.join(assetDir, lockup[0])).size > 10 * 1024,
    lockup.length === 1 ? `${fs.statSync(path.join(assetDir, lockup[0])).size} bytes` : ''
  );

  // ── PRINT: the shop logo is what reaches paper ───────────────────────────
  section('Paper: the SHOP logo prints');
  const receiptWith = printing.buildReceiptJob(saleId, 'standard', false);
  check('the receipt job carries the uploaded shop logo', receiptWith.html.includes(SHOP_LOGO));
  check('the receipt job prints it as a logo image', LOGO_IMG.test(receiptWith.html));

  const invoiceWith = printDocs.buildInvoiceHtml(saleId, 'a4');
  check('the invoice carries the uploaded shop logo', invoiceWith.includes(SHOP_LOGO));
  check('the invoice prints it as a logo image', LOGO_IMG.test(invoiceWith));

  const sample = receiptDesigner.buildSampleSale(printDocs.getPrintSettings(), 'sale');
  const design = sharedDesign.defaultReceiptDesign('thermal80');
  const designedWith = await receiptDesigner.buildDesignedReceiptAsync(sample, 'thermal80', design);
  check('the designed receipt carries the uploaded shop logo', designedWith.includes(SHOP_LOGO));
  check('the designed receipt prints it as a logo image', LOGO_IMG.test(designedWith));

  admin.setAdminSetting(receiptDesigner.RECEIPT_DESIGN_ENABLED_KEY, 'true');
  admin.setAdminSetting(receiptDesigner.RECEIPT_DESIGN_KEY, JSON.stringify(design));
  const appliedWith = await printing.buildReceiptJobAsync(saleId, 'standard');
  check('the REAL print path carries the uploaded shop logo', appliedWith.html.includes(SHOP_LOGO));

  // ── PRINT: no shop logo means NOTHING (no app-logo fallback) ─────────────
  section('Paper: with no shop logo, print nothing (never the app logo)');
  settings.setSetting('shop_logo', '');
  check('the setting really is empty now', settings.getSetting('shop_logo') === '', `got ${JSON.stringify(settings.getSetting('shop_logo'))}`);

  const receiptBare = printing.buildReceiptJob(saleId, 'standard', false);
  check('the receipt prints no logo image', !LOGO_IMG.test(receiptBare.html));
  check('the receipt never falls back to a bundled app asset', !APP_ASSET.test(receiptBare.html));

  const invoiceBare = printDocs.buildInvoiceHtml(saleId, 'a4');
  check('the invoice prints no logo image', !LOGO_IMG.test(invoiceBare));
  check('the invoice never falls back to a bundled app asset', !APP_ASSET.test(invoiceBare));

  const designedBare = await receiptDesigner.buildDesignedReceiptAsync(sample, 'thermal80', design);
  check('the designed receipt prints no logo image', !LOGO_IMG.test(designedBare));
  check('the designed receipt never falls back to a bundled app asset', !APP_ASSET.test(designedBare));

  const appliedBare = await printing.buildReceiptJobAsync(saleId, 'standard');
  check('the REAL print path prints no logo image', !LOGO_IMG.test(appliedBare.html));
  check('the REAL print path never falls back to a bundled app asset', !APP_ASSET.test(appliedBare.html));

  // Put the logo back for the screen half (a shop that has one).
  settings.setSetting('shop_logo', SHOP_LOGO);

  win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ── SCREEN: the login card is the APP ────────────────────────────────────
  section('Screen: the login card shows only the APP logo');
  await waitUntil('window.__l.hasLogin()', 'the login screen', 25000);
  const loginImgs = await js('window.__l.loginImages()');
  check('the login card shows exactly one image', loginImgs.length === 1, `count=${loginImgs.length}`);
  check('that image is the app lockup', loginImgs.length === 1 && loginImgs[0].alt === 'Rokar POS', loginImgs[0] && loginImgs[0].alt);
  check(
    'that image is the bundled lockup file',
    loginImgs.length === 1 && /rokar-pos-logo-light/.test(loginImgs[0].src),
    loginImgs[0] && loginImgs[0].src
  );
  check(
    'the login screen never uses the shop logo',
    (await js('window.__l.images()')).every((i) => i.src !== SHOP_LOGO)
  );

  // ── SCREEN: the sidebar brand is the APP ─────────────────────────────────
  section('Screen: the signed-in chrome shows only the APP logo');
  await signIn('admin', 'admin123');
  await waitUntil(
    "window.__l.buttons().some((b) => (b.innerText || '').trim() === 'History')",
    'the Billing screen',
    25000
  );
  const brand = await js('window.__l.sidebarImage()');
  check('the sidebar brand has an image', !!brand);
  check('the sidebar brand is the app mark', !!brand && /rokar-pos-mark-dark/.test(brand.src), brand && brand.src);
  check('the sidebar brand is not the shop logo', !!brand && brand.src !== SHOP_LOGO);
  check(
    'no image in the signed-in app is the shop logo',
    (await js('window.__l.images()')).every((i) => i.src !== SHOP_LOGO)
  );

  // ── SCREEN: the upload field stays, labelled print-only ──────────────────
  section('Settings: the shop logo is still uploadable, and says what it is for');
  await js("window.__l.click('Settings')");
  await waitText('Shop Logo', 25000);
  check(
    'the Shop Profile still has a "Upload from PC" control',
    await js("Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').toLowerCase().includes('upload from pc'))")
  );
  check(
    'the hint says "printed documents only"',
    await js('(/printed documents only/i).test(document.body.innerText)')
  );
  check(
    'the upload control previews the uploaded shop logo',
    await js(`(document.querySelector('img.logo-preview') || {}).src === ${JSON.stringify(SHOP_LOGO)}`)
  );

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILED'}: ${checks - failures}/${checks} checks passed`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_logoRule crashed:', e);
  app.exit(1);
});

// A suite that never finishes is a failure, not a hang for the operator.
setTimeout(() => {
  console.error('WATCHDOG: the logo suite did not finish in 240s');
  app.exit(2);
}, 240000);
