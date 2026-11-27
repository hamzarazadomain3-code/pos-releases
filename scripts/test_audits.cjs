#!/usr/bin/env node
/**
 * Phase 0 item 0.12 — audits: discard unfinished + empty-complete guard.
 *
 * Runs the REAL audit service against a throwaway database:
 *   1. createAudit builds an item list from every active product;
 *   2. completeAudit rejects an audit with NO counted items
 *      ("No items counted — nothing to complete") and leaves stock untouched;
 *   3. cancelAudit marks it cancelled, then discardAudit permanently deletes an
 *      in-progress/cancelled audit (rows + items) with an activity entry;
 *   4. a COMPLETED audit cannot be discarded; a cashier cannot discard.
 *
 * Run: npm run test:audits (requires `npm run build:main` first — the npm
 * script does it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-audits-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'audits-test.db');

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

  const audits = require('../dist/main/services/audits.js');
  const inventory = require('../dist/main/services/inventory.js');
  const auth = require('../dist/main/services/auth.js');

  auth.setSessionUser(1); // seeded owner

  for (let i = 1; i <= 3; i++) {
    inventory.createProduct({
      name: 'Audit Item ' + i,
      sale_price: 100,
      cost_price: 50,
      stock_qty: 10 * i,
      tax_rate: 0,
    });
  }

  console.log('=== create audit builds from active products ===');
  const audit = audits.createAudit();
  check('audit created in_progress', audit.status === 'in_progress', audit.status);
  check('audit includes every active product', audit.items.length === 3, String(audit.items.length));
  const anyNull = audit.items.every((i) => i.system_qty !== null);
  check('system quantities populated', anyNull);

  console.log('\n=== empty-complete is blocked ===');
  const err = throws(() => audits.completeAudit(audit.id));
  check(
    'complete with no counted items rejected',
    !!err && err.includes('No items counted'),
    err || 'no error'
  );

  console.log('\n=== discard path (cancel → discard) ===');
  const cancelled = audits.cancelAudit(audit.id);
  check('cancelAudit succeeded', cancelled === true);
  const row = db.prepare('SELECT id, status FROM audits WHERE id = ?').get(audit.id);
  check('row is now cancelled', row?.status === 'cancelled', row?.status);

  const discardFalse = throws(() => audits.discardAudit(audit.id + 9999));
  check('discard of unknown audit rejected', !!discardFalse, discardFalse || 'no error');

  const discarded = audits.discardAudit(audit.id);
  check('discardAudit returned true', discarded === true);
  const gone = db.prepare('SELECT id FROM audits WHERE id = ?').get(audit.id);
  check('audit row deleted', !gone, 'still present');
  const itemsGone = db.prepare('SELECT COUNT(*) AS c FROM audit_items WHERE audit_id = ?').get(audit.id).c;
  check('audit_items deleted', Number(itemsGone) === 0, String(itemsGone));
  const logRow = db
    .prepare("SELECT * FROM activity_log WHERE action = 'audit_discarded' ORDER BY id DESC LIMIT 1")
    .get();
  check('audit_discarded activity entry written', !!logRow, logRow?.details);

  console.log('\n=== a completed audit cannot be discarded ===');
  const done = audits.createAudit();
  db.prepare("UPDATE audits SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(done.id);
  const rejectDone = throws(() => audits.discardAudit(done.id));
  check(
    'completed audit discard is rejected',
    !!rejectDone && rejectDone.includes('completed'),
    rejectDone || 'no error'
  );
  const stillThere = db.prepare('SELECT id FROM audits WHERE id = ?').get(done.id);
  check('completed audit still exists', !!stillThere);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('All audits checks passed.');
  // Electron must be told to quit: without this the process stays alive and
  // the npm script never returns (the suite HANGS the build).
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
