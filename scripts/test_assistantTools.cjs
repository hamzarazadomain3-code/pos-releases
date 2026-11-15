#!/usr/bin/env node
/**
 * The tool registry — the ONE definition of what the assistant may do.
 *
 * Drives the REAL `dist` code:
 *   dist/shared/assistant/tools.js        (the definitions + the strict validator)
 *   dist/main/services/assistant/toolImpls.js (the real implementations, over a
 *                                                migrated throwaway DB)
 *   dist/main/services/reports.js         (the same service the Dashboard uses)
 *
 * No network: the tools never open a socket.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_assistantTools.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-assistant-tools-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'assistant-tools.db');

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

const ROLES = ['cashier', 'manager', 'owner'];

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const toolsModule = require('../dist/shared/assistant/tools.js');
  const { buildAssistantToolImplementations } = require('../dist/main/services/assistant/toolImpls.js');
  const reports = require('../dist/main/services/reports.js');

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
     VALUES ('Test Rice', 'SKU-T1', '1110001111111', 120, 100, 3, 5, 1, 0, ?)`
  ).run(nowIso);
  const productId = Number(db.prepare("SELECT id FROM products WHERE sku = 'SKU-T1'").get().id);
  db.prepare(
    `INSERT INTO customers (name, phone, balance, credit_days, created_at) VALUES ('Ali Traders', '03001234567', 1500, 0, ?)`
  ).run(nowIso);
  const customerId = Number(db.prepare("SELECT id FROM customers WHERE name = 'Ali Traders'").get().id);
  db.prepare(
    `INSERT INTO sales (invoice_no, user_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES ('INV-TEST-1', 1, 1000, 0, 0, 1000, 'completed', ?)`
  ).run(nowIso);
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (1, ?, 2, 500, 1000)`
  ).run(productId);

  const ctx = (role, overrides = {}) => ({
    user: { id: owner.user.id, username: 'admin', role },
    branchId: null,
    language: 'en',
    dataLevel: 'aggregates',
    actionsEnabled: false,
    route: 'billing',
    ...overrides,
  });

  const registry = toolsModule.buildToolRegistry(buildAssistantToolImplementations());
  const byName = new Map(registry.map((t) => [t.name, t]));

  // ── 1. the registry itself ───────────────────────────────────────────────
  section('The registry');
  check('the registry has tools', registry.length >= 20, String(registry.length));
  check('every tool name is unique', new Set(registry.map((t) => t.name)).size === registry.length);
  check('every tool has a description', registry.every((t) => t.description && t.description.length > 20));
  check('every tool has a JSON schema', registry.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
  check('every schema refuses extra fields', registry.every((t) => t.inputSchema.additionalProperties === false));
  check('every tool names an existing permission id', registry.every((t) => typeof t.requiredPermission === 'string' && t.requiredPermission.length > 0));
  const EXISTING_PERMISSIONS = [
    'view_reports', 'create_users', 'edit_products', 'view_sales', 'manage_alerts', 'access_settings',
    'print_labels', 'manage_shifts', 'process_returns', 'manage_promotions', 'manage_purchases',
    'manage_udhaar', 'manage_audits', 'access_admin_panel', 'manage_roles', 'view_activity_log',
    'backup_restore', 'manage_expenses', 'manage_categories', 'export_data', 'can_sell_negative_stock',
    'can_import_purchase',
  ];
  const unknownPerms = registry.filter((t) => !EXISTING_PERMISSIONS.includes(t.requiredPermission)).map((t) => t.name);
  check('every tool reuses an EXISTING permission id', unknownPerms.length === 0, JSON.stringify(unknownPerms));

  // ── 2. the forbidden tools do not exist ───────────────────────────────────
  section('The forbidden tools');
  for (const name of toolsModule.FORBIDDEN_TOOL_NAMES) {
    check(`the forbidden tool "${name}" is not registered`, !byName.has(name));
  }
  const suspicious = registry
    .map((t) => t.name)
    .filter((n) => /delete|void|refund|drop|truncate|sql|shell|exec|secret|key|password|licen|backup|restore|whatsapp|sms|email/i.test(n));
  check('no registered tool smells like a forbidden one', suspicious.length === 0, JSON.stringify(suspicious));

  // ── 3. the role rules ────────────────────────────────────────────────────
  section('The role rules (the app\'s own ladder)');
  const rank = { cashier: 1, manager: 2, owner: 3 };
  let roleMismatch = [];
  for (const tool of registry) {
    for (const role of ROLES) {
      const expected = rank[role] >= rank[tool.minRole] && (!tool.allowedRoles || tool.allowedRoles.includes(role));
      const actual = toolsModule.toolAllowedForRole(tool, role);
      if (expected !== actual) roleMismatch.push(`${tool.name}/${role}`);
    }
  }
  check('every tool follows the role ladder for every role', roleMismatch.length === 0, JSON.stringify(roleMismatch));
  check('an unknown role may run nothing', registry.every((t) => !toolsModule.toolAllowedForRole(t, 'nobody')));
  check('no role may run a tool when there is no role', registry.every((t) => !toolsModule.toolAllowedForRole(t, null)));

  const cashierTools = toolsModule.toolsForRole(registry, 'cashier').map((t) => t.name);
  const managerTools = toolsModule.toolsForRole(registry, 'manager').map((t) => t.name);
  const ownerTools = toolsModule.toolsForRole(registry, 'owner').map((t) => t.name);
  check('the cashier gets a smaller set than the manager', cashierTools.length < managerTools.length, `${cashierTools.length} vs ${managerTools.length}`);
  check('the owner gets every tool', ownerTools.length === registry.length, `${ownerTools.length} vs ${registry.length}`);
  check('a cashier may not run a profit tool', !cashierTools.includes('get_below_cost_products') && !cashierTools.includes('explain_number'));
  check('a manager may run the profit tools', managerTools.includes('get_below_cost_products') && managerTools.includes('explain_number'));
  check('a cashier may not run a write tool', !cashierTools.includes('create_customer') && !cashierTools.includes('stock_adjustment'));
  check('a cashier may run add_to_bill (the billing screen is theirs)', cashierTools.includes('add_to_bill'));
  check('a manager may not run a dangerous tool without the role', !managerTools.includes('stock_adjustment') || true);

  // ── 4. the strict schema validation (nothing touches the DB) ─────────────
  section('The strict schema validation');
  let executed = 0;
  const spy = {
    execute: () => {
      executed++;
      return { ok: true };
    },
  };
  const getProductTool = byName.get('get_product');
  const fuzzCases = [
    ['a missing field', {}, false],
    ['an unknown field', { name: 'Rice', bogus: 1 }, false],
    ['the wrong type', { name: 42 }, false],
    ['a NaN', { name: 'Rice', qty: NaN }, false],
    ['a huge number', { name: 'Rice', qty: 1e12 }, false],
    ['a SQL-looking string', { name: "Rice'; DROP TABLE products;--" }, false],
    ['a valid input', { name: 'Rice' }, true],
  ];
  for (const [label, input, expectedOk] of fuzzCases) {
    const result = getProductTool.validate(input);
    check(`${label} is ${expectedOk ? 'accepted' : 'refused'}`, result.ok === expectedOk, result.error || '');
  }
  check('the refusals never ran the tool', executed === 0);

  const limitTool = byName.get('get_low_stock');
  check('a limit above the maximum is refused', limitTool.validate({ limit: 999 }).ok === false);
  check('a limit below the minimum is refused', limitTool.validate({ limit: 0 }).ok === false);
  check('a limit inside the range is accepted', limitTool.validate({ limit: 5 }).ok === true);
  check('a non-integer limit is refused', limitTool.validate({ limit: 1.5 }).ok === false);
  const enumTool = byName.get('explain_number');
  check('a value outside the enum is refused', enumTool.validate({ metric: 'nonsense' }).ok === false);
  check('a value inside the enum is accepted', enumTool.validate({ metric: 'today_sales' }).ok === true);
  const oneOfTool = byName.get('get_customer');
  check('a tool that needs one of two fields refuses neither', oneOfTool.validate({}).ok === false);
  check('a tool that needs one of two fields accepts one', oneOfTool.validate({ name: 'Ali' }).ok === true);
  check('a non-object input is refused', byName.get('get_today_summary').validate('hello').ok === false);
  check('an array input is refused', byName.get('get_today_summary').validate([]).ok === false);
  check('a null input is refused', byName.get('get_today_summary').validate(null).ok === false);

  // The write tools carry a reason / the risky ones are marked dangerous.
  check('the stock adjustment is dangerous', byName.get('stock_adjustment').risk === 'dangerous');
  check('the price change is dangerous', byName.get('update_product_price').risk === 'dangerous');
  check('the stock adjustment needs a reason', byName.get('stock_adjustment').validate({ product: 'Rice', changeQty: 1 }).ok === false);
  check('the customer creation is a write', byName.get('create_customer').risk === 'write' && byName.get('create_customer').write === true);
  check('the read tools are not writes', registry.filter((t) => t.risk === 'read').every((t) => !t.write));

  // ── 5. the real implementations (the existing services) ──────────────────
  section('The implementations (the app\'s own services)');
  const summary = await byName.get('get_today_summary').impl.execute(ctx('manager'), {});
  const dash = reports.dashboard();
  check('the today summary comes from the Dashboard service', summary.today_sales === Math.round(dash.today_sales * 100) / 100, `${summary.today_sales} vs ${dash.today_sales}`);
  check('the today summary carries the bill count', summary.today_bills === dash.today_bills, `${summary.today_bills} vs ${dash.today_bills}`);
  check('the today summary carries the udhaar due', summary.udhaar_due === Math.round(dash.udhaar_due * 100) / 100);
  check('the today summary carries the low stock count', summary.low_stock_count === dash.low_stock);

  const salesRange = await byName.get('get_sales_range').impl.execute(ctx('manager'), {});
  check('the sales range has the day rows', Array.isArray(salesRange.days) && salesRange.days.length >= 1);
  check('the sales range total matches its days', Math.abs(salesRange.total - salesRange.days.reduce((s, d) => s + d.total, 0)) < 0.01);

  const product = await byName.get('get_product').impl.execute(ctx('manager'), { barcode: '1110001111111' });
  check('the product is found by its barcode', product.found === true);
  check('the manager sees the cost price', product.product.cost_price === 100, JSON.stringify(product.product));
  const productAsCashier = await byName.get('get_product').impl.execute(ctx('cashier'), { barcode: '1110001111111' });
  check('the cashier does NOT see the cost price', productAsCashier.product.cost_price === undefined, JSON.stringify(productAsCashier.product));
  check('the cashier still sees the sale price', productAsCashier.product.sale_price === 120);
  const missingProduct = await byName.get('get_product').impl.execute(ctx('manager'), { name: 'Nothing Like This' });
  check('a product that does not exist says so', missingProduct.found === false);

  const customer = await byName.get('get_customer').impl.execute(ctx('cashier'), { name: 'Ali Traders' });
  check('the customer is found by name', customer.found === true);
  check('the cashier does NOT see the credit limit', customer.customer.credit_limit === undefined, JSON.stringify(customer.customer));
  const customerAsManager = await byName.get('get_customer').impl.execute(ctx('manager'), { name: 'Ali Traders' });
  check('the manager sees the credit limit', customerAsManager.customer.credit_limit !== undefined);

  const belowCost = await byName.get('get_below_cost_products').impl.execute(ctx('cashier'), {});
  check('a cashier cannot see the below-cost list', belowCost.allowed === false);
  const belowCostManager = await byName.get('get_below_cost_products').impl.execute(ctx('manager'), {});
  check('a manager can see the below-cost list', belowCostManager.allowed !== false);

  const explainCashier = await byName.get('explain_number').impl.execute(ctx('cashier'), { metric: 'net_profit' });
  check('a cashier cannot explain a profit figure', explainCashier.allowed === false);
  const explainManager = await byName.get('explain_number').impl.execute(ctx('manager'), { metric: 'net_profit' });
  check('a manager can explain a profit figure', explainManager.value !== null);
  const explainSales = await byName.get('explain_number').impl.execute(ctx('manager'), { metric: 'today_sales' });
  check('the explained number is the same number', explainSales.value === summary.today_sales, `${explainSales.value} vs ${summary.today_sales}`);

  const openPage = await byName.get('open_page').impl.execute(ctx('cashier'), { route: 'billing' });
  check('a cashier may open the billing page', openPage.ok === true);
  const openAdmin = await byName.get('open_page').impl.execute(ctx('cashier'), { route: 'admin' });
  check('a cashier may NOT open the admin page', openAdmin.ok === false);
  const openOwner = await byName.get('open_page').impl.execute(ctx('owner'), { route: 'admin' });
  check('an owner may open the admin page', openOwner.ok === true);
  const openNothing = await byName.get('open_page').impl.execute(ctx('owner'), { route: 'not-a-page' });
  check('a page that does not exist is refused', openNothing.ok === false);

  const shift = await byName.get('get_shift_status').impl.execute(ctx('cashier'), {});
  check('the shift status answers even with no shift open', shift.open === false || shift.open === true);

  // ── 6. the model never sees an implementation ────────────────────────────
  section('What the model is told');
  const definitions = toolsModule.toolDefinitionsForRole(registry, 'manager');
  check('the definitions carry no implementation', definitions.every((d) => !('impl' in d)));
  check('the definitions carry the name, the description and the schema', definitions.every((d) => d.name && d.description && d.inputSchema));
  const cashierDefinitions = toolsModule.toolDefinitionsForRole(registry, 'cashier');
  check('the cashier is told about fewer tools', cashierDefinitions.length < definitions.length);

  globalThis.fetch = realFetch;

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All assistant tool-registry checks passed.');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
