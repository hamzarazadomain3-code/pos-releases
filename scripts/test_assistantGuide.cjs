#!/usr/bin/env node
/**
 * The guide mode ("dikha do") — the guides, the FAQ and the help search.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/guides.js  (the guide catalogue + the step machine)
 *   dist/shared/assistant/faq.js     (the FAQ)
 *   dist/shared/assistant/search.js  (the in-app help search)
 *   dist/main/services/assistant/toolImpls.js (the real `search_help`,
 *                                                 `start_guide` and `highlight`)
 *
 * The provider is ALWAYS the MockProvider — no test ever reaches a real LLM,
 * and the search needs no network at all.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantGuide.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-guide-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-guide.db');

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
  const guides = require('../dist/shared/assistant/guides.js');
  const faq = require('../dist/shared/assistant/faq.js');
  const search = require('../dist/shared/assistant/search.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const en = require('../src/renderer/src/i18n/en.json');
  const ur = require('../src/renderer/src/i18n/ur.json');

  await initDatabase();

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    check('no real network call was attempted', false, 'global fetch was called');
    throw new Error('NETWORK CALL IN TEST');
  };

  // ── 1. the guides ────────────────────────────────────────────────────────
  section('The guides');
  check('there are guides', guides.GUIDES.length >= 5, String(guides.GUIDES.length));
  check('every guide has an id', guides.GUIDES.every((g) => typeof g.id === 'string' && g.id.length > 2));
  check('every guide id is unique', new Set(guides.GUIDES.map((g) => g.id)).size === guides.GUIDES.length);
  check('every guide has a title in both languages', guides.GUIDES.every((g) => g.title && g.titleUr));
  check('every guide has a route', guides.GUIDES.every((g) => typeof g.route === 'string' && g.route.length > 0));
  check('every guide has at least two steps', guides.GUIDES.every((g) => g.steps.length >= 2));
  check('every guide has keywords', guides.GUIDES.every((g) => g.keywords.length > 0));
  check('every step has an id, an anchor and both texts', guides.GUIDES.every((g) => g.steps.every((s) => s.id && s.anchor && s.title && s.titleUr && s.body && s.bodyUr)));
  const stepIds = guides.GUIDES.flatMap((g) => g.steps.map((s) => s.id));
  check('the step ids are unique inside a guide', guides.GUIDES.every((g) => new Set(g.steps.map((s) => s.id)).size === g.steps.length), String(stepIds.length));
  check('every guide is found by its id', guides.GUIDES.every((g) => guides.guideById(g.id) === g));
  check('an unknown guide id finds nothing', guides.guideById('nope') === undefined);
  check('the guides of a page are found', guides.guidesForRoute('billing').length >= 1);
  check('a page with no guide returns none', guides.guidesForRoute('not-a-page').length === 0);
  check('no guide returns none', guides.guidesForRoute(null).length === 0);

  // The text of a step follows the shop's language.
  const firstGuide = guides.GUIDES[0];
  const firstStep = firstGuide.steps[0];
  check('the step text is English by default', guides.stepText(firstStep, 'en').title === firstStep.title);
  check('the step text is Urdu for the Urdu shop', guides.stepText(firstStep, 'ur').title === firstStep.titleUr);
  check('the guide title follows the language', guides.guideTitle(firstGuide, 'ur') === firstGuide.titleUr);

  // ── 2. the step machine ──────────────────────────────────────────────────
  section('The step machine');
  const guide = guides.guideById('make_a_bill');
  check('the guide of the test exists', !!guide);
  let state = guides.INITIAL_GUIDE_STATE;
  check('the machine starts with no guide', state.guideId === null && state.stepIndex === 0 && state.done === false);
  state = guides.guideReducer(state, { type: 'start', guideId: 'make_a_bill' });
  check('the guide starts at the first step', state.guideId === 'make_a_bill' && state.stepIndex === 0 && state.done === false);
  check('the current step is the first one', guides.currentStep(state).id === guide.steps[0].id);
  state = guides.guideReducer(state, { type: 'next' });
  check('next moves one step on', state.stepIndex === 1);
  state = guides.guideReducer(state, { type: 'next' });
  state = guides.guideReducer(state, { type: 'next' });
  check('the last step is still a step', state.stepIndex === guide.steps.length - 1 && state.done === false);
  state = guides.guideReducer(state, { type: 'next' });
  check('one step past the end finishes the guide', state.done === true, JSON.stringify(state));
  check('a finished guide shows no step', guides.currentStep(state) === null);
  state = guides.guideReducer(state, { type: 'prev' });
  check('prev comes back from the end', state.stepIndex === guide.steps.length - 1 && state.done === false);
  state = guides.guideReducer(state, { type: 'prev' });
  check('prev walks backwards', state.stepIndex === guide.steps.length - 2);
  state = guides.guideReducer(state, { type: 'goto', stepIndex: 0 });
  check('goto jumps to a step', state.stepIndex === 0);
  state = guides.guideReducer(state, { type: 'goto', stepIndex: 99 });
  check('goto never walks past the last step', state.stepIndex === guide.steps.length - 1);
  state = guides.guideReducer(state, { type: 'goto', stepIndex: -5 });
  check('goto never walks before the first step', state.stepIndex === 0);
  state = guides.guideReducer(state, { type: 'prev' });
  check('prev never walks before the first step', state.stepIndex === 0);
  state = guides.guideReducer(state, { type: 'stop' });
  check('stop clears the guide', state.guideId === null && state.stepIndex === 0 && state.done === false);
  check('the step count is the number of steps', guides.stepCount({ guideId: 'make_a_bill', stepIndex: 0, done: false }) === guide.steps.length);
  check('no guide means no steps', guides.stepCount(guides.INITIAL_GUIDE_STATE) === 0);
  check('starting an unknown guide ends it', guides.guideReducer(guides.INITIAL_GUIDE_STATE, { type: 'start', guideId: 'nope' }).guideId === null);

  // ── 3. the FAQ ───────────────────────────────────────────────────────────
  section('The FAQ');
  check('there are FAQ entries', faq.FAQ.length >= 8, String(faq.FAQ.length));
  check('every entry has an id', faq.FAQ.every((f) => typeof f.id === 'string' && f.id.length > 2));
  check('every entry id is unique', new Set(faq.FAQ.map((f) => f.id)).size === faq.FAQ.length);
  check('every entry has a question and an answer in both languages', faq.FAQ.every((f) => f.question && f.answer && f.questionUr && f.answerUr));
  check('every entry has keywords', faq.FAQ.every((f) => f.keywords.length > 0));
  check('an entry is found by its id', faq.faqById(faq.FAQ[0].id) === faq.FAQ[0]);
  check('an unknown entry id finds nothing', faq.faqById('nope') === undefined);

  // ── 4. the help search ───────────────────────────────────────────────────
  section('The in-app help search');
  const billResults = search.searchHelp('how do I make a bill');
  check('the search finds the bill guide', billResults.some((r) => r.id === 'make_a_bill'), JSON.stringify(billResults.map((r) => r.id)));
  check('the guides come before the FAQ', billResults.length > 0 && billResults[0].kind === 'guide');
  check('the result carries the steps', (billResults.find((r) => r.id === 'make_a_bill') || {}).steps?.length > 0);
  check('the result carries the page', (billResults.find((r) => r.id === 'make_a_bill') || {}).route === 'billing');

  const romanResults = search.searchHelp('bill banane ka tareeqa kya hai');
  check('Roman Urdu finds the bill guide too', romanResults.some((r) => r.id === 'make_a_bill'), JSON.stringify(romanResults.map((r) => r.id)));

  const udhaarResults = search.searchHelp('udhaar kaise dete hain');
  check('Roman Urdu finds the udhaar guide', udhaarResults.some((r) => r.id === 'give_udhaar'), JSON.stringify(udhaarResults.map((r) => r.id)));

  const productResults = search.searchHelp('new product add karna hai');
  check('the search finds the product guide', productResults.some((r) => r.id === 'add_a_product'), JSON.stringify(productResults.map((r) => r.id)));

  const faqResults = search.searchHelp('change the shop name and logo');
  check('the search finds the FAQ entry', faqResults.some((r) => r.id === 'change_the_shop_name'), JSON.stringify(faqResults.map((r) => r.id)));

  check('an empty question finds nothing', search.searchHelp('').length === 0);
  check('a question about nothing finds nothing', search.searchHelp('quantum chromodynamics').length === 0);
  check('the result list is capped', search.searchHelp('bill product customer discount price stock', { limit: 3 }).length <= 3);
  check('the tokenizer drops the punctuation', JSON.stringify(search.tokenize('Hello, world!')) === '["hello","world"]');
  check('the tokenizer keeps the Urdu words', search.tokenize('بل بنائیں').length === 2);
  check('the tokenizer drops the one-letter words', search.tokenize('a bill').length === 1);

  // ── 5. the real tools ────────────────────────────────────────────────────
  section('The tools (the real implementations)');
  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));
  const ctx = {
    user: { id: 1, username: 'admin', role: 'owner' },
    branchId: null,
    language: 'en',
    dataLevel: 'aggregates',
    actionsEnabled: false,
    route: 'billing',
  };

  check('the search_help tool is registered', byName.has('search_help'));
  check('the start_guide tool is registered', byName.has('start_guide'));
  check('the highlight tool is registered', byName.has('highlight'));

  const helpResult = await byName.get('search_help').impl.execute(ctx, { query: 'how do I make a bill' });
  check('the search_help tool finds the guide', helpResult.found === true);
  check('the search_help tool returns the steps', (helpResult.results[0] || {}).steps?.length > 0);
  check('the search_help tool returns the page', (helpResult.results[0] || {}).route === 'billing');
  const helpEmpty = await byName.get('search_help').impl.execute(ctx, { query: '' });
  check('the search_help tool refuses an empty question', helpEmpty.found === false);
  const helpNothing = await byName.get('search_help').impl.execute(ctx, { query: 'quantum chromodynamics' });
  check('the search_help tool says when it finds nothing', helpNothing.found === false);

  const guideResult = await byName.get('start_guide').impl.execute(ctx, { guideId: 'make_a_bill' });
  check('the start_guide tool returns the guide', guideResult.ok === true && guideResult.guideId === 'make_a_bill');
  check('the start_guide tool returns every step', guideResult.steps.length === guides.guideById('make_a_bill').steps.length);
  check('every step carries its anchor', guideResult.steps.every((s) => typeof s.anchor === 'string' && s.anchor.length > 0));
  const guideMissing = await byName.get('start_guide').impl.execute(ctx, { guideId: 'nope' });
  check('the start_guide tool refuses an unknown guide', guideMissing.ok === false);
  check('the start_guide tool lists the real guides', (guideMissing.available || []).length === guides.GUIDES.length);

  const highlight = await byName.get('highlight').impl.execute(ctx, { elementId: 'billing.search' });
  check('the highlight tool answers with the element', highlight.ok === true && highlight.elementId === 'billing.search');

  // ── 6. the anchors exist in the app ──────────────────────────────────────
  section('The anchors (the controls the steps point at)');
  const fs2 = fs;
  const appSource = fs2.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/App.tsx'), 'utf8');
  check('every nav button carries its anchor', appSource.includes('data-guide-id={`nav.${item.route}`}'));
  const billingSource = fs2.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/pages/Billing.tsx'), 'utf8');
  check('the billing search carries its anchor', billingSource.includes('data-guide-id="billing.search"'));
  check('the billing cart carries its anchor', billingSource.includes('data-guide-id="billing.cart"'));
  check('the billing payment carries its anchor', billingSource.includes('data-guide-id="billing.payment"'));
  const inventorySource = fs2.readFileSync(path.join(PROJECT_ROOT, 'src/renderer/src/pages/Inventory.tsx'), 'utf8');
  check('the add-product button carries its anchor', inventorySource.includes('data-guide-id="inventory.add"'));
  check('the product form carries its anchors', inventorySource.includes('data-guide-id="inventory.form.name"'));

  // The anchors the guides use are the ones the app really has (the nav
  // anchor covers every page).
  const anchors = new Set();
  for (const g of guides.GUIDES) for (const s of g.steps) anchors.add(s.anchor);
  const known = [
    'nav.billing', 'nav.inventory', 'nav.udhaar', 'nav.shifts', 'nav.returns', 'nav.dashboard',
    'billing.search', 'billing.cart', 'billing.customer', 'billing.payment', 'billing.shift',
    'inventory.add', 'inventory.form.name', 'inventory.form.quantity', 'inventory.form.save',
    'udhaar.new', 'udhaar.form.details', 'modal.save',
    'returns.list', 'returns.items', 'dashboard.today', 'dashboard.cards',
  ];
  const unknownAnchors = [...anchors].filter((a) => !known.includes(a));
  check('every anchor the guides use is a known one', unknownAnchors.length === 0, JSON.stringify(unknownAnchors));

  // Every anchor the guides use really exists in the app's own source.
  const sources = {
    'nav.billing': ['src/renderer/src/App.tsx'],
    'billing.search': ['src/renderer/src/pages/Billing.tsx'],
    'billing.cart': ['src/renderer/src/pages/Billing.tsx'],
    'billing.customer': ['src/renderer/src/pages/Billing.tsx'],
    'billing.payment': ['src/renderer/src/pages/Billing.tsx'],
    'billing.shift': ['src/renderer/src/pages/Billing.tsx'],
    'inventory.add': ['src/renderer/src/pages/Inventory.tsx'],
    'inventory.form.name': ['src/renderer/src/pages/Inventory.tsx'],
    'inventory.form.quantity': ['src/renderer/src/pages/Inventory.tsx'],
    'inventory.form.save': ['src/renderer/src/pages/Inventory.tsx'],
    'udhaar.new': ['src/renderer/src/pages/Udhaar.tsx'],
    'udhaar.form.details': ['src/renderer/src/components/UdhaarCustomerModal.tsx'],
    'modal.save': ['src/renderer/src/components/ModalShell.tsx'],
    'returns.list': ['src/renderer/src/pages/Returns.tsx'],
    'returns.items': ['src/renderer/src/pages/Returns.tsx'],
    'dashboard.today': ['src/renderer/src/pages/Dashboard.tsx'],
    'dashboard.cards': ['src/renderer/src/pages/Dashboard.tsx'],
  };
  const missingAnchors = [];
  for (const anchor of anchors) {
    const files = sources[anchor];
    if (!files) continue;
    const found = files.some((f) =>
      fs2.readFileSync(path.join(PROJECT_ROOT, f), 'utf8').includes(`data-guide-id="${anchor}"`)
    );
    if (!found) missingAnchors.push(anchor);
  }
  check('every anchor the guides use exists in the app', missingAnchors.length === 0, JSON.stringify(missingAnchors));

  // ── 7. the i18n ──────────────────────────────────────────────────────────
  section('The translations');
  check('the guide overlay has its strings in English', ['close', 'done', 'next', 'back', 'openPage', 'missingTarget'].every((k) => !!en.assistant.guide[k]));
  check('the guide overlay has its strings in Urdu', ['close', 'done', 'next', 'back', 'openPage', 'missingTarget'].every((k) => !!ur.assistant.guide[k]));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant guide-mode checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
