#!/usr/bin/env node
/**
 * Capture REAL screenshots of Rokar POS for the marketing website.
 *
 * The website previously showed Billing/Stock/Khata screens that were drawn in
 * HTML from hand-written mock rows. A shopkeeper comparing products wants to see
 * the actual interface, so this boots the real renderer against a seeded demo
 * database and photographs it.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/capture_screens.js
 *   npx electron scripts/capture_screens.js --out E:/tmp-opencode/site/public/screens
 *
 * Output is WebP when a WebP encoder is reachable (Chromium's own, via a canvas)
 * and JPEG otherwise. Both are far smaller than PNG for UI screenshots, which are
 * mostly flat colour and text.
 *
 * The window is positioned off-screen rather than hidden: `capturePage()` needs a
 * window that has actually painted, and a `show: false` window is not guaranteed
 * to have one.
 *
 * ⚠ Every screenshot shows FICTIONAL demo data from scripts/seed_demo.js. The
 * website must label them as sample data.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const VIEWPORT = { width: 1600, height: 1000 };

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT_DIR = path.resolve(argValue('--out', path.join(PROJECT_ROOT, 'captures')));

/**
 * Screens to photograph.
 *
 * `nav` is matched case-insensitively against the sidebar button text, with
 * several aliases per screen on purpose: labels come from i18n, so a missing or
 * renamed translation silently falls through to the raw nav key and a single
 * hard-coded string would then click the wrong page (or nothing) and the capture
 * would quietly be of the previous screen.
 *
 * `ready` must prove the page actually RENDERED, not merely that the click
 * registered. Clicking a nav item flips `active` synchronously but the component
 * is lazy-loaded, so without this the screenshot is taken while the previous
 * page is still on screen. That failure is silent and produced three identical
 * "different" screenshots before this check existed.
 */
const SCREENS = [
  {
    file: 'dashboard',
    nav: ['dashboard'],
    ready: `(document.querySelector('.page-header h1')||{}).innerText === 'Dashboard'`,
    settle: 1800,
  },
  {
    file: 'billing',
    nav: ['billing'],
    ready: `!!document.querySelector('.sale-invoice-title')`,
    fillCart: true,
    settle: 1800,
  },
  {
    file: 'inventory',
    nav: ['inventory'],
    ready: `(document.querySelector('.page-header h1')||{}).innerText === 'Inventory'`,
    settle: 1800,
  },
  {
    file: 'udhaar',
    nav: ['udhaar'],
    ready: `(document.querySelector('.page-header h1')||{}).innerText === 'Udhaar / Khata'`,
    settle: 1800,
  },
  {
    file: 'purchases',
    nav: ['purchases'],
    // Purchases uses .page-head, not .page-header like the other pages.
    ready: `(document.querySelector('.page-head h1')||{}).innerText === 'Purchases & Suppliers'`,
    settle: 1800,
  },
  {
    file: 'reports',
    nav: ['reports'],
    ready: `(document.querySelector('.page-header h1')||{}).innerText === 'Reports & Analytics'`,
    settle: 2600,
  },
];

/** Things added to the Billing cart so the screenshot shows a real bill. */
const CART_ITEMS = ['Tapal', 'Shakoor Sugar', 'Coca-Cola'];

let win;

const js = (code) => win.webContents.executeJavaScript(code, true);

/**
 * What is actually on screen right now.
 *
 * Sign-in failures here are otherwise invisible: the login screen, the auto-lock
 * screen and the forced first-run password modal all render `.lock-box`, so a
 * wrong selector or a mistimed click just times out with no clue which one is
 * showing. This is attached to the timeout message.
 */
async function dumpState() {
  return js(`(() => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    const box = boxes[boxes.length - 1];
    const shell = document.querySelector('.app-shell');
    return JSON.stringify({
      lockBoxes: boxes.length,
      heading: box && box.querySelector('h2') ? box.querySelector('h2').innerText : null,
      text: box ? box.innerText.replace(/\\s+/g, ' ').slice(0, 300) : null,
      inputs: box ? Array.from(box.querySelectorAll('input')).map((i) => i.type + '=' + i.value) : [],
      buttons: box ? Array.from(box.querySelectorAll('button')).map((b) => b.innerText.trim()) : [],
      appShell: !!shell,
      bodyStart: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    });
  })()`).catch((e) => 'dumpState failed: ' + e.message);
}

async function waitFor(expr, desc, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await js(expr)) return true;
    } catch {
      /* page mid-navigation */
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${desc}\n   page state: ${await dumpState()}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers live in the page, so any reload wipes them. */
const HELPERS = `
window.__cap = {
  navLabels: () => Array.from(document.querySelectorAll('.sidebar-nav .nav-btn'))
    .map((b) => (b.querySelector('.nav-label') || b).innerText.trim()),
  clickNav: (aliases) => {
    const want = aliases.map((a) => a.toLowerCase());
    const btns = Array.from(document.querySelectorAll('.sidebar-nav .nav-btn'));
    const btn = btns.find((b) => want.includes((b.querySelector('.nav-label') || b).innerText.trim().toLowerCase()));
    if (!btn) throw new Error('no nav button for ' + aliases.join('/') + ' (have: ' +
      btns.map((b) => (b.querySelector('.nav-label') || b).innerText.trim()).join(', ') + ')');
    btn.click();
    return true;
  },
  // React controlled inputs ignore plain .value assignment.
  typeInto: (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error('no input ' + selector);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  addFirstResult: () => {
    const r = document.querySelector('.product-search-dropdown .product-search-result');
    if (!r) return false;
    r.click();
    return true;
  },
  // Index of the first result whose text contains the token, or -1.
  // Waiting merely for "some result" is not enough: right after typing, the
  // dropdown still holds the PREVIOUS query's results for a frame or two, so
  // clicking result 0 then adds whatever product happened to be on top before —
  // which is how three different searches all ended up adding the same item.
  matchIndex: (token) => {
    const t = token.toLowerCase();
    const rs = Array.from(document.querySelectorAll('.product-search-dropdown .product-search-result'));
    const i = rs.findIndex((r) => r.innerText.toLowerCase().includes(t));
    return i;
  },
  resultNames: () => Array.from(document.querySelectorAll('.product-search-dropdown .product-search-result'))
    .map((r) => r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)),
  addAt: (i) => {
    const rs = document.querySelectorAll('.product-search-dropdown .product-search-result');
    if (!rs[i]) return false;
    rs[i].click();
    return true;
  },
  cartRows: () => document.querySelectorAll('.cart-row').length,
  ready: () => !!document.querySelector('.app-shell') && !document.querySelector('.lock-box'),
};
true;
`;

async function ensureHelpers() {
  if (!(await js('!!window.__cap').catch(() => false))) await js(HELPERS);
}

/** Sign in and clear the forced first-run password modal. */
async function signIn() {
  await ensureHelpers();
  await waitFor("!!document.querySelector('.lock-box')", 'the login screen', 30000);

  const set = (i, v) =>
    js(`(() => {
      const boxes = Array.from(document.querySelectorAll('.lock-box'));
      const box = boxes[boxes.length - 1];
      const el = box.querySelectorAll('input')[${i}];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`);

  const clickText = (label) =>
    js(`(() => {
      const boxes = Array.from(document.querySelectorAll('.lock-box'));
      const box = boxes[boxes.length - 1];
      const btn = Array.from(box.querySelectorAll('button'))
        .find((b) => b.innerText.trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

  const forcedModalVisible = `(() => {
    const boxes = Array.from(document.querySelectorAll('.lock-box'));
    const box = boxes[boxes.length - 1];
    const h = box && box.querySelector('h2');
    return !!(h && h.innerText.toLowerCase().includes('owner password'));
  })()`;

  await set(0, 'admin');
  await set(1, 'admin123');
  await clickText('login');

  // A fresh database forces an owner password change, but that modal mounts
  // asynchronously after login resolves — checking for it immediately after the
  // click races it, and the run then waits forever for an app shell that is
  // sitting behind the modal. Wait for whichever outcome actually happens.
  await waitFor(
    `window.__cap.ready() || (${forcedModalVisible})`,
    'either the app shell or the first-run password modal',
    30000,
  );

  if (await js(forcedModalVisible)) {
    await set(0, 'OwnerPass1');
    await set(1, 'OwnerPass1');
    // The button reads "Save & Continue"; match on "save".
    await clickText('save');
    await waitFor('window.__cap.ready()', 'the password modal to close and the app to open', 30000);
  }

  await ensureHelpers();
  await waitFor('window.__cap.ready()', 'the app shell', 30000);
}

/** Put a few real lines in the cart so Billing is not photographed empty. */
async function fillCart(items) {
  const added = new Set();

  for (const query of items) {
    // Match on a distinctive fragment, not the whole query: the search box also
    // matches on barcode and phone number.
    const token = query.split(' ')[0];
    await js(`window.__cap.typeInto('.billing-search', ${JSON.stringify(query)})`);

    const started = Date.now();
    let idx = -1;
    while (Date.now() - started < 12000) {
      idx = await js(`window.__cap.matchIndex(${JSON.stringify(token)})`);
      if (idx >= 0) break;
      await sleep(200);
    }
    if (idx < 0) {
      const names = await js('window.__cap.resultNames()');
      throw new Error(`no search result matching "${token}" (dropdown had: ${JSON.stringify(names)})`);
    }

    const names = await js('window.__cap.resultNames()');
    await js(`window.__cap.addAt(${idx})`);
    await sleep(800);
    const rows = await js('window.__cap.cartRows()');
    added.add(names[idx]);
    console.log(`   cart += ${names[idx]}  (search "${query}", ${rows} row(s))`);
  }

  const rows = await js('window.__cap.cartRows()');
  if (rows < 2) {
    throw new Error(`cart only has ${rows} row(s) after adding ${added.size} distinct products`);
  }
}

/**
 * A single long-lived window used to encode and to inspect captures.
 *
 * Both jobs are canvas work, and churning BrowserWindows on Windows intermittently
 * fails the next loadFile with ERR_FAILED (-2), so one window is created and kept.
 */
let tool;
async function toolWindow() {
  if (!tool || tool.isDestroyed()) {
    tool = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { offscreen: true } });
    await tool.loadURL('data:text/html,<body></body>');
  }
  return tool;
}

/**
 * Encode a NativeImage to WebP using Chromium's own encoder.
 *
 * Electron's nativeImage only writes PNG/JPEG, and a PNG of a full-size UI is
 * ~400 KB, which is far too heavy for six screenshots on a marketing page.
 * Round-tripping through a canvas gets us Chromium's WebP encoder without adding
 * a native image dependency to the app just for this script.
 */
async function encode(image, quality = 0.86) {
  const png = image.toPNG().toString('base64');
  const w = await toolWindow();
  const dataUrl = await w.webContents.executeJavaScript(
    `(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${png}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', ${quality});
    })()`,
    true,
  );
  const str = String(dataUrl);
  if (!str.startsWith('data:image/webp')) throw new Error('WebP encoder unavailable');
  return Buffer.from(str.split(',')[1], 'base64');
}

/**
 * Is this actually a rendered page, or an unpainted black rectangle?
 *
 * `capturePage()` on a window that has not composited yet returns a correctly
 * sized but nearly-uniform dark image, which would sail through a size check and
 * ship black rectangles to the website.
 *
 * The test is deliberately about *uniformity*, not brightness. An earlier version
 * required a bright average and rejected every good capture, because Rokar's
 * sidebar is dark and accounts for roughly a quarter of the width — a perfectly
 * healthy Dashboard measures around 27% dark pixels. What an unpainted buffer
 * actually looks like is ~85-100% dark with almost no variation, because it is a
 * single flat colour where the compositor never drew.
 */
function looksRendered(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let dark = 0;

  // Coarse luminance grid, used as a fingerprint so two screens cannot quietly
  // end up as the same picture.
  const GX = 16;
  const GY = 12;
  const cell = new Float64Array(GX * GY);
  const cellN = new Float64Array(GX * GY);

  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(GY - 1, Math.floor((y / height) * GY));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // BGRA -> luminance
      const lum = 0.2126 * bgra[i + 2] + 0.7152 * bgra[i + 1] + 0.0722 * bgra[i];
      const gx = Math.min(GX - 1, Math.floor((x / width) * GX));
      const c = gy * GX + gx;
      cell[c] += lum;
      cellN[c] += 1;
      if ((x + y) % 13 === 0) {
        sum += lum;
        sumSq += lum * lum;
        n += 1;
        if (lum < 100) dark += 1;
      }
    }
  }

  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const darkPct = (dark / n) * 100;

  let sig = '';
  for (let c = 0; c < cell.length; c += 1) {
    const v = cellN[c] ? cell[c] / cellN[c] : 0;
    sig += Math.min(9, Math.floor(v / 26)).toString(36);
  }

  return { ok: mean > 90 && darkPct < 80 && sd > 15, mean, sd, darkPct, sig };
}

/** Capture one screen, refusing to return anything that has not actually painted. */
async function captureVerified(label, attempts = 5) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // NB: deliberately a timer and NOT requestAnimationFrame. The window sits
    // off-screen, so it counts as occluded and Chromium throttles rAF to zero —
    // awaiting one here hangs forever.
    await sleep(attempt === 1 ? 1300 : 900);

    let image;
    try {
      image = await win.webContents.capturePage();
    } catch (e) {
      // The first capturePage() after a window is shown fails with
      // UnknownVizError: Chromium has not built the compositor frame yet. It is
      // transient — every subsequent call succeeds — so retry rather than abort.
      last = `${e && e.name}: ${e && e.message}`;
      console.log(`   (${label}: capture ${attempt} not ready — ${last})`);
      win.webContents.invalidate();
      await sleep(1200);
      continue;
    }

    const size = image.getSize();
    if (size.width === 0 || size.height === 0) {
      last = `empty image ${size.width}x${size.height}`;
      console.log(`   (${label}: capture ${attempt} was empty)`);
      await sleep(1000);
      continue;
    }

    const check = looksRendered(image);
    if (check.ok) return { image, size };

    last = `unpainted (mean ${check.mean.toFixed(0)}, sd ${check.sd.toFixed(0)}, dark ${check.darkPct.toFixed(0)}%)`;
    console.log(`   (${label}: attempt ${attempt} ${last})`);
    // Nudge the compositor so the next attempt has a reason to repaint.
    win.webContents.invalidate();
    win.setBackgroundColor('#ffffff');
    await sleep(1200);
  }
  throw new Error(`${label}: gave up after ${attempts} attempts — last problem was ${last}`);
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-capture-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'capture.db');

  console.log('=== Rokar POS — website screenshot capture ===');
  console.log(`   out: ${OUT_DIR}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── database ────────────────────────────────────────────────────────────────
  console.log('\n── seeding demo data ──');
  const { seedDemo } = require('./seed_demo.js');
  const seeded = await seedDemo();

  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  await initDatabase();
  registerIpcHandlers();

  // Channels the real app registers in main/updater/licensing. Stubbed so the
  // renderer mounts without the full bootstrap or a network round-trip.
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  // ── window ──────────────────────────────────────────────────────────────────
  win = new BrowserWindow({
    // Off-screen rather than hidden: capturePage() needs a painted window.
    x: -3200,
    y: 0,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    useContentSize: true,
    // NB: do NOT set enableLargerThanScreen here. A window wider than the
    // display at a negative x makes Chromium drop the viz frame, and
    // capturePage() then fails outright with "UnknownVizError". Windows clamps
    // this to the display instead, which still yields ~1950x1020 real pixels at
    // the machine's device pixel ratio — ample for the website.
    show: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js'),
      // Essential here. The window is parked off-screen, so Chromium treats it as
      // occluded and throttles background work — which includes fetching the
      // lazy-loaded page chunks. With throttling on, navigation silently never
      // completes and every screenshot comes out as the previous page.
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await js(HELPERS);

  // Record what we actually got rather than assuming, because a clamped window
  // changes the layout and the number belongs in the manifest.
  const actual = win.getContentSize();
  const viewport = { width: actual[0], height: actual[1] };
  const scale = win.webContents.getZoomFactor() || 1;
  console.log(`\n── window ──\n   requested ${VIEWPORT.width}x${VIEWPORT.height}, got ${viewport.width}x${viewport.height}${actual[0] !== VIEWPORT.width ? '  (clamped by the display)' : ''}`);

  console.log('\n── signing in ──');
  await signIn();
  console.log('   inside the app');

  // ── capture ─────────────────────────────────────────────────────────────────
  console.log('\n── capturing ──');
  const report = [];
  const signatures = new Map();

  for (const screen of SCREENS) {
    try {
      await ensureHelpers();
      await js(`window.__cap.clickNav(${JSON.stringify(screen.nav)})`);
      // Prove the page rendered before spending any time on the capture.
      await waitFor(screen.ready, `${screen.file} to finish rendering`, 30000);
      await sleep(screen.settle);
      if (screen.fillCart) await fillCart(CART_ITEMS);

      let shot = null;
      for (let attempt = 1; attempt <= 3 && !shot; attempt += 1) {
        const captured = await captureVerified(screen.file);
        const sig = looksRendered(captured.image).sig;
        const clash = signatures.get(sig);
        if (clash) {
          console.log(`   (${screen.file}: identical to ${clash} — page had not repainted, retrying)`);
          await sleep(2000);
          continue;
        }
        shot = captured;
        signatures.set(sig, screen.file);
      }
      if (!shot) throw new Error(`${screen.file}: kept producing an image identical to another screen`);

      const { image, size } = shot;
      let buf;
      let ext;
      try {
        buf = await encode(image);
        ext = 'webp';
      } catch (e) {
        console.log(`   (webp encoder unavailable: ${e && e.message})`);
        buf = image.toJPEG(88);
        ext = 'jpg';
      }
      const file = path.join(OUT_DIR, `${screen.file}.${ext}`);
      fs.writeFileSync(file, buf);
      const kb = Math.round(buf.length / 1024);
      console.log(`   ${screen.file.padEnd(11)} ${size.width}x${size.height}  ${String(kb).padStart(4)} KB  ${ext}`);
      report.push({ screen: screen.file, file: path.basename(file), kb, width: size.width, height: size.height });
    } catch (e) {
      // Name the screen: a bare "UnknownVizError" from deep inside Electron is
      // otherwise impossible to place.
      console.log(`   !! ${screen.file}: ${e && e.message}  (${e && e.name})`);
      throw e;
    }
  }

  // ── manifest, so the site can be wired up without guessing filenames ───────
  // app.getVersion() reports Electron's version here (43.x), not Rokar's, because
  // this script is run by `electron` rather than as the packaged app. Read the
  // real version so the manifest can be traced back to a release.
  const rokVersion = require(path.join(PROJECT_ROOT, 'package.json')).version;

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        generatedFrom: `Rokar POS v${rokVersion}`,
        shop: 'Al-Madina General Store',
        sampleData: true,
        viewport,
        shots: report,
      },
      null,
      2,
    ) + '\n',
  );

  const totalKb = report.reduce((a, r) => a + r.kb, 0);
  console.log(`\nDONE: ${report.length} screens, ${Math.round(totalKb / 1024 * 10) / 10} MB total`);
  if (seeded.sales === 0) throw new Error('no sales were seeded — screenshots would show empty pages');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* db handle still open */ }
  app.exit(0);
}

app.whenReady()
  .then(run)
  .catch((e) => {
    console.error('\ncapture_screens FAILED:', e && e.stack ? e.stack : e);
    app.exit(1);
  });