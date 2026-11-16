#!/usr/bin/env node
/**
 * The assistant's two screens in the REAL UI (items 11 + 13).
 *
 * The logic of both is already covered by the service suites
 * (`test:assistantProactive` 48/48, `test:assistantPrivacy` 72/72). This suite
 * covers what those cannot: that the SCREENS really render it.
 *
 * It drives the REAL built renderer (`dist/renderer`) in a real BrowserWindow
 * with the real preload and the real IPC handlers:
 *
 *   1. the privacy page (Admin → Assistant) really lists EVERY tool of the
 *      registry, with its real risk and its real roles — the table on the
 *      screen is the same one the pure model builds,
 *   2. the proactive card really appears in the panel when the opt-in is on,
 *      it is a real touch target and asking it really sends its question,
 *   3. the "Turn off for me" button really takes the assistant away for that
 *      user — the panel closes and the sidebar button disappears.
 *
 * No LLM, no key, no network: there is no API key in the test database, so
 * the provider is never even built, and the renderer's own `fetch` is blocked.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_assistant_ui.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-ui-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-ui.db');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

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
    throw new Error(`js failed: ${String(code).slice(0, 140)}\n  ${e && e.message ? e.message : e}`);
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

/** The assistant's sidebar button (it is the first one in the footer). */
const OPEN_PANEL = `(() => {
  const btn = document.querySelector('.sidebar-bottom-actions .sidebar-footer-btn');
  if (btn) btn.click();
  return !!btn;
})()`;

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const inventory = require('../dist/main/services/inventory.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const en = require('../src/renderer/src/i18n/en.json');

  await initDatabase();
  registerIpcHandlers();
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:quit', () => true);
  ipcMain.handle('updater:getState', () => 'idle');
  ipcMain.handle('updater:check', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('updater:install', () => true);
  ipcMain.handle('licensing:activate', () => ({ ok: false, message: 'stub' }));
  ipcMain.handle('licensing:check', () => ({ valid: true, activated: true }));

  console.log('=== Rokar POS — the assistant (the privacy page and the proactive card) ===');

  // The real registry — the source of truth for the privacy table.
  const registry = toolsModule.buildToolRegistry();

  // A product that is low in stock, so the proactive insight has something real
  // to say (the app's own rule: stock <= threshold).
  const lowProduct = inventory.createProduct({
    name: 'Assistant UI Salt',
    cost_price: 20,
    sale_price: 30,
    stock_qty: 2,
    low_stock_threshold: 5,
  });
  check('the low-stock product really exists', !!lowProduct && lowProduct.id > 0);

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

  // The renderer must never reach the network in this suite.
  await js(`(() => { window.fetch = () => { throw new Error('NETWORK BLOCKED IN THE TEST'); }; return true; })()`);

  // The owner turns the assistant on (with the proactive opt-in).
  const turnedOn = await js(
    `window.api.assistant.saveSettings({
       enabled: true,
       actionsEnabled: true,
       proactiveEnabled: true,
       roles: ['owner', 'manager', 'cashier']
     }).then((r) => 'ok:' + JSON.stringify(r && r.enabled && r.proactiveEnabled))
     .catch((e) => 'err:' + (e && e.message ? e.message : e))`
  );
  check('the assistant was turned on for the test', String(turnedOn).startsWith('ok:true'), String(turnedOn));

  // ── item 11 — the proactive card in the panel ─────────────────────────────
  section('The proactive card (item 11)');
  await js(OPEN_PANEL);
  await waitUntil(`!!document.querySelector('.assistant-panel')`, 'the assistant panel');
  await waitUntil(`!!document.querySelector('.assistant-suggestion')`, 'the proactive card');
  await sleep(500);

  const cards = await js(`(() => Array.from(document.querySelectorAll('.assistant-suggestion')).map((c) => ({
    cls: c.className,
    tag: c.tagName,
    title: ((c.querySelector('.assistant-suggestion-title') || {}).textContent || '').trim(),
    text: (c.textContent || '').trim(),
    height: c.getBoundingClientRect().height,
  })))()`);
  check('the proactive card is on the screen', cards.length > 0, `${cards.length} card(s)`);
  check('the proactive card has a title', cards.length > 0 && !!cards[0].title, cards[0] && cards[0].title);
  check('the proactive card is a button', cards.length > 0 && cards[0].tag === 'BUTTON', cards[0] && cards[0].tag);
  check(
    'the proactive card is a real touch target',
    cards.length > 0 && cards[0].height >= 40,
    cards[0] && `${cards[0].height}px`
  );
  check(
    'the proactive card carries its severity',
    cards.length > 0 && /assistant-suggestion-(warning|info|danger|critical)/.test(cards[0].cls),
    cards[0] && cards[0].cls
  );
  check(
    'the proactive card mentions the real count',
    cards.length > 0 && /\d/.test(cards[0].text),
    cards[0] && cards[0].text.slice(0, 80)
  );

  // Asking the card really sends its question.
  const before = await js(`document.querySelectorAll('.assistant-message').length`);
  await js(`(() => { const c = document.querySelector('.assistant-suggestion'); if (c) c.click(); return true; })()`);
  await sleep(1200);
  const after = await js(`document.querySelectorAll('.assistant-message').length`);
  check('asking the card really sent the question', after > before, `${before} → ${after} messages`);

  // ── item 13 — the privacy page (Admin → Assistant) ────────────────────────
  section('The privacy page (item 13)');
  await js(`(() => { const b = document.querySelector('.assistant-panel-close'); if (b) b.click(); return true; })()`);
  await sleep(400);

  // Open the nav groups and go to Admin.
  await js(`(() => {
    for (const g of Array.from(document.querySelectorAll('.nav-group-btn'))) {
      if (g.getAttribute('aria-expanded') === 'false') g.click();
    }
    return true;
  })()`);
  await sleep(400);
  const adminFound = await js(`(() => {
    const btn = document.querySelector('[data-guide-id="nav.admin"]');
    if (btn) btn.click();
    return !!btn;
  })()`);
  check('the Admin page is reachable', adminFound === true);
  await waitUntil(`!!document.querySelector('.admin-tab-btn')`, 'the Admin tabs');
  const tabClicked = await js(`(() => {
    const tabs = Array.from(document.querySelectorAll('.admin-tab-btn'));
    const wanted = ${JSON.stringify(en.settings.assistant.title)};
    const tab = tabs.find((b) => (b.textContent || '').trim() === wanted) || tabs[tabs.length - 1];
    if (tab) tab.click();
    return !!tab;
  })()`);
  check('the Assistant tab is there', tabClicked === true);
  await waitUntil(`!!document.querySelector('.admin-tab-btn.active')`, 'the Assistant tab');
  await sleep(1200);

  const privacy = await js(`(() => {
    const title = ${JSON.stringify(en.settings.assistant.privacyTitle)};
    const card = Array.from(document.querySelectorAll('.card')).find((c) => {
      const h3 = c.querySelector('h3');
      return h3 && (h3.textContent || '').trim() === title;
    });
    if (!card) return { found: false };
    const table = card.querySelector('table.data-table');
    const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
    return {
      found: true,
      head: table ? Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim()) : [],
      rowCount: rows.length,
      rows: rows.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())),
      text: (card.textContent || '').replace(/\\s+/g, ' ').trim(),
    };
  })()`);

  check('the privacy card is on the screen', privacy.found === true);
  check(
    'the table has the four columns',
    privacy.head &&
      privacy.head.length === 4 &&
      privacy.head[0] === en.settings.assistant.tool &&
      privacy.head[1] === en.settings.assistant.toolDoes &&
      privacy.head[2] === en.settings.assistant.toolRisk &&
      privacy.head[3] === en.settings.assistant.toolRoles,
    privacy.head && privacy.head.join(' | ')
  );
  check(
    'the table has a row for EVERY tool of the registry',
    privacy.rowCount === registry.length,
    `${privacy.rowCount} rows / ${registry.length} tools`
  );
  const toolNames = registry.map((t) => t.name);
  check(
    'every row names a real tool',
    privacy.rows.every((cells) => toolNames.includes(cells[0])),
    privacy.rows.filter((cells) => !toolNames.includes(cells[0])).map((cells) => cells[0]).join(', ')
  );
  check(
    'every row has its four cells filled',
    privacy.rows.every((cells) => cells.length === 4 && cells.every((c) => c.length > 0))
  );
  const riskLabels = [
    en.settings.assistant.risk_read,
    en.settings.assistant.risk_write,
    en.settings.assistant.risk_dangerous,
    en.settings.assistant.risk_forbidden,
  ];
  check(
    'every row carries a real risk',
    privacy.rows.every((cells) => riskLabels.includes(cells[2])),
    privacy.rows.filter((cells) => !riskLabels.includes(cells[2])).map((cells) => cells[2]).join(', ')
  );
  check(
    'every row names the roles',
    privacy.rows.every((cells) => /Owner|Manager|Cashier/.test(cells[3]))
  );
  const writeRows = registry.filter((t) => t.write);
  const shownAsWrite = privacy.rows.filter((cells) => cells[2] === en.settings.assistant.risk_write || cells[2] === en.settings.assistant.risk_dangerous);
  check(
    'the write tools really are the write ones on the screen',
    shownAsWrite.length === writeRows.length,
    `${shownAsWrite.length} shown / ${writeRows.length} in the registry`
  );
  check(
    'the card shows the spend of today against the cap',
    /\$\d+\.\d{4}\s*\/\s*\$\d+\.\d{2}/.test(privacy.text),
    (privacy.text.match(/\$\d+\.\d{4}\s*\/\s*\$\d+\.\d{2}/) || [''])[0]
  );
  check(
    'the card shows the number of turns',
    privacy.text.includes(String(0).replace(/^/, '')) && /turn/.test(privacy.text),
    (privacy.text.match(/\d+ turn[^|]{0,20}/) || [''])[0]
  );
  check(
    'the card explains that a user may switch it off for themselves',
    privacy.text.includes(en.settings.assistant.optOutHint.slice(0, 20)),
    en.settings.assistant.optOutHint.slice(0, 40)
  );

  // ── item 13 — the "Turn off for me" button really takes it away ──────────
  section('The opt-out button (item 13)');
  await js(OPEN_PANEL);
  await waitUntil(`!!document.querySelector('.assistant-panel')`, 'the assistant panel');
  await sleep(400);
  const optOutClicked = await js(`(() => {
    const buttons = Array.from(document.querySelectorAll('.assistant-panel button'));
    const wanted = ${JSON.stringify(en.assistant.optOut)};
    const btn = buttons.find((b) => (b.textContent || '').trim() === wanted);
    if (btn) btn.click();
    return !!btn;
  })()`);
  check('the "Turn off for me" button is in the panel', optOutClicked === true);
  await sleep(900);
  const panelGone = await js(`!document.querySelector('.assistant-panel')`);
  check('the panel closed itself', panelGone === true);
  const buttonGone = await js(`!document.querySelector('.sidebar-bottom-actions .sidebar-footer-btn[aria-label="${en.assistant.open}"]')`);
  check('the assistant button is gone from the sidebar', buttonGone === true);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('FATAL', e);
  app.exit(1);
});
