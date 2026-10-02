#!/usr/bin/env node
/**
 * Password recovery END-TO-END UI test.
 *
 * Boots the real renderer (built dist/renderer) in a real BrowserWindow with the
 * real preload and the real IPC handlers, then drives the actual DOM the way a
 * user would. This covers what the service-level suite cannot: that the React
 * components render, that the IPC channel names line up end to end, and that the
 * Ctrl+Shift+Alt+R shortcut is actually armed.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_recovery_ui.js
 *
 * Covers verification steps 3 and 4 from the recovery plan:
 *   3. set a security question -> log out -> Forgot password -> answer -> new
 *      password -> log in successfully
 *   4. trigger Support Recovery, read the Device ID, verify a correct code works
 *      and an incorrect one is rejected
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-recovery-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'recovery-ui.db');

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

/** Injected once into the page; every later step drives the real DOM through it. */
const HELPERS = `
window.__t = {
  // The login screen, the auto-lock screen and the forced-password modal all use
  // .lock-box, and the modal is a sibling that mounts later. The LAST box in DOM
  // order is therefore the one the user is actually looking at / can click.
  all: () => Array.from(document.querySelectorAll('.lock-box')),
  top: () => { const a = window.__t.all(); return a.length ? a[a.length - 1] : null; },
  text: () => { const b = window.__t.top(); return b ? b.innerText : ''; },
  inputs: () => { const b = window.__t.top(); return b ? Array.from(b.querySelectorAll('input')) : []; },
  hasLoginBox: () => !!document.querySelector('.lock-box'),
  heading: () => { const b = window.__t.top(); const h = b && b.querySelector('h2'); return h ? h.innerText : ''; },
  // React controlled inputs ignore plain .value assignment; use the native setter
  // and fire the bubbling input event React actually listens for.
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
  supportChord: () => {
    window.confirm = () => true;   // the hidden shortcut asks before opening
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true, altKey: true, bubbles: true,
    }));
    return true;
  },
  deviceBlock: () => {
    const el = document.querySelector('.recovery-device-id');
    return el ? el.innerText.trim() : null;
  },
};
true;
`;

const js = (code) => win.webContents.executeJavaScript(code, true);

/** Helpers live in the page, so a reload wipes them. Re-inject on demand. */
async function ensureHelpers() {
  const present = await js('!!window.__t').catch(() => false);
  if (!present) await js(HELPERS);
  return true;
}

async function waitFor(label, timeoutMs = 8000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js('window.__t.text()');
      if (last && last.toLowerCase().includes(label.toLowerCase())) return true;
    } catch {
      // Page is mid-navigation (or reloaded) — put the helpers back and retry.
      await ensureHelpers();
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out waiting for "${label}" (last box text: ${JSON.stringify(String(last).slice(0, 160))})`);
}

async function waitGone(selector, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await js(`!!document.querySelector(${JSON.stringify(selector)})`))) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/** Poll an in-page predicate until it returns truthy. */
async function waitUntil(expr, desc, timeoutMs = 10000) {
  const started = Date.now();
  let truthy = false;
  while (Date.now() - started < timeoutMs) {
    try {
      truthy = await js(expr);
      if (truthy) return true;
    } catch {
      await ensureHelpers();
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out waiting for ${desc} (top box heading: ${JSON.stringify(
    await js('window.__t.heading()').catch(() => '?'))})`);
}

/** True when the app is showing the forced "Set a new owner password" modal. */
async function mustChangePwVisible() {
  const heading = await js('window.__t.heading()').catch(() => '');
  // NB: the real heading is "Set a new owner password" — match on a phrase that
  // is not broken by the "a".
  return heading.toLowerCase().includes('owner password');
}

/** Type a new password into the forced modal and dismiss it. */
async function clearDefaultPasswordModal(newPassword) {
  await waitUntil("window.__t.heading().toLowerCase().includes('owner password')", 'the default-password modal');
  await js(`window.__t.set(0, ${JSON.stringify(newPassword)})`);
  await js(`window.__t.set(1, ${JSON.stringify(newPassword)})`);
  await js("window.__t.click('Save')");
  await waitUntil('!window.__t.hasLoginBox()', 'the modal to close', 10000);
}

/** Drop the session and return to a clean login screen. */
async function goToLoginScreen() {
  if (await mustChangePwVisible()) await clearDefaultPasswordModal('OwnerPass1');
  await js('window.api.auth.logout()').catch(() => undefined);
  await js('localStorage.clear()');
  await js('window.location.reload()');
  await new Promise((r) => setTimeout(r, 900));
  await ensureHelpers();
  await waitFor('Rokar POS', 20000);
}

/** Sign in through the real login form and land inside the app. */
async function signIn(username, password) {
  await ensureHelpers();
  await waitFor('Rokar POS');
  await js(`window.__t.set(0, ${JSON.stringify(username)})`);
  await js(`window.__t.set(1, ${JSON.stringify(password)})`);
  await js("window.__t.click('Login')");
  // Either the login screen unmounts (landed) or the forced modal takes over.
  const outcome = await waitUntil(
    "!window.__t.hasLoginBox() || window.__t.heading().toLowerCase().includes('owner password')",
    `login as ${username} to complete`,
    15000,
  ).then(() => 'ok').catch(() => 'timeout');
  if (outcome === 'timeout') {
    throw new Error(`login did not complete for ${username}; box says: ${await js('window.__t.text()')}`);
  }
  if (await mustChangePwVisible()) {
    // First run on a fresh DB forces a password change. Clear it, then sign back in.
    await clearDefaultPasswordModal('OwnerPass1');
    await goToLoginScreen();
    return signIn(username, 'OwnerPass1');
  }
}



async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const { computeSupportCode } = require('../tools/recovery-code-cli.js');

  await initDatabase();
  registerIpcHandlers();

  // Channels that main.ts / updater.ts / licensing.ts register in the real app.
  // Stubbed here so the renderer can mount without the full bootstrap. App.tsx
  // calls updater.getState() with no .catch, so leaving these unregistered throws.
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS — Password Recovery UI (end-to-end) ===');

  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // ─────────────────────────────────────────────────────────────────────
  section('Boot + first login');
  await waitFor('Rokar POS', 15000);
  check('login screen renders', (await js('window.__t.hasLoginBox()')) === true);
  check('"Forgot password?" link is present on the login screen',
    (await js("Array.from(document.querySelectorAll('.lock-box button')).some(b => b.innerText.includes('Forgot password'))")) === true);

  // signIn() transparently clears the forced default-password modal (which sets
  // the password to OwnerPass1) and lands back inside the app.
  await signIn('admin', 'admin123');
  check('owner signed in and the default-password modal was cleared', true);

  // ─────────────────────────────────────────────────────────────────────
  section('Step 3 — self-service recovery through the real UI');
  const setRes = await js("window.api.recovery.setSecurity(1, \"What is your shop's registration year?\", '2019')");
  check('security question saved via IPC', setRes && setRes.hasSecurityQuestion === true, setRes && setRes.question);

  await goToLoginScreen();

  await js("window.__t.click('Forgot password')");
  await waitFor('Reset your password');
  check('"Forgot password?" opens the recovery screen', true);

  await js("window.__t.set(0, 'admin')");
  await js("window.__t.click('Continue')");
  await waitFor('registration year');
  check('the stored security question is shown', true);

  // Wrong answer must be rejected.
  await js("window.__t.set(0, '1999')");
  await js("window.__t.click('Verify answer')");
  await waitFor('Incorrect answer');
  check('a wrong answer is rejected with a visible error', true);

  await js("window.__t.set(0, '  2019  ')");
  await js("window.__t.click('Verify answer')");
  await waitFor('Choose a new password');
  check('the correct answer (normalised) advances to the new-password step', true);

  await js("window.__t.set(0, 'Recovered1')");
  await js("window.__t.set(1, 'Recovered1')");
  await js("window.__t.click('Set password')");
  await waitFor('Password updated');
  check('password is reset and the success screen appears', true);

  await js("window.__t.click('Back to login')");
  await waitFor('Rokar POS');
  check('login screen returns with the username prefilled',
    (await js("window.__t.inputs()[0].value")) === 'admin',
    await js("window.__t.inputs()[0].value"));

  await signIn('admin', 'Recovered1');
  check('✅ sign-in with the NEW password succeeds', true);

  // ─────────────────────────────────────────────────────────────────────
  section('Option A via the owner recovery code');
  const masterCode = await js('window.api.recovery.ownerCode()');
  check('owner recovery code is XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(masterCode), masterCode);

  await goToLoginScreen();
  await js("window.__t.click('Forgot password')");
  await waitFor('Reset your password');
  await js("window.__t.set(0, 'admin')");
  await js("window.__t.click('Continue')");
  await waitFor('registration year');
  await js("window.__t.click('Use my recovery code instead')");
  await waitFor('recovery code you wrote down');
  check('the recovery-code toggle is available', true);
  await js(`window.__t.set(0, ${JSON.stringify(masterCode)})`);
  await js("window.__t.click('Verify answer')");
  await waitFor('Choose a new password');
  check('the owner recovery code also opens the reset step', true);

  await js("window.__t.set(0, 'OwnerPass1')");
  await js("window.__t.set(1, 'OwnerPass1')");
  await js("window.__t.click('Set password')");
  await waitFor('Password updated');
  await js("window.__t.click('Back to login')");
  await signIn('admin', 'OwnerPass1');
  check('sign-in works again after the code-based reset', true);

  // ─────────────────────────────────────────────────────────────────────
  section('Step 4 — Support Recovery via the hidden chord');
  await goToLoginScreen();

  // The chord must NOT fire without the modifier keys.
  await js("window.confirm = () => { window.__confirmFired = true; return false; }; true");
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true })); true");
  await new Promise((r) => setTimeout(r, 500));
  check('plain "R" does not open Support Recovery', (await js('!!window.__confirmFired')) === false);

  await js('window.__t.supportChord()');
  await waitFor('Support Recovery');
  check('Ctrl+Shift+Alt+R opens Support Recovery', true);

  const deviceId = await js('window.__t.deviceBlock()');
  check('Device ID is displayed for the client to read out', !!deviceId, deviceId);

  const boxText = await js('window.__t.text()');
  const epochMatch = boxText.match(/Request #:\s*(\d+)/);
  const ownerMatch = boxText.match(/Owner:\s*(\S+)/);
  check('Request # is displayed', !!epochMatch, epochMatch && epochMatch[1]);
  check('Owner name is displayed', !!ownerMatch, ownerMatch && ownerMatch[1]);

  const epoch = epochMatch ? Number(epochMatch[1]) : 0;
  const owner = ownerMatch ? ownerMatch[1] : 'admin';
  const goodCode = computeSupportCode(deviceId, owner, epoch);

  // Wrong code must be rejected.
  await js("window.__t.set(0, 'ZZZZ-ZZZZ')");
  await js("window.__t.click('Verify code')");
  await waitFor('Invalid recovery code');
  check('❌ an incorrect support code is rejected', true);

  // Correct code must be accepted.
  await js(`window.__t.set(0, ${JSON.stringify(goodCode)})`);
  await js("window.__t.click('Verify code')");
  await waitFor('Set a new password');
  check('✅ the correct support code is accepted', true);

  await js("window.__t.set(0, 'SupportPw9')");
  await js("window.__t.set(1, 'SupportPw9')");
  await js("window.__t.click('Set password')");
  await waitFor('Password updated');
  check('support reset sets the owner password', true);

  await js("window.__t.click('Back to login')");
  await signIn('admin', 'SupportPw9');
  check('✅ sign-in with the support-recovered password succeeds', true);

  // The request number must have advanced, so the old code is dead.
  await goToLoginScreen();
  await js('window.__t.supportChord()');
  await waitFor('Support Recovery');
  const newBox = await js('window.__t.text()');
  const newEpoch = Number((newBox.match(/Request #:\s*(\d+)/) || [])[1]);
  check('Request # advanced after the successful recovery', newEpoch === epoch + 1, `${epoch} -> ${newEpoch}`);
  await js(`window.__t.set(0, ${JSON.stringify(goodCode)})`);
  await js("window.__t.click('Verify code')");
  await new Promise((r) => setTimeout(r, 900));
  check('the used code no longer opens recovery', (await js('window.__t.text()')).includes('Invalid'));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_recovery_ui crashed:', e);
  app.exit(1);
});