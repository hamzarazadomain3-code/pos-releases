#!/usr/bin/env node
/**
 * Phase 1 — Negative stock suite.
 *
 * Runs the REAL services against a throwaway database (same pattern as
 * scripts/test_return_bill.js):
 *
 *   1. stock 0, sell 1  -> stock -1, bill saves, audit-log entry written
 *   2. purchase 10      -> stock  9  (purchase adds qty normally)
 *   3. return 1         -> stock 10  (restock from a negative base works)
 *   4. allow_negative_stock = 'no' hard-blocks for a cashier session,
 *      owner/manager rank may still override
 *   5. max_negative_qty cap is enforced
 *   6. hold/resume with an out-of-stock item keeps correct totals
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_negative_stock.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-negative-stock-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'negative-stock-test.db');

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

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const shifts = require('../dist/main/services/shifts.js');
  const returns = require('../dist/main/services/returns.js');
  const sales = require('../dist/main/services/sales.js');
  const purchases = require('../dist/main/services/purchases.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');

  auth.setSessionUser(1); // seeded owner

  // createSale is licence-gated; start a local trial for the throwaway DB.
  settings.setSetting('license_trial', '1');
  settings.setSetting('license_trial_started', new Date().toISOString());
  settings.setSetting('license_trial_expires', new Date(Date.now() + 15 * 864e5).toISOString());
  settings.setSetting('license_trial_offline', '0');

  const shift = shifts.openShift(1000);
  check('shift opened', shift.id > 0);

  // ── 1. Sell out of stock: 0 -> -1 ──────────────────────────────────────────
  section('Sell with zero stock (warn mode)');
  settings.setSetting('allow_negative_stock', 'warn');
  settings.setSetting('max_negative_qty', '0');

  const product = inventory.createProduct({
    name: 'Negative Stock Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 0,
    tax_rate: 0,
  });
  const stock = () => Number(inventory.getProduct(product.id).stock_qty);
  check('product starts at stock 0', near(stock(), 0), String(stock()));

  // price floor must not block the test product (price == cost would pass, but be explicit)
  settings.setSetting('price_floor_enabled', '0');

  const sale = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'Cash', amount: 100 }],
    price_mode: 'retail',
  });
  check('bill saves with zero stock (warn mode)', !!sale && !!sale.sale, sale ? `invoice ${sale.sale.invoice_no}` : 'no sale');
  check('stock went to -1', near(stock(), -1), String(stock()));

  const line = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
    .get(sale.sale.id);
  check('sale line is stored with batch_id NULL', !!line && line.batch_id == null, line ? String(line.batch_id) : 'missing line');

  const auditRow = db
    .prepare("SELECT * FROM activity_log WHERE action = 'stock_negative' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .get(product.id);
  check('audit-log entry written for the negative push', !!auditRow, auditRow ? auditRow.details : 'missing');

  // ── 2. Purchase 10: -1 + 10 = 9 ────────────────────────────────────────────
  section('Purchase restores from negative');
  const supplier = purchases.createSupplier('NegStock Supplier');
  const po = purchases.createPurchaseOrder(supplier.id, [{ product_id: product.id, qty: 10, unit_cost: 55 }]);
  purchases.receivePurchaseOrder(po.id);
  check('stock after +10 purchase = 9', near(stock(), 9), String(stock()));
  check(
    'product cost updated to last purchase cost',
    near(Number(inventory.getProduct(product.id).cost_price), 55),
    String(inventory.getProduct(product.id).cost_price)
  );
  check('supplier ledger balance = 550', near(Number(purchases.listSuppliers().find((s) => s.id === supplier.id).balance), 550));

  // ── 3. Return 1: 9 + 1 = 10 ────────────────────────────────────────────────
  section('Return adds stock');
  const ret = returns.createReturnBill({
    items: [{ product_id: product.id, qty: 1, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
  });
  check('return saved', ret.id > 0 && near(ret.refund_amount, 100));
  check('stock after return = 10', near(stock(), 10), String(stock()));

  // ── 3b. Return over a negative base: -3 + 10 = 7 ──────────────────────────
  section('Return over a negative base (-3 + 10 = 7)');
  const p2 = inventory.createProduct({
    name: 'Oversold Return Widget',
    sale_price: 50,
    cost_price: 30,
    stock_qty: 0,
    tax_rate: 0,
  });
  const stock2 = () => Number(inventory.getProduct(p2.id).stock_qty);
  sales.createSale({
    items: [{ product_id: p2.id, qty: 3, price: 50, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'Cash', amount: 150 }],
    price_mode: 'retail',
  });
  check('oversold to -3', near(stock2(), -3), String(stock2()));
  returns.createReturnBill({
    items: [{ product_id: p2.id, qty: 1, unit_price: 50 }],
    refund_mode: 'cash',
    restock: true,
  });
  check('return 1 over negative base = -2', near(stock2(), -2), String(stock2()));
  const po2 = purchases.createPurchaseOrder(supplier.id, [{ product_id: p2.id, qty: 10, unit_cost: 30 }]);
  purchases.receivePurchaseOrder(po2.id);
  check('purchase 10 over -2 = 8', near(stock2(), 8), String(stock2()));
  const ret2 = returns.createReturnBill({
    items: [{ product_id: p2.id, qty: 2, unit_price: 50 }],
    refund_mode: 'cash',
    restock: true,
  });
  check('return 2 over 8 = 10', near(stock2(), 10), String(stock2()));
  check('return ids differ', ret2.id !== ret.id);

  // ── 4. 'no' mode blocks a cashier, owner may override ─────────────────────
  section("'no' mode: cashier blocked, owner override");
  settings.setSetting('allow_negative_stock', 'no');
  const p3 = inventory.createProduct({
    name: 'Blocked Widget',
    sale_price: 20,
    cost_price: 10,
    stock_qty: 0,
    tax_rate: 0,
  });

  // simulate a cashier session (role rank below manager)
  const cashierUser = sales.createCustomer ? null : null; // (no-op; keep lint happy)
  void cashierUser;
  const cashier = auth.createUser({ username: 'negstock_cashier', pin: '4321', role: 'cashier' });
  auth.setSessionUser(cashier.id);
  const blocked = throws(() =>
    sales.createSale({
      items: [{ product_id: p3.id, qty: 1, price: 20, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 20 }],
      price_mode: 'retail',
    })
  );
  check('cashier is blocked when policy is No', !!blocked && /Insufficient stock/i.test(blocked), blocked || 'sale went through');
  check('stock stayed at 0 for the blocked sale', near(Number(inventory.getProduct(p3.id).stock_qty), 0));

  auth.setSessionUser(1); // owner
  const ownerSale = throws(() =>
    sales.createSale({
      items: [{ product_id: p3.id, qty: 1, price: 20, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 20 }],
      price_mode: 'retail',
    })
  );
  check('owner override succeeds despite No policy', ownerSale === null, ownerSale || 'ok');
  check('owner sale pushed stock to -1', near(Number(inventory.getProduct(p3.id).stock_qty), -1));

  // ── 5. max_negative_qty cap ────────────────────────────────────────────────
  section('max_negative_qty cap');
  settings.setSetting('allow_negative_stock', 'warn');
  settings.setSetting('max_negative_qty', '2');
  const p4 = inventory.createProduct({ name: 'Cap Widget', sale_price: 10, cost_price: 5, stock_qty: 0, tax_rate: 0 });
  const capped = throws(() =>
    sales.createSale({
      items: [{ product_id: p4.id, qty: 3, price: 10, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 30 }],
      price_mode: 'retail',
    })
  );
  check('sale beyond cap is rejected', !!capped && /max negative qty/i.test(capped), capped || 'sale went through');
  const withinCap = throws(() =>
    sales.createSale({
      items: [{ product_id: p4.id, qty: 2, price: 10, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 20 }],
      price_mode: 'retail',
    })
  );
  check('sale within cap succeeds', withinCap === null, withinCap || 'ok');
  check('stock is -2 after capped sale', near(Number(inventory.getProduct(p4.id).stock_qty), -2));
  settings.setSetting('max_negative_qty', '0');

  // -- 7. max_negative_qty = 0 (or unset) means "no cap" ------------------
  section('max_negative_qty 0 = no cap');
  settings.setSetting('allow_negative_stock', 'warn');
  settings.setSetting('max_negative_qty', '0');
  const p5 = inventory.createProduct({ name: 'Unlimited Negative Widget', sale_price: 10, cost_price: 5, stock_qty: 0, tax_rate: 0 });
  const unlimited = throws(() =>
    sales.createSale({
      items: [{ product_id: p5.id, qty: 5, price: 10, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 50 }],
      price_mode: 'retail',
    })
  );
  check('sale of 5 goes through when cap is 0', unlimited === null, unlimited || 'ok');
  check('stock reaches -5 with no cap', near(Number(inventory.getProduct(p5.id).stock_qty), -5), String(inventory.getProduct(p5.id).stock_qty));

  // An unset key must behave exactly like 0 (pre-migration installs).
  db.prepare("DELETE FROM settings WHERE key = 'max_negative_qty'").run();
  const p6 = inventory.createProduct({ name: 'Missing Setting Widget', sale_price: 10, cost_price: 5, stock_qty: 0, tax_rate: 0 });
  const missing = throws(() =>
    sales.createSale({
      items: [{ product_id: p6.id, qty: 3, price: 10, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 30 }],
      price_mode: 'retail',
    })
  );
  check('missing max_negative_qty behaves as no cap', missing === null, missing || 'ok');
  check('stock reaches -3 with setting absent', near(Number(inventory.getProduct(p6.id).stock_qty), -3), String(inventory.getProduct(p6.id).stock_qty));
  settings.setSetting('max_negative_qty', '0');

  // ── 6. Hold / resume with an out-of-stock item keeps totals ────────────────
  section('Hold/resume with out-of-stock item');
  const { lineTotals, serializeCartLine, rehydrateCartLines } = require('../dist/shared/cartMath.js');
  const outOfStockLine = {
    product_id: product.id,
    name: 'Negative Stock Widget',
    qty: 2,
    price: 100,
    retail_price: 100,
    wholesale_price: 100,
    cost_price: 55,
    line_discount: 0,
    tax_rate: 0,
    expired: false,
    shelf_location: null,
    stock_qty: -1, // out of stock (negative)
    units: [
      { id: 1, product_id: product.id, level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: null, price: 100, is_base: true },
    ],
    selected_unit_level: 0,
  };
  const preTotals = lineTotals([outOfStockLine], 0, 'amount', {});
  const held = { items: [serializeCartLine(outOfStockLine)], bill_discount: 0, discount_type: 'amount', price_mode: 'retail' };
  const roundTrip = JSON.parse(JSON.stringify(held));
  const resumed = rehydrateCartLines(roundTrip.items, [inventory.getProduct(product.id)], 'retail');
  const postTotals = lineTotals(resumed, 0, 'amount', {});
  check('resumed line keeps the out-of-stock qty', near(resumed[0].qty, 2), String(resumed[0].qty));
  check('resumed stock_qty preserved (negative)', near(Number(resumed[0].stock_qty), -1), String(resumed[0].stock_qty));
  check('pre-hold totals equal post-resume totals', near(preTotals.total, postTotals.total), `${preTotals.total} vs ${postTotals.total}`);
  check('totals are finite (no NaN)', [postTotals.subtotal, postTotals.tax, postTotals.total].every(Number.isFinite));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All negative-stock checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
