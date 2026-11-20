#!/usr/bin/env node
/**
 * Bill amendment suite — amending a FINISHED bill.
 *
 * Runs the REAL `src/main/services/billAmendments.ts` against a throwaway
 * database, so every assertion covers the code path the "Amend bill" screen
 * uses. Nothing here greps source text and nothing short-circuits the service
 * with SQL: every check reads back what the service actually wrote.
 *
 * The money rules that must never drift:
 *   - a cashier is refused in the SERVICE (the UI hiding a button is not a
 *     permission),
 *   - a manager needs `amend_allow_manager` AND their own PIN re-entered,
 *   - every amendment needs a reason,
 *   - the bill total never changes in a customer / payment / notes amendment,
 *   - the udhaar change is the customer's ledger, the cash change is a cash
 *     adjustment on the CURRENT OPEN shift,
 *   - a closed shift is NEVER mutated (the original payment rows stay),
 *   - one transaction: a mid-write failure leaves nothing behind,
 *   - the bill keeps its original date; the amendment is its own timeline event.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_billAmend.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-bill-amend-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'bill-amend-test.db');

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
  const returns = require('../dist/main/services/returns.js');
  const auth = require('../dist/main/services/auth.js');
  const admin = require('../dist/main/services/admin.js');
  const printing = require('../dist/main/services/printing.js');
  const cashDrawer = require('../dist/main/services/cashDrawer.js');
  const reports = require('../dist/main/services/reports.js');
  const history = require('../dist/main/services/salesHistory.js');
  const billAmend = require('../dist/main/services/billAmendments.js');
  const migration089 = require('../migrations/089_bill_amendments.js');
  const settings = require('../dist/main/services/settings.js');

  // A throwaway shop that is LICENSED, exactly like seed_demo.js does — a sale
  // is refused without a licence, and that rule is not what this suite tests.
  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');

  auth.setSessionUser(1); // user 1 is the seeded owner

  const balanceOf = (customerId) =>
    Number((db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId) || {}).balance || 0);
  const amendCount = (saleId) =>
    Number(db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE sale_id = ?').get(saleId).c || 0);
  const eventsOf = (saleId, type) =>
    Number(
      db
        .prepare('SELECT COUNT(*) AS c FROM sale_events WHERE sale_id = ? AND event_type = ?')
        .get(saleId, type).c || 0
    );

  // ── Migration 089: additive + idempotent ───────────────────────────────────
  section('Migration 089 is additive and idempotent');
  const salesCols = db.prepare('PRAGMA table_info(sales)').all().map((c) => c.name);
  check('sales.amended_count exists', salesCols.includes('amended_count'));
  check('sales.last_amended_at exists', salesCols.includes('last_amended_at'));
  check(
    'sale_amendments table exists',
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_amendments'").get()
  );
  const amendCols = db.prepare('PRAGMA table_info(sale_amendments)').all().map((c) => c.name);
  check(
    'the amendment row carries before/after + the money effects',
    ['before_json', 'after_json', 'cash_effect', 'credit_effect', 'shift_id', 'reason', 'kind'].every((c) =>
      amendCols.includes(c)
    ),
    amendCols.join(',')
  );
  migration089.up(db);
  migration089.up(db);
  check(
    're-running the migration keeps exactly one amend_allow_manager row',
    Number(
      db.prepare("SELECT COUNT(*) AS c FROM admin_settings WHERE key = 'amend_allow_manager'").get().c
    ) === 1
  );
  check(
    're-running the migration keeps exactly one amend_max_days_back row',
    Number(
      db.prepare("SELECT COUNT(*) AS c FROM admin_settings WHERE key = 'amend_max_days_back'").get().c
    ) === 1
  );

  // ── Seed the shop ──────────────────────────────────────────────────────────
  const product = inventory.createProduct({
    name: 'Amend Widget',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 100,
    tax_rate: 0,
  });
  const customerA = sales.createCustomer('Amend Customer A');
  const customerB = sales.createCustomer('Amend Customer B');
  const shift1 = shifts.openShift(1000);

  const cashier = auth.createUser({ username: 'amend_cashier', password: 'cashier123', pin: '1111', role: 'cashier' });
  const manager = auth.createUser({ username: 'amend_manager', password: 'manager123', pin: '2222', role: 'manager' });

  const sale1 = sales.createSale({
    items: [{ product_id: product.id, qty: 2, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerA.id,
    payments: [{ mode: 'cash', amount: 200 }],
  });
  const sale1Id = sale1.sale.id;
  const sale1CreatedAt = String(sales.getSale(sale1Id).created_at);
  check('the bill was created (200, fully paid in cash)', near(sale1.sale.total_amount, 200) && near(sale1.balance, 0));

  // ── The permissions live in the service ────────────────────────────────────
  section('Permissions are enforced server-side');
  auth.setSessionUser(cashier.id);
  const cashierErr = throws(() => billAmend.amendNotes({ saleId: sale1Id, notes: 'cashier', reason: 'cashier try' }));
  check('a cashier can never amend', /only the owner or a manager/i.test(cashierErr || ''), cashierErr);
  check(
    'the amend view tells a cashier why',
    /only the owner or a manager/i.test(String((billAmend.getBillAmendView(sale1Id) || {}).blockedReason || ''))
  );

  auth.setSessionUser(1);
  admin.setAdminSetting('amend_allow_manager', '0');
  auth.setSessionUser(manager.id);
  const managerOffErr = throws(() =>
    billAmend.amendNotes({ saleId: sale1Id, notes: 'mgr', reason: 'manager try', managerPin: '2222' })
  );
  check('amend_allow_manager=0 refuses a manager', /cannot amend bills in this shop/i.test(managerOffErr || ''), managerOffErr);

  auth.setSessionUser(1);
  admin.setAdminSetting('amend_allow_manager', '1');
  auth.setSessionUser(manager.id);
  const managerNoPin = throws(() => billAmend.amendNotes({ saleId: sale1Id, notes: 'mgr', reason: 'manager try' }));
  check('a manager must re-enter their PIN', /pin again/i.test(managerNoPin || ''), managerNoPin);
  const managerBadPin = throws(() =>
    billAmend.amendNotes({ saleId: sale1Id, notes: 'mgr', reason: 'manager try', managerPin: '9999' })
  );
  check('a wrong PIN is refused', /not correct/i.test(managerBadPin || ''), managerBadPin);

  const managerOk = billAmend.amendNotes({
    saleId: sale1Id,
    notes: 'Manager checked the bill',
    reason: 'customer asked on the phone',
    managerPin: '2222',
  });
  check('a manager with the setting on + their PIN can amend', managerOk.ok === true);

  auth.setSessionUser(1);

  // ── A reason is mandatory ──────────────────────────────────────────────────
  section('Every amendment needs a reason');
  const noReason = throws(() => billAmend.amendNotes({ saleId: sale1Id, notes: 'x', reason: '   ' }));
  check('a blank reason is refused', /reason is required/i.test(noReason || ''), noReason);

  // ── C) Notes ───────────────────────────────────────────────────────────────
  section('C) Editing the notes');
  const notesRes = billAmend.amendNotes({ saleId: sale1Id, notes: 'Customer called - address fixed', reason: 'phone correction' });
  check('the sale row carries the new notes', sales.getSale(sale1Id).notes === 'Customer called - address fixed');
  check('a notes amendment moves no money', near(notesRes.cashEffect, 0) && near(notesRes.creditEffect, 0));

  const notesRow = db
    .prepare('SELECT * FROM sale_amendments WHERE sale_id = ? ORDER BY id DESC LIMIT 1')
    .get(sale1Id);
  const notesBefore = JSON.parse(notesRow.before_json);
  const notesAfter = JSON.parse(notesRow.after_json);
  check('before_json keeps the PREVIOUS state', notesBefore.notes === 'Manager checked the bill', String(notesBefore.notes));
  check('after_json holds the new state', notesAfter.notes === 'Customer called - address fixed', String(notesAfter.notes));
  check('the bill keeps its original date', String(sales.getSale(sale1Id).created_at) === sale1CreatedAt);

  // ── B) Payment split / udhaar ──────────────────────────────────────────────
  section('B) Moving 80 of the bill onto udhaar');
  const balanceABefore = balanceOf(customerA.id);
  const shift1ExpectedBefore = shifts.shiftTotals(shift1.id).expected;
  const payRes = billAmend.amendPayments({
    saleId: sale1Id,
    split: { cash: 120, card: 0, bank: 0, credit: 80 },
    reason: 'customer only had 120 in cash',
  });

  check('credit effect is +80', near(payRes.creditEffect, 80), String(payRes.creditEffect));
  check('cash effect is -80', near(payRes.cashEffect, -80), String(payRes.cashEffect));
  check('the customer owes 80 more', near(balanceOf(customerA.id), balanceABefore + 80), String(balanceOf(customerA.id)));

  const amendTxn = db
    .prepare("SELECT * FROM customer_transactions WHERE customer_id = ? AND sale_id = ? AND type = 'amend' ORDER BY id DESC LIMIT 1")
    .get(customerA.id, sale1Id);
  check('one ledger row records the udhaar change', !!amendTxn && near(amendTxn.amount, 80), amendTxn ? String(amendTxn.amount) : 'missing');

  const sale1After = sales.getSale(sale1Id);
  check('the bill total is unchanged', near(sale1After.total_amount, 200), String(sale1After.total_amount));
  check(
    'the bill now shows the amended split (cash 120)',
    sale1After.payments.length === 1 && sale1After.payments[0].mode === 'cash' && near(sale1After.payments[0].amount, 120),
    JSON.stringify(sale1After.payments.map((p) => [p.mode, p.amount]))
  );
  const originalCashRow = db
    .prepare("SELECT amount FROM payments WHERE sale_id = ? AND LOWER(mode) = 'cash'")
    .get(sale1Id);
  check('the ORIGINAL payment row is untouched', near(originalCashRow.amount, 200), String(originalCashRow.amount));

  check(
    'the open shift expects 80 less cash',
    near(shifts.shiftTotals(shift1.id).expected, shift1ExpectedBefore - 80),
    `${shifts.shiftTotals(shift1.id).expected} vs ${shift1ExpectedBefore - 80}`
  );
  const drawer1 = cashDrawer.getBreakdown(shift1.id);
  check(
    'the cash drawer agrees with the shift totals',
    near(shift1.start_cash + drawer1.cash_sales - drawer1.refunds + drawer1.amendment_cash, shifts.shiftTotals(shift1.id).expected),
    `${shift1.start_cash + drawer1.cash_sales - drawer1.refunds + drawer1.amendment_cash} vs ${shifts.shiftTotals(shift1.id).expected}`
  );

  // ── The split must add up, and NaN is never money ──────────────────────────
  section('A split must add up to the bill total');
  const rowCountBeforeBad = amendCount(sale1Id);
  const badSum = throws(() =>
    billAmend.amendPayments({ saleId: sale1Id, split: { cash: 100, card: 0, bank: 0, credit: 50 }, reason: 'bad sum' })
  );
  check('a split that does not add up is refused', /add up to the bill total/i.test(badSum || ''), badSum);
  const nanSum = throws(() =>
    billAmend.amendPayments({ saleId: sale1Id, split: { cash: NaN, card: undefined, bank: null, credit: NaN }, reason: 'nan' })
  );
  check('NaN / null / undefined are treated as 0 and refused', /add up to the bill total/i.test(nanSum || ''), nanSum);
  check('a refused split writes no amendment row', amendCount(sale1Id) === rowCountBeforeBad);
  const nanRow = db.prepare('SELECT COUNT(*) AS c FROM sale_amendments WHERE cash_effect != cash_effect').get();
  check('no NaN ever reaches the database', Number(nanRow.c) === 0);

  // ── A closed shift is never mutated ───────────────────────────────────────
  section('A closed shift is never mutated');
  const shift1ExpectedAtClose = shifts.shiftTotals(shift1.id).expected;
  const closed1 = shifts.closeShift(shift1.id, shift1ExpectedAtClose);
  check('shift 1 closed with its expected cash stored', near(closed1.expected_cash, shift1ExpectedAtClose), String(closed1.expected_cash));

  const shift2 = shifts.openShift(500);
  const revertRes = billAmend.amendPayments({
    saleId: sale1Id,
    split: { cash: 200, card: 0, bank: 0, credit: 0 },
    reason: 'customer paid the rest in cash',
  });
  check('the revert moves +80 cash', near(revertRes.cashEffect, 80), String(revertRes.cashEffect));
  check('the revert clears the udhaar', near(balanceOf(customerA.id), balanceABefore), String(balanceOf(customerA.id)));
  check(
    'the CLOSED shift recomputes to the same expected cash',
    near(shifts.shiftTotals(shift1.id).expected, shift1ExpectedAtClose),
    `${shifts.shiftTotals(shift1.id).expected} vs ${shift1ExpectedAtClose}`
  );
  check(
    'the CLOSED shift keeps its stored expected cash',
    near(
      Number(db.prepare('SELECT expected_cash FROM shifts WHERE id = ?').get(shift1.id).expected_cash),
      shift1ExpectedAtClose
    )
  );
  check(
    'the CURRENT OPEN shift carries the +80',
    near(shifts.shiftTotals(shift2.id).expected, 500 + 80),
    String(shifts.shiftTotals(shift2.id).expected)
  );
  const drawer2 = cashDrawer.getBreakdown(shift2.id);
  check(
    'the drawer of the new shift agrees too',
    near(shift2.start_cash + drawer2.cash_sales - drawer2.refunds + drawer2.amendment_cash, shifts.shiftTotals(shift2.id).expected)
  );

  // ── No open shift -> a cash change is refused ─────────────────────────────
  section('A cash change needs an open shift');
  shifts.closeShift(shift2.id, shifts.shiftTotals(shift2.id).expected);
  const noShift = throws(() =>
    billAmend.amendPayments({ saleId: sale1Id, split: { cash: 100, card: 0, bank: 0, credit: 100 }, reason: 'no shift' })
  );
  check('a cash change with no open shift is refused', /open a shift/i.test(noShift || ''), noShift);
  const shift3 = shifts.openShift(0);

  // ── A) Moving the bill to another customer ────────────────────────────────
  section('A) Moving a bill to another customer');
  const sale2 = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerA.id,
    payments: [],
  });
  const sale2Id = sale2.sale.id;
  check('a full-udhaar bill can be made for a customer', near(sale2.balance, 100), String(sale2.balance));
  const balanceABeforeMove = balanceOf(customerA.id);

  const moveRes = billAmend.amendCustomer({ saleId: sale2Id, customerId: customerB.id, reason: 'bill was for B, not A' });
  check('the move does not change the bill total', near(moveRes.state.total, 100));
  check('the old customer owes 100 less', near(balanceOf(customerA.id), balanceABeforeMove - 100), String(balanceOf(customerA.id)));
  check('the new customer owes 100 more', near(balanceOf(customerB.id), 100), String(balanceOf(customerB.id)));
  check('the sale row follows the new customer', Number(sales.getSale(sale2Id).customer_id) === customerB.id);
  const oldLedger = db
    .prepare("SELECT * FROM customer_transactions WHERE customer_id = ? AND sale_id = ? AND type = 'amend' ORDER BY id DESC LIMIT 1")
    .get(customerA.id, sale2Id);
  const newLedger = db
    .prepare("SELECT * FROM customer_transactions WHERE customer_id = ? AND sale_id = ? AND type = 'amend' ORDER BY id DESC LIMIT 1")
    .get(customerB.id, sale2Id);
  check('the old customer ledger shows -100', !!oldLedger && near(oldLedger.amount, -100), oldLedger ? String(oldLedger.amount) : 'missing');
  check('the new customer ledger shows +100', !!newLedger && near(newLedger.amount, 100), newLedger ? String(newLedger.amount) : 'missing');

  const toWalkIn = throws(() => billAmend.amendCustomer({ saleId: sale2Id, customerId: null, reason: 'walk-in' }));
  check('a bill with udhaar cannot become a walk-in bill', /cannot become a walk-in/i.test(toWalkIn || ''), toWalkIn);

  const customerD = sales.createCustomer('Amend Customer D');
  db.prepare('UPDATE customers SET credit_limit = 50 WHERE id = ?').run(customerD.id);
  const overLimit = throws(() => billAmend.amendCustomer({ saleId: sale2Id, customerId: customerD.id, reason: 'over limit' }));
  check('the credit limit blocks the move', /credit limit exceeded/i.test(overLimit || ''), overLimit);
  check('the blocked move changed nothing', Number(sales.getSale(sale2Id).customer_id) === customerB.id);

  const overridden = billAmend.amendCustomer({
    saleId: sale2Id,
    customerId: customerD.id,
    reason: 'owner approved: long-time customer',
    overrideCreditLimit: true,
  });
  check('the owner may override the credit limit', overridden.ok === true);
  check('the overridden balance really is over the limit', near(balanceOf(customerD.id), 100), String(balanceOf(customerD.id)));

  // A manager must NOT be able to override.
  const customerF = sales.createCustomer('Amend Customer F');
  db.prepare('UPDATE customers SET credit_limit = 10 WHERE id = ?').run(customerF.id);
  auth.setSessionUser(manager.id);
  const managerOverride = throws(() =>
    billAmend.amendCustomer({
      saleId: sale2Id,
      customerId: customerF.id,
      reason: 'manager tries to go over a limit',
      managerPin: '2222',
      overrideCreditLimit: true,
    })
  );
  check('only the owner may override a credit limit', /only the owner may go over a credit limit/i.test(managerOverride || ''), managerOverride);
  auth.setSessionUser(1);

  // A fully paid bill may become a walk-in bill.
  const walkInSale = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerA.id,
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const walkInRes = billAmend.amendCustomer({ saleId: walkInSale.sale.id, customerId: null, reason: 'it was a walk-in after all' });
  check('a bill with no udhaar may become a walk-in bill', walkInRes.state.customerId === null);
  check('the sale row really is a walk-in bill', sales.getSale(walkInSale.sale.id).customer_id === null);

  // ── One transaction: a mid-write failure leaves nothing behind ────────────
  section('One transaction — a mid-write failure rolls everything back');
  const walkInId = walkInSale.sale.id;
  const notesBeforeRollback = sales.getSale(walkInId).notes;
  const amendmentsBeforeRollback = amendCount(walkInId);
  const eventsBeforeRollback = eventsOf(walkInId, 'amend');
  const activityBeforeRollback = Number(
    db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'sale_amended' AND entity_id = ?").get(walkInId).c
  );
  db.exec(`CREATE TRIGGER amend_fail_guard BEFORE INSERT ON sale_amendments
           BEGIN SELECT RAISE(ABORT, 'forced-rollback'); END;`);
  const rollbackErr = throws(() =>
    billAmend.amendNotes({ saleId: walkInId, notes: 'must not stick', reason: 'rollback test' })
  );
  db.exec('DROP TRIGGER IF EXISTS amend_fail_guard');
  check('the mid-write failure is surfaced', /forced-rollback/i.test(rollbackErr || ''), rollbackErr);
  check('the sale row was rolled back', sales.getSale(walkInId).notes === notesBeforeRollback, String(sales.getSale(walkInId).notes));
  check('no amendment row was left behind', amendCount(walkInId) === amendmentsBeforeRollback);
  check('no timeline event was left behind', eventsOf(walkInId, 'amend') === eventsBeforeRollback);
  check(
    'no activity-log entry was left behind',
    Number(
      db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'sale_amended' AND entity_id = ?").get(walkInId).c
    ) === activityBeforeRollback
  );

  // ── The window rule ────────────────────────────────────────────────────────
  section('The "max days back" window');
  admin.setAdminSetting('amend_max_days_back', '1');
  check('a bill from today may still be amended inside a 1-day window', billAmend.getBillAmendView(walkInId).allowed === true);
  db.prepare("UPDATE sales SET created_at = datetime('now', '-10 days') WHERE id = ?").run(walkInId);
  const oldBill = throws(() => billAmend.amendNotes({ saleId: walkInId, notes: 'too old', reason: 'too old' }));
  check('a 10-day-old bill is refused by a 1-day window', /days old/i.test(oldBill || ''), oldBill);
  db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(sale1CreatedAt, walkInId);
  admin.setAdminSetting('amend_max_days_back', '0');
  check('0 means unlimited again', billAmend.getBillAmendView(walkInId).allowed === true);

  // ── D) Returning from an amended bill ─────────────────────────────────────
  section('D) Returning from an amended bill (no double subtraction)');
  const customerE = sales.createCustomer('Amend Customer E');
  const sale3 = sales.createSale({
    items: [{ product_id: product.id, qty: 2, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: customerE.id,
    payments: [{ mode: 'cash', amount: 200 }],
  });
  const sale3Id = sale3.sale.id;
  billAmend.amendPayments({ saleId: sale3Id, split: { cash: 100, card: 0, bank: 0, credit: 100 }, reason: 'half on udhaar' });
  check('the amended bill owes 100', near(balanceOf(customerE.id), 100), String(balanceOf(customerE.id)));

  const item = sales.getSale(sale3Id).items[0];
  const ret1 = returns.createReturn({
    sale_id: sale3Id,
    items: [{ sale_item_id: item.id, qty: 1, unit_price: 100 }],
    reason: 'one came back',
    refund_mode: 'cash',
    restock: true,
  });
  check('the return refunds the price actually paid', near(ret1.refund_amount, 100), String(ret1.refund_amount));
  check('the sale is marked as 100 returned', near(Number(sales.getSale(sale3Id).returned_amount), 100), String(sales.getSale(sale3Id).returned_amount));

  // The timeline dedupe index is keyed on `(event_type, sale_id, held_bill_id,
  // created_at)` and `returns.created_at` only has SECOND precision, so two
  // identical returns on the same bill inside one second collide on purpose.
  // (Pre-existing: it is what makes the 073 backfill idempotent.) Real shops do
  // not return twice in the same second; the suite spaces them the same way.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const ret2 = returns.createReturn({
    sale_id: sale3Id,
    items: [{ sale_item_id: item.id, qty: 1, unit_price: 100 }],
    reason: 'the second one too',
    refund_mode: 'cash',
    restock: true,
  });
  check('the second return refunds the second unit', near(ret2.refund_amount, 100));
  check('the sale is marked as fully returned once', near(Number(sales.getSale(sale3Id).returned_amount), 200));

  const thirdReturn = throws(() =>
    returns.createReturn({
      sale_id: sale3Id,
      items: [{ sale_item_id: item.id, qty: 1, unit_price: 100 }],
      reason: 'double subtraction attempt',
      refund_mode: 'cash',
      restock: true,
    })
  );
  check('a third return is refused (no double subtraction)', /returnable|exceeds unrefunded/i.test(thirdReturn || ''), thirdReturn);
  check('returned_amount never exceeds the bill', near(Number(sales.getSale(sale3Id).returned_amount), 200));

  // ── Dashboard / History / Sales list agree ────────────────────────────────
  section('Dashboard, Sales History and the sales list agree after amending');
  const today = new Date().toISOString().slice(0, 10);
  const dash = reports.dashboard({ now: new Date(), startHour: 0 });
  const hist = history.historySummary({ from: today, to: today });
  check(
    'Sales History NET equals Dashboard today sales',
    near(hist.netSales, dash.today_sales),
    `${hist.netSales} vs ${dash.today_sales}`
  );
  const listed = sales.listSales();
  // The sales LIST shows each bill's gross amount; Dashboard's today_sales is
  // net of `returned_amount`. The two agree exactly once the one subtraction
  // that a return makes is applied — that is the "no double subtraction" proof.
  const listedTotal = listed.reduce(
    (sum, s) => sum + Number(s.total_amount || 0) - Number(s.returned_amount || 0),
    0
  );
  check(
    'the sales list (net of returned_amount) equals Dashboard today sales',
    near(listedTotal, dash.today_sales),
    `${listedTotal} vs ${dash.today_sales}`
  );
  check(
    'the amended bill is still one bill at its original total',
    listed.filter((s) => s.id === sale1Id).length === 1 &&
      near(listed.find((s) => s.id === sale1Id).total_amount, 200)
  );

  // ── E) The reprint carries the stamps ─────────────────────────────────────
  section('E) Reprint stamps the amended bill');
  const invoice1 = sales.getSale(sale1Id).invoice_no;
  const reprint = await printing.buildReceiptJobAsync(sale1Id, 'standard', { duplicate: true });
  check('the reprint says DUPLICATE COPY', /DUPLICATE COPY/.test(reprint.html));
  check('the reprint says AMENDED', /AMENDED/.test(reprint.html));
  check('the amended marker carries the amendment count', /AMENDED \(4 amendments\)/.test(reprint.html), String(reprint.html.match(/AMENDED[^<]*/) || ''));
  check('the reprint carries the ORIGINAL invoice number', reprint.html.includes(invoice1), invoice1);
  const plain = await printing.buildReceiptJobAsync(sale1Id, 'standard', {});
  check('a normal print is not stamped DUPLICATE', !/DUPLICATE COPY/.test(plain.html));
  check('a normal print of an amended bill still says AMENDED', /AMENDED/.test(plain.html));
  const cleanSale = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const cleanReprint = await printing.buildReceiptJobAsync(cleanSale.sale.id, 'standard', { duplicate: true });
  check('an unamended bill never says AMENDED', !/AMENDED/.test(cleanReprint.html));
  const amendedVersion = await printing.buildReceiptJobAsync(sale1Id, 'standard', { amendedVersion: true });
  check('"print amended version" forces the marker', /AMENDED/.test(amendedVersion.html));

  // ── The audit trail ────────────────────────────────────────────────────────
  section('The amendment is audited');
  check('the bill records 4 amendments', Number(sales.getSale(sale1Id).amended_count) === 4, String(sales.getSale(sale1Id).amended_count));
  check('the bill has a last_amended_at stamp', !!sales.getSale(sale1Id).last_amended_at, String(sales.getSale(sale1Id).last_amended_at));
  const amendEvents = db
    .prepare("SELECT * FROM sale_events WHERE sale_id = ? AND event_type = 'amend' ORDER BY id")
    .all(sale1Id);
  check('every amendment is its own timeline event', amendEvents.length === 4, String(amendEvents.length));
  check(
    'the timeline event carries who, why and the original invoice',
    amendEvents.every((e) => e.user_id && e.reason && String(e.snapshot_json).includes('original_invoice'))
  );
  const amendActivity = db
    .prepare("SELECT * FROM activity_log WHERE action = 'sale_amended' AND entity_id = ? ORDER BY id")
    .all(sale1Id);
  check('every amendment is in the activity log', amendActivity.length === 4, String(amendActivity.length));
  check(
    'the activity log records the reason',
    amendActivity.some((a) => String(a.details || '').includes('customer only had 120 in cash'))
  );
  check('the amendment history is readable', billAmend.listAmendments(sale1Id).length === 4);
  const view = billAmend.getBillAmendView(sale1Id);
  check('the amend view shows the current split', view && view.split.cash === 200 && view.split.credit === 0, JSON.stringify(view && view.split));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_billAmend crashed:', e);
  app.exit(1);
});
