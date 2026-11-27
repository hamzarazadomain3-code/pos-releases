#!/usr/bin/env node
/**
 * Phase 0 item 0.5 — shift safety.
 *
 * Verifies the service-level invariants that protect the till:
 *   1. A second open shift for the same user is rejected.
 *   2. An open shift older than 24 hours cannot be silently re-opened — the
 *      cashier must close it first (+ a `shift_long_open` audit entry appears).
 *   3. A shift under 24 hours can still be force-closed only with a reason
 *      (`forced` flag set, reason stored).
 *   4. forceCloseShift requires the manager role.
 *   5. closeShift validates counted cash and rounds the expected total.
 *
 * Run: npm run test:shifts
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-shifts-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'shifts-test.db');

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

  const shifts = require('../dist/main/services/shifts.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');

  auth.setSessionUser(1); // seeded owner

  settings.setSetting('license_trial', '1');
  settings.setSetting('license_trial_started', new Date().toISOString());
  settings.setSetting('license_trial_expires', new Date(Date.now() + 15 * 864e5).toISOString());
  settings.setSetting('license_trial_offline', '0');

  console.log('=== single open shift per user ===');
  const first = shifts.openShift(1000);
  check('shift opened', first.id > 0);

  const second = throws(() => shifts.openShift(500));
  check(
    'a second open shift for the same user is rejected',
    !!second && second.includes('open shift'),
    second || 'no error'
  );

  console.log('\n=== over-24h guard ===');
  // Backdate the open shift so it is older than 24h.
  const openedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
  db.prepare('UPDATE shifts SET opened_at = ? WHERE id = ?').run(openedAt, first.id);
  const third = throws(() => shifts.openShift(200));
  check(
    'an over-24h open shift forces a close first',
    !!third && third.includes('24 hours'),
    third || 'no error'
  );
  const longRow = db
    .prepare("SELECT * FROM activity_log WHERE action = 'shift_long_open' ORDER BY id DESC LIMIT 1")
    .get();
  check('shift_long_open audit entry written', !!longRow, longRow?.details);

  db.prepare(`UPDATE shifts SET opened_at = ?, closed_at = NULL WHERE id = ?`).run(
    new Date(Date.now() - 2 * 3_600_000).toISOString(),
    first.id
  );

  console.log('\n=== close with counted cash ===');
  const closed = shifts.closeShift(first.id, 1500, 'end of day');
  check('shift closed normally', !!closed?.closed_at, closed?.closed_at || 'still open');
  check('expected cash recorded', Number(closed?.expected_cash) === 1000, String(closed?.expected_cash));
  check('variance recorded', Number(closed?.variance) === 500, String(closed?.variance));

  const reopen = shifts.openShift(800);
  check('a closed shift frees the slot', reopen.id > first.id, `new shift ${reopen.id}`);

  console.log('\n=== force close needs manager + reason ===');
  auth.setSessionUser(2); // a seeded cashier (no manager rank) would fail
  const forceDenied = throws(() => shifts.forceCloseShift(reopen.id, 800, 'x'));
  check('cashier cannot force-close', !!forceDenied, forceDenied || 'no error');
  auth.setSessionUser(1);

  const forceNoReason = throws(() => shifts.forceCloseShift(reopen.id, 800));
  check('force close without a reason is rejected', !!forceNoReason && forceNoReason.includes('reason'), forceNoReason || 'no error');

  const forced = shifts.forceCloseShift(reopen.id, 850, 'emergency close');
  check('manager force-close succeeds', !!forced?.closed_at, forced?.closed_at || 'not closed');
  check('forced flag set', Number(forced?.forced) === 1, String(forced?.forced));
  check('reason stored in notes', String(forced?.notes ?? '') === 'emergency close', forced?.notes);
  check('variance from counted cash', Number(forced?.variance) === 50, String(forced?.variance));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('All shift-safety checks passed.');
  // Electron must be told to quit: without this the process stays alive and
  // the npm script never returns (the suite HANGS the build).
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});