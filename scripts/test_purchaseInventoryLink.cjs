#!/usr/bin/env node
/**
 * The Purchase Order <-> Inventory live link.
 *
 * The rule of this screen: the Purchase Order READS the inventory master
 * data live, but the ORDER itself keeps a snapshot of what was ordered — the
 * history never changes retroactively.
 *
 * This suite runs the REAL `src/main/services/purchases.ts` (create, receive,
 * cancel, the live product row), the REAL `src/main/services/inventory.ts`
 * (the product write) and the REAL `src/main/services/settings.ts` (the
 * shop's costing setting) against a throwaway database.
 *
 * What must never drift:
 *   - receiving an order updates the product's LAST purchase cost, its last
 *     supplier and the date it was received,
 *   - the product's own `cost_price` follows the shop's costing setting —
 *     and only that setting decides it,
 *   - a SALE price is never changed by a purchase,
 *   - the saved order keeps its own snapshot: a later change to the product
 *     (the cost, the sale price, even the pack size) never rewrites it,
 *   - the live row the Purchase Order screen reads DOES see the later change.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_purchaseInventoryLink.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-po-link-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'po-link-test.db');

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

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  auth.setSessionUser(1);

  const supplier = purchases.createSupplier('Metro Wholesale', '0300-2222222', 'Lahore');
  const product = inventory.createProduct({
    name: 'Basmati Rice 5kg',
    sku: 'RICE-BAS-5',
    barcode: '4444444444444',
    cost_price: 700,
    sale_price: 900,
    low_stock_threshold: 10,
    min_stock_level: 10,
    reorder_qty: 20,
    units: [
      { level: 0, name: 'Bag', quantity_in_base_units: 1, is_base: true },
      { level: 1, name: 'Carton', quantity_in_base_units: 6, is_base: false },
    ],
  });
  const productRow = () => purchases.purchaseProductRow(product.id);
  const productOf = () => inventory.getProduct(product.id);

  // ═══════════════════════════════════════════════════════════════════════════
  section('1) receiving updates the last purchase cost, the supplier and the date');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    check('the costing setting is on by default', purchases.poCostingUpdatesCostPrice() === true);
    const po = purchases.createPurchaseOrder(supplier.id, [
      { product_id: product.id, qty: 2, unit_cost: 780, units_in_base: 6, unit_name: 'Carton', tax_pct: 0 },
    ], { status: 'ordered' });
    purchases.receivePurchaseOrder(po.id);

    const last = purchases.lastPurchaseInfo(product.id);
    check('the last purchase cost is recorded (per base unit)', near(last.last_cost, 130), JSON.stringify(last));
    check('the last supplier is recorded', last.last_supplier_id === supplier.id && last.last_supplier_name === supplier.name, JSON.stringify(last));
    check('the last received date is recorded', !!last.last_received_at, String(last.last_received_at));
    check('the product now points at that supplier', productOf().last_supplier_id === supplier.id, String(productOf().last_supplier_id));
    check('the product cost price follows the received cost', near(productOf().cost_price, 130), String(productOf().cost_price));
    const history = purchases.purchasePriceHistory(product.id);
    check('the price history holds the received cost', history.length === 1 && near(history[0].unit_cost, 130), JSON.stringify(history));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('2) the costing setting decides whether the cost price moves');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    settings.setSetting('po_update_cost_price', '0');
    check('the costing setting is now off', purchases.poCostingUpdatesCostPrice() === false);
    const salePriceBefore = productOf().sale_price;
    const po = purchases.createPurchaseOrder(supplier.id, [
      { product_id: product.id, qty: 1, unit_cost: 900, units_in_base: 6, unit_name: 'Carton', tax_pct: 0 },
    ], { status: 'ordered' });
    purchases.receivePurchaseOrder(po.id);

    check('the product cost price was left alone', near(productOf().cost_price, 130), String(productOf().cost_price));
    const history = purchases.purchasePriceHistory(product.id);
    check('the last purchase cost is still recorded', near(history[0].unit_cost, 150), JSON.stringify(history.map((h) => h.unit_cost)));
    check('the last purchase info still shows the new cost', near(purchases.lastPurchaseInfo(product.id).last_cost, 150), String(purchases.lastPurchaseInfo(product.id).last_cost));
    check('the sale price was NEVER changed by the purchase', near(productOf().sale_price, salePriceBefore), String(productOf().sale_price));

    settings.setSetting('po_update_cost_price', '1');
    check('the costing setting is back on', purchases.poCostingUpdatesCostPrice() === true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('3) the saved order keeps its own snapshot');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const po = purchases.createPurchaseOrder(supplier.id, [
      { product_id: product.id, qty: 3, unit_cost: 1000, units_in_base: 6, unit_name: 'Carton', tax_pct: 5 },
    ], { status: 'ordered' });
    const saved = purchases.getPurchaseOrder(po.id);
    const line = saved.items[0];
    check('the line keeps the qty it was ordered with', near(line.qty, 3), String(line.qty));
    check('the line keeps the cost it was ordered with', near(line.unit_cost, 1000), String(line.unit_cost));
    check('the line keeps the multiplier it was ordered with', near(line.unit_multiplier, 6), String(line.unit_multiplier));
    check('the line keeps the base qty it was ordered with', near(line.base_qty, 18), String(line.base_qty));
    check('the line keeps the per-base cost it was ordered with', near(line.cost_per_base, 1000 / 6), String(line.cost_per_base));

    // The shop changes the product afterwards: the cost, the sale price and
    // even the pack size.
    inventory.updateProduct(product.id, {
      name: 'Basmati Rice 5kg',
      cost_price: 1500,
      sale_price: 2000,
      low_stock_threshold: 10,
      min_stock_level: 25,
      reorder_qty: 50,
      units: [
        { level: 0, name: 'Bag', quantity_in_base_units: 1, is_base: true },
        { level: 1, name: 'Carton', quantity_in_base_units: 10, is_base: false },
      ],
    });

    const after = purchases.getPurchaseOrder(po.id);
    const afterLine = after.items[0];
    check('the saved order still keeps its qty', near(afterLine.qty, 3), String(afterLine.qty));
    check('the saved order still keeps its cost', near(afterLine.unit_cost, 1000), String(afterLine.unit_cost));
    check('the saved order still keeps its multiplier', near(afterLine.unit_multiplier, 6), String(afterLine.unit_multiplier));
    check('the saved order still keeps its base qty', near(afterLine.base_qty, 18), String(afterLine.base_qty));
    check('the saved order still keeps its per-base cost', near(afterLine.cost_per_base, 1000 / 6), String(afterLine.cost_per_base));
    check('the saved order still keeps its total', near(after.total_amount, 3 * 1000 * 1.05), String(after.total_amount));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('4) the live row DOES see the later change');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const live = productRow();
    check('the live row shows the new cost', near(live.cost_price, 1500), String(live.cost_price));
    check('the live row shows the new sale price', near(live.sale_price, 2000), String(live.sale_price));
    check('the live row shows the new reorder level', near(live.min_stock_level, 25), String(live.min_stock_level));
    check('the live row shows the new reorder qty', near(live.reorder_qty, 50), String(live.reorder_qty));
    check('the live row shows the new pack size', near(live.units.find((u) => u.name === 'Carton').quantity_in_base_units, 10), JSON.stringify(live.units));
    check('the live row shows the last purchase cost', near(live.last_purchase_cost, 150), String(live.last_purchase_cost));

    // The product is now low on stock (the level moved up), so the live
    // low-stock list must include it.
    const low = purchases.listLowStockPurchaseProducts(100);
    check('the low-stock list follows the new level', low.some((r) => r.product_id === product.id), JSON.stringify(low.map((r) => r.product_id)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('5) the Purchase Order settings are read from the shop profile');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    check('the cost-change warning defaults to 10%', purchases.poCostChangeWarnPct() === 10, String(purchases.poCostChangeWarnPct()));
    check('the minimum margin defaults to off (0)', purchases.poMinMarginPct() === 0, String(purchases.poMinMarginPct()));
    check('the low-stock suggestion defaults to on', purchases.poAutoSuggestLowStock() === true);
    check('the default payment method defaults to cash', purchases.poDefaultPaymentMethod() === 'cash', purchases.poDefaultPaymentMethod());

    settings.setSetting('po_cost_change_warn_pct', '25');
    settings.setSetting('po_min_margin_pct', '15');
    settings.setSetting('po_auto_suggest_low_stock', '0');
    settings.setSetting('po_default_payment_method', 'bank');
    check('the cost-change warning follows the setting', purchases.poCostChangeWarnPct() === 25, String(purchases.poCostChangeWarnPct()));
    check('the minimum margin follows the setting', purchases.poMinMarginPct() === 15, String(purchases.poMinMarginPct()));
    check('the low-stock suggestion follows the setting', purchases.poAutoSuggestLowStock() === false);
    check('the default payment method follows the setting', purchases.poDefaultPaymentMethod() === 'bank', purchases.poDefaultPaymentMethod());
  }

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_purchaseInventoryLink crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the purchase-inventory-link suite did not finish in 180s');
  app.exit(2);
}, 180000);
