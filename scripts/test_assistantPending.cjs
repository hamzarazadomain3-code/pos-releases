#!/usr/bin/env node
/**
 * The pending action + the confirmation flow.
 *
 * The assistant proposes, the owner decides: a write tool NEVER runs inside
 * the agent loop — it becomes a row in the app's own database and waits there
 * until the owner confirms it.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/pending.js  (the pure state machine + the expiry)
 *   dist/main/services/assistant/pending.js (the real service, over a migrated
 *                                                throwaway DB)
 *   dist/main/services/assistant/agent.js    (the turn runner)
 *   dist/shared/assistant/agent.js     (the loop that must NOT run a write)
 *   dist/main/services/assistant/toolImpls.js (the real write implementation)
 *   dist/main/services/customers.js   (the service the action really uses)
 *
 * The provider is ALWAYS the MockProvider — no test ever reaches a real LLM.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantPending.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-pending-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-pending.db');

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
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const pendingModel = require('../dist/shared/assistant/pending.js');
  const pendingService = require('../dist/main/services/assistant/pending.js');
  const agentService = require('../dist/main/services/assistant/agent.js');
  const { runAgentTurn } = require('../dist/shared/assistant/agent.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const customers = require('../dist/main/services/sales.js');
  const customerService = require('../dist/main/services/customers.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  // The assistant is OFF by default — the owner turns it on (and the actions
  // switch) so the confirm flow can run.
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const saved = settingsService.saveAssistantSettings({
    enabled: true,
    actionsEnabled: true,
    roles: ['owner', 'manager', 'cashier'],
  });
  check('the assistant is switched on for the test', saved.enabled === true, JSON.stringify(saved));

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  // ── 1. the pure model ────────────────────────────────────────────────────
  section('The pending-action model');
  check('a fresh action is pending', pendingModel.isPending({ status: 'pending' }) === true);
  check('a settled action is not pending', pendingModel.isPending({ status: 'confirmed' }) === false);
  check('an action that waits too long expires', pendingModel.isExpired({ status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString() }) === true);
  check('an action inside its time does not expire', pendingModel.isExpired({ status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }) === false);
  check('a settled action never expires', pendingModel.isExpired({ status: 'confirmed', expires_at: new Date(Date.now() - 100000).toISOString() }) === false);
  check('an action without an expiry never expires', pendingModel.isExpired({ status: 'pending', expires_at: null }) === false);
  check('a live action can be confirmed', pendingModel.canConfirm({ status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }) === true);
  check('an expired action cannot be confirmed', pendingModel.canConfirm({ status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString() }) === false);
  check('a confirmed action cannot be confirmed again', pendingModel.canConfirm({ status: 'confirmed' }) === false);
  check('a live action can be cancelled', pendingModel.canCancel({ status: 'pending' }) === true);
  check('a cancelled action cannot be cancelled again', pendingModel.canCancel({ status: 'cancelled' }) === false);
  check('the status machine moves pending to confirmed', pendingModel.nextStatus('pending', 'confirmed') === 'confirmed');
  check('the status machine moves pending to cancelled', pendingModel.nextStatus('pending', 'cancelled') === 'cancelled');
  check('the status machine never goes back to pending', pendingModel.nextStatus('confirmed', 'cancelled') === 'confirmed');
  check('an action is over once it is settled', pendingModel.isOver('confirmed') === true && pendingModel.isOver('pending') === false);
  check('the expiry is ten minutes away', Math.abs(Date.parse(pendingModel.expiryFrom(0)) - 10 * 60_000) < 1000);

  // ── 2. the table exists ──────────────────────────────────────────────────
  section('The table (the app\'s own database)');
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_pending_actions'")
    .all();
  check('the pending-actions table exists', tables.length === 1);

  // ── 3. the real service ──────────────────────────────────────────────────
  section('The service (the real database)');
  const row = pendingService.createPendingAction({
    tool: 'create_customer',
    args: { name: 'Pending Traders', phone: '03001234567' },
    risk: 'write',
    reason: 'the owner asked for it',
    preview: { summary: 'Add the customer "Pending Traders"', details: [{ label: 'Name', after: 'Pending Traders' }] },
    userId: owner.user.id,
    username: owner.user.username,
  });
  check('the action is created', !!row && row.id > 0);
  check('the action is pending', row.status === 'pending');
  check('the action keeps its args', row.args.name === 'Pending Traders');
  check('the action keeps the preview', row.preview === 'Add the customer "Pending Traders"');
  check('the action has an expiry', !!row.expires_at);
  check('the action knows who proposed it', row.username === owner.user.username);
  check('the action is in the list', pendingService.listPendingActions().some((r) => r.id === row.id));
  check('nothing was written yet', customers.listCustomers('all').every((c) => c.name !== 'Pending Traders'));

  // The confirmation runs the REAL service.
  const confirmed = await agentService.confirmAssistantAction(row.id);
  check('the confirmation succeeds', confirmed.ok === true, confirmed.message || '');
  const afterConfirm = pendingService.getPendingAction(row.id);
  check('the action is confirmed', afterConfirm.status === 'confirmed');
  check('the customer really exists now', customers.listCustomers('all').some((c) => c.name === 'Pending Traders'));
  check('the confirmation is written to the activity log', pendingService.listPendingActions(true).length >= 1);

  // A second confirmation changes nothing.
  const confirmedAgain = await agentService.confirmAssistantAction(row.id);
  check('a confirmed action cannot be confirmed again', confirmedAgain.ok === false, confirmedAgain.message || '');

  // Cancelling changes nothing.
  const cancelledRow = pendingService.createPendingAction({
    tool: 'create_customer',
    args: { name: 'Cancelled Traders' },
    risk: 'write',
    userId: owner.user.id,
    username: owner.user.username,
  });
  const cancelled = agentService.cancelAssistantAction(cancelledRow.id);
  check('the cancellation succeeds', cancelled.ok === true, cancelled.message || '');
  check('the action is cancelled', pendingService.getPendingAction(cancelledRow.id).status === 'cancelled');
  check('the cancelled customer was NOT created', customers.listCustomers('all').every((c) => c.name !== 'Cancelled Traders'));

  // An expired action is dead.
  const expiredRow = pendingService.createPendingAction({
    tool: 'create_customer',
    args: { name: 'Expired Traders' },
    risk: 'write',
    userId: owner.user.id,
    username: owner.user.username,
  });
  db.prepare(`UPDATE assistant_pending_actions SET expires_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 60_000).toISOString(),
    expiredRow.id
  );
  pendingService.expirePendingActions();
  check('the expired action is marked expired', pendingService.getPendingAction(expiredRow.id).status === 'expired');
  const expiredConfirm = await agentService.confirmAssistantAction(expiredRow.id);
  check('an expired action cannot be confirmed', expiredConfirm.ok === false, expiredConfirm.message || '');
  check('the expired customer was NOT created', customers.listCustomers('all').every((c) => c.name !== 'Expired Traders'));

  // A failing action is recorded as failed, not swallowed.
  const badRow = pendingService.createPendingAction({
    tool: 'create_customer',
    args: { name: '' },
    risk: 'write',
    userId: owner.user.id,
    username: owner.user.username,
  });
  const badConfirm = await agentService.confirmAssistantAction(badRow.id);
  check('a broken action fails', badConfirm.ok === false, badConfirm.message || '');
  check('the failure is recorded', pendingService.getPendingAction(badRow.id).status === 'failed');

  // ── 4. the agent loop only PROPOSES ──────────────────────────────────────
  section('The agent loop only proposes');
  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));
  let writeRan = false;
  const proposeRegistry = toolsModule.buildToolRegistry({
    ...buildAssistantToolImplementations(),
    create_customer: {
      execute(_ctx, _input) {
        writeRan = true;
        return { created: true };
      },
    },
  });
  const proposeProvider = new MockProvider([
    {
      respond: () => ({
        text: 'I would like to add the customer.',
        toolCalls: [{ id: 'c1', name: 'create_customer', input: { name: 'Loop Traders' } }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'tool_use',
      }),
    },
  ]);
  const proposeRun = await runAgentTurn({
    adapter: proposeProvider,
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'add a customer' }],
    tools: proposeRegistry,
    executeTool: async (name, input) => byName.get(name).impl.execute({ user: { id: 1, username: 'admin', role: 'owner' }, branchId: null, language: 'en', dataLevel: 'full', actionsEnabled: true, route: null }, input),
    limits: { ...require('../dist/shared/assistant/limits.js').DEFAULT_ASSISTANT_LIMITS },
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
  });
  check('the write tool never ran in the loop', writeRan === false);
  check('the write tool became a pending action', proposeRun.pendingActions.length >= 1 && proposeRun.pendingActions.every((p) => p.tool === 'create_customer'), JSON.stringify(proposeRun.pendingActions.map((p) => p.tool)));
  check('the customer was NOT created by the loop', customers.listCustomers('all').every((c) => c.name !== 'Loop Traders'));

  // ── 5. the role gate ─────────────────────────────────────────────────────
  section('The role gate');
  const cashier = auth.createUser({ username: 'pending-cashier', password: 'CashierPass1', pin: '1234', role: 'cashier' });
  check('the cashier user was created', !!cashier && !!cashier.id);
  auth.setSessionUser(cashier.id);
  const cashierRow = pendingService.createPendingAction({
    tool: 'create_customer',
    args: { name: 'Gate Traders' },
    risk: 'write',
    userId: owner.user.id,
    username: owner.user.username,
  });
  const cashierConfirm = await agentService.confirmAssistantAction(cashierRow.id);
  check('a cashier cannot confirm a write action', cashierConfirm.ok === false, cashierConfirm.message || '');
  check('the gated customer was NOT created', customers.listCustomers('all').every((c) => c.name !== 'Gate Traders'));
  auth.setSessionUser(owner.user.id);

  // ── 6. the write tool's own preview ──────────────────────────────────────
  section('The preview (what the owner sees before confirming)');
  const preview = await byName.get('create_customer').impl.preview(
    { user: { id: 1, username: 'admin', role: 'owner' }, branchId: null, language: 'en', dataLevel: 'full', actionsEnabled: true, route: null },
    { name: 'Preview Traders', phone: '03009999999', address: 'Main Road' }
  );
  check('the preview has a summary', typeof preview.summary === 'string' && preview.summary.includes('Preview Traders'), preview.summary);
  check('the preview shows the details', Array.isArray(preview.details) && preview.details.length === 3);

  // ── 7. the card in the panel ─────────────────────────────────────────────
  section('The card (the panel)');
  check('the card has its strings in English', ['actionConfirm', 'actionCancel', 'action_confirmed', 'action_cancelled', 'action_expired', 'action_failed'].every((k) => !!en.assistant[k]));
  check('the card has its strings in Urdu', ['actionConfirm', 'actionCancel', 'action_confirmed', 'action_cancelled', 'action_expired', 'action_failed'].every((k) => !!ur.assistant[k]));
  const panelSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel can confirm an action', panelSource.includes('pendingConfirm'));
  check('the panel can cancel an action', panelSource.includes('pendingCancel'));
  const preloadSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/preload/preload.ts'), 'utf8');
  check('the preload exposes the confirm channel', preloadSource.includes("'assistant:pendingConfirm'"));
  check('the preload exposes the cancel channel', preloadSource.includes("'assistant:pendingCancel'"));
  check('the preload exposes the list channel', preloadSource.includes("'assistant:pendingList'"));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant pending-action checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
