#!/usr/bin/env node
/**
 * Phase 1 — the product / inventory data model (the units, the batch & expiry
 * rules, the stock ledger).
 *
 * Every check below is a REGRESSION test for one numbered item. The suite runs
 * the REAL services against a throwaway database.
 *
 *   1.1  the FIFO deduction is all-or-nothing (a refused adjustment leaves the
 *        batches untouched)
 *   1.2  a bill with two lines of the SAME product writes its OWN FIFO
 *        allocations (the old per-product map mixed them up)
 *   1.3  `product_batches.quantity_received` is written, so the FIFO Stock
 *        Report is not empty
 *   1.4  a return RELEASES the FIFO allocation (the shelf and the report agree)
 *   1.5  the expiry rule is ONE rule (the till and the report cannot disagree)
 *   1.6  an expired BATCH is never sold (and the bill amendment refuses it too)
 *   1.7  a quotation conversion obeys the negative-stock policy
 *   1.8  the stock ledger records WHO moved the stock and from WHICH branch
 *   1.9  the two inventory-report queries run (they selected a column that
 *        does not exist)
 *   1.10 the purchase line snapshot is COMPLETE (unit, total, batch, received)
 *   1.11 the purchase import writes `quantity_received` and its undo removes
 *        the exact batch it created
 *   1.12 one unit-conversion rule (the import and the purchase convert a pack
 *        into base units; the batch quantity equals the product stock)
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_inventoryModel.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-inventory-model-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'inventory-model-test.db');

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

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Local calendar date, yyyy-mm-dd (never UTC-shifted). */
function localIso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const shifts = require('../dist/main/services/shifts.js');
  const sales = require('../dist/main/services/sales.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');
  const returns = require('../dist/main/services/returns.js');
  const purchases = require('../dist/main/services/purchases.js');
  const purchaseImport = require('../dist/main/services/purchaseImport.js');
  const quotations = require('../dist/main/services/quotations.js');
  const billAmendments = require('../dist/main/services/billAmendments.js');
  const inventoryReports = require('../dist/main/services/inventoryReports.js');
  const alertService = require('../dist/main/services/alertService.js');
  const fifoEngine = require('../dist/main/services/fifoEngine.js');
  const expiry = require('../dist/shared/expiry.js');
  const units = require('../dist/shared/units.js');

  auth.setSessionUser(1); // the seeded owner

  settings.setSetting('license_trial', '1');
  settings.setSetting('license_trial_started', new Date().toISOString());
  settings.setSetting('license_trial_expires', new Date(Date.now() + 15 * 864e5).toISOString());
  settings.setSetting('license_trial_offline', '0');
  settings.setSetting('price_floor_enabled', '0');
  settings.setSetting('allow_negative_stock', 'warn');

  const shift = shifts.openShift(1000);
  check('shift opened', shift.id > 0);

  const stockOf = (id) => Number(inventory.getProduct(id).stock_qty);
  const batchesOf = (id) => inventory.getProductBatches(id);

  function sell(productId, qty, extra) {
    return sales.createSale({
      items: [{ product_id: productId, qty, price: 100, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 100 * qty }],
      price_mode: 'retail',
      ...extra,
    });
  }

  /* ── 1.1 ─ the FIFO deduction is all-or-nothing ─────────────────────────── */
  section('1.1 - a refused stock adjustment leaves the batches untouched');
  const widget = inventory.createProduct({
    name: 'All-or-Nothing Widget',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 10,
    tax_rate: 0,
  });
  const batchBefore = batchesOf(widget.id)[0];
  const refused = throws(() => inventory.adjustStock(widget.id, -20, 'Phase 1 test'));
  check('the over-large reduction is refused', !!refused, refused || 'no error');
  const batchAfter = batchesOf(widget.id)[0];
  check(
    'the batch quantity is STILL 10 (it was not left half-deducted)',
    near(batchAfter.quantity, 10),
    `before=${batchBefore.quantity} after=${batchAfter.quantity}`
  );
  check('the product stock is still 10', near(stockOf(widget.id), 10), String(stockOf(widget.id)));
  const movementCount = db
    .prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?')
    .get(widget.id).c;
  check('no movement row was written for the refused adjustment', Number(movementCount) === 1, String(movementCount));

  /* ── 1.2 ─ two lines of the SAME product ─────────────────────────────────── */
  section('1.2 - two lines of the same product keep their own FIFO allocations');
  const twin = inventory.createProduct({
    name: 'Twin Bread',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 0,
    tax_rate: 0,
  });
  const batchA = inventory.createBatch(twin.id, 'TWIN-A', 5, 50, null);
  const batchB = inventory.createBatch(twin.id, 'TWIN-B', 5, 50, null);
  inventory.recordMovement(twin.id, 10, 'Initial stock', null, null, null, 1, null);

  const twoLineSale = sales.createSale({
    items: [
      { product_id: twin.id, qty: 5, price: 100, line_discount: 0, tax_rate: 0 },
      { product_id: twin.id, qty: 5, price: 100, line_discount: 0, tax_rate: 0 },
    ],
    payments: [{ mode: 'Cash', amount: 1000 }],
    price_mode: 'retail',
  });
  check('the two-line bill was created', !!twoLineSale?.sale?.id, twoLineSale?.sale?.invoice_no);
  const saleItems = db
    .prepare('SELECT id, qty, batch_id FROM sale_items WHERE sale_id = ? ORDER BY id')
    .all(twoLineSale.sale.id);
  check('two sale item rows were written', saleItems.length === 2, String(saleItems.length));
  check(
    'the first line took batch A',
    Number(saleItems[0]?.batch_id) === Number(batchA),
    `got ${saleItems[0]?.batch_id} want ${batchA}`
  );
  check(
    'the second line took batch B',
    Number(saleItems[1]?.batch_id) === Number(batchB),
    `got ${saleItems[1]?.batch_id} want ${batchB}`
  );
  const allocations = db
    .prepare(
      `SELECT fa.sale_item_id, fa.product_batch_id, fa.allocated_qty
       FROM fifo_allocations fa WHERE fa.sale_item_id IN (?, ?) ORDER BY fa.id`
    )
    .all(saleItems[0].id, saleItems[1].id);
  check('BOTH allocations were recorded (the old bug wrote one)', allocations.length === 2, String(allocations.length));
  check(
    'the first allocation points at batch A',
    allocations.length >= 1 && Number(allocations[0].product_batch_id) === Number(batchA),
    JSON.stringify(allocations)
  );
  check(
    'the second allocation points at batch B',
    allocations.length >= 2 && Number(allocations[1].product_batch_id) === Number(batchB),
    JSON.stringify(allocations)
  );
  check(
    'both batches are empty now',
    near(batchesOf(twin.id).length, 0) || batchesOf(twin.id).every((b) => b.quantity === 0),
    JSON.stringify(batchesOf(twin.id).map((b) => b.quantity))
  );
  check('the product stock is 0', near(stockOf(twin.id), 0), String(stockOf(twin.id)));

  /* ── 1.3 ─ quantity_received ─────────────────────────────────────────────── */
  section('1.3 - the batches carry the quantity they received');
  const received = db
    .prepare('SELECT quantity_received FROM product_batches WHERE id = ?')
    .get(batchA);
  check('the batch remembers what it received', Number(received?.quantity_received) === 5, JSON.stringify(received));
  const fifoRows = fifoEngine.getFIFOStockReport(twin.id);
  check('the FIFO stock report shows the batch (it used to be empty)', fifoRows.length === 2, String(fifoRows.length));

  /* ── 1.4 ─ a return releases the allocation ──────────────────────────────── */
  section('1.4 - returning a line releases its FIFO allocation');
  const returnable = inventory.createProduct({
    name: 'Returnable Cake',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 4,
    tax_rate: 0,
  });
  const returnBatch = batchesOf(returnable.id)[0];
  const sold = sell(returnable.id, 2);
  check('the cake was sold', !!sold?.sale?.id, sold?.sale?.invoice_no);
  const allocAfterSale = db
    .prepare('SELECT COUNT(*) AS c FROM fifo_allocations WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)')
    .get(sold.sale.id).c;
  check('the sale left one FIFO allocation', Number(allocAfterSale) === 1, String(allocAfterSale));
  const soldItem = db.prepare('SELECT id, batch_id FROM sale_items WHERE sale_id = ? ORDER BY id').get(sold.sale.id);
  const ret = returns.createReturn({
    sale_id: sold.sale.id,
    items: [{ sale_item_id: soldItem.id, qty: 2, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
    reason: 'Phase 1 test',
  });
  check('the return was created', !!ret?.id, ret?.invoice_no);
  const allocAfterReturn = db
    .prepare('SELECT COUNT(*) AS c FROM fifo_allocations WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)')
    .get(sold.sale.id).c;
  check('the FIFO allocation was RELEASED', Number(allocAfterReturn) === 0, String(allocAfterReturn));
  check('the stock is back to 4', near(stockOf(returnable.id), 4), String(stockOf(returnable.id)));
  check(
    'the batch quantity is back to 4',
    near(inventory.getProductBatches(returnable.id).find((b) => b.id === returnBatch.id)?.quantity, 4),
    String(inventory.getProductBatches(returnable.id).find((b) => b.id === returnBatch.id)?.quantity)
  );

  /* ── 1.5 ─ ONE expiry rule ───────────────────────────────────────────────── */
  section('1.5 - the expiry rule is ONE rule');
  const today = localIso(0);
  check('yesterday is expired', expiry.isExpiredOn(localIso(-1), today) === true);
  check('today is NOT expired (the shop sells through the date)', expiry.isExpiredOn(today, today) === false);
  check('tomorrow is NOT expired', expiry.isExpiredOn(localIso(1), today) === false);
  check('no date is NOT expired', expiry.isExpiredOn(null, today) === false);
  check('an unreadable date is NOT expired (never block on garbage)', expiry.isExpiredOn('31/12/2026', today) === false);
  check('an unambiguous dd/mm/yyyy date is understood', expiry.isExpiredOn('27/11/2020', '2026-11-27') === true);
  check('the days count agrees with the rule', expiry.daysUntilExpiry(localIso(-1), today) === -1, String(expiry.daysUntilExpiry(localIso(-1), today)));
  check('the report and the till agree on "expires today"', expiry.expiryBucket(today, today) === 'today', expiry.expiryBucket(today, today));

  const todayExpiry = inventory.createProduct({
    name: 'Expires Today Loaf',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 3,
    tax_rate: 0,
    expiry_date: today,
  });
  const yesterdayExpiry = inventory.createProduct({
    name: 'Expired Yesterday Loaf',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 3,
    tax_rate: 0,
    expiry_date: localIso(-1),
  });
  const reports = require('../dist/main/services/reports.js');
  const analysis = reports.getInventoryAnalysis();
  const todayRow = analysis.expiryAlert.find((r) => Number(r.id) === Number(todayExpiry.id));
  const yesterdayRow = analysis.expiryAlert.find((r) => Number(r.id) === Number(yesterdayExpiry.id));
  check('the report does NOT call a same-day expiry EXPIRED', todayRow && todayRow.status !== 'EXPIRED', todayRow?.status);
  check('the report DOES call a past expiry EXPIRED', yesterdayRow && yesterdayRow.status === 'EXPIRED', yesterdayRow?.status);

  /* ── 1.6 ─ an expired batch is never sold ────────────────────────────────── */
  section('1.6 - an expired batch is not sellable');
  const batchExpired = inventory.createProduct({
    name: 'Old Batch Bread',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 0,
    tax_rate: 0,
  });
  inventory.createBatch(batchExpired.id, 'OLD-1', 5, 50, localIso(-1));
  inventory.recordMovement(batchExpired.id, 5, 'Initial stock', null, null, null, 1, null);
  const expiredBatchError = throws(() => sell(batchExpired.id, 1));
  check(
    'selling the expired batch is refused',
    !!expiredBatchError && expiredBatchError.startsWith('Expired items:'),
    expiredBatchError || 'no error'
  );
  check('the stock is untouched', near(stockOf(batchExpired.id), 5), String(stockOf(batchExpired.id)));

  const mixed = inventory.createProduct({
    name: 'Mixed Batch Bread',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 0,
    tax_rate: 0,
  });
  const oldBatch = inventory.createBatch(mixed.id, 'MIX-OLD', 5, 50, localIso(-1));
  const freshBatch = inventory.createBatch(mixed.id, 'MIX-FRESH', 5, 50, localIso(30));
  inventory.recordMovement(mixed.id, 10, 'Initial stock', null, null, null, 1, null);
  const mixedSale = sell(mixed.id, 2);
  check('the mixed product sells from its FRESH batch', !!mixedSale?.sale?.id, mixedSale?.sale?.invoice_no);
  const mixedItem = db
    .prepare('SELECT batch_id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1')
    .get(mixedSale.sale.id);
  check(
    'the fresh batch was the one consumed',
    Number(mixedItem?.batch_id) === Number(freshBatch),
    `got ${mixedItem?.batch_id} want ${freshBatch} (old=${oldBatch})`
  );
  check(
    'the expired batch still has its stock',
    near(inventory.getProductBatches(mixed.id).find((b) => b.id === oldBatch)?.quantity, 5),
    String(inventory.getProductBatches(mixed.id).find((b) => b.id === oldBatch)?.quantity)
  );

  section('1.6 - the bill amendment refuses expired stock too');
  const amendTarget = inventory.createProduct({
    name: 'Amendment Expiry Cake',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 5,
    tax_rate: 0,
  });
  const amendSale = sell(amendTarget.id, 1);
  const amendError = throws(() =>
    billAmendments.amendItems({
      saleId: amendSale.sale.id,
      lines: [{ productId: amendTarget.id, qty: 4, unitPrice: 100 }],
      reason: 'Phase 1 test',
    })
  );
  check('the amendment of a normal product is allowed', amendError === null, amendError || 'ok');

  const amendExpired = inventory.createProduct({
    name: 'Amendment Expired Cake',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 5,
    tax_rate: 0,
    expiry_date: localIso(-1),
  });
  const amendSale2 = sell(amendExpired.id, 1, {
    expired_override: true,
    expired_approved_by: 1,
    expired_reason: 'test',
  });
  const amendError2 = throws(() =>
    billAmendments.amendItems({
      saleId: amendSale2.sale.id,
      lines: [{ productId: amendExpired.id, qty: 4, unitPrice: 100 }],
      reason: 'Phase 1 test',
    })
  );
  check(
    'the amendment refuses to add expired stock',
    !!amendError2 && amendError2.startsWith('Expired items:'),
    amendError2 || 'no error'
  );

  /* ── 1.7 ─ the quotation conversion obeys the stock policy ───────────────── */
  section('1.7 - a quotation conversion obeys the stock policy');
  // `max_negative_qty` is the rule that even a manager cannot break (the same
  // as a fresh sale), so it is the one that proves the conversion applies the
  // stock rules at all.
  settings.setSetting('max_negative_qty', '2');
  const quoted = inventory.createProduct({
    name: 'Quoted Bread',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 1,
    tax_rate: 0,
  });
  const quote = quotations.createQuotation({
    customer_id: null,
    user_id: 1,
    items: [{ product_id: quoted.id, qty: 5, unit_price: 100, line_total: 500 }],
  });
  check('the quotation was created', !!quote.ok && quote.id > 0, quote.message || String(quote.id));
  const converted = quotations.convertToSale(quote.id, 1);
  check('the conversion is REFUSED (the policy caps the negative stock)', converted.ok === false, JSON.stringify(converted));
  check(
    'the refusal names the stock',
    !!converted.message && converted.message.includes('max negative qty'),
    converted.message
  );
  check('the stock is unchanged', near(stockOf(quoted.id), 1), String(stockOf(quoted.id)));
  settings.setSetting('max_negative_qty', '0');
  settings.setSetting('allow_negative_stock', 'warn');

  /* ── 1.8 ─ the ledger records the user + the branch ──────────────────────── */
  section('1.8 - the stock ledger records who moved the stock');
  const ledgerProduct = inventory.createProduct({
    name: 'Ledger Bread',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 3,
    tax_rate: 0,
  });
  const ledgerSale = sell(ledgerProduct.id, 1);
  const ledgerRow = db
    .prepare("SELECT * FROM stock_movements WHERE product_id = ? AND reason = 'Sale' ORDER BY id DESC LIMIT 1")
    .get(ledgerProduct.id);
  check('the movement row was written', !!ledgerRow, JSON.stringify(ledgerRow));
  check('the movement records the USER', Number(ledgerRow?.user_id) === 1, String(ledgerRow?.user_id));
  check(
    'the movement records the branch (null when the shop has none)',
    ledgerRow?.branch_id === null || ledgerRow?.branch_id === undefined || Number(ledgerRow.branch_id) > 0,
    String(ledgerRow?.branch_id)
  );

  /* ── 1.9 ─ the inventory-report queries run ──────────────────────────────── */
  section('1.9 - the inventory-report queries run');
  const supplier = purchases.createSupplier('Phase 1 Supplier');
  const po = purchases.createPurchaseOrder(
    supplier.id,
    [{ product_id: ledgerProduct.id, qty: 2, unit_cost: 50, unit_name: 'box' }],
    { status: 'ordered' }
  );
  check('the purchase order was created', !!po?.id, String(po?.id));
  const historyError = throws(() => inventoryReports.getInventoryReports().getPurchaseHistory());
  check('the purchase history query runs (it used to select a missing column)', historyError === null, historyError || 'ok');
  const summaryError = throws(() =>
    inventoryReports.getInventoryReports().getProductPurchaseSummary(ledgerProduct.id)
  );
  check('the product purchase summary query runs', summaryError === null, summaryError || 'ok');

  /* ── 1.10 ─ the purchase line snapshot is COMPLETE ───────────────────────── */
  section('1.10 - the purchase line snapshot is complete');
  const poItem = db.prepare('SELECT * FROM purchase_items WHERE purchase_order_id = ?').get(po.id);
  check('the unit name was stored', poItem?.unit_name === 'box', String(poItem?.unit_name));
  check('the line total was stored', near(poItem?.total_cost, 100), String(poItem?.total_cost));
  check('the legacy batch number was stored (the expiry alert reads it)', poItem?.batch_number !== undefined, String(poItem?.batch_number));
  check('the legacy received quantity was stored', poItem?.quantity_received !== null && poItem?.quantity_received !== undefined, String(poItem?.quantity_received));

  const alertProduct = inventory.createProduct({
    name: 'Alert Cake',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 0,
    tax_rate: 0,
  });
  const alertPo = purchases.createPurchaseOrder(
    supplier.id,
    [{ product_id: alertProduct.id, qty: 5, unit_cost: 50, batch_no: 'ALERT-1', expiry_date: localIso(10) }],
    { status: 'ordered' }
  );
  const expiryAlerts = alertService.getAlertService().checkExpiry();
  check('the purchase expiry alert sees the purchase (it used to be invisible)', expiryAlerts >= 1, String(expiryAlerts));

  /* ── 1.11 + 1.12 ─ the import converts the pack and undoes exactly ──────── */
  section('1.11 + 1.12 - the import converts a pack into base units');
  const packed = inventory.createProduct({
    name: 'Packed Cookies',
    sale_price: 240,
    cost_price: 120,
    stock_qty: 0,
    tax_rate: 0,
    units: [
      { level: 0, name: 'Piece', quantity_in_base_units: 1, is_base: true, price: null, barcode: null },
      { level: 1, name: 'Box', quantity_in_base_units: 12, is_base: false, price: null, barcode: null },
    ],
  });
  const imported = purchaseImport.importPurchaseOrders({
    supplier_id: supplier.id,
    document_type: 'purchase_invoice',
    options: { updateCostPrice: true },
    rows: [
      {
        row: 2,
        product_id: packed.id,
        qty: 2,
        unit_cost: 1200,
        units_in_base: 12,
        unit_name: 'Box',
        batch_no: 'IMP-BATCH-1',
        expiry_date: localIso(60),
      },
    ],
  });
  check('the import ran', imported.imported === 1, JSON.stringify(imported.errors));
  check('the stock is in BASE units (2 boxes of 12 = 24 pieces)', near(stockOf(packed.id), 24), String(stockOf(packed.id)));
  const importedBatch = db
    .prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1')
    .get(packed.id);
  check('the batch holds 24 base units', near(importedBatch?.quantity, 24), String(importedBatch?.quantity));
  check('the batch remembers what it received', near(importedBatch?.quantity_received, 24), String(importedBatch?.quantity_received));
  check('the cost per base unit is 1200 / 12 = 100', near(importedBatch?.cost_price, 100), String(importedBatch?.cost_price));
  const importedLine = db
    .prepare('SELECT * FROM purchase_items WHERE purchase_order_id = ?')
    .get(imported.purchase_order_id);
  check('the batch number was stored on the line (the undo needs it)', importedLine?.batch_no === 'IMP-BATCH-1', String(importedLine?.batch_no));

  const undone = purchaseImport.undoPurchaseImport(imported.import_id);
  check('the import was undone', undone.ok === true, undone.message);
  check('the stock is back to 0', near(stockOf(packed.id), 0), String(stockOf(packed.id)));
  const batchesLeft = db
    .prepare('SELECT COUNT(*) AS c FROM product_batches WHERE product_id = ?')
    .get(packed.id).c;
  check('the generated batch was removed (it used to survive the undo)', Number(batchesLeft) === 0, String(batchesLeft));

  /* ── 1.12 ─ ONE conversion rule ──────────────────────────────────────────── */
  section('1.12 - one unit-conversion rule');
  check('1.5 boxes of 12 = 18 pieces', units.baseQty(1.5, 12) === 18, String(units.baseQty(1.5, 12)));
  check('the quantity is rounded to the stock precision (3)', units.baseQty(0.3333, 1) === 0.333, String(units.baseQty(0.3333, 1)));
  check('a missing factor means 1 (never zero)', units.unitsInBase(undefined) === 1, String(units.unitsInBase(undefined)));
  check('a zero factor means 1 (never zero)', units.unitsInBase(0) === 1, String(units.unitsInBase(0)));
  check('the cost per base unit is 1200 / 12 = 100', units.costPerBaseUnit(1200, 12) === 100, String(units.costPerBaseUnit(1200, 12)));

  const receivedPo = purchases.createPurchaseOrder(
    supplier.id,
    [{ product_id: packed.id, qty: 1.5, unit_cost: 1200, units_in_base: 12, unit_name: 'Box' }],
    { status: 'ordered' }
  );
  purchases.receivePurchaseOrder(receivedPo.id);
  check('the receipt put 18 pieces on the shelf', near(stockOf(packed.id), 18), String(stockOf(packed.id)));
  const receiptBatch = db
    .prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1')
    .get(packed.id);
  check('the batch quantity equals the product stock (no rounding drift)', near(receiptBatch?.quantity, stockOf(packed.id)), `batch=${receiptBatch?.quantity} stock=${stockOf(packed.id)}`);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All inventory-model checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
