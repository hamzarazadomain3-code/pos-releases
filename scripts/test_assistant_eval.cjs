#!/usr/bin/env node
/**
 * The assistant's evaluation set (item 12) — the REGRESSION suite.
 *
 * The cases live in `src/shared/assistant/evals.json` and every one of them
 * runs against the MOCK provider: no case ever reaches a real LLM, so the
 * suite is free, offline and repeatable.
 *
 * The `{fact}` placeholders are filled in by the runner with the numbers the
 * app's OWN services returned, so an answer that repeats the real figure
 * passes and one that invents it fails. The expectations are the behaviour the
 * shop depends on:
 *   - the right READ tool runs,
 *   - a WRITE tool only ever becomes a pending action (it never runs in the
 *     loop) and the owner confirms it,
 *   - a figure that cannot be traced to a tool result is never shown,
 *   - a role never gets a tool it may not use.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/agent.js      (the loop)
 *   dist/shared/assistant/tools.js      (the registry + the role ladder)
 *   dist/shared/assistant/mockProvider.js (the scripted provider)
 *   dist/main/services/assistant/toolImpls.js (the real implementations)
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_eval.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-eval-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-eval.db');

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

/** Fill the `{fact}` placeholders with the real numbers. */
function fill(text, facts) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (whole, key) =>
    facts[key] === undefined ? whole : String(facts[key])
  );
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const { runAgentTurn } = require('../dist/shared/assistant/agent.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const reports = require('../dist/main/services/reports.js');
  const inventory = require('../dist/main/services/inventory.js');
  const customerService = require('../dist/main/services/customers.js');
  const udhaar = require('../dist/main/services/udhaar.js');

  const evalFile = path.join(PROJECT_ROOT, 'src/shared/assistant/evals.json');
  const evals = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
  check('the evaluation set exists', Array.isArray(evals.cases) && evals.cases.length > 0);
  check('every case has an id and a question', evals.cases.every((c) => c.id && c.question));
  check('every case has a role', evals.cases.every((c) => ['owner', 'manager', 'cashier'].includes(c.role)));
  check('every case has a script', evals.cases.every((c) => Array.isArray(c.script) && c.script.length > 0));
  check('every case has expectations', evals.cases.every((c) => c.expect && typeof c.expect === 'object'));
  check('the case ids are unique', new Set(evals.cases.map((c) => c.id)).size === evals.cases.length);

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');
  const db = getDb();

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  // ── the fixtures (the app's own services) ─────────────────────────────────
  section('The fixtures');
  const soap = inventory.createProduct({
    name: 'Eval Soap',
    barcode: '0300555000111',
    cost_price: 50,
    sale_price: 80,
    stock_qty: 30,
    low_stock_threshold: 5,
  });
  check('the Eval Soap product really exists', !!soap && soap.id > 0);
  inventory.createProduct({
    name: 'Eval Low Stock',
    barcode: '0300555000222',
    cost_price: 10,
    sale_price: 20,
    stock_qty: 2,
    low_stock_threshold: 5,
  });
  check('the low stock product really exists', inventory.getProductByBarcode('0300555000222') !== null);

  // A bill from today (the Dashboard's own numbers).
  db.prepare(
    `INSERT INTO sales (invoice_no, customer_id, user_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  ).run('EVAL-TODAY-1', null, owner.user.id, 500, 0, 0, 500, new Date().toISOString());

  // A customer whose udhaar is overdue (20 days ago, 7 days of credit).
  const overdueCustomer = customerService.saveCustomer({
    name: 'Eval Overdue',
    phone: '03001237777',
    credit_days: 7,
  });
  check('the overdue customer really exists', overdueCustomer.ok === true, overdueCustomer.message || '');
  const twentyDaysAgo = new Date(Date.now() - 20 * 86400000).toISOString();
  const saleInfo = db
    .prepare(
      `INSERT INTO sales (invoice_no, customer_id, user_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    )
    .run('EVAL-OD-1', overdueCustomer.customer.id, owner.user.id, 750, 0, 0, 750, twentyDaysAgo);
  db.prepare(
    `INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, ?, ?, 'sale', ?)`
  ).run(overdueCustomer.customer.id, Number(saleInfo.lastInsertRowid), 750, twentyDaysAgo);
  db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(750, overdueCustomer.customer.id);

  // ── the facts (the real numbers) ─────────────────────────────────────────
  const dash = reports.dashboard();
  const aging = udhaar.getUdhaarAging();
  const overdueRows = aging.rows.filter((row) => {
    const b = row.buckets;
    return Number(b.d1_30) + Number(b.d31_60) + Number(b.d61_90) + Number(b.d90_plus) > 0;
  });
  const facts = {
    today_sales: Math.round(Number(dash.today_sales) * 100) / 100,
    today_bills: Number(dash.today_bills),
    low_stock_count: Number(dash.low_stock),
    overdue_count: overdueRows.length,
    below_cost_count: reports.listBelowCostProducts().length,
  };
  check('the today fact is a real number', Number.isFinite(facts.today_sales));
  check('the bills fact is a real number', Number.isFinite(facts.today_bills));
  check('the overdue customer really is overdue', facts.overdue_count >= 1, String(facts.overdue_count));

  // ── the cases ─────────────────────────────────────────────────────────────
  section('The cases');
  for (const evalCase of evals.cases) {
    const expect = evalCase.expect || {};
    const role = evalCase.role;
    const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
    const roleTools = toolsModule.toolsForRole(registry, role);

    // Every write tool is wrapped: the runner sees if one of them ever RAN.
    const ranTools = [];
    const implementations = buildAssistantToolImplementations();
    const wrapped = {};
    for (const [name, impl] of Object.entries(implementations)) {
      wrapped[name] = {
        ...impl,
        execute: async (ctx, input) => {
          ranTools.push(name);
          return impl.execute(ctx, input);
        },
      };
    }
    const wrappedRegistry = toolsModule.buildToolRegistry(wrapped);
    const roleToolsWrapped = toolsModule.toolsForRole(wrappedRegistry, role);

    const provider = new MockProvider(
      evalCase.script.map((turn) => ({
        text: turn.text !== undefined ? fill(turn.text, facts) : undefined,
        toolCalls: (turn.toolCalls || []).map((call) => ({
          id: call.id || `${evalCase.id}-${call.name}`,
          name: call.name,
          input: call.input || {},
        })),
      }))
    );

    const result = await runAgentTurn({
      adapter: provider,
      model: 'claude-eval',
      system: 'You are the Rokar POS assistant.',
      messages: [{ role: 'user', content: evalCase.question }],
      tools: roleToolsWrapped,
      executeTool: async (name, input) => {
        const tool = wrappedRegistry.find((t) => t.name === name);
        if (!tool?.impl) throw new Error('That tool is not available.');
        return tool.impl.execute(
          {
            user: { id: owner.user.id, username: owner.user.username, role },
            branchId: null,
            language: 'en',
            dataLevel: 'aggregates',
            actionsEnabled: true,
            route: null,
          },
          input
        );
      },
      limits: { maxTurns: 6, maxToolCallsPerTurn: 6, maxOutputTokens: 800, wallClockMs: 10000 },
      budget: { spentUsd: 0, budgetUsd: 5 },
      dataLevel: 'aggregates',
      secrets: [],
      language: 'en',
    });

    const ran = result.sources || [];
    const pending = result.pendingActions || [];
    const answer = result.text || '';

    if (expect.toolCalls) {
      for (const tool of expect.toolCalls) {
        check(`${evalCase.id}: the tool ${tool} ran`, ran.includes(tool), `ran: ${ran.join(', ') || 'nothing'}`);
      }
    }
    if (expect.forbiddenTools) {
      for (const tool of expect.forbiddenTools) {
        check(
          `${evalCase.id}: the tool ${tool} did NOT run`,
          !ran.includes(tool) && !pending.some((p) => p.tool === tool),
          `ran: ${ran.join(', ') || 'nothing'}`
        );
      }
    }
    if (expect.pendingActions !== undefined) {
      check(
        `${evalCase.id}: the number of pending actions`,
        pending.length === expect.pendingActions,
        `${pending.length} (${pending.map((p) => p.tool).join(', ') || 'none'})`
      );
    }
    if (expect.pendingTools) {
      for (const tool of expect.pendingTools) {
        check(`${evalCase.id}: the pending action is ${tool}`, pending.some((p) => p.tool === tool));
      }
    }
    if (expect.writeDidNotRun) {
      const writeTools = ['create_customer', 'set_customer_discount', 'add_to_bill', 'hold_bill', 'create_expense_draft', 'create_promotion_draft', 'stock_adjustment', 'update_product_price'];
      const ranWrite = writeTools.filter((t) => ranTools.includes(t));
      check(`${evalCase.id}: no write tool ever ran`, ranWrite.length === 0, ranWrite.join(', '));
    }
    if (expect.numberRetries !== undefined) {
      check(
        `${evalCase.id}: the number of retries`,
        result.numberRetries === expect.numberRetries,
        String(result.numberRetries)
      );
    }
    if (expect.answerContains) {
      for (const part of expect.answerContains) {
        const text = fill(part, facts);
        check(`${evalCase.id}: the answer contains "${text}"`, answer.includes(text), answer.slice(0, 120));
      }
    }
    if (expect.answerNotContains) {
      for (const part of expect.answerNotContains) {
        const text = fill(part, facts);
        check(`${evalCase.id}: the answer does NOT contain "${text}"`, !answer.includes(text), answer.slice(0, 120));
      }
    }
    if (expect.verified !== undefined) {
      const unverifiedList = result.unverifiedNumbers || [];
      const unverified = unverifiedList.length;
      if (expect.verified) {
        check(`${evalCase.id}: every figure was traced to a tool`, unverified === 0, unverifiedList.join(', '));
      } else {
        check(`${evalCase.id}: the unconfirmed figures were caught`, unverified > 0, `unverified: ${unverified}`);
        check(`${evalCase.id}: no figure is shown anyway`, !/\d/.test(answer), answer.slice(0, 120));
      }
    }
    // The case must always end on its own — never on a limit.
    check(`${evalCase.id}: the turn ended normally`, result.stop === 'end_turn', result.stop);
  }

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed (${evals.cases.length} cases).`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant evaluation cases passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
