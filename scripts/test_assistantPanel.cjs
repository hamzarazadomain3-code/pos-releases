#!/usr/bin/env node
/**
 * The assistant panel's pure parts — the sanitizer, the chips, the history and
 * the language detection — plus the shortcut registration.
 *
 * The RENDERING itself has no automated check (it is a React panel), so this
 * suite covers everything that can be checked without a browser.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantPanel.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-panel-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-panel.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const sanitize = require('../dist/shared/assistant/sanitize.js');
  const chips = require('../dist/shared/assistant/chips.js');
  const history = require('../dist/shared/assistant/history.js');
  const language = require('../dist/shared/assistant/language.js');
  const shortcuts = require('../dist/shared/shortcuts.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();

  // ── 1. the sanitizer ─────────────────────────────────────────────────────
  section('The message sanitizer (XSS)');
  const script = sanitize.sanitizeMessage('<script>alert("xss")</script>Hello');
  check('a script tag is removed', !JSON.stringify(script).includes('script'), JSON.stringify(script));
  check('the text around it survives', script.some((b) => b.runs.some((r) => r.text.includes('Hello'))));

  const img = sanitize.sanitizeMessage('<img src=x onerror="alert(1)">');
  check('an img tag with an event handler is removed', !JSON.stringify(img).includes('onerror') && !JSON.stringify(img).includes('<img'));

  const js = sanitize.sanitizeMessage('Click javascript:alert(1) now');
  check('a javascript URL is neutralised', !js.some((b) => b.runs.some((r) => r.text.includes('javascript:alert'))), JSON.stringify(js));

  const iframe = sanitize.sanitizeMessage('<iframe src="evil"></iframe>');
  check('an iframe is removed', !JSON.stringify(iframe).includes('iframe'));

  const bold = sanitize.sanitizeMessage('Today **12,500** in *two* bills');
  check('bold becomes a bold run', bold[0].runs.some((r) => r.bold && r.text === '12,500'), JSON.stringify(bold[0].runs));
  check('italic becomes an italic run', bold[0].runs.some((r) => r.italic && r.text === 'two'));
  check('the plain text stays plain', bold[0].runs.some((r) => !r.bold && !r.italic && r.text.includes('Today')));

  const code = sanitize.sanitizeMessage('Use `Ctrl+J`');
  check('code becomes a code run', code[0].runs.some((r) => r.code && r.text === 'Ctrl+J'));

  const list = sanitize.sanitizeMessage('- first\n- second\n1. third');
  check('a bullet becomes a bullet block', list.some((b) => b.type === 'bullet'), JSON.stringify(list.map((b) => b.type)));
  check('a numbered item becomes a numbered block', list.some((b) => b.type === 'numbered'));

  const plain = sanitize.sanitizePlainText('<b>bold</b> & <script>x</script>');
  check('the copy text has no tags', !plain.includes('<') && !plain.includes('>'), plain);

  // ── 2. the chips ─────────────────────────────────────────────────────────
  section('The quick-action chips');
  const cashierChips = chips.chipsForContext('cashier', 'billing');
  const managerChips = chips.chipsForContext('manager', 'billing');
  const ownerChips = chips.chipsForContext('owner', 'dashboard');
  check('the cashier gets chips', cashierChips.length > 0);
  check('the cashier gets fewer chips than the manager', cashierChips.length < managerChips.length, `${cashierChips.length} vs ${managerChips.length}`);
  check('the cashier never gets a profit chip', !cashierChips.some((c) => c.id === 'below_cost'));
  check('the manager gets the profit chip', managerChips.some((c) => c.id === 'below_cost'));
  check('no route means no page guide', !chips.chipsForContext('owner', null).some((c) => c.id === 'page_guide'));
  check('a route means the page guide', chips.chipsForContext('owner', 'billing').some((c) => c.id === 'page_guide'));
  check('an unknown role gets no chips', chips.chipsForContext('nobody', 'billing').length === 0);
  check('no role means no chips', chips.chipsForContext(null, 'billing').length === 0);
  check('every chip has a label key and a prompt', chips.allChips().every((c) => c.labelKey && c.prompt.length > 5));
  const labelKeys = chips.allChips().map((c) => c.labelKey);
  check('every chip label exists in the English file', labelKeys.every((k) => en.assistant.chips[k.replace('assistant.chips.', '')] !== undefined), JSON.stringify(labelKeys));
  check('every chip label exists in the Urdu file', labelKeys.every((k) => ur.assistant.chips[k.replace('assistant.chips.', '')] !== undefined));
  check('the chip order is stable', chips.chipsForContext('owner', 'billing').map((c) => c.id).join(',') === chips.chipsForContext('owner', 'billing').map((c) => c.id).join(','));

  // ── 3. the history ───────────────────────────────────────────────────────
  section('The conversation history');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const many = [];
  for (let i = 0; i < 100; i++) many.push({ role: i % 2 ? 'assistant' : 'user', text: `m${i}`, at: i });
  history.saveHistory(3, many);
  const stored = history.loadHistory(3);
  check('the history is capped', stored.length === history.ASSISTANT_HISTORY_LIMIT, String(stored.length));
  check('the newest messages are kept', stored[stored.length - 1].text === 'm99');
  check('the history is per user', history.loadHistory(4).length === 0);
  const big = history.trimHistory([{ role: 'user', text: 'x'.repeat(50000), at: 1 }, { role: 'user', text: 'small', at: 2 }]);
  check('the character cap drops the huge message', big.length === 1 && big[0].text === 'small', JSON.stringify(big.map((m) => m.text.length)));
  check('a broken store is not a crash', (() => {
    store.set(history.historyKey(9), 'not json at all');
    return history.loadHistory(9).length === 0;
  })());
  history.clearHistory(3);
  check('the history can be cleared', history.loadHistory(3).length === 0);

  // ── 4. the language detection ────────────────────────────────────────────
  section('The language detection');
  check('English is English', language.detectLanguage('How much did we sell today?') === 'en');
  check('Urdu script is Urdu', language.detectLanguage('آج کی فروخت کتنی ہے؟') === 'ur');
  check('Roman Urdu is Roman Urdu', language.detectLanguage('aaj ki sale kitni hai') === 'roman');
  check('Roman Urdu with a question', language.detectLanguage('batao udhaar kitna hai') === 'roman');
  check('a mixed sentence is English', language.detectLanguage('show me the low stock products') === 'en');
  check('an empty text is English', language.detectLanguage('') === 'en');
  check('Urdu text is right-to-left', language.isRtlText('آج') === true);
  check('English text is not right-to-left', language.isRtlText('today') === false);

  // ── 5. the shortcut registration ─────────────────────────────────────────
  section('The shortcut registration');
  const action = shortcuts.getAction('assistant_open');
  check('the assistant has a registry row', !!action);
  check('the default combo is Ctrl+J', action.defaultKey === 'Ctrl+J', action.defaultKey);
  check('the action runs on every screen', action.screens.includes('global'));
  check('the action is admin-assignable', shortcuts.DEFAULT_SHORTCUTS.assistant_open === 'Ctrl+J');
  check('the action is not a built-in (it can be moved)', !action.global);
  const conflicts = shortcuts.SHORTCUT_ACTIONS.filter((a) => a.id !== 'assistant_open' && a.defaultKey === 'Ctrl+J');
  check('no other action uses Ctrl+J', conflicts.length === 0, JSON.stringify(conflicts.map((c) => c.id)));
  const alt = shortcuts.SHORTCUT_ACTIONS.filter((a) => (a.altKeys ?? []).includes('Ctrl+J'));
  check('no other action uses Ctrl+J as an alternative', alt.length === 0);
  check('the action is on the billing screen too', shortcuts.isActionAllowedOn('assistant_open', 'billing'));
  check('the action is on the inventory screen too', shortcuts.isActionAllowedOn('assistant_open', 'inventory'));

  // The F1 help shows it under "Everywhere".
  check('the F1 help lists the assistant', shortcuts.GLOBAL_SHORTCUT_ACTIONS.some((a) => a.id === 'assistant_open'));
  check('the F1 help still lists the built-ins', shortcuts.GLOBAL_SHORTCUT_ACTIONS.some((a) => a.id === 'command_palette') && shortcuts.GLOBAL_SHORTCUT_ACTIONS.some((a) => a.id === 'help'));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant panel checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
