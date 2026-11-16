#!/usr/bin/env node
/**
 * The proactive insights (item 11) — OPT-IN.
 *
 * The assistant may notice something on its own (a product that ran low, a
 * price below the cost, an overdue udhaar, an open shift) and offer to look
 * into it. The switch is OFF by default and the gate is checked BEFORE a
 * single fact is read.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/proactive.js      (the pure rules)
 *   dist/main/services/assistant/proactive.js (the service, over a migrated
 *                                                throwaway DB)
 *   dist/main/services/assistant/settings.js  (the switches)
 *   dist/main/services/inventory.js / reports.js / udhaar.js / shifts.js
 *                                                (the app's own numbers)
 *
 * No test ever reaches a real LLM — there is no provider call at all here.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_proactive.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-proactive-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-proactive.db');

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
  const proactive = require('../dist/shared/assistant/proactive.js');
  const proactiveService = require('../dist/main/services/assistant/proactive.js');
  const settingsService = require('../dist/main/services/assistant/settings.js');
  const inventory = require('../dist/main/services/inventory.js');
  const customers = require('../dist/main/services/customers.js');
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

  // ── 1. the pure rules ────────────────────────────────────────────────────
  section('The rules (pure)');
  const empty = proactive.buildProactiveSuggestions([], 'owner');
  check('no facts means no suggestions', empty.length === 0);

  const lowStock = proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 3 }], 'owner');
  check('a low stock fact becomes a suggestion', lowStock.length === 1);
  check('the suggestion knows the count', lowStock[0].values.count === 3);
  check('the suggestion has an id', lowStock[0].id === 'low_stock');
  check('the suggestion points at the page', lowStock[0].route === 'inventory');
  check('the suggestion asks a question', typeof lowStock[0].prompt === 'string' && lowStock[0].prompt.length > 0);
  check('the suggestion carries the i18n keys', lowStock[0].titleKey.startsWith('assistant.proactive.'));

  const zero = proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 0 }], 'owner');
  check('a fact with nothing in it says nothing', zero.length === 0);

  const cashierView = proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 3 }], 'cashier');
  check('a cashier never sees the profit suggestion', cashierView.length === 0);
  const managerView = proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 3 }], 'manager');
  check('a manager does see it', managerView.length === 1);
  check('an unknown role sees nothing', proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 3 }], 'ghost').length === 0);
  check('no role at all sees nothing', proactive.buildProactiveSuggestions([{ kind: 'low_stock', count: 3 }], null).length === 0);

  const both = proactive.buildProactiveSuggestions(
    [
      { kind: 'low_stock', count: 2 },
      { kind: 'overdue_customers', count: 1, amount: 500 },
    ],
    'owner'
  );
  check('two facts become two suggestions', both.length === 2);
  check('the warnings come first', both[0].severity === 'warning');
  check('the overdue suggestion keeps the amount', both[1].values.amount === 500);

  const shiftOpen = proactive.buildProactiveSuggestions([{ kind: 'shift_open', count: 1 }], 'cashier');
  check('an open shift is a suggestion', shiftOpen.length === 1 && shiftOpen[0].id === 'shift_open');
  const shiftMissing = proactive.buildProactiveSuggestions([{ kind: 'shift_missing', count: 1 }], 'cashier');
  check('a missing shift is a suggestion', shiftMissing.length === 1 && shiftMissing[0].id === 'shift_missing');
  check(
    'an open and a missing shift are never both shown',
    proactive.buildProactiveSuggestions(
      [{ kind: 'shift_open', count: 1 }, { kind: 'shift_missing', count: 0 }],
      'cashier'
    ).length === 1
  );

  const many = proactive.buildProactiveSuggestions(
    [
      { kind: 'low_stock', count: 1 },
      { kind: 'below_cost', count: 1 },
      { kind: 'overdue_customers', count: 1 },
      { kind: 'shift_open', count: 1 },
    ],
    'owner'
  );
  check('the list is capped', many.length <= proactive.MAX_PROACTIVE_SUGGESTIONS, String(many.length));
  check('the cap is three', proactive.MAX_PROACTIVE_SUGGESTIONS === 3);

  // ── 2. the switches (the opt-in) ─────────────────────────────────────────
  section('The switches (opt-in)');
  const defaultSettings = settingsService.getAssistantSettings();
  check('the proactive switch is OFF by default', defaultSettings.proactiveEnabled === false);
  check('the assistant is OFF by default too', defaultSettings.enabled === false);
  check('no suggestions while everything is off', proactiveService.getProactiveSuggestions().length === 0);

  settingsService.saveAssistantSettings({ enabled: true, proactiveEnabled: false });
  check('the assistant alone is not enough', proactiveService.getProactiveSuggestions().length === 0);
  settingsService.saveAssistantSettings({ enabled: false, proactiveEnabled: true });
  check('the proactive switch alone is not enough either', proactiveService.getProactiveSuggestions().length === 0);

  settingsService.saveAssistantSettings({ enabled: true, proactiveEnabled: true, roles: ['owner', 'manager'] });

  // ── 3. the real service (the app's own numbers) ──────────────────────────
  section('The service (the app\'s own numbers)');
  const facts = proactiveService.collectProactiveFacts();
  check('the facts are collected', Array.isArray(facts) && facts.length > 0);
  check(
    'every fact is a count',
    facts.every((f) => typeof f.kind === 'string' && Number.isFinite(Number(f.count)))
  );
  check(
    'no fact carries a row of data',
    facts.every((f) => Object.keys(f).every((k) => k === 'kind' || k === 'count' || k === 'amount'))
  );

  // A product that is low in stock (the app's own rule: stock <= threshold).
  const lowProduct = inventory.createProduct({
    name: 'Proactive Salt',
    cost_price: 20,
    sale_price: 30,
    stock_qty: 2,
    low_stock_threshold: 5,
  });
  check('the low stock product really exists', !!lowProduct && lowProduct.id > 0);
  const afterProduct = proactiveService.collectProactiveFacts();
  const lowFact = afterProduct.find((f) => f.kind === 'low_stock');
  check('the low stock fact counts the real product', lowFact && lowFact.count >= 1, String(lowFact && lowFact.count));

  // A product priced below its cost (the app's own rule).
  inventory.createProduct({
    name: 'Proactive Loss',
    cost_price: 100,
    sale_price: 80,
    stock_qty: 5,
  });
  const belowFact = proactiveService.collectProactiveFacts().find((f) => f.kind === 'below_cost');
  check('the below-cost fact counts the real product', belowFact && belowFact.count >= 1, String(belowFact && belowFact.count));

  const suggestions = proactiveService.getProactiveSuggestions();
  check('the suggestions come back', suggestions.length > 0);
  check('the low stock suggestion is there', suggestions.some((s) => s.id === 'low_stock'));
  check('the below-cost suggestion is there', suggestions.some((s) => s.id === 'below_cost'));
  check('every suggestion has its keys', suggestions.every((s) => s.titleKey && s.messageKey && s.prompt));
  check('the suggestions are counts, not rows', suggestions.every((s) => !('name' in s) && !('rows' in s)));

  // A role that may not use the assistant gets nothing.
  const cashier = auth.createUser({ username: 'proactive-cashier', pin: '9876', role: 'cashier' });
  auth.setSessionUser(cashier.id);
  check('a role outside the settings gets nothing', proactiveService.getProactiveSuggestions().length === 0);
  auth.setSessionUser(owner.user.id);
  check('the owner gets them again', proactiveService.getProactiveSuggestions().length > 0);

  // Nobody signed in — nothing.
  auth.setSessionUser(null);
  check('nobody signed in means nothing', proactiveService.getProactiveSuggestions().length === 0);
  auth.setSessionUser(owner.user.id);

  // ── 4. the renderer ──────────────────────────────────────────────────────
  section('The renderer (the panel shows them)');
  const panelSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/components/AssistantPanel.tsx'), 'utf8');
  check('the panel asks for the suggestions', panelSource.includes('window.api.assistant.proactive'));
  check('the panel renders them', panelSource.includes('assistant-suggestion'));
  check('a suggestion is tappable', panelSource.includes('send(suggestion.prompt)'));
  const preloadSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/preload/preload.ts'), 'utf8');
  check('the preload exposes the channel', preloadSource.includes("'assistant:proactive'"));
  const ipcSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/ipc.ts'), 'utf8');
  check('the main process answers the channel', ipcSource.includes("'assistant:proactive'"));

  // The strings are in BOTH languages.
  const enKeys = ['proactiveTitle', 'proactive'];
  check('the English strings are there', enKeys.every((k) => !!en.assistant[k]));
  const proactiveKeys = [
    'lowStockTitle',
    'lowStockBody',
    'belowCostTitle',
    'belowCostBody',
    'overdueTitle',
    'overdueBody',
    'shiftTitle',
    'shiftBody',
    'noShiftTitle',
    'noShiftBody',
  ];
  check('every proactive string is in English', proactiveKeys.every((k) => !!en.assistant.proactive[k]));
  check('every proactive string is in Urdu', proactiveKeys.every((k) => !!ur.assistant.proactive[k]));
  check('the Urdu strings use the same placeholders', proactiveKeys.every((k) => {
    const a = String(en.assistant.proactive[k]);
    const b = String(ur.assistant.proactive[k]);
    const placeholders = (text) => (text.match(/\{\{\w+\}\}/g) || []).sort().join(',');
    return placeholders(a) === placeholders(b);
  }));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant proactive-insight checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
