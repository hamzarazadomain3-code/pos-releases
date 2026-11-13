#!/usr/bin/env node
/**
 * End-to-end check: after a sale completes, the bill can be sent on WhatsApp
 * to the customer's number, exactly like the Email and SMS rows.
 *
 * Boots the REAL renderer (built dist/renderer) in a real BrowserWindow with
 * the real preload and the real IPC handlers, completes a real sale through
 * the UI, and then inspects the "Sale Completed" modal.
 *
 * Usage (after `npm run build`):  npx electron scripts/test_whatsapp_receipt_ui.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-wa-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'wa-receipt.db');
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

/* ---- the sale-success modal ---- */
window.__w = {
  successModal: () => {
    const modals = Array.from(document.querySelectorAll('.modal'));
    return modals.find((m) => /sale completed/i.test(m.innerText || '')) || null;
  },
  rows: () => {
    const m = window.__w.successModal();
    return m ? Array.from(m.querySelectorAll('.modal-action-row')) : [];
  },
  rowFor: (placeholder) => {
    const m = window.__w.successModal();
    if (!m) return null;
    const row = Array.from(m.querySelectorAll('.modal-action-row'))
      .find((r) => {
        const inp = r.querySelector('input');
        return inp && (inp.placeholder || '').toLowerCase().includes(placeholder.toLowerCase());
      });
    if (!row) return null;
    const input = row.querySelector('input');
    const button = row.querySelector('button');
    return {
      placeholder: input ? input.placeholder : '',
      value: input ? input.value : '',
      type: input ? input.type : '',
      buttonText: button ? button.innerText.trim() : '',
      disabled: button ? !!button.disabled : false,
    };
  },
  /* the WhatsApp button must carry its own class so it can be found reliably */
  whatsappButton: () => {
    const m = window.__w.successModal();
    if (!m) return null;
    const b = m.querySelector('button.btn-whatsapp');
    return b ? { text: b.innerText.trim(), disabled: !!b.disabled } : null;
  },
  /* the WhatsApp row must sit next to the WhatsApp button */
  whatsappRow: () => {
    const m = window.__w.successModal();
    if (!m) return null;
    const b = m.querySelector('button.btn-whatsapp');
    if (!b) return null;
    const row = b.closest('.modal-action-row');
    if (!row) return null;
    const input = row.querySelector('input');
    return { placeholder: input ? input.placeholder : '', value: input ? input.value : '' };
  },
  cartCount: () => document.querySelectorAll('.cart-row').length,
  setSearch: (text) => {
    const el = document.querySelector('.billing-search');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  focusSearch: () => {
    const el = document.querySelector('.billing-search');
    if (!el) return false;
    el.click();
    el.focus();
    return true;
  },
  comboOpen: () => !!document.querySelector('#customer-combobox-list'),
  comboRows: () => Array.from(document.querySelectorAll('#customer-combobox-list [role="option"]'))
                      .map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()),
  typeCombo: (text) => {
    const el = document.querySelector('input[role="combobox"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  /* Click the customer row in the combobox (the mouse path). */
  clickComboOption: (name) => {
    const rows = Array.from(document.querySelectorAll('#customer-combobox-list [role="option"]'));
    const r = rows.find((x) => (x.innerText || '').toLowerCase().includes(name.toLowerCase()));
    if (!r) return false;
    r.click();
    return true;
  },
  comboValue: () => {
    const el = document.querySelector('input[role="combobox"]');
    return el ? el.value : '';
  },
};

window.__k = {
  press(combo) {
    const raw = String(combo);
    const parts = raw.split('+');
    let keyName = parts.pop();
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
    else if (keyName === 'Escape' || keyName === 'Enter' || keyName === 'Delete' || keyName === 'Home' || keyName === 'End') { o.code = keyName; o.key = keyName; }
    else if (keyName === 'Pause') { o.code = 'Pause'; o.key = 'Pause'; }
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', o));
    return o.key;
  },
};
/* The helpers object holds functions, which cannot be cloned back to the
   main process — end the script with a cloneable value. */
undefined;
`;

// Plain executeJavaScript — the same shape the other suites use. The results
// this suite reads are all plain data (strings / booleans / small objects).
async function js(expr) {
  try {
    return await win.webContents.executeJavaScript(expr, true);
  } catch (e) {
    throw new Error(`js() failed for ${JSON.stringify(String(expr).slice(0, 160))}: ${e.message}`);
  }
}

/** Inject the helper script (a STATEMENT, so it cannot go through js()). */
async function inject(script) {
  await win.webContents.executeJavaScript(script, true);
}

async function ensureHelpers() {
  try {
    await inject(HELPERS);
  } catch {
    await sleep(300);
    await inject(HELPERS);
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

/** The fresh install forces a new owner password — set it so the next login works. */
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

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');

  await initDatabase();
  registerIpcHandlers();
  // A perpetual licence so the sale path is not blocked by the licence gate.
  {
    const { getDb } = require('../dist/main/db.js');
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('license_lifetime', '1')").run();
  }
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));
  // The WhatsApp handlers are the REAL ones (registered by registerIpcHandlers).
  // The gateway is not running in this test, but the button is never pressed —
  // the point of this suite is the UI, not the WhatsApp session.

  console.log('=== Rokar POS — send the bill on WhatsApp after a sale (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 950,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await inject(HELPERS);

  // ── Boot + login ──────────────────────────────────────────────────────────
  section('Boot + login');
  await waitFor('Sign in to continue', 20000);
  await signIn('admin', 'admin123');
  check('owner signed in', true);
  // A fresh install forces a new owner password before anything else works.
  await clearDefaultPasswordModal('OwnerPass1').catch(() => undefined);

  // ── Fixtures ──────────────────────────────────────────────────────────────
  section('Fixtures');
  const product = await js(
    "window.api.inventory.create({ name: 'WhatsApp Widget', sku: 'WA-1', barcode: 'WA-1', sale_price: 150, cost_price: 90, stock_qty: 25, low_stock_threshold: 5 })"
  );
  check('seeded a product', !!product && !!product.id, product && `#${product.id}`);

  const customer = await js(
    "window.api.customers.save({ name: 'Bilal WhatsApp', phone: '03001234567' }, null)"
  );
  check('seeded a customer with a phone', !!customer && !!customer.ok, customer && customer.message);
  const CUSTOMER_PHONE = '03001234567';

  // ── Build a bill ──────────────────────────────────────────────────────────
  section('Build a bill');
  await js("window.api.admin.shortcuts.reset()");
  // Sign out and reload so the Billing page picks up the new customer.
  await js('window.api.auth.logout()').catch(() => undefined);
  await js('localStorage.clear()');
  await js("localStorage.setItem('i18nextLng', 'en')");
  win.webContents.reload();
  await sleep(1800);
  await ensureHelpers();
  await waitFor('Sign in to continue', 20000);
  await signIn('admin', 'OwnerPass1');

  // Put the product in the cart by clicking its tile in the browse grid
  // (a real mouse click; the grid adds on a single click).
  await waitUntil("!!document.querySelector('.billing-search')", 'the Billing page to come back', 20000);
  await waitUntil("!!document.querySelector('.browse-item')", 'the browse grid', 20000);
  // A shop must have an open shift before it can bill.
  const shift = await js('window.api.shifts.open(0)');
  check('opened a shift', !!shift, shift && (shift.ok === false ? shift.message : `id ${shift.id ?? '?'}`));
  const tileClicked = await js(`
    (() => {
      const b = Array.from(document.querySelectorAll('.browse-item'))
        .find((x) => /WhatsApp Widget/i.test(x.innerText));
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  check('the product tile is in the browse grid', !!tileClicked);
  // The tile adds on a 220ms click timer.
  await waitUntil('window.__w.cartCount() > 0', 'the product to reach the cart', 10000);
  const cartCount = await js('window.__w.cartCount()');
  check('the product is in the cart', cartCount > 0, `${cartCount} line(s)`);

  // Select the customer (F6 → type → click the row), so the phone is known.
  await js("window.__k.press('F6')");
  await waitUntil('window.__w.comboOpen()', 'the customer combobox to open', 8000);
  await js("window.__w.typeCombo('Bilal WhatsApp')");
  await sleep(600);
  const clicked = await js("window.__w.clickComboOption('Bilal WhatsApp')");
  check('the customer row was clickable in the combobox', !!clicked);
  await sleep(700);
  const comboGone = await js('!window.__w.comboOpen()');
  const comboValue = await js('window.__w.comboValue()');
  check('the customer was selected', !!comboGone && /Bilal/i.test(String(comboValue || '')), comboValue);

  // ── Complete the sale (F8 = express checkout) ─────────────────────────────
  section('Complete the sale');
  await js("window.__k.press('F8')");
  await waitUntil('!!window.__w.successModal()', 'the Sale Completed modal', 20000);
  check('the sale completed and the modal opened', true);

  // ── The WhatsApp row ──────────────────────────────────────────────────────
  section('The bill can go out on WhatsApp');
  const waButton = await js('window.__w.whatsappButton()');
  check('there is a WhatsApp button', !!waButton, waButton && waButton.text);

  const waRow = await js('window.__w.whatsappRow()');
  check('the WhatsApp button sits in an input row (like Email / SMS)', !!waRow, waRow && waRow.placeholder);

  const emailRow = await js("window.__w.rowFor('email')");
  const smsRow = await js("window.__w.rowFor('customer phone')");
  check('the Email row is still there', !!emailRow, emailRow && emailRow.buttonText);
  check('the SMS row is still there', !!smsRow, smsRow && smsRow.buttonText);

  check(
    'the WhatsApp number is pre-filled with the customer phone',
    !!waRow && waRow.value === CUSTOMER_PHONE,
    waRow && `${waRow.value}`
  );
  check(
    'the WhatsApp button is enabled (there is a number to send to)',
    !!waButton && waButton.disabled === false
  );

  // The number is editable: any number can be typed in.
  const edited = await js(`
    (() => {
      const m = window.__w.successModal();
      const row = m.querySelector('button.btn-whatsapp').closest('.modal-action-row');
      const input = row.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '03009998877');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()
  `);
  check('the WhatsApp number can be edited to any other number', edited === '03009998877', edited);

  console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
  if (failures) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('ALL PASSED');
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    console.error('\n=== TEST CRASHED ===');
    console.error(e);
    process.exit(1);
  }
  app.quit();
});
