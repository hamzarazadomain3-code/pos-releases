#!/usr/bin/env node
/**
 * "Import purchases from file" — the END-TO-END UI check.
 *
 * Boots the real renderer (built dist/renderer) in a real BrowserWindow with the
 * real preload and the real IPC handlers, then drives the actual DOM: it drops a
 * CSV on the Purchases screen and picks a file inside the import wizard, and
 * asserts the file is really parsed (the wizard jumps to the column-mapping
 * step with the file's own columns and values).
 *
 * This is what the service-level suite (`test:purchaseimportdata`) cannot prove:
 * that the renderer reads the picked FILE (not a file path — a browser has no
 * file system) and hands the content to the main process.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_purchaseImportUi.js   # or: npm run test:purchaseimportui
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-purchase-import-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'purchase-import-ui.db');
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

const CSV = [
  'barcode,sku,product name,qty,unit,cost rate,sale price',
  '1110001110001,SKU-1,Rice 5kg,10,Bag,100,120',
  ',SKU-2,Cooking Oil,6,pcs,50,60',
].join('\r\n');

/** Injected into the page: the login box + the purchase-import helpers. */
const HELPERS = `
window.__t = {
  all: () => Array.from(document.querySelectorAll('.lock-box')),
  top: () => { const a = window.__t.all(); return a.length ? a[a.length - 1] : null; },
  hasLoginBox: () => !!document.querySelector('.lock-box'),
  heading: () => { const b = window.__t.top(); const h = b && b.querySelector('h2'); return h ? h.innerText : ''; },
  inputs: () => { const b = window.__t.top(); return b ? Array.from(b.querySelectorAll('input')) : []; },
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

window.__pi = {
  csv: () => ${JSON.stringify(CSV)},
  /** The wizard modal is open. */
  wizardOpen: () => !!document.querySelector('.import-wizard'),
  wizardTitle: () => {
    const t = document.querySelector('.import-wizard');
    return t ? (t.innerText || '').slice(0, 400) : '';
  },
  activeStep: () => {
    const t = document.querySelector('.import-wizard .modal-tab.is-active');
    return t ? t.innerText.trim() : '';
  },
  /** The column-mapping table (step 3). */
  mappingRows: () => {
    const rows = Array.from(document.querySelectorAll('.import-wizard table.data-table tbody tr'));
    return rows.map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.innerText.trim()));
  },
  /** Drop a CSV on the Purchases screen's drop zone. */
  dropOnPurchases: () => {
    const zone = document.querySelector('[data-purchase-drop]');
    if (!zone) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([window.__pi.csv()], 'purchases.csv', { type: 'text/csv' }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  },
  /** Pick a CSV in the wizard's own file input (step 2). */
  pickInWizard: () => {
    const input = document.querySelector('.import-wizard input[type=file]');
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([window.__pi.csv()], 'purchases.csv', { type: 'text/csv' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  /** The "Purchase Orders" tab on the Purchases screen. */
  clickOrdersTab: () => {
    const btn = Array.from(document.querySelectorAll('.tabs .tab-btn'))
      .find((b) => (b.textContent || '').trim().toLowerCase() === 'purchase orders');
    if (!btn) return false;
    btn.click();
    return true;
  },
  /** The "Import from file" button on the Purchases screen. */
  clickImportFromFile: () => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim().toLowerCase() === 'import from file');
    if (!btn) return false;
    btn.click();
    return true;
  },
  /** The wizard's primary Next button (the modal's submit action). */
  clickNext: () => {
    const btn = document.querySelector('.import-wizard .modal-actions .btn-primary');
    if (!btn) return false;
    btn.click();
    return true;
  },
  /** The wizard's Cancel button. */
  closeWizard: () => {
    const t = document.querySelector('.import-wizard');
    if (!t) return false;
    const btn = Array.from(t.querySelectorAll('.modal-actions button'))
      .find((b) => (b.textContent || '').trim().toLowerCase() === 'cancel');
    if (!btn) return false;
    btn.click();
    return true;
  },
  nav: (label) => {
    const btns = Array.from(document.querySelectorAll('.nav-btn'));
    const b = btns.find((x) => ((x.getAttribute('data-label') || x.innerText || '').trim().toLowerCase() === label.toLowerCase()));
    if (!b) throw new Error('no nav button "' + label + '"');
    b.click();
    return true;
  },
  activeNavLabel: () => { const b = document.querySelector('.nav-btn.active'); return b ? (b.getAttribute('data-label') || b.innerText || '').trim() : ''; },
  pageTitle: () => { const h = document.querySelector('.page-header h1') || document.querySelector('h1'); return h ? h.innerText.trim() : ''; },
};
true;
`;

async function js(code) {
  return win.webContents.executeJavaScript(code, true);
}

async function ensureHelpers() {
  await js(HELPERS);
}

async function waitUntil(expr, label, timeoutMs = 12000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js(`String(${expr})`);
      if (last === 'true') return true;
    } catch {
      await ensureHelpers();
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label} (last: ${String(last).slice(0, 160)})`);
}

async function waitForText(label, timeoutMs = 20000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js('document.body.innerText');
      if (last && last.toLowerCase().includes(label.toLowerCase())) return true;
    } catch {
      await ensureHelpers();
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for "${label}" (last: ${String(last).slice(0, 160)})`);
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
  await waitUntil('!window.__t.hasLoginBox()', 'the password modal to close', 10000);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitForText('Sign in to continue');
  await js(`window.__t.set(0, ${JSON.stringify(username)})`);
  await js(`window.__t.set(1, ${JSON.stringify(password)})`);
  await js("window.__t.click('Login')");
  await waitUntil(
    "!window.__t.hasLoginBox() || window.__t.heading().toLowerCase().includes('owner password')",
    `login as ${username} to complete`,
    15000,
  );
  if (await mustChangePwVisible()) {
    await clearDefaultPasswordModal('OwnerPass1');
    await js('window.api.auth.logout()').catch(() => undefined);
    await js('localStorage.clear()');
    await js('window.location.reload()');
    await sleep(1200);
    await ensureHelpers();
    await waitForText('Sign in to continue');
    return signIn(username, 'OwnerPass1');
  }
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const { createSupplier } = require('../dist/main/services/purchases.js');

  await initDatabase();
  registerIpcHandlers();

  // The wizard's first step needs a supplier to pick.
  createSupplier('Test Supplier', '0300-1234567');

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS — Purchase import from file (end-to-end) ===');

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

  section('Boot + login');
  await waitForText('Sign in to continue', 15000);
  await signIn('admin', 'admin123');
  check('owner signed in', true);

  section('Drop a file on the Purchases screen');
  await js("window.__pi.nav('Purchases')");
  await waitUntil("window.__pi.activeNavLabel() === 'Purchases'", 'the Purchases nav to activate');
  await waitUntil("window.__pi.pageTitle() === 'Purchases & Suppliers'", 'the Purchases page to render', 20000);
  check('the Purchases page is open', true);

  await js('window.__pi.clickOrdersTab()');
  await waitUntil('!!document.querySelector("[data-purchase-drop]")', 'the Purchase Orders tab', 10000);
  check('the Purchase Orders tab is open', true);

  const dropped = await js('window.__pi.dropOnPurchases()');
  check('the drop zone exists', dropped === true);
  await waitUntil('window.__pi.wizardOpen()', 'the import wizard to open', 12000);
  check('dropping a file opens the import wizard', true);

  await waitUntil("window.__pi.activeStep() === '3 · Columns'", 'the wizard to parse the dropped file', 15000);
  check('the dropped file was parsed (the wizard is on the Columns step)', true, await js('window.__pi.activeStep()'));

  const rows = await js('window.__pi.mappingRows()');
  check('every column of the file is listed', Array.isArray(rows) && rows.length === 7, String(rows && rows.length));
  const fileColumns = (rows || []).map((r) => r[0]);
  check('the file columns are read', fileColumns.includes('barcode') && fileColumns.includes('product name') && fileColumns.includes('qty'), JSON.stringify(fileColumns));
  const qtyRow = (rows || []).find((r) => r[0] === 'qty');
  check('the first row value is shown', !!qtyRow && qtyRow[1] === '10', JSON.stringify(qtyRow));
  const nameRow = (rows || []).find((r) => r[0] === 'product name');
  check('the product name of the first row is shown', !!nameRow && nameRow[1] === 'Rice 5kg', JSON.stringify(nameRow));

  section('Pick a file inside the wizard');
  await js('window.__pi.closeWizard()');
  await waitUntil('!window.__pi.wizardOpen()', 'the wizard to close', 10000);
  check('the wizard can be closed', true);

  await js("window.__pi.clickImportFromFile()");
  await waitUntil('window.__pi.wizardOpen()', 'the wizard to reopen', 10000);
  check('the "Import from file" button opens the wizard', true);

  const activeStep1 = await js('window.__pi.activeStep()');
  check('the wizard starts on the Details step', activeStep1 === '1 · Details', activeStep1);

  // Step 1 needs a supplier before "Next" is allowed.
  const hasSupplier = await js(`(() => {
    const sel = document.querySelector('.import-wizard select');
    if (!sel) return false;
    if (sel.options.length < 2) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  check('a supplier can be chosen', hasSupplier === true);

  await js('window.__pi.clickNext()');
  await waitUntil("window.__pi.activeStep() === '2 · File'", 'the wizard to reach the File step', 10000);
  check('the wizard reached the File step', true);

  const picked = await js('window.__pi.pickInWizard()');
  check('the wizard has a file input', picked === true);
  await waitUntil("window.__pi.activeStep() === '3 · Columns'", 'the picked file to be parsed', 15000);
  check('the picked file was parsed (the wizard is on the Columns step)', true, await js('window.__pi.activeStep()'));

  const rows2 = await js('window.__pi.mappingRows()');
  check('the picked file lists its columns', Array.isArray(rows2) && rows2.length === 7, String(rows2 && rows2.length));
  const qtyRow2 = (rows2 || []).find((r) => r[0] === 'qty');
  check('the picked file keeps its values', !!qtyRow2 && qtyRow2[1] === '10', JSON.stringify(qtyRow2));

  section('No error is shown');
  const errors = await js(`(() => {
    const e = document.querySelector('.import-wizard .notice.error');
    return e ? e.innerText.trim() : '';
  })()`);
  check('the wizard shows no error', !errors, errors);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All purchase-import-from-file UI checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
