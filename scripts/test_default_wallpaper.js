#!/usr/bin/env node
/**
 * The DEFAULT wallpaper - the supplied Rokar POS artwork.
 *
 * The app ships the supplied isometric artwork as the wallpaper every screen
 * shows until the owner picks their own in Admin -> System Settings ->
 * Background Wallpaper. This suite boots the REAL renderer (built
 * dist/renderer) in a real BrowserWindow with the real preload and the real
 * IPC handlers and asserts the behaviour against the live DOM:
 *
 *   - the built renderer really ships the default wallpaper asset
 *   - with no shop wallpaper the body background IS the default asset
 *   - that asset really loads (1920x1080, not a broken URL)
 *   - a shop wallpaper OVERRIDES the default
 *   - clearing the shop wallpaper falls BACK to the default
 *
 * Usage (after `npm run build`):  npx electron scripts/test_default_wallpaper.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-wallpaper-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'wallpaper.db');
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

/** The live wallpaper state of the document body. */
const BG = `(() => ({
  bg: getComputedStyle(document.body).backgroundImage,
  inline: document.body.style.backgroundImage || '',
  size: document.body.style.backgroundSize || '',
  position: document.body.style.backgroundPosition || '',
}))()`;

async function js(code) {
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    throw new Error(
      `js failed for: ${String(code).slice(0, 160)}\n  ${e && e.message ? e.message : e}`
    );
  }
}

async function waitUntil(expr, desc, timeoutMs = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await js(expr);
      if (last) return true;
    } catch {
      /* the renderer may still be booting */
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${desc} (last: ${JSON.stringify(last)})`);
}

/** Wait until the body background mentions `needle`. */
async function waitForBackground(needle, desc, timeoutMs = 15000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    last = (await js(BG)).bg || '';
    if (last.includes(needle)) return last;
    await sleep(150);
  }
  throw new Error(`timed out waiting for the background to contain ${needle} (last: ${last})`);
}

/** A 1x1 red PNG - stands in for a shop's own wallpaper. */
const CUSTOM_WALLPAPER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function signIn() {
  await waitUntil(`!!document.querySelector('.lock-box input')`, 'the login box');
  await js(`(() => {
    const inputs = document.querySelectorAll('.lock-box input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'admin');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], 'admin123');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    const btn = Array.from(document.querySelectorAll('.lock-box button'))
      .find((b) => /login/i.test(b.innerText || ''));
    if (btn) btn.click();
    return true;
  })()`);
  // The first run asks for a new owner password.
  await sleep(2500);
  const heading = await js(
    `(document.querySelectorAll('.lock-box h2')[document.querySelectorAll('.lock-box h2').length - 1] || {}).innerText || ''`
  );
  if (String(heading).toLowerCase().includes('owner password')) {
    await js(`(() => {
      const boxes = document.querySelectorAll('.lock-box');
      const box = boxes[boxes.length - 1];
      const inputs = box.querySelectorAll('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[0], 'OwnerPass1'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], 'OwnerPass1'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(box.querySelectorAll('button')).find((b) => /save/i.test(b.innerText || ''));
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(2500);
  }
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

  console.log('=== Rokar POS — the default wallpaper (end-to-end) ===');

  // ── The built renderer ships the asset ───────────────────────────────────
  section('Built asset');
  const assetDir = path.join(PROJECT_ROOT, 'dist', 'renderer', 'assets');
  const shipped = fs
    .readdirSync(assetDir)
    .filter((f) => f.startsWith('wallpaper-default') && f.endsWith('.webp'));
  check('the built renderer ships wallpaper-default-*.webp', shipped.length === 1, shipped.join(', '));
  const assetPath = shipped.length ? path.join(assetDir, shipped[0]) : '';
  const assetBytes = shipped.length ? fs.statSync(assetPath).size : 0;
  check('the shipped asset is a real image (not empty)', assetBytes > 10 * 1024, `${assetBytes} bytes`);

  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 950,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));

  // ── The default wallpaper is on the login screen ──────────────────────────
  section('Login screen');
  await waitUntil(`!!document.querySelector('.lock-box input')`, 'the login box');
  const loginBg = await waitForBackground('wallpaper-default', 'the default wallpaper on the login screen');
  check('the login screen shows the default wallpaper', loginBg.includes('wallpaper-default'), loginBg.slice(0, 120));

  await signIn();

  // ── The default wallpaper is on the app screens ──────────────────────────
  section('App screens');
  const appBg = await waitForBackground('wallpaper-default', 'the default wallpaper after login');
  check('the app body background is the default wallpaper', appBg.includes('wallpaper-default'), appBg.slice(0, 120));

  const bgState = await js(BG);
  check('the background is sized to cover the window', bgState.size === 'cover', bgState.size);
  check('the background is centred', /^center( center)?$/.test(bgState.position), bgState.position);

  const probe = await js(`new Promise((resolve) => {
    const m = getComputedStyle(document.body).backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
    if (!m) return resolve({ ok: false, reason: 'no url()' });
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight, src: m[1] });
    img.onerror = () => resolve({ ok: false, reason: 'load failed', src: m[1] });
    img.src = m[1];
  })`);
  check('the default wallpaper really loads', probe && probe.ok, probe && `${probe.w}x${probe.h}`);
  check(
    'the default wallpaper is the 1920x1080 canvas',
    probe && probe.ok && probe.w === 1920 && probe.h === 1080,
    probe && `${probe.w}x${probe.h}`
  );

  // ── A shop wallpaper overrides the default ───────────────────────────────
  section('Shop wallpaper wins');
  const setResult = await js(
    `window.api.admin.settings.set('wallpaper_image', ${JSON.stringify(CUSTOM_WALLPAPER)})
       .then((r) => 'ok:' + JSON.stringify(r))
       .catch((e) => 'err:' + (e && e.message ? e.message : e))`
  );
  check('the shop wallpaper was stored', String(setResult).startsWith('ok:'), String(setResult));
  const stored = await js(
    `window.api.admin.settings.get('wallpaper_image')
       .then((v) => String(v).length)
       .catch((e) => 'err:' + (e && e.message ? e.message : e))`
  );
  check('the stored wallpaper is the shop one', Number(stored) > 50, `${stored} chars`);
  const customBg = await waitForBackground('data:image/png', 'the shop wallpaper');
  check('the shop wallpaper replaces the default', customBg.includes('data:image/png'), customBg.slice(0, 80));
  check('the default is not applied on top of it', !customBg.includes('wallpaper-default'), customBg.slice(0, 80));

  // ── Clearing it falls back to the default ────────────────────────────────
  section('Fallback');
  await js(`window.api.admin.settings.set('wallpaper_image', '')`);
  const backBg = await waitForBackground('wallpaper-default', 'the default wallpaper again');
  check('clearing the shop wallpaper falls back to the default', backBg.includes('wallpaper-default'), backBg.slice(0, 120));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('FATAL', e);
  app.exit(1);
});
