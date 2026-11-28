#!/usr/bin/env node
/**
 * Bill amendment — the ITEMS (item / qty / price) suite.
 *
 * Runs the REAL `src/main/services/billAmendments.ts` (the `amendItems`
 * service) and the REAL `src/shared/billAmendItems.ts` (the pure rules)
 * against a throwaway database, so every assertion covers the code path the
 * "Amend bill → Items" screen uses.
 *
 * The rules that must never drift:
 *   - a line that loses units gives them back to the SHELF and to the FIFO
 *     batch they came from (the newest allocation first),
 *   - a line that gains units takes them from the OLDEST batch first,
 *   - a line that only changes its PRICE moves no stock at all,
 *   - the bill's totals are recomputed with the exact maths a fresh sale uses,
 *   - the paid rows of the bill never change; the udhaar follows the
 *     customer's ledger and the cash follows the open shift,
 *   - a cashier is refused in the SERVICE, every amendment needs a reason,
 *   - a refunded bill is left alone (the refund is its own record),
 *   - one transaction: a mid-write failure leaves nothing behind.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_billAmendItems.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-bill-amend-items-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'bill-amend-items-test.db');

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
  const shifts = require('../dist/main/services/shifts.js');
  const sales = require('../dist/main/services/sales.js');
  const auth = require('../dist/main/services/auth.js');
  const admin = require('../dist/main/services/admin.js');
  const billAmend = require('../dist/main/services/billAmendments.js');
  const settings = require('../dist/main/services/settings.js');
  const pure = require('../dist/shared/billAmendItems.js');

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  auth.setSessionUser(1); // user 1 is the seeded owner

  const stockOf = (productId) => Number(inventory.getProduct(productId).stock_qty);
  const balanceOf = (customerId) =>
    Number((db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId) || {}).balance || 0);
  const batchQty = (batchId) =>
    Number((db.prepare('SELECT quantity FROM product_batches WHERE id = ?').get(batchId) || {}).quantity || 0);
  const allocationsOf = (saleItemId) =>
    db
      .prepare('SELECT product_batch_id, allocated_qty FROM fifo_allocations WHERE sale_item_id = ? ORDER BY id')
      .all(saleItemId);
  const movementCount = (productId) =>
    Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ? AND ref_type = 'sale_amend'")
        .get(productId).c || 0
    );
  const amendRows = (saleId) =>
    db.prepare('SELECT * FROM sale_amendments WHERE sale_id = ? ORDER BY id').all(saleId);

  console.log('=== Rokar POS - Bill amendment: items / qty / price ===');

  // ───────────────────────────────────────────────────────────────────────────
  section('The pure rules (the real dist module)');

  const line = { productId: 1, name: 'X', qty: 3, unitPrice: 100, lineDiscount: 10, taxRate: 10 };
  const money = pure.lineMoney(line);
  check('the taxable amount is price × qty − the discount', near(money.taxable, 290), String(money.taxable));
  check('the tax is on the taxable amount', near(money.tax, 29), String(money.tax));
  check('the line total is taxable + tax', near(money.total, 319), String(money.total));

  const free = pure.lineMoney({ productId: 1, name: 'X', qty: 2, unitPrice: 50, lineDiscount: 0, taxRate: 0 });
  check('a line without a discount or a tax is price × qty', near(free.total, 100), String(free.total));
  const over = pure.lineMoney({ productId: 1, name: 'X', qty: 1, unitPrice: 10, lineDiscount: 50, taxRate: 0 });
  check('a discount larger than the line floors it at zero', near(over.taxable, 0), String(over.taxable));

  const totals = pure.recomputeSaleTotals(
    [
      { productId: 1, name: 'A', qty: 2, unitPrice: 100, lineDiscount: 0, taxRate: 0 },
      { productId: 2, name: 'B', qty: 1, unitPrice: 50, lineDiscount: 0, taxRate: 10 },
    ],
    { billDiscount: 10, discountType: 'amount', serviceCharge: 5, freight: 7 }
  );
  check('the subtotal excludes the tax', near(totals.subtotal, 250), String(totals.subtotal));
  check('the tax is summed up', near(totals.taxAmount, 5), String(totals.taxAmount));
  check('the gross includes the tax', near(totals.gross, 255), String(totals.gross));
  check('the bill discount comes off the gross', near(totals.total, 245), String(totals.total));
  check('the service charge and the freight are added', near(totals.finalTotal, 257), String(totals.finalTotal));

  const parts = pure.distributeAmount(100, [1, 1, 1]);
  check('a split adds up exactly', near(parts.reduce((s, v) => s + v, 0), 100), JSON.stringify(parts));
  const uneven = pure.distributeAmount(10, [1, 1, 1]);
  check('an uneven split adds up exactly', near(uneven.reduce((s, v) => s + v, 0), 10), JSON.stringify(uneven));
  const weighted = pure.distributeAmount(100, [3, 1]);
  check('a weighted split follows the weights', near(weighted[0], 75) && near(weighted[1], 25), JSON.stringify(weighted));

  const deltas = pure.planItemStockDeltas(
    [
      { productId: 1, name: 'A', qty: 3, unitPrice: 100, lineDiscount: 0, taxRate: 0 },
      { productId: 2, name: 'B', qty: 1, unitPrice: 50, lineDiscount: 0, taxRate: 0 },
    ],
    [
      { productId: 1, name: 'A', qty: 2, unitPrice: 100, lineDiscount: 0, taxRate: 0 },
      { productId: 3, name: 'C', qty: 4, unitPrice: 20, lineDiscount: 0, taxRate: 0 },
    ]
  );
  const dA = deltas.find((d) => d.productId === 1);
  const dB = deltas.find((d) => d.productId === 2);
  const dC = deltas.find((d) => d.productId === 3);
  check('a smaller qty gives the stock back', dA.delta === 1, String(dA.delta));
  check('a removed line gives its whole qty back', dB.delta === 1, String(dB.delta));
  check('an added line takes its qty out', dC.delta === -4, String(dC.delta));

  const priceOnly = pure.planItemStockDeltas(
    [{ productId: 1, name: 'A', qty: 3, unitPrice: 100, lineDiscount: 0, taxRate: 0 }],
    [{ productId: 1, name: 'A', qty: 3, unitPrice: 90, lineDiscount: 0, taxRate: 0 }]
  );
  check('a price-only change moves no stock', priceOnly[0].delta === 0, String(priceOnly[0].delta));
  check('a price-only change is still a change', priceOnly[0].priceChanged === true);

  check('an empty bill is refused', !!pure.validateItemLines([]));
  check(
    'a qty of zero is refused',
    /more than zero/i.test(String(pure.validateItemLines([{ productId: 1, name: 'A', qty: 0, unitPrice: 10, lineDiscount: 0, taxRate: 0 }])))
  );
  check(
    'a negative price is refused',
    /cannot be negative/i.test(String(pure.validateItemLines([{ productId: 1, name: 'A', qty: 1, unitPrice: -5, lineDiscount: 0, taxRate: 0 }])))
  );
  check(
    'the same product twice is refused',
    /twice/i.test(
      String(
        pure.validateItemLines([
          { productId: 1, name: 'A', qty: 1, unitPrice: 10, lineDiscount: 0, taxRate: 0 },
          { productId: 1, name: 'A', qty: 2, unitPrice: 10, lineDiscount: 0, taxRate: 0 },
        ])
      )
    )
  );

  // The money rules
  const splitSame = pure.planItemsSplit(200, 200, { cash: 200, card: 0, bank: 0, credit: 0 }, false);
  check('nothing changes when the total does not', splitSame.creditEffect === 0 && splitSame.cashEffect === 0);
  const splitUp = pure.planItemsSplit(200, 250, { cash: 100, card: 0, bank: 0, credit: 100 }, true);
  check('a bigger bill puts the extra on the ledger', near(splitUp.after.credit, 150), JSON.stringify(splitUp.after));
  check('a bigger bill moves no cash when there is a customer', splitUp.cashEffect === 0, String(splitUp.cashEffect));
  const splitUpWalkIn = pure.planItemsSplit(200, 250, { cash: 200, card: 0, bank: 0, credit: 0 }, false);
  check('a bigger walk-in bill takes the extra in cash', near(splitUpWalkIn.after.cash, 250), JSON.stringify(splitUpWalkIn.after));
  check('the extra cash lands in the drawer', near(splitUpWalkIn.cashEffect, 50), String(splitUpWalkIn.cashEffect));
  const splitDown = pure.planItemsSplit(200, 150, { cash: 200, card: 0, bank: 0, credit: 0 }, false);
  check('a smaller bill gives the difference back in cash', near(splitDown.after.cash, 150), JSON.stringify(splitDown.after));
  check('the drawer gives the difference back', near(splitDown.cashEffect, -50), String(splitDown.cashEffect));
  const splitDownLedger = pure.planItemsSplit(200, 150, { cash: 100, card: 0, bank: 0, credit: 100 }, true);
  check('a smaller bill shrinks the udhaar', near(splitDownLedger.after.credit, 50), JSON.stringify(splitDownLedger.after));
  check('the customer owes less', near(splitDownLedger.creditEffect, -50), String(splitDownLedger.creditEffect));
  const splitRefundTooBig = pure.planItemsSplit(200, 150, { cash: 20, card: 180, bank: 0, credit: 0 }, false);
  check(
    'a refund bigger than the cash is refused',
    /more than the .* cash this bill took/i.test(String(splitRefundTooBig.problem)),
    String(splitRefundTooBig.problem)
  );

  // ───────────────────────────────────────────────────────────────────────────
  section('The shop');

  /** A product with real batches, so the FIFO has something to allocate. */
  function makeProduct(name, salePrice, costPrice, batches) {
    const product = inventory.createProduct({
      name,
      sale_price: salePrice,
      cost_price: costPrice,
      stock_qty: 0,
      tax_rate: 0,
    });
    let total = 0;
    const ids = [];
    batches.forEach((qty, i) => {
      const id = inventory.createBatch(product.id, `${name}-B${i + 1}`, qty, costPrice, null);
      // A purchase records the received quantity and the date; createBatch
      // does not, so the fixture fills them in (same as a real purchase row).
      db.prepare(
        "UPDATE product_batches SET quantity_received = ?, received_date = ? WHERE id = ?"
      ).run(qty, `2026-01-0${i + 1}`, id);
      ids.push(id);
      total += qty;
    });
    inventory.recordMovement(product.id, total, 'Purchase', 'purchase', null, null);
    return { product, batchIds: ids };
  }

  const a = makeProduct('Items Widget A', 100, 60, [2, 50]); // the sale spans both batches
  const b = makeProduct('Items Widget B', 100, 60, [40]);
  const c = makeProduct('Items Widget C', 30, 10, [25, 25]);
  const customer = sales.createCustomer('Items Customer');
  const shift = shifts.openShift(1000);

  check('the product stock matches its batches', stockOf(a.product.id) === 52, String(stockOf(a.product.id)));
  check('the batches are stocked', batchQty(a.batchIds[0]) === 2 && batchQty(a.batchIds[1]) === 50);

  // A bill: 4 × A (2 from the first batch, 2 from the second) + 1 × B,
  // 200 cash and 200 udhaar.
  const sale1 = sales.createSale({
    items: [
      { product_id: a.product.id, qty: 4, price: 100, line_discount: 0, tax_rate: 0 },
      { product_id: b.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 },
    ],
    customer_id: customer.id,
    payments: [{ mode: 'cash', amount: 200 }],
  });
  const sale1Id = sale1.sale.id;
  check('the bill is 500 with 300 udhaar', near(sale1.sale.total_amount, 500) && near(sale1.balance, 300), `${sale1.sale.total_amount} / ${sale1.balance}`);
  check('the stock went down by 5', stockOf(a.product.id) === 48 && stockOf(b.product.id) === 39);

  const rows1 = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(sale1Id);
  const aRows = rows1.filter((r) => r.product_id === a.product.id);
  check('the line was split over two batches', aRows.length === 2, `${aRows.length} rows`);
  const alloc1 = allocationsOf(aRows[0].id);
  const alloc2 = allocationsOf(aRows[1].id);
  check('the first row took the oldest batch', alloc1.length === 1 && alloc1[0].product_batch_id === a.batchIds[0], JSON.stringify(alloc1));
  check('the second row took the next batch', alloc2.length === 1 && alloc2[0].product_batch_id === a.batchIds[1], JSON.stringify(alloc2));
  check('the first batch is empty now', batchQty(a.batchIds[0]) === 0, String(batchQty(a.batchIds[0])));
  check('the second batch lost 2', batchQty(a.batchIds[1]) === 48, String(batchQty(a.batchIds[1])));

  // ───────────────────────────────────────────────────────────────────────────
  section('The permissions live in the service');

  const cashier = auth.createUser({ username: 'items_cashier', password: 'Cashier123', pin: '1111', role: 'cashier' });
  auth.setSessionUser(cashier.id);
  const cashierErr = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [{ productId: a.product.id, qty: 3, unitPrice: 100 }],
      reason: 'cashier try',
    })
  );
  check('a cashier can never change the items', /only the owner or a manager/i.test(cashierErr || ''), cashierErr);

  auth.setSessionUser(1);
  const noReason = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [{ productId: a.product.id, qty: 3, unitPrice: 100 }],
      reason: '   ',
    })
  );
  check('a reason is required', /reason is required/i.test(noReason || ''), noReason);

  const noChange = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [
        { productId: a.product.id, qty: 4, unitPrice: 100 },
        { productId: b.product.id, qty: 1, unitPrice: 100 },
      ],
      reason: 'same',
    })
  );
  check('nothing to change is refused', /nothing to change/i.test(noChange || ''), noChange);

  const zeroQty = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [
        { productId: a.product.id, qty: 0, unitPrice: 100 },
        { productId: b.product.id, qty: 1, unitPrice: 100 },
      ],
      reason: 'zero',
    })
  );
  check('a qty of zero is refused', /more than zero/i.test(zeroQty || ''), zeroQty);

  const belowCost = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [
        { productId: a.product.id, qty: 4, unitPrice: 10 },
        { productId: b.product.id, qty: 1, unitPrice: 100 },
      ],
      reason: 'cheap',
    })
  );
  check('a price below the cost is refused', /below cost/i.test(belowCost || ''), belowCost);

  const missingProduct = throws(() =>
    billAmend.amendItems({
      saleId: sale1Id,
      lines: [{ productId: 999999, qty: 1, unitPrice: 10 }],
      reason: 'ghost',
    })
  );
  check('a product that does not exist is refused', /not found/i.test(missingProduct || ''), missingProduct);

  // nothing was written by any refusal
  check('no refusal wrote an amendment', amendRows(sale1Id).length === 0, String(amendRows(sale1Id).length));
  check('no refusal moved the stock', stockOf(a.product.id) === 48, String(stockOf(a.product.id)));

  // ───────────────────────────────────────────────────────────────────────────
  section('A smaller qty: the stock and the FIFO come back');

  const beforeBalance = balanceOf(customer.id);
  const res1 = billAmend.amendItems({
    saleId: sale1Id,
    lines: [
      { productId: a.product.id, qty: 3, unitPrice: 100 },
      { productId: b.product.id, qty: 1, unitPrice: 100 },
    ],
    reason: 'customer took 3, not 4',
  });
  check('the amendment succeeded', res1 && res1.ok === true);
  check('the bill is 400 now', near(res1.state.total, 400), String(res1.state.total));
  check('the udhaar is 200 now', near(res1.state.credit, 200), String(res1.state.credit));
  check('the customer owes 100 less', near(balanceOf(customer.id), beforeBalance - 100), String(balanceOf(customer.id)));

  check('the stock came back', stockOf(a.product.id) === 49, String(stockOf(a.product.id)));
  check('the newest batch got the unit back', batchQty(a.batchIds[1]) === 49, String(batchQty(a.batchIds[1])));
  check('the oldest batch was left alone', batchQty(a.batchIds[0]) === 0, String(batchQty(a.batchIds[0])));
  const rows1b = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(sale1Id);
  const aRowsB = rows1b.filter((r) => r.product_id === a.product.id);
  check('the line now holds 3 units', near(aRowsB.reduce((s, r) => s + r.qty, 0), 3), String(aRowsB.reduce((s, r) => s + r.qty, 0)));
  const alloc1b = allocationsOf(aRowsB[0].id);
  const alloc2b = allocationsOf(aRowsB[1].id);
  check('the oldest allocation is untouched', near(alloc1b[0].allocated_qty, 2), JSON.stringify(alloc1b));
  check('the newest allocation lost one', near(alloc2b[0].allocated_qty, 1), JSON.stringify(alloc2b));
  check('the stock movement is recorded', movementCount(a.product.id) === 1, String(movementCount(a.product.id)));

  const sale1After = sales.getSale(sale1Id);
  check('the stored total is 400', near(sale1After.total_amount, 400), String(sale1After.total_amount));
  check('the stored subtotal is 400', near(sale1After.subtotal, 400), String(sale1After.subtotal));
  const itemTotal = Number(
    db.prepare('SELECT COALESCE(SUM(line_total), 0) AS t FROM sale_items WHERE sale_id = ?').get(sale1Id).t
  );
  check('the items add up to the bill', near(itemTotal, 400), String(itemTotal));

  const amendment1 = amendRows(sale1Id)[0];
  check('the amendment row is written', !!amendment1);
  check('it is an items amendment', amendment1.kind === 'items', amendment1.kind);
  check('it carries the reason', amendment1.reason === 'customer took 3, not 4');
  const beforeJson = JSON.parse(amendment1.before_json);
  const afterJson = JSON.parse(amendment1.after_json);
  check('the history shows the old qty', near(beforeJson.items[0].qty, 4), JSON.stringify(beforeJson.items));
  check('the history shows the new qty', near(afterJson.items[0].qty, 3), JSON.stringify(afterJson.items));
  check('the history shows the credit effect', near(amendment1.credit_effect, -100), String(amendment1.credit_effect));
  check('the bill counts the amendment', Number(sales.getSale(sale1Id).amended_count) === 1);
  const events = db
    .prepare("SELECT COUNT(*) AS c FROM sale_events WHERE sale_id = ? AND event_type = 'amend'")
    .get(sale1Id).c;
  check('the timeline has the amendment', Number(events) === 1, String(events));

  // ───────────────────────────────────────────────────────────────────────────
  section('A price-only change moves no stock');

  const movementsBefore = movementCount(b.product.id);
  const stockBefore = stockOf(b.product.id);
  const res2 = billAmend.amendItems({
    saleId: sale1Id,
    lines: [
      { productId: a.product.id, qty: 3, unitPrice: 100 },
      { productId: b.product.id, qty: 1, unitPrice: 80 },
    ],
    reason: 'the price was wrong',
  });
  check('the amendment succeeded', res2 && res2.ok === true);
  check('the bill is 380 now', near(res2.state.total, 380), String(res2.state.total));
  check('the udhaar is 180 now', near(res2.state.credit, 180), String(res2.state.credit));
  check('the stock did not move', stockOf(b.product.id) === stockBefore, `${stockBefore} -> ${stockOf(b.product.id)}`);
  check('no stock movement was written', movementCount(b.product.id) === movementsBefore);
  check('the bill is marked price-overridden', Number(sales.getSale(sale1Id).price_overridden) === 1);

  // ───────────────────────────────────────────────────────────────────────────
  section('A removed line gives its whole qty back');

  const stockBBefore = stockOf(b.product.id);
  const res3 = billAmend.amendItems({
    saleId: sale1Id,
    lines: [{ productId: a.product.id, qty: 3, unitPrice: 100 }],
    reason: 'the customer did not take the B',
  });
  check('the amendment succeeded', res3 && res3.ok === true);
  check('the bill is 300 now', near(res3.state.total, 300), String(res3.state.total));
  check('the udhaar is 100 now', near(res3.state.credit, 100), String(res3.state.credit));
  check('the whole line came back', stockOf(b.product.id) === stockBBefore + 1, `${stockBBefore} -> ${stockOf(b.product.id)}`);
  const bRows = db
    .prepare('SELECT * FROM sale_items WHERE sale_id = ? AND product_id = ?')
    .all(sale1Id, b.product.id);
  check('the row of the removed line is gone', bRows.length === 0, String(bRows.length));
  const bAlloc = db
    .prepare(
      'SELECT COUNT(*) AS c FROM fifo_allocations WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?)'
    )
    .get(sale1Id, b.product.id).c;
  check('its FIFO allocations are gone too', Number(bAlloc) === 0, String(bAlloc));

  // ───────────────────────────────────────────────────────────────────────────
  section('An added line takes its qty out of the oldest batch');

  const stockCBefore = stockOf(c.product.id);
  const res4 = billAmend.amendItems({
    saleId: sale1Id,
    lines: [
      { productId: a.product.id, qty: 3, unitPrice: 100 },
      { productId: c.product.id, qty: 2, unitPrice: 30 },
    ],
    reason: 'the customer also took 2 of the C',
  });
  check('the amendment succeeded', res4 && res4.ok === true);
  check('the bill is 360 now', near(res4.state.total, 360), String(res4.state.total));
  check('the stock went down by 2', stockOf(c.product.id) === stockCBefore - 2, `${stockCBefore} -> ${stockOf(c.product.id)}`);
  check('the oldest batch paid for it', batchQty(c.batchIds[0]) === 23, String(batchQty(c.batchIds[0])));
  check('the newer batch was left alone', batchQty(c.batchIds[1]) === 25, String(batchQty(c.batchIds[1])));
  const cRows = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND product_id = ?').all(sale1Id, c.product.id);
  check('the new line has a row', cRows.length === 1, String(cRows.length));
  const cAlloc = allocationsOf(cRows[0].id);
  check('the new row points at the oldest batch', cAlloc.length === 1 && cAlloc[0].product_batch_id === c.batchIds[0], JSON.stringify(cAlloc));
  check('the allocation carries the qty', near(cAlloc[0].allocated_qty, 2), JSON.stringify(cAlloc));

  // ───────────────────────────────────────────────────────────────────────────
  section('The money follows the bill');

  // The customer now owes 160 on this bill (360 − 200 paid).
  check('the udhaar is 160', near(res4.state.credit, 160), String(res4.state.credit));
  check(
    'the customer ledger is the bill credit',
    near(balanceOf(customer.id), 160),
    `${balanceOf(customer.id)} (the customer had no other bill)`
  );

  // A walk-in bill that grows takes the extra in cash.
  const walkIn = sales.createSale({
    items: [{ product_id: b.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const res5 = billAmend.amendItems({
    saleId: walkIn.sale.id,
    lines: [{ productId: b.product.id, qty: 2, unitPrice: 100 }],
    reason: 'the customer took 2',
  });
  check('the walk-in amendment succeeded', res5 && res5.ok === true);
  check('the bill is 200 now', near(res5.state.total, 200), String(res5.state.total));
  check('the drawer took the extra 100', near(res5.cashEffect, 100), String(res5.cashEffect));
  check('the shift carries the cash effect', near(billAmend.shiftAmendmentCashEffect(shift.id), 100), String(billAmend.shiftAmendmentCashEffect(shift.id)));

  // A fully paid bill that gets smaller gives the difference back.
  const paidBill = sales.createSale({
    items: [{ product_id: b.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const res6 = billAmend.amendItems({
    saleId: paidBill.sale.id,
    lines: [{ productId: b.product.id, qty: 1, unitPrice: 80 }],
    reason: 'the price was 80, not 100',
  });
  check('the paid bill amendment succeeded', res6 && res6.ok === true);
  check('the bill is 80 now', near(res6.state.total, 80), String(res6.state.total));
  check('the drawer gave 20 back', near(res6.cashEffect, -20), String(res6.cashEffect));
  check('the split follows the drawer', near(res6.state.payments[0].amount, 80), JSON.stringify(res6.state.payments));

  // ───────────────────────────────────────────────────────────────────────────
  section('A card refund the drawer cannot make is refused');

  const cardBill = sales.createSale({
    items: [{ product_id: b.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'card', amount: 100 }],
  });
  const cardErr = throws(() =>
    billAmend.amendItems({
      saleId: cardBill.sale.id,
      lines: [{ productId: b.product.id, qty: 1, unitPrice: 70 }],
      reason: 'the price was 70',
    })
  );
  check('a card refund is refused', /more than the .* cash this bill took/i.test(cardErr || ''), cardErr);

  // ───────────────────────────────────────────────────────────────────────────
  section('The stock rules still apply');

  const noStock = makeProduct('Items Widget D', 100, 60, [1]);
  const smallBill = sales.createSale({
    items: [{ product_id: noStock.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  settings.setSetting('allow_negative_stock', 'no');
  // A MANAGER may amend bills but may not break the "no negative stock"
  // policy — only the owner may.
  const itemsManager = auth.createUser({
    username: 'items_manager',
    password: 'Manager123',
    pin: '2222',
    role: 'manager',
  });
  admin.setAdminSetting('amend_allow_manager', '1');
  auth.setSessionUser(itemsManager.id);
  const stockErr = throws(() =>
    billAmend.amendItems({
      saleId: smallBill.sale.id,
      lines: [{ productId: noStock.product.id, qty: 5, unitPrice: 100 }],
      reason: 'too many',
      managerPin: '2222',
    })
  );
  check('too much stock is refused', /insufficient stock/i.test(stockErr || ''), stockErr);
  // The owner may override it.
  auth.setSessionUser(1);
  const ownerStock = billAmend.amendItems({
    saleId: smallBill.sale.id,
    lines: [{ productId: noStock.product.id, qty: 5, unitPrice: 100 }],
    reason: 'the owner knows the stock is there',
  });
  check('the owner may go over the stock policy', ownerStock && ownerStock.ok === true);
  settings.setSetting('allow_negative_stock', 'warn');

  // ───────────────────────────────────────────────────────────────────────────
  section('A refunded bill is left alone');

  const returns = require('../dist/main/services/returns.js');
  const returnBill = sales.createSale({
    items: [{ product_id: b.product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const returnRow = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(returnBill.sale.id);
  returns.createReturn({
    sale_id: returnBill.sale.id,
    reason: 'customer sent it back',
    refund_mode: 'cash',
    restock: true,
    items: [{ sale_item_id: returnRow.id, qty: 1, unit_price: 100 }],
  });
  const returnedErr = throws(() =>
    billAmend.amendItems({
      saleId: returnBill.sale.id,
      lines: [{ productId: b.product.id, qty: 1, unitPrice: 70 }],
      reason: 'the price was wrong',
    })
  );
  check('a refunded bill refuses an items amendment', /has a return/i.test(returnedErr || ''), returnedErr);
  const returnedView = billAmend.getBillAmendView(returnBill.sale.id);
  check('the view explains why the items are blocked', /has a return/i.test(String(returnedView.itemsBlockedReason || '')), String(returnedView.itemsBlockedReason));
  check('the view says the items are not allowed', returnedView.itemsAllowed === false);

  // ───────────────────────────────────────────────────────────────────────────
  section('One transaction: a failure leaves nothing behind');

  const txSale = sales.createSale({
    items: [{ product_id: a.product.id, qty: 2, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customer.id,
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const txStockBefore = stockOf(a.product.id);
  const txTotalBefore = sales.getSale(txSale.sale.id).total_amount;
  const txRowsBefore = amendRows(txSale.sale.id).length;
  const txBalanceBefore = balanceOf(customer.id);
  // A product that does not exist makes the service fail AFTER it read the
  // bill — nothing may be written.
  const txErr = throws(() =>
    billAmend.amendItems({
      saleId: txSale.sale.id,
      lines: [
        { productId: a.product.id, qty: 1, unitPrice: 100 },
        { productId: 987654, qty: 1, unitPrice: 10 },
      ],
      reason: 'a broken amendment',
    })
  );
  check('the broken amendment is refused', !!txErr, String(txErr));
  check('the stock is untouched', stockOf(a.product.id) === txStockBefore, `${txStockBefore} -> ${stockOf(a.product.id)}`);
  check('the bill total is untouched', near(sales.getSale(txSale.sale.id).total_amount, txTotalBefore));
  check('no amendment row was written', amendRows(txSale.sale.id).length === txRowsBefore);
  check('the customer ledger is untouched', near(balanceOf(customer.id), txBalanceBefore));

  // ───────────────────────────────────────────────────────────────────────────
  section('The view carries the items');

  const view = billAmend.getBillAmendView(sale1Id);
  check('the view has the lines', Array.isArray(view.items) && view.items.length === 2, String(view.items?.length));
  check('the lines carry the qty and the price', near(view.items[0].qty, 3) && near(view.items[0].unitPrice, 100), JSON.stringify(view.items[0]));
  check('the items are allowed', view.itemsAllowed === true, String(view.itemsBlockedReason));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_billAmendItems crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the items-amendment suite did not finish in 180s');
  app.exit(2);
}, 180000);
