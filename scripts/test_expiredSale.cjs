#!/usr/bin/env node
/**
 * Phase 0 item 0.9 — expired-stock hard block + manager override.
 *
 * Runs the REAL services against a throwaway database:
 *   1. selling a product whose expiry_date is in the past is blocked
 *      (no stock mutation, no sale row),
 *   2. the override flag alone is not enough — the approving user must be an
 *      owner/manager in the database,
 *   3. a manager-approved override completes the sale and writes an
 *      `expired_override` activity-log entry (approver + reason),
 *   4. same-day expiry and products without an expiry date sell normally.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_expiredSale.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-expired-sale-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'expired-sale-test.db');

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

  auth.setSessionUser(1); // seeded owner

  // createSale is licence-gated; start a local trial for the throwaway DB.
  settings.setSetting('license_trial', '1');
  settings.setSetting('license_trial_started', new Date().toISOString());
  settings.setSetting('license_trial_expires', new Date(Date.now() + 15 * 864e5).toISOString());
  settings.setSetting('license_trial_offline', '0');
  settings.setSetting('price_floor_enabled', '0');
  settings.setSetting('allow_negative_stock', 'warn');

  const shift = shifts.openShift(1000);
  check('shift opened', shift.id > 0);

  const expired = inventory.createProduct({
    name: 'Expired Juice',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 10,
    tax_rate: 0,
    expiry_date: localIso(-1),
  });
  const expiresToday = inventory.createProduct({
    name: 'Fresh Today',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 10,
    tax_rate: 0,
    expiry_date: localIso(0),
  });
  const noExpiry = inventory.createProduct({
    name: 'No Expiry Widget',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 10,
    tax_rate: 0,
  });

  const stockOf = (p) => Number(inventory.getProduct(p.id).stock_qty);

  function sell(productId, extra) {
    return sales.createSale({
      items: [{ product_id: productId, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'Cash', amount: 100 }],
      price_mode: 'retail',
      ...extra,
    });
  }

  section('Expired product is hard-blocked');
  const blocked = throws(() => sell(expired.id));
  check(
    'sale without override throws "Expired items: ..."',
    !!blocked && blocked.startsWith('Expired items:') && blocked.includes('Expired Juice'),
    blocked || 'no error'
  );
  check('stock is unchanged after the blocked sale', near(stockOf(expired), 10), String(stockOf(expired)));

  section('Override needs a real owner/manager');
  const noApprover = throws(() => sell(expired.id, { expired_override: true }));
  check(
    'override flag without approver is rejected',
    noApprover === 'Expired stock needs a manager approval',
    noApprover || 'no error'
  );

  const unknownApprover = throws(() =>
    sell(expired.id, { expired_override: true, expired_approved_by: 999999 })
  );
  check(
    'override by an unknown user is rejected',
    unknownApprover === 'Expired stock needs a manager approval',
    unknownApprover || 'no error'
  );
  check('stock is still unchanged', near(stockOf(expired), 10), String(stockOf(expired)));

  section('Manager-approved override sells + audits');
  const approved = sell(expired.id, {
    expired_override: true,
    expired_approved_by: 1,
    expired_reason: 'damaged stock return to customer',
  });
  check('approved sale succeeds', !!approved && !!approved.sale && approved.sale.id > 0, approved?.sale?.invoice_no);
  check('stock decremented to 9', near(stockOf(expired), 9), String(stockOf(expired)));

  const logRow = db
    .prepare("SELECT * FROM activity_log WHERE action = 'expired_override' ORDER BY id DESC LIMIT 1")
    .get();
  check('expired_override activity row written', !!logRow, logRow ? logRow.details : 'missing');
  check(
    'audit row records the approver',
    !!logRow && String(logRow.details).includes('approved_by='),
    logRow?.details
  );
  check(
    'audit row records the reason',
    !!logRow && String(logRow.details).includes('reason=damaged stock return to customer'),
    logRow?.details
  );
  check(
    'audit row points at the sale',
    !!logRow && String(logRow.entity) === 'sale' && Number(logRow.entity_id) === Number(approved.sale.id),
    logRow ? `${logRow.entity}#${logRow.entity_id}` : 'missing'
  );

  section('Same-day expiry and no-expiry still sell');
  const todaySale = sell(expiresToday.id);
  check('product expiring today sells without override', !!todaySale?.sale?.id, todaySale?.sale?.invoice_no);

  const plainSale = sell(noExpiry.id);
  check('product without expiry sells normally', !!plainSale?.sale?.id, plainSale?.sale?.invoice_no);

  const overrideCount = db
    .prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'expired_override'")
    .get().c;
  check('only the approved sale wrote an override log', Number(overrideCount) === 1, String(overrideCount));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All expired-sale checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
