#!/usr/bin/env node
/**
 * The Purchase Order enhancement — the service + pure-logic suite.
 *
 * It runs the REAL `src/main/services/purchases.ts` (the purchase service),
 * the REAL `src/main/services/inventory.ts` (the stock + batch path), the
 * REAL `src/main/services/shifts.ts` (the open shift's cash) and the REAL
 * `src/shared/purchaseCalc.ts` (the pure PO maths) against a throwaway
 * database, so every assertion covers the code path the Purchase Order
 * screen uses.
 *
 * The rules that must never drift:
 *   - the order's money is EXACT: the discount (amount or %), the tax, the
 *     freight, the paid-now amount and the payable all add up to the cent,
 *   - a qty typed in a box is a qty in PIECES: "2 box = 24 pcs" must put 24
 *     pieces into the stock, never 2,
 *   - the stock goes in through the EXISTING stock functions (the batch, the
 *     movement, the FIFO batch), and the batch carries the cost of ONE base
 *     unit,
 *   - a DRAFT costs nothing: no balance, no ledger row, no stock,
 *   - a partial receipt keeps the remainder open, and the full receipt
 *     finishes the order,
 *   - the paid-now CASH leaves the OPEN shift's drawer — and is refused when
 *     there is no open shift,
 *   - a cancelled order never touches the stock,
 *   - the migration is idempotent: running it twice changes nothing.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_purchaseEnhance.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-po-enhance-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'po-enhance-test.db');

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
  const purchases = require('../dist/main/services/purchases.js');
  const shifts = require('../dist/main/services/shifts.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');
  const calc = require('../dist/shared/purchaseCalc.js');

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  auth.setSessionUser(1); // user 1 is the seeded owner

  const stockOf = (id) => Number(inventory.getProduct(id).stock_qty);
  const balanceOf = (id) =>
    Number((db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(id) || {}).balance || 0);
  const batchRows = (productId) =>
    db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY id').all(productId);
  const columnNames = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  // ── the fixtures ─────────────────────────────────────────────────────────
  const supplier = purchases.createSupplier('Al-Madina Traders', '0300-1234567', 'Lahore');
  const otherSupplier = purchases.createSupplier('Sunrise Foods', '0300-7654321', 'Karachi');

  // A product bought in CARTONS: 1 carton = 12 pieces.
  const oil = inventory.createProduct({
    name: 'Cooking Oil 5L',
    sku: 'OIL-5L',
    barcode: '1111111111111',
    cost_price: 1200,
    sale_price: 1500,
    wholesale_price: 1450,
    low_stock_threshold: 10,
    min_stock_level: 10,
    reorder_qty: 24,
    tax_rate: 5,
    units: [
      { level: 0, name: 'Piece', quantity_in_base_units: 1, is_base: true },
      { level: 1, name: 'Carton', quantity_in_base_units: 12, is_base: false },
    ],
  });
  // A product bought in PIECES, and it is low on stock.
  const sugar = inventory.createProduct({
    name: 'Sugar 1kg',
    sku: 'SUG-1KG',
    barcode: '2222222222222',
    cost_price: 130,
    sale_price: 160,
    low_stock_threshold: 20,
    min_stock_level: 20,
    reorder_qty: 50,
    tax_rate: 0,
  });
  // A product with plenty of stock — it must NOT be in the low-stock list.
  const rice = inventory.createProduct({
    name: 'Rice 5kg',
    sku: 'RICE-5KG',
    barcode: '3333333333333',
    cost_price: 700,
    sale_price: 850,
    low_stock_threshold: 5,
    min_stock_level: 5,
    tax_rate: 0,
  });
  // Give them some opening stock (through the real movement path).
  inventory.recordMovement(oil.id, 4, 'Opening stock', 'manual', null);
  inventory.recordMovement(sugar.id, 4, 'Opening stock', 'manual', null);
  inventory.recordMovement(rice.id, 100, 'Opening stock', 'manual', null);
  db.prepare('UPDATE products SET last_supplier_id = ? WHERE id = ?').run(otherSupplier.id, sugar.id);

  // ═══════════════════════════════════════════════════════════════════════════
  section('a) the totals — the discount, the tax, the freight, the paid, the payable');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const lines = [
      { qty: 2, unit_cost: 1000, tax_pct: 5 }, // 2000 gross, 100 tax
      { qty: 3, unit_cost: 100, tax_pct: 0 }, // 300 gross
    ];
    const plain = calc.computeTotals({ lines });
    check('the subtotal is the sum of the line gross amounts', near(plain.subtotal, 2300), String(plain.subtotal));
    check('the tax is the tax of the lines', near(plain.tax, 100), String(plain.tax));
    check('the grand total is the lines + the tax', near(plain.grandTotal, 2400), String(plain.grandTotal));
    check(
      'the parts add up to the total',
      near(plain.subtotal - plain.lineDiscount + plain.tax, plain.lineTotal),
      `${plain.subtotal} - ${plain.lineDiscount} + ${plain.tax} = ${plain.lineTotal}`
    );

    const withAmount = calc.computeTotals({ lines, discount_type: 'amount', discount_value: 100, freight: 50, paid_amount: 500 });
    check('an amount discount comes off the total', near(withAmount.discount, 100), String(withAmount.discount));
    check('the freight is added', near(withAmount.freight, 50), String(withAmount.freight));
    check('the grand total carries the discount and the freight', near(withAmount.grandTotal, 2350), String(withAmount.grandTotal));
    check('the paid amount comes off the payable', near(withAmount.paid, 500) && near(withAmount.payable, 1850), String(withAmount.payable));

    const withPercent = calc.computeTotals({ lines, discount_type: 'percent', discount_value: 10 });
    check('a percent discount is a percent of the subtotal', near(withPercent.discount, 230), String(withPercent.discount));
    check('the percent discount lands on the total', near(withPercent.grandTotal, 2170), String(withPercent.grandTotal));

    const overpaid = calc.computeTotals({ lines, paid_amount: 99999 });
    check('an overpaid order never shows a negative payable', overpaid.payable === 0, String(overpaid.payable));

    const junk = calc.computeTotals({
      lines: [{ qty: Number('abc'), unit_cost: Number('xyz'), tax_pct: Number('nope') }],
    });
    check('junk numbers never become NaN', Number.isFinite(junk.grandTotal) && junk.grandTotal === 0, String(junk.grandTotal));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('b) the units — a box is a box, the stock is in pieces');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    check('2 cartons are 24 pieces', near(calc.baseQty(2, 12), 24), String(calc.baseQty(2, 12)));
    check('the cost of a carton is the cost of its pieces', near(calc.costPerBaseUnit(1200, 12), 100), String(calc.costPerBaseUnit(1200, 12)));
    check('the base unit converts to itself', near(calc.baseQty(5, 1), 5) && near(calc.costPerBaseUnit(130, 1), 130));
    check('a missing multiplier is 1, never NaN', near(calc.baseQty(5, null), 5) && near(calc.costPerBaseUnit(130, undefined), 130));

    const units = calc.purchaseUnits([
      { id: 1, product_id: 1, level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: null, price: null, is_base: true },
      { id: 2, product_id: 1, level: 1, name: 'Carton', quantity_in_base_units: 12, barcode: null, price: null, is_base: false },
    ]);
    check('the purchase units are the pack + the base', units.length === 2 && units[0].name === 'Carton', JSON.stringify(units.map((u) => u.name)));

    // The service stores the SNAPSHOT on the line.
    const po = purchases.createPurchaseOrder(supplier.id, [
      { product_id: oil.id, qty: 2, unit_cost: 1200, units_in_base: 12, unit_name: 'Carton', tax_pct: 5 },
    ], { status: 'ordered' });
    const line = purchases.getPurchaseOrder(po.id).items[0];
    check('the line keeps the multiplier it was ordered with', near(line.unit_multiplier, 12), String(line.unit_multiplier));
    check('the line keeps the qty in base units', near(line.base_qty, 24), String(line.base_qty));
    check('the line keeps the cost of one base unit', near(line.cost_per_base, 100), String(line.cost_per_base));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('c) the suggested quantity + the low-stock list');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    check(
      'the reorder qty is the first suggestion',
      near(calc.suggestedQty({ stock_qty: 4, min_stock_level: 10, reorder_qty: 24 }), 24),
      String(calc.suggestedQty({ stock_qty: 4, min_stock_level: 10, reorder_qty: 24 }))
    );
    check(
      'without a reorder qty the gap to the reorder level is suggested',
      near(calc.suggestedQty({ stock_qty: 4, min_stock_level: 10 }), 6),
      String(calc.suggestedQty({ stock_qty: 4, min_stock_level: 10 }))
    );
    check(
      'a product with enough stock has no suggestion',
      near(calc.suggestedQty({ stock_qty: 30, min_stock_level: 10 }), 0),
      String(calc.suggestedQty({ stock_qty: 30, min_stock_level: 10 }))
    );
    check('the legacy threshold is used when there is no new level', near(calc.minStockLevel({ low_stock_threshold: 20 }), 20));
    check('the product is low when the stock is at (or under) the level', calc.isLowStock({ stock_qty: 10, min_stock_level: 10 }) && !calc.isLowStock({ stock_qty: 11, min_stock_level: 10 }));

    const low = purchases.listLowStockPurchaseProducts(100);
    const lowIds = low.map((r) => r.product_id);
    check('the low-stock list holds the product under its level', lowIds.includes(sugar.id), JSON.stringify(lowIds));
    check('the low-stock list leaves the product with stock alone', !lowIds.includes(rice.id), JSON.stringify(lowIds));
    const sugarRow = low.find((r) => r.product_id === sugar.id);
    check('the low-stock row carries the live inventory data', sugarRow && sugarRow.min_stock_level === 20 && sugarRow.reorder_qty === 50, JSON.stringify(sugarRow && { min: sugarRow.min_stock_level, reorder: sugarRow.reorder_qty }));
    check(
      'the low-stock row carries the product\'s units',
      sugarRow && Array.isArray(sugarRow.units),
      JSON.stringify(sugarRow && sugarRow.units)
    );

    const supplierRows = purchases.listSupplierPurchaseProducts(otherSupplier.id, 50);
    check(
      'the supplier list holds the products of that supplier',
      supplierRows.some((r) => r.product_id === sugar.id) && !supplierRows.some((r) => r.product_id === rice.id),
      JSON.stringify(supplierRows.map((r) => r.product_id))
    );

    const live = purchases.purchaseProductRow(sugar.id);
    check('the live product row reads the stock', live && near(live.stock_qty, 4), String(live && live.stock_qty));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('d) the cost-change warning + the margin warning');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const over = calc.costChange(100, 115, 10);
    check('a cost that moved more than the threshold warns', over.warn === true && near(over.pct, 15), JSON.stringify(over));
    const under = calc.costChange(100, 105, 10);
    check('a cost inside the threshold does not warn', under.warn === false && near(under.pct, 5), JSON.stringify(under));
    const noBase = calc.costChange(0, 100, 10);
    check('without a baseline nothing warns (no infinite jump)', noBase.warn === false && noBase.pct === 0, JSON.stringify(noBase));
    const cheaper = calc.costChange(100, 80, 10);
    check('a cheaper cost warns too (the sign is kept)', cheaper.warn === true && near(cheaper.pct, -20), JSON.stringify(cheaper));

    check('the margin is the markup on the cost (the shop\'s own rule)', near(calc.marginPct(1500, 1000), 50), String(calc.marginPct(1500, 1000)));
    check('a sale price under the cost is caught', calc.belowCost(900, 1000) === true);
    check(
      'the suggested sale price keeps the current margin',
      near(calc.suggestedSalePrice(1500, 1000, 1200), 1800),
      String(calc.suggestedSalePrice(1500, 1000, 1200))
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('e) draft → ordered → partial receive → the remainder → the full receive');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const balanceBefore = balanceOf(supplier.id);
    const ledgerBefore = Number(
      db.prepare('SELECT COUNT(*) AS c FROM supplier_transactions WHERE supplier_id = ?').get(supplier.id).c
    );

    const draft = purchases.createPurchaseOrder(supplier.id, [
      { product_id: sugar.id, qty: 10, unit_cost: 130, units_in_base: 1, tax_pct: 0 },
    ], { status: 'draft' });
    const draftRow = purchases.getPurchaseOrder(draft.id);
    check('a draft is saved as a draft', draftRow.status === 'draft', draftRow.status);
    check('a draft costs nothing', near(draftRow.total_amount, 0), String(draftRow.total_amount));
    check('a draft does not touch the supplier balance', near(balanceOf(supplier.id), balanceBefore));
    check(
      'a draft writes no ledger row',
      Number(db.prepare('SELECT COUNT(*) AS c FROM supplier_transactions WHERE supplier_id = ?').get(supplier.id).c) === ledgerBefore
    );

    const stockBeforeOil = stockOf(oil.id);
    const stockBeforeSugar = stockOf(sugar.id);

    const po = purchases.createPurchaseOrder(supplier.id, [
      { product_id: oil.id, qty: 2, unit_cost: 1200, units_in_base: 12, unit_name: 'Carton', tax_pct: 5 },
      { product_id: sugar.id, qty: 5, unit_cost: 130, units_in_base: 1, tax_pct: 0 },
    ], { status: 'ordered' });
    const order = purchases.getPurchaseOrder(po.id);
    check('the created order is "ordered"', order.status === 'ordered', order.status);
    check(
      'the order total is the lines + the tax',
      near(order.total_amount, 2 * 1200 * 1.05 + 5 * 130),
      String(order.total_amount)
    );
    check('the order adds its total to the supplier balance', near(balanceOf(supplier.id), balanceBefore + order.total_amount), String(balanceOf(supplier.id)));
    check('the order touches no stock before it is received', near(stockOf(oil.id), stockBeforeOil) && near(stockOf(sugar.id), stockBeforeSugar));

    // ── the partial receipt: ONE carton of the oil ──
    const partial = purchases.receivePurchaseOrder(po.id, [{ product_id: oil.id, qty: 1 }]);
    check('a partial receipt leaves the order partial', partial.status === 'partial', partial.status);
    check('one carton puts 12 PIECES into the stock', near(stockOf(oil.id), stockBeforeOil + 12), String(stockOf(oil.id)));
    const oilBatches = batchRows(oil.id);
    const firstBatch = oilBatches[oilBatches.length - 1];
    check('the batch holds the base qty (12 pieces)', near(firstBatch.quantity, 12), String(firstBatch.quantity));
    check('the batch carries the cost of ONE base unit', near(firstBatch.cost_price, 100), String(firstBatch.cost_price));
    const oilLine = purchases.getPurchaseOrder(po.id).items.find((i) => i.product_id === oil.id);
    check('the line records what arrived (1 carton)', near(oilLine.received_qty, 1), String(oilLine.received_qty));
    check('the remainder stays open (1 carton)', near(oilLine.qty - oilLine.received_qty, 1), String(oilLine.qty - oilLine.received_qty));
    check('the other line is untouched', near(stockOf(sugar.id), stockBeforeSugar), String(stockOf(sugar.id)));
    check(
      'the remaining quantity is the pure rule',
      near(calc.remainingQty(oilLine.qty, oilLine.received_qty), 1),
      String(calc.remainingQty(oilLine.qty, oilLine.received_qty))
    );

    // ── the full receipt ──
    const full = purchases.receivePurchaseOrder(po.id);
    check('the full receipt finishes the order', full.status === 'received', full.status);
    check('the rest of the carton lands as 12 more pieces', near(stockOf(oil.id), stockBeforeOil + 24), String(stockOf(oil.id)));
    check('the sugar lands as 5 pieces', near(stockOf(sugar.id), stockBeforeSugar + 5), String(stockOf(sugar.id)));
    const oilBatches2 = batchRows(oil.id);
    check('the second receipt made its own batch', oilBatches2.length === oilBatches.length + 1, String(oilBatches2.length));
    check(
      'every batch holds base units at the base cost',
      oilBatches2.every((b) => near(b.quantity, 12) && near(b.cost_price, 100)),
      JSON.stringify(oilBatches2.map((b) => ({ q: b.quantity, c: b.cost_price })))
    );
    check(
      'the stock moved through the movement log',
      Number(
        db
          .prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ? AND ref_type = 'purchase'")
          .get(oil.id).c
      ) === 2,
      'the movement rows'
    );
    const receivedTwice = throws(() => purchases.receivePurchaseOrder(po.id));
    check('a received order cannot be received again', receivedTwice !== null && /received/i.test(receivedTwice), String(receivedTwice));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('f) the paid-now cash leaves the open shift');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const noShift = throws(() =>
      purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 1, unit_cost: 130 }], {
        status: 'ordered',
        paid_amount: 500,
        payment_method: 'cash',
      })
    );
    check('a cash payment without an open shift is refused', noShift !== null && /shift/i.test(noShift), String(noShift));

    const shift = shifts.openShift(1000);
    const expectedBefore = shifts.shiftTotals(shift.id).expected;
    check('the shift starts with its opening cash', near(expectedBefore, 1000), String(expectedBefore));

    const balanceBefore = balanceOf(supplier.id);
    const po = purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 10, unit_cost: 130 }], {
      status: 'ordered',
      paid_amount: 500,
      payment_method: 'cash',
    });
    const order = purchases.getPurchaseOrder(po.id);
    check('the order keeps what was paid', near(order.paid_amount, 500), String(order.paid_amount));
    check('the order keeps the payment method', order.payment_method === 'cash', String(order.payment_method));
    check('the supplier owes only the remainder', near(balanceOf(supplier.id), balanceBefore + order.total_amount - 500), String(balanceOf(supplier.id)));
    const expectedAfter = shifts.shiftTotals(shift.id).expected;
    check('the open shift\'s cash came down by exactly the paid amount', near(expectedAfter, expectedBefore - 500), String(expectedAfter));
    const payRow = db
      .prepare("SELECT * FROM supplier_transactions WHERE purchase_order_id = ? AND type = 'payment:cash'")
      .get(po.id);
    check('the payment is on the supplier ledger', !!payRow && near(Math.abs(payRow.amount), 500), JSON.stringify(payRow));
    check('the payment is tied to the shift it was paid from', payRow && payRow.shift_id === shift.id, String(payRow && payRow.shift_id));

    // A BANK payment needs no shift and leaves the drawer alone.
    const expectedBeforeBank = shifts.shiftTotals(shift.id).expected;
    const bankPo = purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 1, unit_cost: 130 }], {
      status: 'ordered',
      paid_amount: 100,
      payment_method: 'bank',
    });
    check('a bank payment needs no shift', !!bankPo && bankPo.id > 0);
    check('a bank payment leaves the drawer alone', near(shifts.shiftTotals(shift.id).expected, expectedBeforeBank), String(shifts.shiftTotals(shift.id).expected));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('g) cancelling an order never touches the stock');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const stockBefore = stockOf(sugar.id);
    const batchesBefore = batchRows(sugar.id).length;
    const balanceBefore = balanceOf(supplier.id);
    const po = purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 4, unit_cost: 130 }], {
      status: 'ordered',
    });
    const total = purchases.getPurchaseOrder(po.id).total_amount;
    const cancelled = purchases.cancelPurchaseOrder(po.id, 'The supplier had no stock');
    check('the order is cancelled', cancelled === true);
    const row = purchases.getPurchaseOrder(po.id);
    check('the status is cancelled', row.status === 'cancelled', row.status);
    check('the reason is stored with the order', row.cancel_reason === 'The supplier had no stock', String(row.cancel_reason));
    check('the stock did not move', near(stockOf(sugar.id), stockBefore), String(stockOf(sugar.id)));
    check('no batch was made', batchRows(sugar.id).length === batchesBefore, String(batchRows(sugar.id).length));
    check('the supplier balance came back', near(balanceOf(supplier.id), balanceBefore), String(balanceOf(supplier.id)));
    check('the order keeps its own total', near(row.total_amount, total), String(row.total_amount));
    const cancelAgain = throws(() => purchases.cancelPurchaseOrder(po.id, 'again'));
    check('a cancelled order cannot be cancelled again', cancelAgain !== null, String(cancelAgain));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('h) the validation — the order cannot be created broken');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const noSupplier = calc.validatePo({ supplierId: 0, lines: [{ product_id: 1, qty: 1, unit_cost: 10 }] });
    check('a missing supplier is refused', noSupplier.ok === false && noSupplier.errors.includes('no_supplier'), JSON.stringify(noSupplier.errors));
    const noLines = calc.validatePo({ supplierId: 1, lines: [] });
    check('an empty order is refused', noLines.ok === false && noLines.errors.includes('no_lines'), JSON.stringify(noLines.errors));
    const zeroQty = calc.validatePo({ supplierId: 1, lines: [{ product_id: 1, qty: 0, unit_cost: 10 }] });
    check('a zero qty is refused', zeroQty.ok === false && zeroQty.errors.includes('qty_not_positive'), JSON.stringify(zeroQty.errors));
    const negCost = calc.validatePo({ supplierId: 1, lines: [{ product_id: 1, qty: 1, unit_cost: -5 }] });
    check('a negative cost is refused', negCost.ok === false && negCost.errors.includes('cost_negative'), JSON.stringify(negCost.errors));
    const nan = calc.validatePo({ supplierId: 1, lines: [{ product_id: 1, qty: Number('abc'), unit_cost: 10 }] });
    check('a NaN qty is refused', nan.ok === false && nan.errors.includes('nan'), JSON.stringify(nan.errors));
    const dupes = calc.validatePo({
      supplierId: 1,
      lines: [
        { product_id: 7, qty: 1, unit_cost: 10 },
        { product_id: 7, qty: 2, unit_cost: 10 },
      ],
    });
    check('the same product twice is refused', dupes.ok === false && dupes.errors.includes('duplicate_product'), JSON.stringify(dupes.errors));
    check('every refusal carries a sentence the owner can read', noSupplier.messages.length > 0 && negCost.messages.length > 0, JSON.stringify(noSupplier.messages));
    const merged = calc.mergeDuplicateLines([
      { product_id: 7, qty: 1, unit_cost: 10 },
      { product_id: 8, qty: 2, unit_cost: 20 },
      { product_id: 7, qty: 2, unit_cost: 10 },
    ]);
    check('the duplicate lines merge into one', merged.lines.length === 2 && near(merged.lines[0].qty, 3), JSON.stringify(merged.lines));

    // The SERVICE refuses the same broken orders.
    const svcZero = throws(() => purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 0, unit_cost: 130 }], { status: 'ordered' }));
    check('the service refuses a zero qty', svcZero !== null && /positive/i.test(svcZero), String(svcZero));
    const svcNeg = throws(() => purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 1, unit_cost: -5 }], { status: 'ordered' }));
    check('the service refuses a negative cost', svcNeg !== null && /negative/i.test(svcNeg), String(svcNeg));
    const svcNan = throws(() => purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: Number('abc'), unit_cost: 130 }], { status: 'ordered' }));
    check('the service refuses a NaN qty', svcNan !== null && /valid numbers/i.test(svcNan), String(svcNan));
    const svcEmpty = throws(() => purchases.createPurchaseOrder(supplier.id, [], { status: 'ordered' }));
    check('the service refuses an empty order', svcEmpty !== null, String(svcEmpty));
    const svcGhost = throws(() => purchases.createPurchaseOrder(supplier.id, [{ product_id: 999999, qty: 1, unit_cost: 10 }], { status: 'ordered' }));
    check('the service refuses a product that does not exist', svcGhost !== null && /not found/i.test(svcGhost), String(svcGhost));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('i) the migration is idempotent — running it twice changes nothing');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const migration = require('../migrations/090_purchase_orders_enhance.js');
    const before = {
      orders: columnNames('purchase_orders'),
      items: columnNames('purchase_items'),
      tx: columnNames('supplier_transactions'),
      orders2: JSON.stringify(db.prepare('SELECT * FROM purchase_orders ORDER BY id').all()),
      items2: JSON.stringify(db.prepare('SELECT * FROM purchase_items ORDER BY id').all()),
      settings: JSON.stringify(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'po_%' ORDER BY key").all()),
    };
    migration.up(db);
    migration.up(db);
    const after = {
      orders: columnNames('purchase_orders'),
      items: columnNames('purchase_items'),
      tx: columnNames('supplier_transactions'),
      orders2: JSON.stringify(db.prepare('SELECT * FROM purchase_orders ORDER BY id').all()),
      items2: JSON.stringify(db.prepare('SELECT * FROM purchase_items ORDER BY id').all()),
      settings: JSON.stringify(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'po_%' ORDER BY key").all()),
    };
    check('the order columns are unchanged', JSON.stringify(before.orders) === JSON.stringify(after.orders), after.orders.join(','));
    check('the line columns are unchanged', JSON.stringify(before.items) === JSON.stringify(after.items), after.items.join(','));
    check('the ledger columns are unchanged', JSON.stringify(before.tx) === JSON.stringify(after.tx), after.tx.join(','));
    check('the order rows are unchanged', before.orders2 === after.orders2);
    check('the line rows are unchanged', before.items2 === after.items2);
    check('the PO settings are unchanged', before.settings === after.settings, after.settings);
    check('the new columns are really there', after.orders.includes('discount_type') && after.orders.includes('paid_amount') && after.items.includes('unit_multiplier') && after.tx.includes('shift_id'), after.orders.join(','));
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
  console.error('test_purchaseEnhance crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the purchase-enhance suite did not finish in 180s');
  app.exit(2);
}, 180000);
