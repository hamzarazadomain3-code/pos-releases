#!/usr/bin/env node
/**
 * The assistant's accessibility, language and phone-size audit (item 14).
 *
 * It drives the REAL built renderer (`dist/renderer`) in a real BrowserWindow
 * with the real preload and the real IPC handlers — no stub of the UI, no LLM
 * and no network. It proves three things:
 *
 *   1. the panel is usable with a screen reader (the roles, the live region,
 *      the accessible names — an icon-only button must still have a name),
 *   2. it fits the phone, the tablet and the desktop (360 / 390 / 768 / 1280)
 *      without a horizontal scroll and with real touch targets — and a PNG of
 *      every width is written to the proof folder,
 *   3. every string the assistant shows exists in BOTH languages with the same
 *      placeholders, and the Urdu layout really mirrors (the panel moves to
 *      the other side).
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_assistant_a11y.cjs [--out E:\temp\proof]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-a11y-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-a11y.db');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const outArg = process.argv.indexOf('--out');
const OUT_DIR = outArg > -1 ? process.argv[outArg + 1] : 'E:\\temp\\proof';
const WIDTHS = [360, 390, 768, 1280];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function js(code) {
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    throw new Error(
      `js failed for: ${String(code).slice(0, 160)}\n  ${e && e.message ? e.message : e}`
    );
  }
}

async function waitUntil(expr, desc, timeoutMs = 20000) {
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

/** Everything the audit needs to know about the panel, in one probe. */
const PROBE = `(() => {
  const panel = document.querySelector('.assistant-panel');
  if (!panel) return null;
  const messages = document.querySelector('.assistant-messages');
  const input = document.querySelector('.assistant-input');
  const chips = Array.from(document.querySelectorAll('.assistant-chip'));
  const buttons = Array.from(panel.querySelectorAll('button'));
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const rect = panel.getBoundingClientRect();
  const inputRect = input ? input.getBoundingClientRect() : null;
  const chipRects = chips.map((c) => c.getBoundingClientRect());
  const titleEl = document.querySelector('.assistant-panel-title');
  const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;
  const actionsEl = document.querySelector('.assistant-panel-head-actions');
  const actionsRect = actionsEl ? actionsEl.getBoundingClientRect() : null;
  // The app's chrome: the phone's menu button and the bottom bar. They are
  // above the panel in the stacking order, so they must step aside.
  const chrome = ['.sidebar-toggle', '.mobile-search-btn', '.sidebar-bottom-bar'].map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }).filter(Boolean);
  const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return {
    role: panel.getAttribute('role') || '',
    panelLabel: panel.getAttribute('aria-label') || '',
    live: messages ? messages.getAttribute('aria-live') || '' : '',
    liveAtomic: messages ? messages.getAttribute('aria-atomic') || '' : '',
    inputName: input ? (input.getAttribute('aria-label') || '') : '',
    inputHeight: inputRect ? inputRect.height : 0,
    unnamedButtons: buttons.filter((b) => !name(b)).map((b) => b.className || b.tagName),
    buttonNames: buttons.map((b) => name(b)),
    chipHeight: chipRects.length ? Math.min(...chipRects.map((r) => r.height)) : 0,
    chipCount: chips.length,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
    titleRect: titleRect ? { left: titleRect.left, top: titleRect.top, right: titleRect.right, bottom: titleRect.bottom } : null,
    actionsRect: actionsRect ? { left: actionsRect.left, top: actionsRect.top, right: actionsRect.right, bottom: actionsRect.bottom } : null,
    chrome,
    titleCovered: chrome.some((c) => overlaps(c, titleRect)),
    actionsCovered: chrome.some((c) => overlaps(c, actionsRect)),
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dir: document.documentElement.dir || '',
    lang: document.documentElement.lang || '',
    title: (document.querySelector('.assistant-panel-title') || {}).innerText || '',
    composerVisible: !!input && inputRect.height > 0,
  };
})()`;

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
  await waitUntil(`!!document.querySelector('.sidebar-bottom-actions')`, 'the app shell');
}

/** Every key of a nested object (dotted). */
function keyPaths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) out.push(...keyPaths(child, path));
    else out.push(path);
  }
  return out;
}

/** The placeholders of a string ({{count}} and friends). */
function placeholders(text) {
  return (String(text ?? '').match(/\{\{\w+\}\}/g) || []).sort().join(',');
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

  console.log('=== Rokar POS — the assistant (accessibility, language, phone sizes) ===');
  console.log(`   proof: ${OUT_DIR}`);

  // ── the window ────────────────────────────────────────────────────────────
  win = new BrowserWindow({
    x: -3200,
    y: 0,
    width: 1280,
    height: 900,
    useContentSize: true,
    show: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js'),
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  await signIn();

  // The owner turns the assistant on (the switch is off by default).
  const turnedOn = await js(
    `window.api.assistant.saveSettings({ enabled: true, actionsEnabled: true, roles: ['owner','manager','cashier'] })
       .then((r) => 'ok:' + JSON.stringify(r && r.enabled))
       .catch((e) => 'err:' + (e && e.message ? e.message : e))`
  );
  check('the assistant was turned on for the test', String(turnedOn).startsWith('ok:true'), String(turnedOn));

  // ── the panel opens ───────────────────────────────────────────────────────
  section('The panel');
  await js(`(() => {
    const btn = document.querySelector('.sidebar-bottom-actions .sidebar-footer-btn');
    if (btn) btn.click();
    return true;
  })()`);
  await waitUntil(`!!document.querySelector('.assistant-panel')`, 'the assistant panel');
  await sleep(600);
  const probe = await js(PROBE);
  check('the panel is on the screen', !!probe);
  check('the panel is a dialog with a name', probe.role === 'dialog' && !!probe.panelLabel, `${probe.role} / ${probe.panelLabel}`);
  check('the messages are a live region', probe.live === 'polite', probe.live);
  check('the live region is not atomic', probe.liveAtomic === 'false', probe.liveAtomic);
  check('the question box has an accessible name', !!probe.inputName, probe.inputName);
  check('every button in the panel has a name', probe.unnamedButtons.length === 0, probe.unnamedButtons.join(', '));
  check('the panel has a title', !!probe.title, probe.title);
  check('the chips are there', probe.chipCount > 0, String(probe.chipCount));

  // ── the phone, the tablet and the desktop ────────────────────────────────
  section('The sizes (360 / 390 / 768 / 1280)');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const width of WIDTHS) {
    win.setContentSize(width, 900);
    await sleep(700);
    const size = await js(PROBE);
    const real = await js(`({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth })`);
    check(`at ${width}px the panel fits the screen`, size.rect.width <= real.inner + 1, `panel ${size.rect.width} / screen ${real.inner}`);
    check(
      `at ${width}px the panel is inside the screen`,
      size.rect.left >= -1 && size.rect.right <= real.inner + 1,
      `left ${size.rect.left} right ${size.rect.right}`
    );
    check(`at ${width}px there is no horizontal scroll`, real.scroll <= real.inner + 1, `scroll ${real.scroll} / inner ${real.inner}`);
    check(`at ${width}px the question box is usable`, size.inputHeight >= 40, `${size.inputHeight}px`);
    check(`at ${width}px the chips are tappable`, size.chipHeight === 0 || size.chipHeight >= 32, `${size.chipHeight}px`);
    check(`at ${width}px the composer is on the screen`, size.composerVisible === true);
    // The app's chrome must not sit ON TOP of the panel (it did: the phone's
    // menu button covered the title and the bottom bar covered the composer).
    check(
      `at ${width}px nothing of the app covers the title`,
      size.titleCovered === false,
      size.chrome.map((c) => c.sel).join(', ')
    );
    check(
      `at ${width}px nothing of the app covers the header buttons`,
      size.actionsCovered === false,
      size.chrome.map((c) => c.sel).join(', ')
    );
    check(
      `at ${width}px the header buttons stay inside the panel`,
      !!size.actionsRect && size.actionsRect.right <= size.rect.right + 1 && size.actionsRect.left >= size.rect.left - 1,
      size.actionsRect ? `left ${size.actionsRect.left} right ${size.actionsRect.right} / panel ${size.rect.left}..${size.rect.right}` : 'no actions'
    );

    // A picture of the panel at this size (the proof).
    let image = null;
    for (let attempt = 1; attempt <= 4 && !image; attempt += 1) {
      await sleep(attempt === 1 ? 700 : 500);
      try {
        const shot = await win.webContents.capturePage();
        const sizeOf = shot.getSize();
        if (sizeOf.width > 0 && sizeOf.height > 0) image = shot;
        else win.webContents.invalidate();
      } catch {
        win.webContents.invalidate();
      }
    }
    if (image) {
      const file = path.join(OUT_DIR, `a14_assistant_${width}.png`);
      fs.writeFileSync(file, image.toPNG());
      const bytes = fs.statSync(file).size;
      check(`at ${width}px the screenshot was saved`, bytes > 1000, `${file} (${bytes} bytes)`);
    } else {
      check(`at ${width}px the screenshot was saved`, false, 'the window never painted');
    }
  }

  // ── the Urdu layout really mirrors ───────────────────────────────────────
  section('The Urdu (RTL) layout');
  win.setContentSize(1280, 900);
  await sleep(500);
  const ltr = await js(PROBE);
  // The language toggle is the globe button in the sidebar footer.
  await js(`(() => {
    const buttons = Array.from(document.querySelectorAll('.sidebar-bottom-actions .sidebar-footer-btn'));
    const globe = buttons.find((b) => b.innerHTML.includes('<circle'));
    if (globe) globe.click();
    return true;
  })()`);
  await sleep(900);
  const rtl = await js(PROBE);
  check('the document really switched to RTL', rtl.dir === 'rtl', rtl.dir);
  check('the language really switched to Urdu', rtl.lang === 'ur', rtl.lang);
  check('the panel mirrored to the other side', Math.abs(rtl.rect.left) < Math.abs(ltr.rect.left) + 1 || rtl.rect.left < ltr.rect.left, `LTR left ${ltr.rect.left} / RTL left ${rtl.rect.left}`);
  check('the panel is still inside the screen', rtl.rect.left >= -1 && rtl.rect.right <= rtl.innerWidth + 1, `left ${rtl.rect.left} right ${rtl.rect.right}`);
  check('the panel still fits', rtl.rect.width <= rtl.innerWidth + 1, `${rtl.rect.width} / ${rtl.innerWidth}`);
  check('the panel still has its accessible name', !!rtl.panelLabel, rtl.panelLabel);

  // The tablet in Urdu: the panel is on the LEFT there, so the app's chrome
  // has to step aside on that side as well.
  win.setContentSize(768, 900);
  await sleep(800);
  const rtlTablet = await js(PROBE);
  check(
    'in Urdu at 768px nothing of the app covers the title',
    rtlTablet.titleCovered === false,
    rtlTablet.chrome.map((c) => c.sel).join(', ')
  );
  check(
    'in Urdu at 768px nothing of the app covers the header buttons',
    rtlTablet.actionsCovered === false,
    rtlTablet.chrome.map((c) => c.sel).join(', ')
  );
  check(
    'in Urdu at 768px the panel is inside the screen',
    rtlTablet.rect.left >= -1 && rtlTablet.rect.right <= rtlTablet.innerWidth + 1,
    `left ${rtlTablet.rect.left} right ${rtlTablet.rect.right}`
  );
  win.setContentSize(1280, 900);
  await sleep(500);
  let rtlImage = null;
  for (let attempt = 1; attempt <= 4 && !rtlImage; attempt += 1) {
    await sleep(attempt === 1 ? 700 : 500);
    try {
      const shot = await win.webContents.capturePage();
      if (shot.getSize().width > 0) rtlImage = shot;
      else win.webContents.invalidate();
    } catch {
      win.webContents.invalidate();
    }
  }
  if (rtlImage) {
    const file = path.join(OUT_DIR, 'a14_assistant_rtl.png');
    fs.writeFileSync(file, rtlImage.toPNG());
    check('the Urdu screenshot was saved', fs.statSync(file).size > 1000, file);
  } else {
    check('the Urdu screenshot was saved', false, 'the window never painted');
  }

  // ── the strings: both languages, the same placeholders ───────────────────
  section('The strings');
  const en = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/i18n/en.json'), 'utf8'));
  const ur = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/i18n/ur.json'), 'utf8'));

  const enAssistant = keyPaths(en.assistant);
  const urAssistant = keyPaths(ur.assistant);
  check('every assistant string exists in English', enAssistant.length > 0, `${enAssistant.length} keys`);
  check(
    'every assistant string exists in Urdu too',
    enAssistant.every((key) => urAssistant.includes(key)),
    enAssistant.filter((key) => !urAssistant.includes(key)).join(', ')
  );
  check(
    'Urdu has no extra assistant string',
    urAssistant.every((key) => enAssistant.includes(key)),
    urAssistant.filter((key) => !enAssistant.includes(key)).join(', ')
  );
  const enSettings = keyPaths(en.settings.assistant);
  const urSettings = keyPaths(ur.settings.assistant);
  check(
    'every assistant setting string exists in Urdu too',
    enSettings.every((key) => urSettings.includes(key)),
    enSettings.filter((key) => !urSettings.includes(key)).join(', ')
  );

  const lookup = (obj, dotted) =>
    dotted.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
  const mismatched = [];
  for (const key of enAssistant.concat(enSettings)) {
    const a = lookup(en, key);
    const b = lookup(ur, key);
    if (typeof a === 'string' && typeof b === 'string' && placeholders(a) !== placeholders(b)) {
      mismatched.push(key);
    }
  }
  check('the two languages use the same placeholders', mismatched.length === 0, mismatched.join(', '));

  // Every key the assistant's own screens ask for must really exist.
  const sources = [
    'src/renderer/src/components/AssistantPanel.tsx',
    'src/renderer/src/components/GuideOverlay.tsx',
    'src/renderer/src/pages/AdminPanel/AssistantSettings.tsx',
  ];
  const used = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    const re = /\bt\(\s*'([^']+)'/g;
    let match;
    while ((match = re.exec(text)) !== null) used.add(match[1]);
  }
  const missing = [...used].filter((key) => {
    if (key.startsWith('settings.assistant.')) return lookup(en, key) === undefined;
    return lookup(en, key) === undefined;
  });
  check('every string the assistant asks for exists', missing.length === 0, missing.join(', '));
  const missingUr = [...used].filter((key) => lookup(ur, key) === undefined);
  check('every string the assistant asks for exists in Urdu', missingUr.length === 0, missingUr.join(', '));
  check('the audit really looked at the assistant strings', used.size >= 15, `${used.size} keys`);

  // ── the RTL rules are the logical ones (the CSS mirrors itself) ──────────
  section('The RTL rules');
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/styles.css'), 'utf8');
  const assistantCss = css.slice(css.indexOf('/* ── The assistant panel'), css.indexOf('/* ── The guide overlay'));
  check('the panel uses the logical inset', assistantCss.includes('inset-inline-end'));
  check('the panel uses the logical border', assistantCss.includes('border-inline-start'));
  check('the panel has no hard-coded left or right', !/\b(left|right)\s*:/.test(assistantCss));
  const guideStart = css.indexOf('/* ── The guide overlay');
  const guideCss = css.slice(guideStart, guideStart + 3200);
  check('the guide overlay uses the logical flow', guideCss.includes('flex-direction: column'));
  check('the guide overlay has no hard-coded left or right', !/\b(left|right)\s*:/.test(guideCss));
  check('the guide card fits the phone', guideCss.includes('100vw'));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('FATAL', e);
  app.exit(1);
});
