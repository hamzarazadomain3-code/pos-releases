// web-smoke-main.cjs — Electron main used only by run-web-smoke.mjs.
//
// Loads the REAL web build (`/app`) from a live worker via a real HTTP origin,
// then proves the browser runtime works end to end:
//   - the unmodified preload installed `window.api` (the `electron` browser shim)
//   - the real React renderer mounted
//   - App.tsx's session restore ran and authenticated via /api/rpc
//   - the `?page=dashboard` deep-link opened the Dashboard (not the Billing default)
//   - a real desktop channel (inventory:list) returns real data
//   - EVERY lazy nav page chunk executes without a cross-chunk TDZ
//
// Exits 0 and prints "SMOKE_RESULT: PASS", or non-zero with the captured errors.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// The version the worker bundle injects from the desktop package.json, so this
// assertion tracks releases instead of pinning a stale literal.
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')
).version;

const BASE = process.env.ROKAR_WEB_URL; // e.g. http://127.0.0.1:8791
const SLUG = process.env.ROKAR_SHOP_SLUG || '';
const TOKEN = process.env.ROKAR_WEB_TOKEN || '';
const USER = JSON.parse(process.env.ROKAR_WEB_USER || 'null');
const SHOP = JSON.parse(process.env.ROKAR_WEB_SHOP || 'null');

const fatal = []; // load failures, renderer crashes, script exceptions
const bootErrors = []; // console errors before the page tour
const tourErrors = []; // console errors while navigating every lazy page
let phase = 'boot';

function note(label, value) {
  console.log(`note ${label}: ${value}`);
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await fn();
    } catch {
      ok = false;
    }
    if (ok) return true;
    if (Date.now() - start > timeoutMs) {
      fatal.push(`timeout waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function run() {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.on('console-message', (...args) => {
    const ev = args[0];
    const message = ev && typeof ev === 'object' && 'message' in ev ? ev.message : args[2];
    const level = ev && typeof ev === 'object' && 'level' in ev ? ev.level : args[1];
    if (level === 'error' || level === 3) {
      (phase === 'boot' ? bootErrors : tourErrors).push(String(message));
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fatal.push(`did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    fatal.push('render-process-gone: ' + JSON.stringify(d));
  });

  const js = (code) => win.webContents.executeJavaScript(code, true);

  // Seed the shared web session on the origin the same way the lite dashboard
  // does, then load the real app so the bridge finds it.
  await win.loadURL(BASE + '/');
  await js(
    `localStorage.setItem('rokar_web_session', ${JSON.stringify(
      JSON.stringify({ token: TOKEN, user: USER, shop: SHOP })
    )});
     localStorage.setItem('rokar_web_shop', ${JSON.stringify(SLUG)});
     'seeded';`
  );

  await win.loadURL(BASE + '/app/?shop=' + encodeURIComponent(SLUG) + '&page=dashboard');

  // 1. React mounted into #root.
  const mounted = await waitFor(
    () => js(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`),
    25000,
    'React mount'
  );
  note('reactMounted', mounted);

  // 2. The preload-installed bridge is present in the page.
  const apiOk = await js(
    `!!window.api && typeof window.api === 'object' && !!window.api.auth && typeof window.api.inventory.list === 'function'`
  );
  note('window.api present', apiOk);

  // 3. Session restore authenticated (login screen gone, shell rendered).
  const shell = await waitFor(
    () => js(`document.querySelectorAll('.lock-box').length === 0 && document.querySelectorAll('nav, .sidebar, aside').length > 0`),
    30000,
    'app shell (post-restore)'
  );
  note('appShell (login bypassed)', shell);

  // 3b. The `?page=dashboard` deep-link must make the Dashboard nav item active
  //     (the app's own default is Billing).
  const deepLink = await waitFor(
    () => js(`(document.querySelector('.nav-btn.active')?.dataset.label || '').toLowerCase().includes('dashboard')`),
    10000,
    'requested page (Dashboard) active'
  );
  note('deep-link page active', deepLink);

  // 4. The real desktop channel round-trips through /api/rpc.
  const who = await js(`window.api.auth.currentUser().then(u => JSON.stringify(u && {id:u.id, username:u.username, role:u.role})).catch(e => 'ERR:'+e.message)`);
  note('auth:currentUser', who);

  const inv = await js(
    `window.api.inventory.list().then(x => JSON.stringify({isArray:Array.isArray(x), n:Array.isArray(x)?x.length:-1})).catch(e => 'ERR:'+e.message)`
  );
  note('inventory:list', inv);

  const ver = await js(`window.api.app.getVersion()`);
  note('app:get-version', ver);

  // 5. Tour every nav page so each lazy chunk is imported and evaluated in the
  //    browser. A rollup cross-chunk TDZ (`Cannot access 'X' before initialization`)
  //    only surfaces when a page chunk actually runs, so this is the real guard.
  phase = 'tour';
  const labels = await js(
    `Array.from(document.querySelectorAll('.sidebar-nav .nav-btn')).map(b => b.dataset.label).filter(Boolean)`
  );
  note('nav pages', labels.length);
  let toured = 0;
  for (const label of labels) {
    const clicked = await js(
      `(() => { const b = Array.from(document.querySelectorAll('.sidebar-nav .nav-btn')).find(x => x.dataset.label === ${JSON.stringify(
        label
      )}); if (!b) return false; b.click(); return true; })()`
    );
    if (!clicked) continue;
    await new Promise((r) => setTimeout(r, 350));
    const alive = await js(`!!document.querySelector('#root') && document.querySelector('#root').children.length > 0`);
    if (!alive) {
      fatal.push(`page crashed after navigating to "${label}"`);
      break;
    }
    toured++;
  }
  note('pages toured', toured);

  // 6. Web keyboard. A browser cannot receive Ctrl+Shift+S (Edge claims it for
  //    "Web capture", Firefox for "Take screenshot") — the keydown never reaches
  //    the page, so the bridge serves save+print as the browser-safe Ctrl+Alt+S.
  //    Prove the shipped binding, the Billing footer hint and the handler all
  //    agree, and that each combo is actually consumed by the app (the Billing
  //    window handler calls preventDefault, so a plain page load cannot fake it).
  const savePrint = await js(
    `window.api.admin.shortcuts.getAll().then(rows => (rows.find(r => r.action === 'save_print') || {}).shortcut_key).catch(e => 'ERR:'+e.message)`
  );
  note('save_print binding', savePrint);

  await js(
    `(() => { const b = Array.from(document.querySelectorAll('.sidebar-nav .nav-btn')).find(x => (x.dataset.label || '').toLowerCase().includes('billing')); if (b) b.click(); return !!b; })()`
  );
  await new Promise((r) => setTimeout(r, 700));
  const billingHint = await js(`(document.querySelector('.shortcuts')?.innerText || '').replace(/\\s+/g, ' ')`);
  note('billing footer', billingHint);

  const pressConsumed = (code, key, mods) =>
    js(
      `(() => {
        const ev = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true });
        window.dispatchEvent(ev);
        return ev.defaultPrevented;
      })()`
    );
  const ctrlAltS = await pressConsumed('KeyS', 's', { ctrl: true, alt: true });
  const ctrlShiftS = await pressConsumed('KeyS', 'S', { ctrl: true, shift: true });
  // A non-Latin layout sends key='س' with code='KeyS' — the handler must still fire.
  const urduS = await pressConsumed('KeyS', '\u0633', { ctrl: true, shift: true });
  note('Ctrl+Alt+S consumed', ctrlAltS);
  note('Ctrl+Shift+S consumed', ctrlShiftS);
  note('non-Latin Ctrl+Shift+S consumed', urduS);

  // Verdict
  const tdz = tourErrors.filter((m) => /before initialization|Cannot access|dynamically imported module|is not defined/i.test(m));
  let ok = mounted && apiOk && shell && deepLink;
  ok = ok && /"username":"?admin/.test(who);
  ok = ok && /"isArray":true/.test(inv);
  ok = ok && ver === APP_VERSION;
  ok = ok && labels.length > 0 && toured === labels.length;
  ok = ok && savePrint === 'Ctrl+Alt+S';
  ok = ok && /Ctrl\+Alt\+S save\+print/i.test(billingHint);
  ok = ok && ctrlAltS === true && ctrlShiftS === true && urduS === true;
  ok = ok && fatal.length === 0 && bootErrors.length === 0 && tdz.length === 0;

  if (fatal.length || bootErrors.length || tdz.length) {
    console.log('--- captured problems ---');
    for (const e of fatal) console.log('FATAL   ' + e);
    for (const e of bootErrors) console.log('BOOT    ' + e);
    for (const e of tdz) console.log('TDZ     ' + e);
  }
  console.log(ok ? 'SMOKE_RESULT: PASS' : 'SMOKE_RESULT: FAIL');
  return ok;
}

app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await run();
  } catch (e) {
    fatal.push('exception: ' + (e && e.stack ? e.stack : String(e)));
    console.log('--- captured problems ---');
    console.log(fatal.join('\n'));
    console.log('SMOKE_RESULT: FAIL');
  }
  app.exit(ok ? 0 : 1);
});
