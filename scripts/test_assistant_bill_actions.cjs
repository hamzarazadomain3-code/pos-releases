#!/usr/bin/env node
/**
 * The billing helper actions (item 9).
 *
 * The assistant PROPOSES; the owner CONFIRMS. For the BILLING helpers the open
 * bill lives in the renderer (the Billing screen owns the cart), so the tool
 * resolves what it can in the main process (the product, through the app's own
 * inventory service) and hands the renderer a COMMAND. The renderer then
 * applies it with the same `addProduct` / `doHold` the Billing buttons use.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/billActions.js    (the pure command model)
 *   dist/main/services/assistant/toolImpls.js (the real tool implementations)
 *   dist/main/services/assistant/agent.js    (the turn runner + the confirm)
 *   dist/main/services/assistant/pending.js  (the waiting actions)
 *   dist/main/services/inventory.js          (the product service)
 *   dist/shared/assistant/agent.js           (the loop that must NOT run a write)
 *
 * The provider is ALWAYS the MockProvider — no test ever reaches a real LLM.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_bill_actions.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-bill-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-bill.db');

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
  const billActions = require('../dist/shared/assistant/billActions.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const agentService = require('../dist/main/services/assistant/agent.js');
  const pendingService = require('../dist/main/services/assistant/pending.js');
  const inventory = require('../dist/main/services/inventory.js');
  const { runAgentTurn } = require('../dist/shared/assistant/agent.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');

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

  // ── 1. the pure command model ────────────────────────────────────────────
  section('The command model (pure)');
  const addCommand = billActions.billCommandFor('add_to_bill', {
    productId: 7,
    productName: 'Milk',
    qty: 2,
  });
  check('an add command is built', !!addCommand && addCommand.kind === 'add_to_bill');
  check('the command carries the product id', addCommand.productId === 7);
  check('the command carries the product name', addCommand.productName === 'Milk');
  check('the command carries the qty', addCommand.qty === 2);
  check('a hold command is built', billActions.billCommandFor('hold_bill', { label: 'For Ali' }).kind === 'hold_bill');
  check('a hold command without a label gets one', billActions.billCommandFor('hold_bill', {}).label === 'Held bill');
  check('a non-billing tool has no command', billActions.billCommandFor('create_customer', { name: 'x' }) === null);
  check('a command without a product id is refused', billActions.billCommandFor('add_to_bill', { productName: 'Milk' }) === null);
  check('a qty of zero becomes one', billActions.billQty(0) === 1);
  check('a negative qty becomes one', billActions.billQty(-5) === 1);
  check('a huge qty is capped', billActions.billQty(99999999) === 100000);
  check('a normal qty is kept', billActions.billQty(3) === 3);
  check('a real command is accepted', billActions.isBillCommand(addCommand) === true);
  check('a broken command is refused', billActions.isBillCommand({ kind: 'add_to_bill', productId: 0 }) === false);
  check('a random object is refused', billActions.isBillCommand({ hello: 'world' }) === false);
  check('null is refused', billActions.isBillCommand(null) === false);
  check(
    'the command is found inside a tool result',
    billActions.billCommandFromResult({ ok: true, billCommand: addCommand }).qty === 2
  );
  check('a result without a command gives null', billActions.billCommandFromResult({ ok: true }) === null);
  check('the text of an add command names the product', billActions.billCommandText(addCommand).includes('Milk'));
  check(
    'the text of a hold command names the label',
    billActions.billCommandText({ kind: 'hold_bill', label: 'For Ali' }).includes('For Ali')
  );

  // ── 2. the real tool implementations ─────────────────────────────────────
  section('The tool implementations (the real services)');
  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));
  const ctx = {
    user: { id: owner.user.id, username: owner.user.username, role: 'owner' },
    branchId: null,
    language: 'en',
    dataLevel: 'full',
    actionsEnabled: true,
    route: 'billing',
  };

  const product = inventory.createProduct({
    name: 'Assistant Milk',
    barcode: '0300123456789',
    cost_price: 100,
    sale_price: 125.5,
    stock_qty: 20,
  });
  check('the test product really exists', !!product && product.id > 0);

  const addTool = byName.get('add_to_bill');
  check('the add_to_bill tool is registered', !!addTool);
  check('the add_to_bill tool is a write', addTool.write === true);
  check('the add_to_bill tool has an implementation', !!addTool.impl);

  const addResult = await addTool.impl.execute(ctx, { product: 'Assistant Milk', qty: 3 });
  check('the add_to_bill action succeeds', addResult.ok === true);
  check('the action knows the real product', addResult.product_id === product.id);
  check('the action carries the real name', addResult.name === 'Assistant Milk');
  check('the action carries the qty', addResult.qty === 3);
  check('the action carries the real price', addResult.sale_price === 125.5);
  check('the action carries a command', addResult.billCommand && addResult.billCommand.kind === 'add_to_bill');
  check('the command points at the real product', addResult.billCommand.productId === product.id);
  check('the command is found by the pure model', billActions.billCommandFromResult(addResult) !== null);

  const addByBarcode = await addTool.impl.execute(ctx, { product: '0300123456789', qty: 1 });
  check('the product is found by its barcode too', addByBarcode.product_id === product.id);

  let addFailed = '';
  try {
    await addTool.impl.execute(ctx, { product: 'No Such Product At All' });
  } catch (e) {
    addFailed = e instanceof Error ? e.message : String(e);
  }
  check('an unknown product fails cleanly', addFailed.length > 0, addFailed);
  check('the failure names the problem', addFailed.toLowerCase().includes('product'), addFailed);

  const addPreview = await addTool.impl.preview(ctx, { product: 'Assistant Milk', qty: 3 });
  check('the preview has a summary', typeof addPreview.summary === 'string' && addPreview.summary.includes('Assistant Milk'));
  check('the preview shows the qty', addPreview.details.some((d) => d.label === 'Qty' && String(d.after) === '3'));
  check(
    'the preview shows the real price',
    addPreview.details.some((d) => d.label === 'Price' && String(d.after).includes('125.50')),
    JSON.stringify(addPreview.details)
  );

  const holdTool = byName.get('hold_bill');
  check('the hold_bill tool is registered', !!holdTool && holdTool.write === true);
  const holdResult = await holdTool.impl.execute(ctx, { label: 'For Ali' });
  check('the hold_bill action succeeds', holdResult.ok === true);
  check('the hold action carries the label', holdResult.label === 'For Ali');
  check('the hold action carries a command', holdResult.billCommand && holdResult.billCommand.kind === 'hold_bill');
  const holdPreview = await holdTool.impl.preview(ctx, { label: 'For Ali' });
  check('the hold preview names the label', holdPreview.summary.includes('For Ali'));

  // ── 3. the whole flow: propose → wait → confirm → the command comes back ─
  section('The whole flow (propose, wait, confirm)');
  const pendingRow = pendingService.createPendingAction({
    tool: 'add_to_bill',
    args: { product: 'Assistant Milk', qty: 2 },
    risk: 'write',
    preview: { summary: 'Add 2 × "Assistant Milk" to the open bill' },
    userId: owner.user.id,
    username: owner.user.username,
  });
  check('the action waits for the owner', pendingRow.status === 'pending');
  const confirmed = await agentService.confirmAssistantAction(pendingRow.id);
  check('the confirmation succeeds', confirmed.ok === true, confirmed.message || '');
  check('the confirmation knows the tool', confirmed.tool === 'add_to_bill');
  check('the confirmation returns the command', billActions.billCommandFromResult(confirmed.result) !== null);
  check(
    'the command points at the real product',
    billActions.billCommandFromResult(confirmed.result).productId === product.id
  );
  const settled = pendingService.getPendingAction(pendingRow.id);
  check('the action is confirmed', settled.status === 'confirmed');
  check('the stored result keeps the command', billActions.billCommandFromResult(settled.result) !== null);

  // The loop itself must NEVER run the write — it only proposes.
  let ranInTheLoop = false;
  const proposeProvider = new MockProvider([
    {
      respond: () => ({
        text: 'I can add that to the bill.',
        toolCalls: [{ id: 'b1', name: 'add_to_bill', input: { product: 'Assistant Milk', qty: 1 } }],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'tool_use',
      }),
    },
    {
      respond: () => ({
        text: 'Done — it is on the card, confirm it when you are ready.',
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5 },
        stopReason: 'end_turn',
      }),
    },
  ]);
  const loopResult = await runAgentTurn({
    adapter: proposeProvider,
    model: 'claude-test',
    system: 'test',
    messages: [{ role: 'user', content: 'add milk to the bill' }],
    tools: toolsModule.toolsForRole(registry, 'owner'),
    executeTool: async (name, input) => {
      if (name === 'add_to_bill') ranInTheLoop = true;
      const tool = byName.get(name);
      return tool.impl ? tool.impl.execute(ctx, input) : {};
    },
    limits: { maxTurns: 4, maxToolCallsPerTurn: 4, maxOutputTokens: 500, wallClockMs: 5000 },
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
    secrets: [],
    language: 'en',
  });
  check('the loop proposed the action', loopResult.pendingActions.length === 1);
  check('the proposed action is add_to_bill', loopResult.pendingActions[0].tool === 'add_to_bill');
  check('the write tool NEVER ran inside the loop', ranInTheLoop === false);

  // ── 4. the renderer applies the command ───────────────────────────────────
  section('The renderer (the billing screen owns the bill)');
  const panelSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel reads the command out of the result', panelSource.includes('billCommandFromResult'));
  check('the panel hands the command over', panelSource.includes('onBillCommand'));
  const appSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/App.tsx'), 'utf8');
  check('the app holds the command', appSource.includes('assistantBillCommand'));
  check('the app gives it to the billing screen', appSource.includes('assistantCommand={assistantBillCommand}'));
  const billingSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/pages/Billing.tsx'), 'utf8');
  check('the billing screen takes the command', billingSource.includes('assistantCommand'));
  check('the billing screen adds the line with its own addProduct', billingSource.includes('addProduct(product'));
  check('the billing screen holds the bill with its own doHold', billingSource.includes('doHold(command.label)'));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant billing-action checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
