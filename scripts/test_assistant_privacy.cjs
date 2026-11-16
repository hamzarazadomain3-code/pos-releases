#!/usr/bin/env node
/**
 * The privacy, the cost and the opt-out (item 13).
 *
 * The owner must be able to see EXACTLY what the assistant may do — so the
 * privacy page is generated from the tool registry itself, and it can never
 * drift from the tools. The cost is shown next to the cap. And any user (a
 * cashier, anybody) may turn the assistant off for their OWN account.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/privacy.js   (the pure page + the opt-out model)
 *   dist/shared/assistant/tools.js     (the registry the page is built from)
 *   dist/main/services/assistant/settings.js (the switches + the opt-out list)
 *   dist/main/services/assistant/agent.js    (the turn runner + the gates)
 *   dist/main/services/assistant/proactive.js (the proactive gate)
 *   dist/main/services/assistant/usage.js     (the cost)
 *
 * No test ever reaches a real LLM — the turn is refused before a provider is
 * even built, and the global fetch is guarded so a socket would fail the run.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_privacy.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-privacy-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-privacy.db');

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
  const auth = require('../dist/main/services/auth.js');
  const privacy = require('../dist/shared/assistant/privacy.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const agentService = require('../dist/main/services/assistant/agent.js');
  const proactiveService = require('../dist/main/services/assistant/proactive.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // The owner opens the assistant (with every role) — the settings are
  // owner-only, so this happens while the OWNER is signed in.
  const settingsService = require('../dist/main/services/assistant/settings.js');
  settingsService.saveAssistantSettings({
    enabled: true,
    actionsEnabled: true,
    proactiveEnabled: true,
    roles: ['owner', 'manager', 'cashier'],
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  // ── 1. the pure page (generated from the registry) ───────────────────────
  section('The privacy page (generated from the registry)');
  const registry = toolsModule.buildToolRegistry();
  const rows = privacy.privacyRows(registry);
  check('there is a row for every tool', rows.length === registry.length, `${rows.length} / ${registry.length}`);
  check('every row names a real tool', rows.every((r) => registry.some((t) => t.name === r.name)));
  check('every row carries the registry description', rows.every((r) => r.description && r.description.length > 0));
  check('every row carries the risk', rows.every((r) => ['read', 'write', 'dangerous', 'forbidden'].includes(r.risk)));
  check('every row carries the roles', rows.every((r) => Array.isArray(r.roles) && r.roles.length > 0));
  check(
    'a WRITE tool is marked as one',
    rows.filter((r) => r.writes).length === registry.filter((t) => t.write).length
  );
  check(
    'the write tools really are the write ones',
    rows.filter((r) => r.writes).every((r) => r.risk === 'write' || r.risk === 'dangerous')
  );
  check(
    'a READ tool is never marked as a write',
    rows.filter((r) => r.risk === 'read').every((r) => r.writes === false)
  );

  // The role ladder of the page is the registry's own ladder.
  const stockRow = rows.find((r) => r.name === 'stock_adjustment');
  check('the stock adjustment is on the page', !!stockRow);
  check('the stock adjustment is dangerous', stockRow.risk === 'dangerous');
  check('a cashier may NOT use the stock adjustment', stockRow.roles.includes('cashier') === false);
  check('a manager may use the stock adjustment', stockRow.roles.includes('manager') === true);
  check('an owner may use the stock adjustment', stockRow.roles.includes('owner') === true);
  const billRow = rows.find((r) => r.name === 'add_to_bill');
  check('a cashier MAY use add_to_bill', billRow.roles.includes('cashier') === true);
  const summary = privacy.privacySummary(rows);
  check('the summary counts every tool', summary.total === rows.length);
  check('the summary counts the reads', summary.read === rows.filter((r) => r.risk === 'read').length);
  check('the summary counts the writes', summary.write === rows.filter((r) => r.risk === 'write').length);
  check('the summary counts the dangerous ones', summary.dangerous === rows.filter((r) => r.risk === 'dangerous').length);

  // ── 2. the opt-out model (pure) ──────────────────────────────────────────
  section('The opt-out model (pure)');
  check('an empty list means nobody', privacy.parseOptOutUsers('').length === 0);
  check('null means nobody', privacy.parseOptOutUsers(null).length === 0);
  check('undefined means nobody', privacy.parseOptOutUsers(undefined).length === 0);
  check('a list is parsed', privacy.parseOptOutUsers('3,5').join(',') === '3,5');
  check('junk is ignored', privacy.parseOptOutUsers('3,abc,0,-2,5').join(',') === '3,5');
  check('duplicates collapse', privacy.parseOptOutUsers('3,3,5').join(',') === '3,5');
  check('spaces are trimmed', privacy.parseOptOutUsers(' 3 , 5 ').join(',') === '3,5');
  check('the list round trips', privacy.encodeOptOutUsers(privacy.parseOptOutUsers('7,2')) === '2,7');

  const on = { enabled: true, roles: ['owner', 'manager', 'cashier'] };
  check('an enabled assistant allows a listed role', privacy.assistantAllowedForUser(on, 'cashier', 1, []) === true);
  check('the switch off allows nobody', privacy.assistantAllowedForUser({ ...on, enabled: false }, 'owner', 1, []) === false);
  check('a role outside the list is refused', privacy.assistantAllowedForUser({ ...on, roles: ['owner'] }, 'cashier', 1, []) === false);
  check('an unknown role is refused', privacy.assistantAllowedForUser(on, 'ghost', 1, []) === false);
  check('no role at all is refused', privacy.assistantAllowedForUser(on, null, 1, []) === false);
  check('the user\'s own opt-out is honoured', privacy.assistantAllowedForUser(on, 'owner', 1, [1]) === false);
  check('somebody else\'s opt-out does not touch me', privacy.assistantAllowedForUser(on, 'owner', 2, [1]) === true);

  // ── 3. the real service (the opt-out list) ───────────────────────────────
  section('The service (the opt-out list)');
  check('nobody has opted out to start with', settingsService.getAssistantOptOuts().length === 0);
  check('the owner has not opted out', settingsService.assistantOptedOut(owner.user.id) === false);

  const set = settingsService.setAssistantOptOut(true);
  check('the opt-out is recorded for the signed-in user', set.optedOut === true && set.userId === owner.user.id);
  check('the user is now opted out', settingsService.assistantOptedOut(owner.user.id) === true);
  check('the list really holds the user', settingsService.getAssistantOptOuts().includes(owner.user.id));
  check('the session may not use the assistant any more', settingsService.assistantAllowedForSession() === false);

  // A second user is NOT affected by the first one's decision.
  const cashier = auth.createUser({ username: 'privacy-cashier', pin: '2468', role: 'cashier' });
  auth.setSessionUser(cashier.id);
  check('another user is not opted out', settingsService.assistantOptedOut(cashier.id) === false);
  check('another user may still use the assistant', settingsService.assistantAllowedForSession() === true);
  // A user may only decide for THEMSELVES.
  const second = settingsService.setAssistantOptOut(true);
  check('a user decides for themselves', second.userId === cashier.id);
  check('both users are now in the list', settingsService.getAssistantOptOuts().length === 2);

  // ── 4. the gates (the turn + the proactive insights) ─────────────────────
  section('The gates');
  auth.setSessionUser(owner.user.id);
  const refused = await agentService.runAssistantTurn({ message: 'How much did we sell today?' });
  check('the turn is refused for an opted-out user', refused.ok === false);
  check('the refusal says the assistant is off', refused.failure && refused.failure.code === 'disabled', JSON.stringify(refused.failure));
  check('the refusal carries a message', !!(refused.failure && refused.failure.message));
  check('no answer was produced', !refused.text);
  check('no pending action was produced', (refused.pendingActions || []).length === 0);
  check('no proactive suggestion for an opted-out user', proactiveService.getProactiveSuggestions().length === 0);

  // The owner turns it back on for themselves.
  settingsService.setAssistantOptOut(false);
  check('the owner is not opted out any more', settingsService.assistantOptedOut(owner.user.id) === false);
  check('the session may use the assistant again', settingsService.assistantAllowedForSession() === true);
  check('the other user is still opted out', settingsService.assistantOptedOut(cashier.id) === true);

  // ── 5. the cost (the transparency) ───────────────────────────────────────
  section('The cost');
  const view = settingsService.getAssistantSettingsView();
  check('the view carries the spend of today', typeof view.spendTodayUsd === 'number');
  check('the view carries the number of turns', typeof view.callsToday === 'number');
  check('the spend starts at zero', view.spendTodayUsd === 0);
  check('the view never carries the API key', !('apiKey' in view) && !('key' in view));
  check('the view says whether a key is set', view.keySet === false);
  check('the key hint is empty without a key', !view.keyHint || view.keyHint === '••••');

  // ── 6. the renderer ──────────────────────────────────────────────────────
  section('The renderer');
  const adminSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/pages/AdminPanel/AssistantSettings.tsx'), 'utf8');
  check('the page builds the table from the registry', adminSource.includes('privacyRows(buildToolRegistry())'));
  check('the page shows the spend', adminSource.includes('spendTodayUsd'));
  check('the page shows the number of turns', adminSource.includes('callsToday'));
  const panelSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel has the opt-out button', panelSource.includes('assistant.optOut'));
  check('the panel hands the opt-out over', panelSource.includes('onOptOut'));
  const appSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/App.tsx'), 'utf8');
  check('the app reads the opt-out on sign-in', appSource.includes('window.api.assistant.optOut()'));
  check('the app hides the assistant button when opted out', appSource.includes('!assistantOptedOut'));
  const preloadSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/preload/preload.ts'), 'utf8');
  check('the preload exposes the channel', preloadSource.includes("'assistant:optOut'"));
  const ipcSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/ipc.ts'), 'utf8');
  check('the main process answers the channel', ipcSource.includes("'assistant:optOut'"));

  // ── 7. the strings (both languages) ──────────────────────────────────────
  section('The strings');
  const settingsKeys = [
    'privacyTitle',
    'privacyHint',
    'spentToday',
    'callsToday',
    'toolsCount',
    'toolsSummary',
    'tool',
    'toolDoes',
    'toolRisk',
    'toolRoles',
    'risk_read',
    'risk_write',
    'risk_dangerous',
    'risk_forbidden',
    'optOutHint',
  ];
  check('every privacy string is in English', settingsKeys.every((k) => !!en.settings.assistant[k]));
  check('every privacy string is in Urdu', settingsKeys.every((k) => !!ur.settings.assistant[k]));
  check('the opt-out button is in English', !!en.assistant.optOut);
  check('the opt-out button is in Urdu', !!ur.assistant.optOut);
  check(
    'the Urdu strings use the same placeholders',
    settingsKeys.every((k) => {
      const a = String(en.settings.assistant[k]);
      const b = String(ur.settings.assistant[k]);
      const placeholders = (text) => (text.match(/\{\{\w+\}\}/g) || []).sort().join(',');
      return placeholders(a) === placeholders(b);
    })
  );

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant privacy checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
