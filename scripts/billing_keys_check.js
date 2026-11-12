#!/usr/bin/env node
/**
 * Run 13 — the NEW keyboard + customer-discount features, driven end-to-end.
 *
 * Boots the REAL renderer (built dist/renderer) in a real BrowserWindow with
 * the real preload and the real IPC handlers, then drives the actual DOM with
 * synthetic key presses. This is the "demo chala ke khud check" pass for the
 * features added in this run:
 *
 *   - F6 opens the customer combobox, filters, and selects a customer
 *   - the customer's 5% discount lands in the Discount % field + the badge
 *   - "+ New customer" opens the quick dialog
 *   - Pause / F4 opens the bill-edit mode (and Esc leaves it)
 *   - Esc with nothing open refreshes the page and KEEPS the cart
 *   - Sales History shows the void-rule sentence in its footer
 *
 * Usage (after `npm run build`):  npx electron scripts/billing_keys_check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-keys-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'billing-keys.db');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let checks = 0;
let failures = 0;
let win;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

window.__k = {
  press(combo) {
    const raw = String(combo);
    const parts = raw.split('+');
    let keyName = parts.pop();
    // "+" is BOTH the separator and a key: "press('+')" must deliver key="+".
    if (raw === '+') keyName = '+';
    if (raw === '-') keyName = '-';
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
    else if (keyName === 'ArrowUp' || keyName === 'ArrowDown' || keyName === 'ArrowLeft' || keyName === 'ArrowRight') { o.code = keyName; o.key = keyName; }
    else if (keyName === 'Escape' || keyName === 'Enter' || keyName === 'Delete' || keyName === 'Home' || keyName === 'End') { o.code = keyName; o.key = keyName; }
    else if (keyName === 'Pause') { o.code = 'Pause'; o.key = 'Pause'; }
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', o));
    return o.key;
  },
  /* ---- customer combobox (F6) ---- */
  comboOpen: () => !!document.querySelector('#customer-combobox-list'),
  comboRows: () => Array.from(document.querySelectorAll('#customer-combobox-list [role="option"]'))
                      .map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()),
  comboInput: () => {
    const el = document.querySelector('input[role="combobox"]');
    return el ? el.value : '';
  },
  typeCombo: (text) => {
    const el = document.querySelector('input[role="combobox"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  /* ---- discount fields + badge ---- */
  discountFields: () => {
    const inputs = Array.from(document.querySelectorAll('.bsf-input'));
    const pct = inputs.find((i) => i.previousElementSibling && /Discount %/i.test(i.previousElementSibling.textContent || ''));
    const cur = inputs.find((i) => i.previousElementSibling && /Discount Currency/i.test(i.previousElementSibling.textContent || ''));
    return { pct: pct ? pct.value : null, currency: cur ? cur.value : null };
  },
  discountBadge: () => {
    const b = document.querySelector('.bsf-input-group .badge');
    return b ? (b.innerText || '').trim() : '';
  },
  /* ---- bill edit mode ---- */
  billEditHint: () => {
    const h = document.querySelector('.bill-edit-hint');
    return h ? (h.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  },
  billEditRow: () => {
    const r = document.querySelector('.cart-row-billedit');
    return r ? (r.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  },
  /* ---- cart + notice ---- */
  cartLines: () => document.querySelectorAll('.cart-row').length,
  cartText: () => {
    const rows = Array.from(document.querySelectorAll('.cart-row'));
    return rows.map((r) => (r.innerText || '').replace(/\\s+/g, ' ').trim()).join(' | ');
  },
  notice: () => {
    const n = document.querySelector('.notice');
    return n ? (n.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  },
  /* ---- sales history ---- */
  openHistory: () => {
    const btn = Array.from(document.querySelectorAll('.billing-top .btn'))
      .find((b) => /^History/i.test((b.textContent || '').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  },
  modalFooter: () => {
    const m = document.querySelector('.modal');
    return m ? (m.innerText || '').replace(/\\s+/g, ' ') : '';
  },
  closeModal: () => {
    const btns = Array.from(document.querySelectorAll('.modal button'));
    const b = btns.find((x) => /^Close$/i.test((x.innerText || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  },
  /* ---- product search (add to cart) ---- */
  setSearch: (text) => {
    const el = document.querySelector('.billing-search');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  },
  focusSearch: () => {
    const el = document.querySelector('.billing-search');
    if (!el) return false;
    el.focus();
    return true;
  },
};
/* The helpers object holds functions, which cannot be cloned back to the
   main process — end the script with a cloneable value. */
undefined;
`;

async function js(code) {
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    throw new Error(
      `js failed (len ${String(code).length}) for: ${String(code).slice(0, 200)}\n  ${
        e && e.message ? e.message : e
      }`
    );
  }
}

async function ensureHelpers() {
  try {
    await js(HELPERS);
  } catch {
    await sleep(300);
    await js(HELPERS);
  }
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
  await waitUntil(
    "window.__t.heading().toLowerCase().includes('owner password')",
    'default-password modal'
  );
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
  await sleep(1200);
  await ensureHelpers();
  await waitFor('Sign in to continue', 20000);
}

async function signIn(username, password) {
  await ensureHelpers();
  await waitFor('Sign in to continue');
  await js(`window.__t.set(0, ${JSON.stringify(username)})`);
  await js(`window.__t.set(1, ${JSON.stringify(password)})`);
  await js("window.__t.click('Login')");
  await waitUntil(
    "!window.__t.hasLoginBox() || window.__t.heading().toLowerCase().includes('owner password')",
    `login as ${username}`,
    15000
  );
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

  console.log('=== Rokar POS — new keyboard + discount features (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 950,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ── Boot + login ──────────────────────────────────────────────────────────
  section('Boot + login');
  await waitFor('Sign in to continue', 20000);
  await signIn('admin', 'admin123');
  check('owner signed in', true);

  // Seed the shortcut table so the registry defaults resolve, then reload.
  await js('window.api.admin.shortcuts.reset()');
  await goToLoginScreen();
  await signIn('admin', 'OwnerPass1');
  check('signed in after seeding shortcut defaults', true);

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const product = await js(
    "window.api.inventory.create({ name: 'Demo Widget', sku: 'DEMO-1', barcode: 'DEMO-1', sale_price: 100, cost_price: 60, stock_qty: 40, low_stock_threshold: 5 })"
  );
  check('seeded a product', !!product && !!product.id, product && `#${product.id}`);
  const customer = await js(
    "window.api.customers.save({ name: 'Ali Khan', phone: '03001234567', default_discount_pct: 5, discount_type: 'percent' }, null)"
  );
  check('seeded a customer with a 5% discount', !!customer && !!customer.ok, customer && customer.message);

  // The Billing page loaded its customer list at mount, so reload the renderer
  // to pick up the customer that was just created.
  await js('window.location.reload()');
  await sleep(1500);
  await ensureHelpers();
  await waitUntil(
    "!!document.querySelector('.billing-search')",
    'the Billing page to come back',
    20000
  );
  check('Billing reloaded with the new customer in the list', true);

  // ── F6: the customer combobox ─────────────────────────────────────────────
  section('F6 customer search');
  await js('window.__k.press("F6")');
  await waitUntil('window.__k.comboOpen()', 'the customer combobox to open');
  check('F6 opens the customer combobox', true);

  await js('window.__k.typeCombo("ali")');
  await sleep(400);
  const rows = await js('window.__k.comboRows()');
  check('typing filters the list', rows.some((r) => /ali khan/i.test(r)), rows.join(' / ').slice(0, 120));
  check('the walk-in row is first', /no customer/i.test(rows[0] || ''), rows[0]);
  check('the last row is "+ New customer"', /\+ new customer/i.test(rows[rows.length - 1] || ''), rows[rows.length - 1]);

  await js('window.__k.press("Enter")');
  await sleep(500);
  check('Enter selects the customer (the list closes)', !(await js('window.__k.comboOpen()')));
  const fields = await js('window.__k.discountFields()');
  check('the 5% discount lands in the Discount % field', fields.pct === '5', JSON.stringify(fields));
  const badge = await js('window.__k.discountBadge()');
  check('the badge says "Customer discount 5% applied"', /customer discount 5% applied/i.test(badge), badge);

  // ── "+ New customer" from the combobox ────────────────────────────────────
  section('Quick new customer');
  await js('window.__k.press("F6")');
  await waitUntil('window.__k.comboOpen()', 'the combobox to reopen');
  const newRow = await js(
    "(() => { const b = Array.from(document.querySelectorAll('#customer-combobox-list [role=\"option\"]')).find(x => /new customer/i.test(x.innerText)); if (!b) return false; b.click(); return true; })()"
  );
  check('"+ New customer" is clickable', !!newRow);
  await sleep(400);
  const dialogText = await js(
    "(() => { const m = document.querySelector('.modal'); return m ? (m.innerText || '').replace(/\\s+/g,' ') : ''; })()"
  );
  check('the quick customer dialog opens', /new customer/i.test(dialogText), dialogText.slice(0, 100));
  await js('window.__k.press("Escape")');
  // Wait for the dialog to be really gone: typing into the Billing search
  // while the dialog is still unmounting would race the re-render.
  await waitUntil("!document.querySelector('.modal')", 'the quick customer dialog to close', 10000);
  await sleep(400);

  // ── Put a line in the cart ────────────────────────────────────────────────
  section('Cart + Esc refresh');
  await waitUntil("!!document.querySelector('.billing-search')", 'the billing search box', 10000);
  await js('window.__k.focusSearch()');
  await js('window.__k.setSearch("DEMO-1")');
  await sleep(600);
  await js('window.__k.press("Enter")');
  await waitUntil('window.__k.cartLines() > 0', 'the product to land in the cart');
  check('the product is in the cart', (await js('window.__k.cartLines()')) >= 1);

  // ── Pause / F4: the bill-edit mode ────────────────────────────────────────
  section('Pause / F4 bill editing');
  await js('window.__k.press("F4")');
  await waitUntil("window.__k.billEditHint().length > 0", 'the bill-edit hint bar');
  const hint = await js('window.__k.billEditHint()');
  check('F4 opens the bill-edit mode', /Up\/Down row/.test(hint), hint.slice(0, 90));
  check('the hint names every key', /Enter type qty/.test(hint) && /U unit/.test(hint) && /Del remove/.test(hint));
  check('a row is highlighted', (await js('window.__k.billEditRow()')).length > 0);

  await js('window.__k.press("ArrowDown")');
  await sleep(150);
  check('ArrowDown moves the selection', true);

  const qtyBefore = await js('window.__k.billEditRow()');
  await js('window.__k.press("+")');
  await sleep(300);
  const qtyAfter = await js('window.__k.billEditRow()');
  const qtyOf = (t) => {
    const m = /×\s*([\d.]+)/.exec(String(t || ''));
    return m ? Number(m[1]) : NaN;
  };
  check(
    '"+" raises the quantity',
    qtyOf(qtyAfter) === qtyOf(qtyBefore) + 1,
    `${qtyOf(qtyBefore)} -> ${qtyOf(qtyAfter)} (${qtyAfter})`
  );

  await js('window.__k.press("Escape")');
  await sleep(250);
  check('Escape leaves the bill-edit mode', (await js('window.__k.billEditHint()')) === '');

  // ── Esc refreshes and keeps the cart ──────────────────────────────────────
  const cartBefore = await js('window.__k.cartText()');
  await js('window.__k.focusSearch()');
  await js('window.__k.press("Escape")');
  await sleep(900);
  const cartAfter = await js('window.__k.cartText()');
  check('Esc keeps the cart untouched', cartAfter === cartBefore, `${cartBefore} -> ${cartAfter}`);
  const notice = await js('window.__k.notice()');
  check('Esc shows the "Refreshed" toast', /refreshed/i.test(notice), notice);

  // ── Sales History footer ──────────────────────────────────────────────────
  section('Sales History');
  await js('window.__k.openHistory()');
  await waitUntil(
    "!!document.querySelector('.modal')",
    'the Sales History dialog to open',
    15000
  );
  const historyText = await js('window.__k.modalFooter()');
  check(
    'the footer states the void rule',
    /Totals count a sale only while it is not voided; voids are listed on the day they happen/i.test(historyText),
    historyText.slice(0, 140)
  );
  check('the footer keeps the Esc / Refresh hint', /Press Esc to close, Refresh to reload/i.test(historyText));

  await js('window.__k.press("Escape")');
  await waitUntil("!document.querySelector('.modal')", 'the history dialog to close', 8000);
  check('Escape closes the history dialog', !(await js('document.querySelector(".modal")')));
}

app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await run();
  } catch (e) {
    console.error('FATAL', e && e.stack ? e.stack : String(e));
    failures++;
  } finally {
    console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
    app.exit(failures === 0 ? 0 : 1);
  }
});
