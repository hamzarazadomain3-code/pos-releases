#!/usr/bin/env node
/**
 * The Phase 0 BILLING SMOKE TEST — the master prompt's closing checklist for
 * the phase, driven against the REAL services.
 *
 * The prompt asks for a smoke test at the end of every phase:
 *   drawer, discount+tax, weight, wholesale, split payment, udhaar,
 *   hold/resume, return+restock, below-cost + expired block, close drawer,
 *   cross-screen number equality, backup/restore, kill mid-sale.
 *
 * Every item below is one check against the shipped code path (the services
 * the Billing screen calls), on a throwaway database.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_billingSmoke.cjs
 *
 * Exit code 0 = every check passed. PowerShell can still report 1 because of
 * Electron's stderr banner; trust the "ALL PASSED" line and $LASTEXITCODE.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// Electron treats the script's folder as the app root, which would send db.ts
// looking for `scripts/migrations`. Point it back at the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-billing-smoke-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'billing-smoke.db');

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

const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function run() {
  if (typeof app.whenReady === 'function') {
    try {
      await app.whenReady();
    } catch {
      /* already ready */
    }
  }

  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const shifts = require('../dist/main/services/shifts.js');
  const cashDrawer = require('../dist/main/services/cashDrawer.js');
  const sales = require('../dist/main/services/sales.js');
  const returns = require('../dist/main/services/returns.js');
  const reports = require('../dist/main/services/reports.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');
  const backup = require('../dist/main/services/backup.js');
  const { todayIso } = require('../dist/shared/calendarGrid.js');

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  // The backup folder MUST point into this run's temp directory: the default
  // is the shop's real "Documents\ShopKeeper POS\backups" and the retention
  // cleanup would touch the owner's own backup files.
  const admin = require('../dist/main/services/admin.js');
  db.prepare("INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES ('backup_folder', ?, CURRENT_TIMESTAMP)").run(
    path.join(tmpDir, 'backups')
  );
  auth.setSessionUser(1); // the seeded owner

  // ── the fixtures ──────────────────────────────────────────────────────────
  const normal = inventory.createProduct({
    name: 'Smoke Widget',
    sale_price: 100,
    wholesale_price: 95,
    cost_price: 60,
    stock_qty: 20,
    tax_rate: 5,
  });
  const loose = inventory.createProduct({
    name: 'Smoke Loose Sugar',
    sale_price: 200,
    wholesale_price: 180,
    cost_price: 120,
    stock_qty: 10,
    tax_rate: 0,
    is_loose: true,
    net_weight: 1,
  });
  const expiring = inventory.createProduct({
    name: 'Smoke Expired Pack',
    sale_price: 100,
    cost_price: 60,
    stock_qty: 10,
    tax_rate: 0,
    expiry_date: '2020-01-01',
  });
  const stockOf = (id) => Number(inventory.getProduct(id).stock_qty);

  console.log('=== Rokar POS - the Phase 0 billing smoke test ===');

  // ── 1. the drawer + the shift ─────────────────────────────────────────────
  section('1 - the drawer opens with the shift');
  const shift = shifts.openShift(1000);
  const drawer = cashDrawer.getCurrentDrawer(shift.id);
  check('the shift is open', shift.id > 0);
  check('the drawer session came with it', !!drawer, drawer ? `session ${drawer.id}` : 'none');
  check('the drawer holds the opening cash', !!drawer && near(drawer.opening_cash, 1000), String(drawer && drawer.opening_cash));
  check('the drawer is open (it has no closing time)', !!drawer && !drawer.closing_time, String(drawer && drawer.closing_time));

  // ── 2. discount + tax + split payment ─────────────────────────────────────
  section('2 - a discount, a tax and a split payment add up exactly');
  const stockBeforeA = stockOf(normal.id);
  const sale1 = sales.createSale({
    items: [{ product_id: normal.id, qty: 2, price: 100, line_discount: 0, tax_rate: 5 }],
    bill_discount: 10,
    discount_type: 'percent',
    payments: [
      { mode: 'cash', amount: 100 },
      { mode: 'card', amount: 89 },
    ],
  });
  // 2 x 100 = 200 + 5% tax = 210, minus 10% of 210 = 189.
  check('the total is subtotal - discount (tax included)', near(sale1.sale.total_amount, 189), String(sale1.sale.total_amount));
  check('the sale has two payment rows', sale1.payments.length === 2, JSON.stringify(sale1.payments.map((p) => p.mode)));
  check('the payments add up to the total', near(sale1.payments.reduce((s, p) => s + p.amount, 0), 189));
  check('there is no change and no balance', near(sale1.change, 0) && near(sale1.balance, 0), `change ${sale1.change} balance ${sale1.balance}`);
  check('the tax is on the sale', near(Number(sale1.sale.tax_amount), 10), String(sale1.sale.tax_amount));
  check('the stock went down by 2', stockOf(normal.id) === stockBeforeA - 2, `${stockBeforeA} -> ${stockOf(normal.id)}`);

  // ── 3. weight + wholesale ─────────────────────────────────────────────────
  section('3 - a loose (weighed) item at the wholesale price');
  const stockBeforeLoose = stockOf(loose.id);
  const sale2 = sales.createSale({
    items: [{ product_id: loose.id, qty: 0.57, price: 180, line_discount: 0, tax_rate: 0 }],
    price_mode: 'wholesale',
    payments: [{ mode: 'cash', amount: 102.6 }],
  });
  check('the weighed line is exact (0.57 x 180)', near(sale2.sale.total_amount, 102.6), String(sale2.sale.total_amount));
  check(
    'the wholesale price was the one used',
    near(Number(sale2.items[0].unit_price), 180),
    String(sale2.items[0].unit_price)
  );
  check('the fraction of a unit is what left the stock', near(stockOf(loose.id), stockBeforeLoose - 0.57), `${stockBeforeLoose} -> ${stockOf(loose.id)}`);

  // ── 4. udhaar (credit) ────────────────────────────────────────────────────
  section('4 - a credit sale moves the customer ledger');
  const customer = sales.createCustomer('Smoke Customer', '0300-1234567');
  const sale3 = sales.createSale({
    items: [{ product_id: normal.id, qty: 1, price: 100, line_discount: 0, tax_rate: 5 }],
    customer_id: customer.id,
    // The cashier takes the goods on credit: nothing is paid now, so the whole
    // total is the customer's balance (the UI sends the same - a 0 row).
    payments: [{ mode: 'Udhaar', amount: 0 }],
  });
  check('the credit sale was recorded', sale3.sale.id > 0);
  const ledger = sales.customerLedger(customer.id);
  const creditRow = ledger.find((t) => t.sale_id === sale3.sale.id);
  check('the ledger carries the credit', !!creditRow && near(creditRow.amount, 105), JSON.stringify(creditRow));
  const customerNow = sales.listCustomers('all').find((c) => c.id === customer.id);
  check('the customer balance is the credit', !!customerNow && near(customerNow.balance, 105), String(customerNow && customerNow.balance));

  // ── 5. hold / resume ──────────────────────────────────────────────────────
  section('5 - a held bill comes back exactly as it was');
  const heldPayload = {
    items: [{ product_id: normal.id, qty: 3, price: 100, line_discount: 0, tax_rate: 5 }],
    bill_discount: 0,
    customer_id: customer.id,
  };
  const held = sales.holdBill('held', 'Smoke hold', heldPayload);
  const heldList = sales.listHeldBills('held');
  check('the held bill is listed', heldList.some((h) => h.id === held.id), JSON.stringify(heldList.map((h) => h.label)));
  const resumed = sales.resumeHeldBill(held.id);
  check('the held bill comes back', !!resumed, String(resumed && resumed.id));
  const resumedData = JSON.parse(String(resumed?.data ?? '{}'));
  check(
    'the resumed items are the same',
    JSON.stringify(resumedData.items) === JSON.stringify(heldPayload.items),
    JSON.stringify(resumedData.items)
  );
  check('the resumed customer is the same', resumedData.customer_id === customer.id, String(resumedData.customer_id));

  // ── 6. return + restock ───────────────────────────────────────────────────
  section('6 - a return puts the stock back and the cash leaves the drawer');
  const stockBeforeReturn = stockOf(normal.id);
  const cashBefore = cashDrawer.getBreakdown(shift.id).cash_sales;
  const refund = returns.createReturnBill({
    items: [{ product_id: normal.id, qty: 1, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
  });
  check('the refund amount is the line value', near(refund.refund_amount, 100), String(refund.refund_amount));
  check('the stock went back up', stockOf(normal.id) === stockBeforeReturn + 1, `${stockBeforeReturn} -> ${stockOf(normal.id)}`);
  const breakdown = cashDrawer.getBreakdown(shift.id);
  check('the drawer still shows the cash it took', near(breakdown.cash_sales, cashBefore), `${cashBefore} -> ${breakdown.cash_sales}`);
  check('the refund is counted once as a cash refund', near(breakdown.refunds, 100), String(breakdown.refunds));

  // ── 7. the blocks ─────────────────────────────────────────────────────────
  section('7 - a below-cost and an expired item are both refused');
  const belowCost = throws(() =>
    sales.createSale({
      items: [{ product_id: normal.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'cash', amount: 50 }],
    })
  );
  check('a below-cost sale is refused', !!belowCost && /below cost/i.test(belowCost), String(belowCost));
  const expired = throws(() =>
    sales.createSale({
      items: [{ product_id: expiring.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'cash', amount: 100 }],
    })
  );
  check('an expired item is refused', !!expired && /expired/i.test(expired), String(expired));
  const expiredApproved = sales.createSale({
    items: [{ product_id: expiring.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
    expired_override: true,
    expired_approved_by: 1,
    expired_reason: 'smoke test',
  });
  check('a manager may still approve it', expiredApproved.sale.id > 0, `sale ${expiredApproved.sale.id}`);

  // ── 8. kill mid-sale (a failed sale leaves no trace) ──────────────────────
  section('8 - a sale that fails leaves NO half-written bill');
  const salesBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c);
  const itemsBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM sale_items').get().c);
  const movementsBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c);
  const stockBeforeCrash = stockOf(normal.id);
  const failed = throws(() =>
    sales.createSale({
      items: [
        { product_id: normal.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 },
        { product_id: 99999999, qty: 1, price: 100, line_discount: 0, tax_rate: 0 },
      ],
      payments: [{ mode: 'cash', amount: 200 }],
    })
  );
  check('the broken sale was refused', !!failed, String(failed));
  check(
    'no sale row was written',
    Number(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c) === salesBefore
  );
  check(
    'no sale item row was written',
    Number(db.prepare('SELECT COUNT(*) AS c FROM sale_items').get().c) === itemsBefore
  );
  check(
    'no stock movement was written',
    Number(db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c) === movementsBefore
  );
  check('the stock did not move', stockOf(normal.id) === stockBeforeCrash, `${stockBeforeCrash} -> ${stockOf(normal.id)}`);

  // ── 9. the cross-screen number equality ───────────────────────────────────
  section('9 - the same money on every screen');
  const list = sales.listSales(
    todayIso(),
    todayIso(),
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'completed',
    true
  );
  const completed = list.filter((s) => s.status === 'completed');
  const listTotal = completed.reduce((s, x) => s + Number(x.total_amount), 0);
  const closing = reports.getDailyClosing(todayIso());
  const draw = cashDrawer.getBreakdown(shift.id);
  const drawerMoney =
    draw.cash_sales +
    draw.card_sales +
    draw.cheque_sales +
    draw.easypaisa_sales +
    draw.jazzcash_sales +
    draw.udhaar_sales;
  const creditTaken = Number(
    db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM customer_transactions WHERE type = 'sale'").get().t
  );
  check('the sales list has the three cash/credit sales', completed.length >= 3, `${completed.length} completed`);
  check('the sales list total == the daily closing total', near(listTotal, closing.total_sales), `${listTotal} vs ${closing.total_sales}`);
  check(
    'the sales total = the money that was paid + the credit',
    near(listTotal, drawerMoney + creditTaken),
    `${listTotal} vs ${drawerMoney} + ${creditTaken}`
  );
  check('the bill count agrees', closing.bill_count === completed.length, `${closing.bill_count} vs ${completed.length}`);
  check('the average bill is total / bills', near(draw.average_bill, listTotal / draw.total_bills), `${draw.average_bill} vs ${listTotal / draw.total_bills}`);
  const cashInClosing = closing.by_mode.find((m) => m.mode.toLowerCase() === 'cash');
  check('the cash in the closing == the cash in the drawer', near(cashInClosing?.total ?? 0, draw.cash_sales), `${cashInClosing?.total} vs ${draw.cash_sales}`);

  // ── 10. backup + restore ──────────────────────────────────────────────────
  section('10 - a backup restores to the same numbers');
  const salesCountBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c);
  const made = backup.runBackup();
  check('the backup file was written', !!made.localPath && fs.existsSync(made.localPath), String(made.localPath));
  check(
    'the backup went into THIS run\'s temp folder (never the shop\'s own)',
    String(made.localPath).startsWith(tmpDir),
    String(made.localPath)
  );
  const head = fs.readFileSync(made.localPath).subarray(0, 16).toString('utf8');
  check('the backup is a real SQLite database', head.startsWith('SQLite format 3'), head.replace(/\0/g, ''));
  const restored = await backup.restoreBackup(made.localPath);
  check('the restore succeeded', restored.ok === true, restored.message);
  const db2 = getDb();
  const salesCountAfter = Number(db2.prepare('SELECT COUNT(*) AS c FROM sales').get().c);
  check('the restored database has the same sales', salesCountAfter === salesCountBefore, `${salesCountBefore} -> ${salesCountAfter}`);

  // ── 11. close the drawer ──────────────────────────────────────────────────
  section('11 - the drawer closes with its counted cash');
  const finalBreakdown = cashDrawer.getBreakdown(shift.id);
  const expectedCash = 1000 + finalBreakdown.cash_sales - finalBreakdown.refunds;
  const closed = cashDrawer.closeDrawer(shift.id, expectedCash, 'smoke test');
  check('the drawer is closed (it has a closing time)', !!closed && !!closed.closing_time, String(closed && closed.closing_time));
  check('the variance is zero (the counted cash was right)', near(closed.variance, 0), String(closed.variance));
  check('the shift can be closed too', shifts.closeShift(shift.id, expectedCash).closed_at != null);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('ALL PASSED');
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
