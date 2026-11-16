#!/usr/bin/env node
/**
 * The back-office actions (item 10).
 *
 * The assistant PROPOSES; the owner CONFIRMS. These five helpers write
 * through the app's OWN services — the customer's profile, the expense list,
 * the promotions, the stock and the product price — so there is never a second
 * way of changing the shop's books.
 *
 * Drives the REAL `dist` code:
 *   dist/main/services/assistant/toolImpls.js (the real tool implementations)
 *   dist/main/services/assistant/agent.js     (the turn runner + the confirm)
 *   dist/main/services/assistant/pending.js   (the waiting actions)
 *   dist/main/services/customers.js            (the customer service)
 *   dist/main/services/expenses.js             (the expense service)
 *   dist/main/services/promotions.js           (the promotion service)
 *   dist/main/services/inventory.js            (the product service)
 *   dist/shared/assistant/tools.js             (the registry + the role ladder)
 *
 * The provider is ALWAYS the MockProvider — no test ever reaches a real LLM.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistant_back_office.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-backoffice-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-backoffice.db');

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
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const agentService = require('../dist/main/services/assistant/agent.js');
  const pendingService = require('../dist/main/services/assistant/pending.js');
  const customerService = require('../dist/main/services/customers.js');
  const expenseService = require('../dist/main/services/expenses.js');
  const promotionService = require('../dist/main/services/promotions.js');
  const inventory = require('../dist/main/services/inventory.js');
  const activity = require('../dist/main/services/activity.js');

  await initDatabase();
  const owner = auth.login('admin', 'admin123');
  if (!owner.ok) throw new Error('could not sign in as the owner');

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

  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));
  const ctx = {
    user: { id: owner.user.id, username: owner.user.username, role: 'owner' },
    branchId: null,
    language: 'en',
    dataLevel: 'full',
    actionsEnabled: true,
    route: null,
  };

  // ── 1. the customer's discount ───────────────────────────────────────────
  section('The customer discount (the real customer service)');
  const created = customerService.saveCustomer({
    name: 'Discount Traders',
    phone: '03001234567',
    address: 'Main Road',
    credit_limit: 5000,
    opening_balance: 750,
    notes: 'a good customer',
    price_level: 'wholesale',
  });
  check('the test customer really exists', created.ok === true, created.message || '');
  const customerId = created.customer.id;
  const before = customerService.getCustomer(customerId);
  check('the customer starts without a discount', Number(before.default_discount_pct) === 0);

  const discountTool = byName.get('set_customer_discount');
  check('the set_customer_discount tool is registered', !!discountTool && discountTool.write === true);
  const discountResult = await discountTool.impl.execute(ctx, {
    customer: 'Discount Traders',
    discount: 12.5,
    discountType: 'percent',
  });
  check('the discount action succeeds', discountResult.ok === true);
  check('the action knows the customer', discountResult.customer_id === customerId);
  check('the action carries the discount', discountResult.discount === 12.5);

  const after = customerService.getCustomer(customerId);
  check('the discount is really saved', Number(after.default_discount_pct) === 12.5);
  check('the discount type is really saved', after.discount_type === 'percent');
  check('the NAME of the customer is untouched', after.name === 'Discount Traders');
  check('the PHONE of the customer is untouched', after.phone === '03001234567');
  check('the ADDRESS of the customer is untouched', after.address === 'Main Road');
  check('the CREDIT LIMIT is untouched', Number(after.credit_limit) === 5000);
  check('the NOTES are untouched', after.notes === 'a good customer');
  check('the PRICE LEVEL is untouched', after.price_level === 'wholesale');
  check('the BALANCE is untouched', Number(after.balance) === 750);
  const ledger = require('../dist/main/services/udhaar.js').getUdhaarLedger(customerId);
  check(
    'the OPENING BALANCE is still there',
    ledger.rows.some((r) => r.type === 'opening_balance' && Number(r.amount) === 750)
  );
  check(
    'the change is in the app\'s own activity log',
    activity.listActivity(50).some((row) => String(row.action).includes('customer_discount_changed'))
  );

  const discountPreview = await discountTool.impl.preview(ctx, { customer: 'Discount Traders', discount: 20 });
  check('the preview has a summary', typeof discountPreview.summary === 'string' && discountPreview.summary.includes('Discount Traders'));
  const discountDetail = discountPreview.details.find((d) => d.label === 'Discount');
  check('the preview shows the old discount', String(discountDetail.before).includes('12.5'), String(discountDetail.before));
  check('the preview shows the new discount', String(discountDetail.after).includes('20'), String(discountDetail.after));

  let discountFailed = '';
  try {
    await discountTool.impl.execute(ctx, { customer: 'No Such Customer', discount: 5 });
  } catch (e) {
    discountFailed = e instanceof Error ? e.message : String(e);
  }
  check('an unknown customer fails cleanly', discountFailed.length > 0, discountFailed);

  // A fixed amount is the app's "fixed" discount.
  const fixedResult = await discountTool.impl.execute(ctx, {
    customer: 'Discount Traders',
    discount: 50,
    discountType: 'amount',
  });
  check('a fixed discount action succeeds', fixedResult.ok === true);
  check('a fixed discount is saved as "fixed"', customerService.getCustomer(customerId).discount_type === 'fixed');
  check('a fixed discount keeps its value', Number(customerService.getCustomer(customerId).default_discount_pct) === 50);

  // ── 2. the expense draft ─────────────────────────────────────────────────
  section('The expense draft (the real expense service)');
  const categories = expenseService.listCategories(false);
  check('the shop has expense categories', categories.length > 0);
  const categoryName = categories[0].name;
  const expenseTool = byName.get('create_expense_draft');
  check('the create_expense_draft tool is registered', !!expenseTool && expenseTool.write === true);
  const expenseResult = await expenseTool.impl.execute(ctx, {
    amount: 450,
    category: categoryName,
    note: 'diesel for the generator',
    date: '2026-01-15',
  });
  check('the expense draft is saved', expenseResult.ok === true, expenseResult.message || '');
  const expense = expenseService.getExpense(expenseResult.expense_id);
  check('the expense really exists', !!expense);
  check('the amount is right', Number(expense.amount) === 450);
  check('the category is the one that was asked for', expense.category_name === categoryName);
  check('the note is the title', expense.title === 'diesel for the generator');
  check('the date is the one that was asked for', String(expense.expense_date).slice(0, 10) === '2026-01-15');
  check('a draft is PAUSED (it does not count yet)', expense.status === 'paused');
  const summary = expenseService.getExpenseSummary();
  check('a draft is not in the totals', summary.total === 0, String(summary.total));

  let expenseFailed = '';
  try {
    await expenseTool.impl.execute(ctx, { amount: 100, category: 'No Such Category' });
  } catch (e) {
    expenseFailed = e instanceof Error ? e.message : String(e);
  }
  check('an unknown category fails cleanly', expenseFailed.length > 0, expenseFailed);

  // ── 3. the promotion draft ───────────────────────────────────────────────
  section('The promotion draft (the real promotion service)');
  const product = inventory.createProduct({
    name: 'Promotion Soap',
    barcode: '0300999888777',
    cost_price: 60,
    sale_price: 100,
    stock_qty: 30,
  });
  const promotionTool = byName.get('create_promotion_draft');
  check('the create_promotion_draft tool is registered', !!promotionTool && promotionTool.write === true);
  const promotionResult = await promotionTool.impl.execute(ctx, {
    name: 'Soap Monday',
    product: 'Promotion Soap',
    percent: 15,
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
  });
  check('the promotion draft is saved', promotionResult.ok === true, promotionResult.message || '');
  const promotion = promotionService.listPromotions().find((p) => p.id === promotionResult.promotion_id);
  check('the promotion really exists', !!promotion);
  check('the promotion is INACTIVE (it is a draft)', Number(promotion.active) === 0);
  check('the promotion is for the right product', promotion.product_id === product.id);
  check('the promotion has the right percent', Number(promotion.discount_value) === 15);
  check('the promotion keeps its dates', String(promotion.start_date).slice(0, 10) === '2026-01-01');

  let promotionFailed = '';
  try {
    await promotionTool.impl.execute(ctx, { name: 'No Product', percent: 10 });
  } catch (e) {
    promotionFailed = e instanceof Error ? e.message : String(e);
  }
  check('a promotion without a product fails cleanly', promotionFailed.length > 0, promotionFailed);

  // ── 4. the stock adjustment ──────────────────────────────────────────────
  section('The stock adjustment (the real inventory service)');
  const stockTool = byName.get('stock_adjustment');
  check('the stock_adjustment tool is registered', !!stockTool && stockTool.write === true);
  check('the stock adjustment is a DANGEROUS action', stockTool.risk === 'dangerous');
  const stockResult = await stockTool.impl.execute(ctx, {
    product: 'Promotion Soap',
    changeQty: 5,
    reason: 'physical count',
  });
  check('the stock adjustment succeeds', stockResult.ok === true, stockResult.message || '');
  check('the old stock is reported', stockResult.old_stock === 30);
  check('the new stock is reported', stockResult.new_stock === 35);
  check('the stock really changed', Number(inventory.getProduct(product.id).stock_qty) === 35);
  check(
    'the movement is recorded',
    inventory.listMovements(product.id).some((m) => Number(m.change_qty) === 5 && m.reason === 'physical count')
  );

  let reasonFailed = '';
  try {
    await stockTool.impl.execute(ctx, { product: 'Promotion Soap', changeQty: 5, reason: '' });
  } catch (e) {
    reasonFailed = e instanceof Error ? e.message : String(e);
  }
  check('a stock change without a reason fails cleanly', reasonFailed.length > 0, reasonFailed);
  check('the refused change did NOT touch the stock', Number(inventory.getProduct(product.id).stock_qty) === 35);

  // ── 5. the price change ──────────────────────────────────────────────────
  section('The price change (the real product service)');
  const priceTool = byName.get('update_product_price');
  check('the update_product_price tool is registered', !!priceTool && priceTool.write === true);
  check('the price change is a DANGEROUS action', priceTool.risk === 'dangerous');
  const priceResult = await priceTool.impl.execute(ctx, {
    product: 'Promotion Soap',
    salePrice: 120,
    costPrice: 70,
  });
  check('the price change succeeds', priceResult.ok === true, priceResult.message || '');
  const changed = inventory.getProduct(product.id);
  check('the sale price really changed', Number(changed.sale_price) === 120);
  check('the cost price really changed', Number(changed.cost_price) === 70);
  check('the NAME of the product is untouched', changed.name === 'Promotion Soap');
  check('the BARCODE of the product is untouched', changed.barcode === '0300999888777');
  check('the STOCK of the product is untouched', Number(changed.stock_qty) === 35);

  const pricePreview = await priceTool.impl.preview(ctx, { product: 'Promotion Soap', salePrice: 130 });
  const saleDetail = pricePreview.details.find((d) => d.label === 'Sale price');
  check('the preview shows the old sale price', String(saleDetail.before).includes('120'), String(saleDetail.before));
  check('the preview shows the new sale price', String(saleDetail.after).includes('130'), String(saleDetail.after));

  let priceFailed = '';
  try {
    await priceTool.impl.execute(ctx, { product: 'Promotion Soap' });
  } catch (e) {
    priceFailed = e instanceof Error ? e.message : String(e);
  }
  check('a price change without a price fails cleanly', priceFailed.length > 0, priceFailed);
  check('the refused price change did NOT touch the price', Number(inventory.getProduct(product.id).sale_price) === 120);

  // ── 6. the whole flow: propose → wait → confirm → the real service ran ───
  section('The whole flow (propose, wait, confirm)');
  const pendingRow = pendingService.createPendingAction({
    tool: 'update_product_price',
    args: { product: 'Promotion Soap', salePrice: 140 },
    risk: 'dangerous',
    preview: { summary: 'Change the price of "Promotion Soap"' },
    userId: owner.user.id,
    username: owner.user.username,
  });
  check('the action waits for the owner', pendingRow.status === 'pending');
  check('the price did NOT change yet', Number(inventory.getProduct(product.id).sale_price) === 120);
  const confirmed = await agentService.confirmAssistantAction(pendingRow.id);
  check('the confirmation succeeds', confirmed.ok === true, confirmed.message || '');
  check('the price changed after the confirmation', Number(inventory.getProduct(product.id).sale_price) === 140);
  check('the action is confirmed', pendingService.getPendingAction(pendingRow.id).status === 'confirmed');

  // ── 7. the role ladder ───────────────────────────────────────────────────
  section('The role ladder (a cashier may not do any of this)');
  const backOffice = [
    'set_customer_discount',
    'create_expense_draft',
    'create_promotion_draft',
    'stock_adjustment',
    'update_product_price',
  ];
  for (const name of backOffice) {
    const tool = byName.get(name);
    check(`${name} is refused for a cashier`, toolsModule.toolAllowedForRole(tool, 'cashier') === false);
    check(`${name} is allowed for a manager`, toolsModule.toolAllowedForRole(tool, 'manager') === true);
  }

  // A cashier may not confirm it either — even if the action is already waiting.
  const cashier = auth.createUser({ username: 'backoffice-cashier', pin: '4321', role: 'cashier' });
  const cashierRow = pendingService.createPendingAction({
    tool: 'stock_adjustment',
    args: { product: 'Promotion Soap', changeQty: 100, reason: 'a cashier tried' },
    risk: 'dangerous',
    userId: owner.user.id,
    username: owner.user.username,
  });
  auth.setSessionUser(cashier.id);
  const cashierConfirm = await agentService.confirmAssistantAction(cashierRow.id);
  check('a cashier may NOT confirm a back-office action', cashierConfirm.ok === false, cashierConfirm.message || '');
  check('the stock did NOT change', Number(inventory.getProduct(product.id).stock_qty) === 35);
  auth.setSessionUser(owner.user.id);

  // ── 8. the tools are the app's own ───────────────────────────────────────
  section('The tools write through the app\'s own services');
  const implSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/services/assistant/toolImpls.ts'), 'utf8');
  check('the customer discount uses the customer service', implSource.includes('saveCustomer('));
  check('the expense draft uses the expense service', implSource.includes('createExpense('));
  check('the promotion draft uses the promotion service', implSource.includes('createPromotion('));
  check('the stock adjustment uses the inventory service', implSource.includes('adjustStock('));
  check('the price change uses the product service', implSource.includes('updateProduct('));
  check('there is no second SQL for the shop\'s books', !/INSERT INTO customers|UPDATE customers SET/i.test(implSource));

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant back-office checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
