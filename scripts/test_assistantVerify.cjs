#!/usr/bin/env node
/**
 * The answers with real numbers — the number verifier.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/verify.js   (the verifier: the extraction, the
 *                                     comparison, the retry message)
 *   dist/shared/assistant/agent.js    (the loop that checks the answer)
 *   dist/shared/assistant/sources.js  (the source line under the answer)
 *   dist/main/services/assistant/toolImpls.js (the real implementations, over a
 *                                                migrated throwaway DB)
 *   dist/main/services/reports.js     (the same service the Dashboard uses)
 *
 * The provider is ALWAYS the MockProvider — no test ever reaches a real LLM,
 * and the numbers really come from the app's own services.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantVerify.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-verify-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-verify.db');

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
  const verify = require('../dist/shared/assistant/verify.js');
  const sources = require('../dist/shared/assistant/sources.js');
  const { runAgentTurn } = require('../dist/shared/assistant/agent.js');
  const { MockProvider } = require('../dist/shared/assistant/mockProvider.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const reports = require('../dist/main/services/reports.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  // ── fixtures: one product, one customer, one sale ────────────────────────
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO products (name, sku, barcode, sale_price, cost_price, stock_qty, low_stock_threshold, active, is_test, created_at)
     VALUES ('Verify Rice', 'SKU-V1', '1110009999999', 250, 200, 4, 5, 1, 0, ?)`
  ).run(nowIso);
  db.prepare(
    `INSERT INTO customers (name, phone, balance, credit_days, created_at) VALUES ('Verify Traders', '03009999999', 2500, 0, ?)`
  ).run(nowIso);
  db.prepare(
    `INSERT INTO sales (invoice_no, user_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES ('INV-VERIFY-1', 1, 1250, 0, 0, 1250, 'completed', ?)`
  ).run(nowIso);

  const ctx = {
    user: { id: owner.user.id, username: 'admin', role: 'owner' },
    branchId: null,
    language: 'en',
    dataLevel: 'full',
    actionsEnabled: false,
    route: 'dashboard',
  };

  // ── 1. the extraction ─────────────────────────────────────────────────────
  section('The number extraction');
  check('an English number with a thousands separator', verify.extractNumbers('We sold 12,500 today', 'en').includes('12,500'));
  check('an English number without a separator', verify.extractNumbers('We sold 12500 today', 'en').includes('12500'));
  check('a decimal number', verify.extractNumbers('The rate is 12.50', 'en').includes('12.50'));
  check('several numbers', verify.extractNumbers('4 bills for 12,500', 'en').length === 2);
  check('no number in a plain sentence', verify.extractNumbers('hello world', 'en').length === 0);
  check('an Urdu number (Arabic-Indic digits)', verify.extractNumbers('آج ١٢،٥٠۰ روپے', 'ur').includes('12500'));
  check('an Urdu number (Extended Arabic-Indic digits)', verify.extractNumbers('آج ۱۲۵۰۰ روپے', 'ur').includes('12500'));
  check('a Roman Urdu number (Latin digits)', verify.extractNumbers('aaj 12500 rupay', 'roman').includes('12500'));
  check('an Urdu answer with Latin digits is read too', verify.extractNumbers('آج 12,500 روپے', 'ur').includes('12,500'));

  // The numbers that are NOT shop data are never checked.
  check('a list marker is not a number', !verify.extractNumbers('1. Rice\n2. Sugar', 'en').includes('1'));
  check('a shortcut is not a number', !verify.extractNumbers('Press Ctrl+2 to search', 'en').includes('2'));
  check('a function key is not a number', !verify.extractNumbers('Press F1 for help', 'en').includes('1'));
  check('a date is not a number', !verify.extractNumbers('on 2026-11-16 we sold', 'en').includes('2026'));
  check('a version is not a number', !verify.extractNumbers('version 2.18.0 is out', 'en').includes('2.18.0'));
  check('a step number is not a number', !verify.extractNumbers('Step 2 of the guide', 'en').includes('2'));
  // A DATE in the everyday forms: the day's numbers are not shop figures, and
  // a correct answer must never be blocked by the way it writes the date.
  check(
    'a numeric date is not a number',
    verify.extractNumbers('From 11/11/2026 to 11/17/2026 we sold', 'en').length === 0,
    JSON.stringify(verify.extractNumbers('From 11/11/2026 to 11/17/2026 we sold', 'en'))
  );
  check(
    'a dotted date is not a number',
    verify.extractNumbers('on 11.11.2026 we sold', 'en').length === 0
  );
  check(
    'a day with a month name is not a number',
    verify.extractNumbers('on 17 November we sold', 'en').length === 0
  );
  check(
    'a month name with a day is not a number',
    verify.extractNumbers('November 17, 2026: we sold', 'en').length === 0,
    JSON.stringify(verify.extractNumbers('November 17, 2026: we sold', 'en'))
  );
  check(
    'a month with a year is not a number',
    verify.extractNumbers('November 2026 was good', 'en').length === 0
  );
  check(
    'a range of days is not a number',
    verify.extractNumbers('Between 15 and 17 November we sold', 'en').length === 0,
    JSON.stringify(verify.extractNumbers('Between 15 and 17 November we sold', 'en'))
  );
  check(
    'a range of days with "to" is not a number',
    verify.extractNumbers('from 15 to 17 November we sold', 'en').length === 0
  );
  check(
    'the real figure next to a date is still checked',
    verify.extractNumbers('From 11/11/2026 to 11/17/2026, the total was 91,600', 'en').join(',') === '91,600',
    JSON.stringify(verify.extractNumbers('From 11/11/2026 to 11/17/2026, the total was 91,600', 'en'))
  );
  check(
    'a number with a space separator is ONE number',
    verify.extractNumbers('Total sales: 91 600', 'en').join(',') === '91 600',
    JSON.stringify(verify.extractNumbers('Total sales: 91 600', 'en'))
  );
  check(
    'a number with a non-breaking space is ONE number',
    verify.normaliseNumber(verify.extractNumbers('Total sales: 91\u00a0600', 'en')[0]) === '91600',
    JSON.stringify(verify.extractNumbers('Total sales: 91\u00a0600', 'en'))
  );
  check(
    'a non-breaking-hyphen date is not a number',
    verify.extractNumbers('From 2026\u201111\u201111 to 2026\u201111\u201117 we sold', 'en').length === 0,
    JSON.stringify(verify.extractNumbers('From 2026\u201111\u201111 to 2026\u201111\u201117 we sold', 'en'))
  );
  check(
    'a day of the month ("the 17th") is not a number',
    verify.extractNumbers('on the 17th we sold', 'en').length === 0
  );

  // ── 2. the comparison ─────────────────────────────────────────────────────
  section('The comparison with the tool results');
  const toolResults = [
    { today_sales: 1234.56, today_bills: 1, udhaar_due: 2500 },
    { products: [{ name: 'Verify Rice', stock_qty: 4, cost_price: 200 }, { name: 'Verify Sugar', stock_qty: 6, cost_price: 150 }] },
  ];
  const good = verify.verifyReply("Today's sale was 1,234.56 in 1 bill.", toolResults, 'en');
  check('a number from a tool result passes', good.ok === true, JSON.stringify(good.unverified));
  check('the matched number is reported', good.matched.length === 2, JSON.stringify(good.matched));

  const bad = verify.verifyReply("Today's sale was 9,999.", toolResults, 'en');
  check('an invented number is caught', bad.ok === false);
  check('the invented number is named', bad.unverified.includes('9,999'), JSON.stringify(bad.unverified));

  const rounded = verify.verifyReply('The sale was 1,235 (a rounded figure).', toolResults, 'en');
  check('a whole-unit rounding of a tool value passes', rounded.ok === true, JSON.stringify(rounded.unverified));

  const spaced = verify.verifyReply('The 7-day total was 91 600.', [{ total: 91600, days: 7 }], 'en');
  check('a space-separated figure matches the tool value', spaced.ok === true, JSON.stringify(spaced.unverified));

  const listLength = verify.verifyReply('There are 2 products.', toolResults, 'en');
  check('the length of a returned list counts as a number', listLength.ok === true, JSON.stringify(listLength.unverified));

  const urduBad = verify.verifyReply('آج ٩٩٩۹ روپے ہوئے۔', toolResults, 'ur');
  check('an invented Urdu number is caught', urduBad.ok === false, JSON.stringify(urduBad.unverified));
  const urduGood = verify.verifyReply('واجب اُدھار ٢٥٠٠ روپے ہے۔', toolResults, 'ur');
  check('a real Urdu number passes', urduGood.ok === true, JSON.stringify(urduGood.unverified));
  const urduMixed = verify.verifyReply('آج 2,500 روپے ہوئے۔', toolResults, 'ur');
  check('a real number in an Urdu answer (Latin digits) passes', urduMixed.ok === true, JSON.stringify(urduMixed.unverified));

  check('an empty tool result set verifies nothing', verify.verifyReply('We sold 10.', [], 'en').ok === false);

  // ── 3. the retry message ──────────────────────────────────────────────────
  section('The retry message');
  const marked = verify.markUnverified('We sold 9,999 and 4.', ['9,999'], 'en');
  check('the invented number is marked', marked.includes('<unverified>9,999</unverified>'), marked);
  check('the other number is not marked', !marked.includes('<unverified>4</unverified>'));
  const markedUrdu = verify.markUnverified('آج ٩۹۹۹ روپے', ['9999'], 'ur');
  check('the invented Urdu number is marked', markedUrdu.includes('<unverified>'), markedUrdu);
  const retry = verify.numberRetryMessage('We sold 9,999.', bad, 'en');
  check('the retry message carries the marked answer', retry.includes('<unverified>9,999</unverified>'));
  check('the retry message tells the model what to do', /tool/i.test(retry));
  check('the fallback message shows no figure', !/\d/.test(verify.unverifiedFallbackMessage('en')), verify.unverifiedFallbackMessage('en'));
  check('the fallback message exists in Urdu', verify.unverifiedFallbackMessage('ur').length > 10);
  check('the fallback message exists in Roman Urdu', verify.unverifiedFallbackMessage('roman').length > 10);

  // ── 4. the source line ────────────────────────────────────────────────────
  section('The source line');
  check('a tool maps to a source key', sources.sourceKeyFor('get_today_summary') === 'navigation.dashboard');
  check('an unknown tool has no source key', sources.sourceKeyFor('nope') === null);
  check('the source keys have no repeats', JSON.stringify(sources.sourceKeysFor(['get_today_summary', 'get_sales_range', 'get_top_products'])) === JSON.stringify(['navigation.dashboard', 'navigation.reports']));
  check('the source line reads the app\'s own page names', sources.sourceLineFor(['get_today_summary']) === 'Dashboard');
  check('the source line joins the pages', sources.sourceLineFor(['get_today_summary', 'get_low_stock']) === 'Dashboard · Inventory');
  check('no tool runs, no source line', sources.sourceLineFor([]) === '');
  const navKeys = ['dashboard', 'reports', 'inventory', 'udhaar', 'purchases', 'shifts', 'returns'];
  check('every navigation source key exists in the English file', navKeys.every((k) => !!en.navigation[k]), navKeys.filter((k) => !en.navigation[k]).join(','));
  check('every navigation source key exists in the Urdu file', navKeys.every((k) => !!ur.navigation[k]), navKeys.filter((k) => !ur.navigation[k]).join(','));
  check(
    'every source label has a translation in both files',
    ['help', 'navigation', 'guide'].every((k) => !!en.assistant.source[k] && !!ur.assistant.source[k])
  );

  // ── 5. the loop checks the answer ─────────────────────────────────────────
  section('The loop checks the answer (the real services)');
  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));
  const limits = { ...require('../dist/shared/assistant/limits.js').DEFAULT_ASSISTANT_LIMITS, maxTurns: 6 };

  const summary = await byName.get('get_today_summary').impl.execute(ctx, {});
  const dash = reports.dashboard();
  check('the summary really comes from the Dashboard service', summary.today_sales === Math.round(dash.today_sales * 100) / 100, `${summary.today_sales}`);

  // The model invents a number first, then answers correctly after the retry.
  const retryProvider = new MockProvider([
    {
      respond: (request, index) => {
        if (index === 0) {
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'get_today_summary', input: {} }],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        if (index === 1) {
          return {
            text: `Today's sale was 9,999 rupees.`,
            toolCalls: [],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'end_turn',
          };
        }
        return {
          text: `Today's sale was ${summary.today_sales} rupees.`,
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'end_turn',
        };
      },
    },
  ]);
  const retryRun = await runAgentTurn({
    adapter: retryProvider,
    model: 'the-model-from-the-setting',
    system: 'system',
    messages: [{ role: 'user', content: 'aaj ki sale?' }],
    tools: registry,
    executeTool: async (name, input) => byName.get(name).impl.execute(ctx, input),
    limits,
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
    language: 'en',
  });
  check('the invented number is caught', retryRun.numberRetries === 1, JSON.stringify(retryRun.numberRetries));
  check('the model is asked to fix it once', retryProvider.callCount === 3, String(retryProvider.callCount));
  check('the fixed answer is the one that is shown', retryRun.text.includes(String(summary.today_sales)), retryRun.text);
  check('the invented number is NOT in the shown answer', !retryRun.text.includes('9,999'), retryRun.text);
  check('the answer names its source', (retryRun.sources || []).includes('get_today_summary'), JSON.stringify(retryRun.sources));
  check('the final answer carries no unverified number', (retryRun.unverifiedNumbers || []).length === 0, JSON.stringify(retryRun.unverifiedNumbers));

  // The model keeps inventing: the figure never reaches the shop.
  const stubbornProvider = new MockProvider([
    {
      respond: (request, index) => {
        if (index === 0) {
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'get_today_summary', input: {} }],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          text: "Today's sale was 9,999 rupees.",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'end_turn',
        };
      },
    },
  ]);
  const stubbornRun = await runAgentTurn({
    adapter: stubbornProvider,
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'aaj ki sale?' }],
    tools: registry,
    executeTool: async (name, input) => byName.get(name).impl.execute(ctx, input),
    limits,
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
    language: 'en',
  });
  check('a stubborn model is asked exactly once more', stubbornProvider.callCount === 3, String(stubbornProvider.callCount));
  check('the invented figure is never shown', !stubbornRun.text.includes('9,999'), stubbornRun.text);
  check('the user gets the reason instead', /could not confirm|verify/i.test(stubbornRun.text), stubbornRun.text);
  check('the invented number is reported', (stubbornRun.unverifiedNumbers || []).includes('9,999'), JSON.stringify(stubbornRun.unverifiedNumbers));
  check('the retry count is reported', stubbornRun.numberRetries === 1, JSON.stringify(stubbornRun.numberRetries));

  // An answer with no numbers at all is never touched.
  const cleanProvider = new MockProvider([
    {
      respond: (request, index) => {
        if (index === 0) {
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'get_today_summary', input: {} }],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          text: 'The shop is open and the drawer is counted.',
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'end_turn',
        };
      },
    },
  ]);
  const cleanRun = await runAgentTurn({
    adapter: cleanProvider,
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'kaisa hai?' }],
    tools: registry,
    executeTool: async (name, input) => byName.get(name).impl.execute(ctx, input),
    limits,
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
    language: 'en',
  });
  check('an answer with no number is shown as it is', cleanRun.text === 'The shop is open and the drawer is counted.', cleanRun.text);
  check('an answer with no number is asked once, not twice', cleanProvider.callCount === 2, String(cleanProvider.callCount));
  check('an answer with no number has no unverified number', (cleanRun.unverifiedNumbers || []).length === 0);

  // The real number from the real service passes the check on its own.
  const realProvider = new MockProvider([
    {
      respond: (request, index) => {
        if (index === 0) {
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'get_today_summary', input: {} }],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          text: `Today's sale was ${summary.today_sales} rupees in ${summary.today_bills} bills.`,
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'end_turn',
        };
      },
    },
  ]);
  const realRun = await runAgentTurn({
    adapter: realProvider,
    model: 'm',
    system: 's',
    messages: [{ role: 'user', content: 'aaj ki sale?' }],
    tools: registry,
    executeTool: async (name, input) => byName.get(name).impl.execute(ctx, input),
    limits,
    budget: { spentUsd: 0, budgetUsd: 1 },
    dataLevel: 'full',
    language: 'en',
  });
  check('the real number from the real service passes', realRun.text.includes(String(summary.today_sales)), realRun.text);
  check('the real answer is not retried', realProvider.callCount === 2, String(realProvider.callCount));
  check('the real answer has no unverified number', (realRun.unverifiedNumbers || []).length === 0, JSON.stringify(realRun.unverifiedNumbers));

  // The numbers are checked against the REDACTED data the model was shown.
  check('the verified result is the data the model saw', Array.isArray(retryRun.verifiedAgainst) && retryRun.verifiedAgainst.length === 1);

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant number-verification checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
