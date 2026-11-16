#!/usr/bin/env node
/**
 * The LIVE evaluation (optional) — the same cases against the REAL provider.
 *
 * This script is NOT part of `npm test` and it never runs by accident:
 *
 *   npm run eval:assistant:live -- --live
 *
 * Without `--live` it only says what it would do and exits 0 — so a careless
 * run can never spend the owner's money.
 *
 * The API key is read from the app's own settings (the owner put it there).
 * It is NEVER printed, never logged and never written to a file — only the
 * outcome of each case is printed.
 *
 * The real test suite (`npm run test:assistantEval`) is the one that gates the
 * build; this one only tells the owner how the real model behaves on the same
 * questions.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-eval-live-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-eval-live.db');

async function run() {
  const live = process.argv.includes('--live');
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const { runAgentTurn } = require('../dist/shared/assistant/agent.js');
  const { AnthropicProvider } = require('../dist/main/services/assistant/provider.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const { buildSystemPrompt } = require('../dist/shared/assistant/prompt.js');
  const { getAdminSetting } = require('../dist/main/services/admin.js');
  const { getAssistantSettings } = require('../dist/main/services/assistant/settings.js');
  const inventory = require('../dist/main/services/inventory.js');

  const evalFile = path.join(PROJECT_ROOT, 'src/shared/assistant/evals.json');
  const evals = JSON.parse(fs.readFileSync(evalFile, 'utf8'));

  if (!live) {
    console.log('The live evaluation is OFF by default.');
    console.log('Run it with:  npm run eval:assistant:live -- --live');
    console.log(`It would run ${evals.cases.length} cases against the real model (the API key comes from the app\'s own settings and is never printed).`);
    app.exit(0);
    return;
  }

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');
  const db = getDb();

  const settings = getAssistantSettings();
  const apiKey = String(getAdminSetting('assistant_api_key') ?? '').trim();
  if (!apiKey) {
    console.log('No API key is set in the app\'s settings — nothing to run.');
    app.exit(0);
    return;
  }
  if (!settings.model) {
    console.log('No model is set in the app\'s settings — nothing to run.');
    app.exit(0);
    return;
  }

  // The same fixtures the regression suite uses.
  inventory.createProduct({
    name: 'Eval Soap',
    barcode: '0300555000111',
    cost_price: 50,
    sale_price: 80,
    stock_qty: 30,
    low_stock_threshold: 5,
  });
  inventory.createProduct({
    name: 'Eval Low Stock',
    barcode: '0300555000222',
    cost_price: 10,
    sale_price: 20,
    stock_qty: 2,
    low_stock_threshold: 5,
  });
  db.prepare(
    `INSERT INTO sales (invoice_no, customer_id, user_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  ).run('EVAL-LIVE-1', null, owner.user.id, 500, 0, 0, 500, new Date().toISOString());

  const provider = new AnthropicProvider({
    apiKey,
    model: settings.model,
    language: settings.language === 'auto' ? 'en' : settings.language,
  });

  let passed = 0;
  let failed = 0;
  for (const evalCase of evals.cases) {
    // The live run only makes sense for the cases that do not script a write.
    if (evalCase.expect.writeDidNotRun || evalCase.expect.numberRetries !== undefined) continue;
    const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
    const roleTools = toolsModule.toolsForRole(registry, evalCase.role);
    const system = buildSystemPrompt({
      role: evalCase.role,
      language: 'en',
      dataLevel: 'aggregates',
      actionsEnabled: false,
      timezone: 'UTC',
      now: new Date().toISOString(),
    });
    let ok = true;
    let detail = '';
    try {
      const result = await runAgentTurn({
        adapter: provider,
        model: settings.model,
        system,
        messages: [{ role: 'user', content: evalCase.question }],
        tools: roleTools,
        executeTool: async (name, input) => {
          const tool = registry.find((t) => t.name === name);
          if (!tool?.impl) throw new Error('That tool is not available.');
          return tool.impl.execute(
            {
              user: { id: owner.user.id, username: owner.user.username, role: evalCase.role },
              branchId: null,
              language: 'en',
              dataLevel: 'aggregates',
              actionsEnabled: false,
              route: null,
            },
            input
          );
        },
        limits: { maxTurns: 6, maxToolCallsPerTurn: 6, maxOutputTokens: 800, wallClockMs: 90000 },
        budget: { spentUsd: 0, budgetUsd: 5 },
        dataLevel: 'aggregates',
        secrets: [],
        language: 'en',
      });
      const ran = result.sources || [];
      if (result.failure) {
        ok = false;
        detail = result.failure.code;
      }
      if (evalCase.expect.toolCalls) {
        for (const tool of evalCase.expect.toolCalls) {
          if (!ran.includes(tool)) {
            ok = false;
            detail = `the tool ${tool} did not run`;
          }
        }
      }
      if ((result.unverifiedNumbers || []).length > 0) {
        ok = false;
        detail = 'a figure could not be traced to a tool result';
      }
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? e.message : String(e);
    }
    if (ok) passed++;
    else failed++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${evalCase.id}${detail ? ' -- ' + detail : ''}`);
  }

  console.log(`\n${passed}/${passed + failed} live cases passed.`);
  app.exit(failed > 0 ? 1 : 0);
}

app.whenReady().then(run).catch((e) => {
  console.error('The live evaluation crashed:', e instanceof Error ? e.message : String(e));
  app.exit(1);
});
