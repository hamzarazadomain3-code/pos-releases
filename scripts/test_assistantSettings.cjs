#!/usr/bin/env node
/**
 * Settings → Assistant: the migration, the owner gate and the kill switch.
 *
 * Drives the REAL `dist` code:
 *   migrations/083_assistant_settings.js  (run against a throwaway DB)
 *   dist/main/services/assistant/settings.js
 *   dist/main/services/assistant/activity.js
 *   dist/shared/assistant/settings.js     (the pure model)
 *   dist/shared/assistant/history.js      (the local history store)
 *   dist/main/ipc.js                      (the real handlers, through the real
 *                                          preload in a hidden window)
 *
 * No network: a global fetch guard fails the test if anything opens a socket.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantSettings.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-settings-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-settings.db');

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
  const { registerIpcHandlers } = require('../dist/main/ipc.js');
  const auth = require('../dist/main/services/auth.js');
  const { getDb } = require('../dist/main/db.js');
  const assistantSettings = require('../dist/main/services/assistant/settings.js');
  const assistantActivity = require('../dist/main/services/assistant/activity.js');
  const sharedSettings = require('../dist/shared/assistant/settings.js');
  const history = require('../dist/shared/assistant/history.js');
  const migration = require('../migrations/083_assistant_settings.js');

  await initDatabase();
  registerIpcHandlers();

  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => {
    networkCalls++;
    throw new Error('NETWORK CALL IN TEST');
  };

  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // ── 1. the migration ─────────────────────────────────────────────────────
  section('The migration (additive + idempotent)');
  const db = getDb();
  const readKey = (key) => {
    const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  };
  const expected = {
    assistant_enabled: '0',
    assistant_roles: 'owner,manager',
    assistant_daily_budget_usd: '1',
    assistant_data_level: 'aggregates',
    assistant_language: 'auto',
    assistant_actions_enabled: '0',
    assistant_proactive_enabled: '0',
  };
  for (const [key, value] of Object.entries(expected)) {
    check(`the migration seeds ${key}`, readKey(key) === value, String(readKey(key)));
  }
  check('the migration seeds a model id', !!readKey('assistant_model'), String(readKey('assistant_model')));
  check('the migration never seeds the API key', readKey('assistant_api_key') === null, String(readKey('assistant_api_key')));

  // Running it again must change NOTHING (idempotent).
  db.prepare("UPDATE admin_settings SET value = '9' WHERE key = 'assistant_daily_budget_usd'").run();
  db.prepare("UPDATE admin_settings SET value = 'owner' WHERE key = 'assistant_roles'").run();
  migration.up(db);
  check('re-running the migration keeps an edited value', readKey('assistant_daily_budget_usd') === '9', String(readKey('assistant_daily_budget_usd')));
  check('re-running the migration keeps the edited roles', readKey('assistant_roles') === 'owner', String(readKey('assistant_roles')));
  db.prepare("UPDATE admin_settings SET value = '1' WHERE key = 'assistant_daily_budget_usd'").run();
  db.prepare("UPDATE admin_settings SET value = 'owner,manager' WHERE key = 'assistant_roles'").run();

  // ── 2. the kill switch ───────────────────────────────────────────────────
  section('The kill switch');
  const view = assistantSettings.getAssistantSettingsView();
  check('the assistant is off after the migration', view.enabled === false);
  check('the actions are off after the migration', view.actionsEnabled === false);
  check('the proactive insights are off after the migration', view.proactiveEnabled === false);
  check('no key is set after the migration', view.keySet === false);
  check('the data level starts at aggregates', view.dataLevel === 'aggregates');
  check('the roles start at owner+manager', JSON.stringify(view.roles) === JSON.stringify(['owner', 'manager']));

  const ready = assistantSettings.assistantReady();
  check('the assistant is not ready while it is off', ready.ok === false && ready.reason === 'disabled', JSON.stringify(ready));

  // While it is off, the test-connection must NOT reach the network.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(PROJECT_ROOT, 'dist', 'preload', 'preload.js') },
  });
  await win.loadURL('data:text/html,<html><body>assistant settings test</body></html>');
  const call = (code) => win.webContents.executeJavaScript(code, true);

  const offResult = await call('window.api.assistant.testConnection()');
  check('the disabled assistant answers cleanly', offResult.ok === false && !!offResult.message, JSON.stringify(offResult));
  check('the disabled assistant made no network call', networkCalls === 0, String(networkCalls));

  // ── 3. the owner gate ────────────────────────────────────────────────────
  section('The owner gate');
  const cashier = auth.createUser({ username: 'settings-cashier', password: 'CashierPass1', pin: '1234', role: 'cashier' });
  auth.setSessionUser(cashier.id);
  let cashierSave = null;
  try {
    assistantSettings.saveAssistantSettings({ enabled: true });
    cashierSave = 'no error';
  } catch (e) {
    cashierSave = e instanceof Error ? e.message : String(e);
  }
  check('a cashier cannot change the settings', /owner/i.test(cashierSave || ''), cashierSave);
  const cashierIpc = await call('window.api.assistant.saveSettings({ enabled: true })').then(
    () => 'no error',
    (e) => String(e && e.message ? e.message : e)
  );
  check('the IPC refuses a non-owner', /owner/i.test(cashierIpc), cashierIpc);
  const cashierTest = await call('window.api.assistant.testConnection()').then(
    () => 'no error',
    (e) => String(e && e.message ? e.message : e)
  );
  check('a cashier cannot test the connection', /owner/i.test(cashierTest), cashierTest);
  auth.setSessionUser(owner.user.id);

  // ── 4. the owner can turn it on ──────────────────────────────────────────
  section('The owner turns it on');
  const saved = assistantSettings.saveAssistantSettings({
    enabled: true,
    roles: ['owner', 'manager', 'cashier'],
    dataLevel: 'names',
    language: 'roman',
    dailyBudgetUsd: 2.5,
    actionsEnabled: false,
    proactiveEnabled: true,
  });
  check('the settings were saved', saved.enabled === true);
  check('the roles were saved', saved.roles.length === 3);
  check('the data level was saved', saved.dataLevel === 'names');
  check('the language was saved', saved.language === 'roman');
  check('the budget was saved', saved.dailyBudgetUsd === 2.5, String(saved.dailyBudgetUsd));
  check('the proactive switch was saved', saved.proactiveEnabled === true);
  check('the actions are still off', saved.actionsEnabled === false);

  // The roles a CASHIER may use: the assistant itself is off for a cashier by
  // default (the default roles exclude the cashier).
  const cashierAllowed = sharedSettings.assistantRoleAllowed(saved, 'cashier');
  check('the saved roles include the cashier', cashierAllowed === true);
  check('a write action needs the actions switch', sharedSettings.assistantActionsAllowed(saved, 'cashier') === false);
  check('a write action needs a manager even with the switch on', sharedSettings.assistantActionsAllowed({ ...saved, actionsEnabled: true }, 'cashier') === false);
  check('a manager may write when the switch is on', sharedSettings.assistantActionsAllowed({ ...saved, actionsEnabled: true }, 'manager') === true);
  check('an owner may write when the switch is on', sharedSettings.assistantActionsAllowed({ ...saved, actionsEnabled: true }, 'owner') === true);
  check('no role may write while the switch is off', sharedSettings.assistantActionsAllowed(saved, 'owner') === false);

  // ── 5. the activity viewer ───────────────────────────────────────────────
  section('The assistant activity');
  assistantActivity.logAssistantActivity('question', 'Asked about today\'s sale');
  assistantActivity.logAssistantActivity('action_confirmed', 'tool=add_to_bill id=abc');
  const rows = assistantActivity.listAssistantActivity(50);
  check('the assistant activity is listed', rows.length === 2, String(rows.length));
  check('the activity carries the actor', rows.every((r) => r.username === 'admin'), JSON.stringify(rows.map((r) => r.username)));
  check('the activity carries the details', rows.some((r) => (r.details || '').includes('add_to_bill')));
  check('the activity is prefixed', rows.every((r) => r.action.startsWith('assistant_')), JSON.stringify(rows.map((r) => r.action)));
  const ipcActivity = await call('window.api.assistant.activity()');
  check('the IPC returns the activity', Array.isArray(ipcActivity) && ipcActivity.length === 2, String(ipcActivity && ipcActivity.length));

  // ── 6. the local history (the "Clear assistant history" button) ──────────
  section('The local history');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ role: i % 2 ? 'assistant' : 'user', text: `message ${i}`, at: i });
  history.saveHistory(7, many);
  const loaded = history.loadHistory(7);
  check('the history is kept', loaded.length === history.ASSISTANT_HISTORY_LIMIT, String(loaded.length));
  check('the newest message is kept', loaded[loaded.length - 1].text === 'message 59', loaded[loaded.length - 1].text);
  check('the history is per user', history.loadHistory(8).length === 0);
  const trimmed = history.trimHistory([{ role: 'user', text: 'x'.repeat(30000), at: 1 }]);
  check('a huge message is dropped by the character cap', trimmed.length === 0, String(trimmed.length));
  history.clearHistory(7);
  check('the history can be cleared', history.loadHistory(7).length === 0);
  history.saveHistory(7, many);
  check('a broken store is treated as no history', (() => {
    store.set(history.historyKey(9), '{not json');
    return history.loadHistory(9).length === 0;
  })());

  win.destroy();
  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant settings checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
