#!/usr/bin/env node
/**
 * Return / Refund (cart flow) suite — `returns.createReturnBill`.
 *
 * Runs the REAL src/main/services/returns.ts against a throwaway database, so the
 * assertions cover the shipped code path the Billing "Return / Refund" button uses.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_return_bill.js
 *
 * Why this exists: the cart flow records the refund as its own NEGATIVE sale
 * (`status = 'returned'`, `total_amount < 0`) instead of reusing an existing
 * invoice. That has three failure modes reading the code does not reveal:
 *
 *   1. The negative sale could leak into a revenue figure. Every report/drawer
 *      query filters `status = 'completed'`, so the test asserts `listSales()`
 *      omits it and that the shift's `cash_refunds` (which sums the `returns`
 *      row, not the sale) carries the cash-out exactly once.
 *   2. Stock could be forgotten (or double-counted) — restock must put qty back
 *      and write one `stock_movements` row.
 *   3. A credit refund must move the customer ledger, while a cash refund must not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// Electron treats the script's folder as the app root, which would send db.ts
// looking for `scripts/migrations`. Point it back at the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-return-bill-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'return-bill-test.db');

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
  const auth = require('../dist/main/services/auth.js');
  const admin = require('../dist/main/services/admin.js');

  // The admin UI writes settings to `admin_settings`; the service must read the
  // same table. (It used to read `settings`, where the threshold never landed.)
  auth.setSessionUser(1); // user 1 is the seeded owner

  const product = inventory.createProduct({
    name: 'Return Bill Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 10,
    tax_rate: 0,
  });
  const stock = () => Number(inventory.getProduct(product.id).stock_qty);

  const shift = shifts.openShift(1000);

  // ── Cash return: stock up, cash out, negative sale excluded from sales ──────
  section('Cash refund');
  check('shift opened', shift.id > 0 && near(shift.start_cash, 1000));

  const before = stock();
  const cashReturn = returns.createReturnBill({
    items: [{ product_id: product.id, qty: 2, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
  });

  check('refund amount = qty x price', near(cashReturn.refund_amount, 200), String(cashReturn.refund_amount));
  check('return row keeps the refund mode', cashReturn.refund_mode === 'cash', cashReturn.refund_mode);
  check('return row records restock', Number(cashReturn.restock) === 1);
  check('return has one item line', cashReturn.items.length === 1 && near(cashReturn.items[0].qty, 2));
  check('stock restored (+2)', near(stock(), before + 2), `${before} -> ${stock()}`);

  const movement = db
    .prepare(
      `SELECT * FROM stock_movements
       WHERE product_id = ? AND ref_type = 'return' AND ref_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(product.id, cashReturn.id);
  check(
    'one stock movement written for the restock',
    !!movement && near(movement.change_qty, 2) && /returned to stock/i.test(movement.reason || ''),
    movement ? `${movement.change_qty} | ${movement.reason}` : 'missing'
  );

  const tailSale = sales.getSale(cashReturn.sale_id);
  check('return is saved as a negative sale', !!tailSale && near(tailSale.total_amount, -200), String(tailSale?.total_amount));
  check('return sale status is "returned"', tailSale?.status === 'returned', String(tailSale?.status));
  check('return sale is attached to the open shift', tailSale?.shift_id === shift.id, String(tailSale?.shift_id));
  check('return invoice is RET-…', /^RET-\d{8}-\d{4}$/.test(tailSale?.invoice_no || ''), tailSale?.invoice_no);
  check(
    'negative sale carries a matching negative cash payment',
    tailSale?.payments.length === 1 && tailSale.payments[0].mode === 'cash' && near(tailSale.payments[0].amount, -200)
  );

  const totalsAfterCash = shifts.shiftTotals(shift.id);
  check('shift cash refunds include the cash return once', near(totalsAfterCash.cash_refunds, 200), String(totalsAfterCash.cash_refunds));
  check('shift expected cash drops by the refund', near(totalsAfterCash.expected, 800), String(totalsAfterCash.expected));

  const listed = sales.listSales();
  check('the RET- sale never appears in the normal sales list', listed.every((s) => !String(s.invoice_no).startsWith('RET-')));
  check('the return is listed on the Returns screen', returns.listReturns().some((r) => r.id === cashReturn.id));

  // ── Credit refund: customer ledger moves, cash drawer does not ──────────────
  section('Credit refund (adjust to customer credit)');
  const customer = sales.createCustomer('Return Credit Customer');
  db.prepare('UPDATE customers SET balance = 50 WHERE id = ?').run(customer.id);

  const stockBeforeCredit = stock();
  const creditReturn = returns.createReturnBill({
    items: [{ product_id: product.id, qty: 1, unit_price: 100 }],
    customer_id: customer.id,
    refund_mode: 'credit',
    restock: true,
  });

  const balanceAfter = Number(
    (db.prepare('SELECT balance FROM customers WHERE id = ?').get(customer.id) || {}).balance
  );
  check('customer balance reduced by the refund', near(balanceAfter, -50), String(balanceAfter));
  check('stock restored on a credit return too', near(stock(), stockBeforeCredit + 1), String(stock()));

  const txn = db
    .prepare("SELECT * FROM customer_transactions WHERE customer_id = ? AND type = 'return' ORDER BY id DESC LIMIT 1")
    .get(customer.id);
  check('ledger entry records the credit return', !!txn && near(txn.amount, -100), txn ? String(txn.amount) : 'missing');

  const totalsAfterCredit = shifts.shiftTotals(shift.id);
  check(
    'a credit refund does not touch drawer cash',
    near(totalsAfterCredit.cash_refunds, 200),
    String(totalsAfterCredit.cash_refunds)
  );
  check('credit return still saves a new RET- sale', /^RET-/.test(sales.getSale(creditReturn.sale_id)?.invoice_no || ''));

  // ── Validation ──────────────────────────────────────────────────────────────
  section('Validation');
  check(
    'empty cart is rejected',
    /at least one item/i.test(
      throws(() => returns.createReturnBill({ items: [], refund_mode: 'cash', restock: true })) || ''
    )
  );
  check(
    'a zero/negative qty line is rejected',
    /at least one item/i.test(
      throws(() =>
        returns.createReturnBill({ items: [{ product_id: product.id, qty: 0, unit_price: 100 }], refund_mode: 'cash', restock: true })
      ) || ''
    )
  );
  check(
    'a negative unit price is rejected',
    /cannot be negative/i.test(
      throws(() =>
        returns.createReturnBill({ items: [{ product_id: product.id, qty: 1, unit_price: -5 }], refund_mode: 'cash', restock: true })
      ) || ''
    )
  );
  check(
    'a zero refund is rejected',
    /greater than zero/i.test(
      throws(() =>
        returns.createReturnBill({ items: [{ product_id: product.id, qty: 1, unit_price: 0 }], refund_mode: 'cash', restock: true })
      ) || ''
    )
  );

  // restock:false must leave the shelf alone.
  const stockNoRestock = stock();
  returns.createReturnBill({
    items: [{ product_id: product.id, qty: 1, unit_price: 100 }],
    refund_mode: 'cash',
    restock: false,
  });
  check('restock:false does not change stock', near(stock(), stockNoRestock), `${stockNoRestock} -> ${stock()}`);

  // ── Manager threshold ───────────────────────────────────────────────────────
  section('Manager refund threshold');
  admin.setAdminSetting('refund_manager_threshold', '50');
  auth.setSessionUser(null); // simulate an unauthenticated cashier
  const blocked = throws(() =>
    returns.createReturnBill({ items: [{ product_id: product.id, qty: 1, unit_price: 100 }], refund_mode: 'cash', restock: true })
  );
  check('a refund above the threshold needs a manager', /need a manager/i.test(blocked || ''), blocked || '');

  auth.setSessionUser(1); // owner
  const approved = returns.createReturnBill({
    items: [{ product_id: product.id, qty: 1, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
  });
  check('a manager/owner can approve the same refund', near(approved.refund_amount, 100));
  admin.setAdminSetting('refund_manager_threshold', '0');

  // ── Refuse without an open shift ────────────────────────────────────────────
  section('Open shift required');
  shifts.closeShift(shift.id, 0);
  const noShift = throws(() =>
    returns.createReturnBill({ items: [{ product_id: product.id, qty: 1, unit_price: 100 }], refund_mode: 'cash', restock: true })
  );
  check('a refund with no open shift is refused', /open a shift/i.test(noShift || ''), noShift || '');

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_return_bill crashed:', e);
  app.exit(1);
});
