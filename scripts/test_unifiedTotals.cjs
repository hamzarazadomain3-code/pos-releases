#!/usr/bin/env node
/**
 * Phase 0 item 0.4 — unified daily totals.
 *
 * Proves that the ONE shared business-day resolver is used by:
 *   - reports.getDailyClosing()
 *   - sales.listSales() (when useBusinessDayRange=true)
 *   - expenses.getExpenseSummary()
 *
 * The test creates sales with known UTC timestamps across a business-day
 * boundary (04:00 anchor) and asserts all three APIs return the same
 * bill count and total.
 *
 * Run: npm run test:unified
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-unified-totals-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'unified-totals-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

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
  const expenses = require('../dist/main/services/expenses.js');
  const reports = require('../dist/main/services/reports.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');

  auth.setSessionUser(1);

  settings.setSetting('license_trial', '1');
  settings.setSetting('license_trial_started', new Date().toISOString());
  settings.setSetting('license_trial_expires', new Date(Date.now() + 15 * 864e5).toISOString());
  settings.setSetting('license_trial_offline', '0');
  settings.setSetting('business_day_start_hour', '4'); // 04:00 anchor
  settings.setSetting('shop_timezone', 'Asia/Karachi');
  settings.setSetting('price_floor_enabled', '0');
  settings.setSetting('allow_negative_stock', 'warn');

  const shift = shifts.openShift(1000);
  check('shift opened', shift.id > 0);

  const product = inventory.createProduct({
    name: 'Unified Test',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 100,
    tax_rate: 0,
  });

  // Helper: insert a sale with a specific created_at (UTC)
  function insertSale(createdAtUtc, amount = 100) {
    const invoiceNo = `INV-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const info = db.prepare(`
      INSERT INTO sales (invoice_no, user_id, shift_id, total_amount, status, created_at)
      VALUES (?, ?, ?, ?, 'completed', ?)
    `).run(invoiceNo, 1, shift.id, amount, createdAtUtc);
    const saleId = info.lastInsertRowid;
    db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total)
      VALUES (?, ?, 1, ?, 0, 0, ?)
    `).run(saleId, product.id, amount, amount);
    db.prepare(`
      INSERT INTO payments (sale_id, mode, amount)
      VALUES (?, 'Cash', ?)
    `).run(saleId, amount);
    return saleId;
  }

  // 23:00 PKT on 26 Nov = 18:00 UTC 26 Nov → business day 26 Nov (04:00 anchor)
  const sale1 = insertSale('2026-11-26 18:00:00', 100);
  // 01:00 PKT on 27 Nov = 20:00 UTC 26 Nov → STILL business day 26 Nov (04:00 anchor)
  const sale2 = insertSale('2026-11-26 20:00:00', 200);
  // 05:00 PKT on 27 Nov = 00:00 UTC 27 Nov → NEXT business day (27 Nov)
  const sale3 = insertSale('2026-11-27 00:00:00', 300);

  // Also add an expense on the same boundary
  const cat = db.prepare(`INSERT INTO expense_categories (name, description, color, is_active) VALUES ('Test', 't', '#000', 1)`).run();
  db.prepare(`INSERT INTO expenses (category_id, user_id, title, amount, expense_date, status) VALUES (?, 1, 'Exp', 50, ?, 'active')`).run(cat.lastInsertRowid, '2026-11-26 18:00:00');
  db.prepare(`INSERT INTO expenses (category_id, user_id, title, amount, expense_date, status) VALUES (?, 1, 'Exp', 75, ?, 'active')`).run(cat.lastInsertRowid, '2026-11-26 20:00:00');
  db.prepare(`INSERT INTO expenses (category_id, user_id, title, amount, expense_date, status) VALUES (?, 1, 'Exp', 100, ?, 'active')`).run(cat.lastInsertRowid, '2026-11-27 00:00:00');

  console.log('\n=== business day 26 Nov (04:00 anchor) ===');
  const closing = reports.getDailyClosing('2026-11-26');
  check('closing bill_count = 2 (sale1 + sale2)', closing.bill_count === 2, `got ${closing.bill_count}`);
  check('closing total_sales = 300', closing.total_sales === 300, `got ${closing.total_sales}`);

  const salesList = sales.listSales('2026-11-26', '2026-11-26', false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'date', 'asc', false, 'completed', true);
  check('sales.listSales (business day) bill_count = 2', salesList.length === 2, `got ${salesList.length}`);
  const salesTotal = salesList.reduce((s, x) => s + Number(x.total_amount || 0), 0);
  check('sales.listSales total_sales = 300', salesTotal === 300, `got ${salesTotal}`);

  const exp = expenses.getExpenseSummary('2026-11-26', '2026-11-26');
  check('expenses total = 125 (50+75)', exp.total === 125, `got ${exp.total}`);

  console.log('\n=== business day 27 Nov ===');
  const closing2 = reports.getDailyClosing('2026-11-27');
  check('closing bill_count = 1 (sale3)', closing2.bill_count === 1, `got ${closing2.bill_count}`);
  check('closing total_sales = 300', closing2.total_sales === 300, `got ${closing2.total_sales}`);

  const salesList2 = sales.listSales('2026-11-27', '2026-11-27', false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'date', 'asc', false, 'completed', true);
  check('sales.listSales (business day) bill_count = 1', salesList2.length === 1, `got ${salesList2.length}`);

  const exp2 = expenses.getExpenseSummary('2026-11-27', '2026-11-27');
  check('expenses total = 100', exp2.total === 100, `got ${exp2.total}`);

  console.log('\n=== calendar day (UTC) still works for backward compat ===');
  const salesCal = sales.listSales('2026-11-26', '2026-11-26');
  // Calendar day 26 Nov UTC: sale1 (18:00) + sale2 (20:00) + sale3 (00:00 next day is 27 Nov UTC!) = 2 sales
  check('sales.listSales (calendar day) bill_count = 2', salesCal.length === 2, `got ${salesCal.length}`);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('All unified totals checks passed.');
  // Electron must be told to quit: without this the process stays alive and
  // the npm script never returns (the suite HANGS the build).
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});