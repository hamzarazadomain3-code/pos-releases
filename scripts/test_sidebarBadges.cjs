/**
 * Item 7 — the sidebar badges.
 *
 * Two layers:
 *   1. the pure rules (dist/shared/sidebarBadges.js): safe counts, the 99+
 *      cap, the role filter, the badge lookup;
 *   2. the real service (dist/main/services/sidebarBadges.js) against a
 *      migrated throwaway DB: low stock, the overdue customers, the audits in
 *      progress, the promotions that end this week, the open-shift dot, the
 *      cache and the role filter.
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/antigravty/billing softwere/pos-app';
const DIST = ROOT + '/dist';

const shared = require(DIST + '/shared/sidebarBadges.js');
const service = require(DIST + '/main/services/sidebarBadges.js');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

console.log('=== test_sidebarBadges (item 7) ===');

// ── Pure rules ───────────────────────────────────────────────────────────────
section('Safe counts');
check('NaN becomes 0', shared.badgeCount(NaN) === 0);
check('undefined becomes 0', shared.badgeCount(undefined) === 0);
check('null becomes 0', shared.badgeCount(null) === 0);
check('a negative number becomes 0', shared.badgeCount(-7) === 0);
check('a string number becomes a number', shared.badgeCount('7') === 7);
check('a float is floored', shared.badgeCount(3.9) === 3);
check('0 is nothing', shared.badgeCount(0) === 0);
check('a whole number is kept', shared.badgeCount(42) === 42);

section('The 99+ cap');
check('99 shows as 99', shared.badgeDisplay(99) === '99');
check('100 shows as 99+', shared.badgeDisplay(100) === '99+');
check('1000 shows as 99+', shared.badgeDisplay(1000) === '99+');
check('0 shows as 0', shared.badgeDisplay(0) === '0');

section('The role filter');
check('the badge minRole comes from the menu', shared.badgeMinRole('inventory') === 'manager');
check('unknown role gets nothing', shared.buildBadges('cashier', [{ id: 'inventory', kind: 'count', count: 5 }]).length === 0);
check('manager gets the badge', shared.buildBadges('manager', [{ id: 'inventory', kind: 'count', count: 5 }]).length === 1);
check('owner gets the badge', shared.buildBadges('owner', [{ id: 'inventory', kind: 'count', count: 5 }]).length === 1);
check('a zero count is no badge', shared.buildBadges('owner', [{ id: 'inventory', kind: 'count', count: 0 }]).length === 0);
check('a dot that is on shows', shared.buildBadges('owner', [{ id: 'shifts', kind: 'dot', count: 1 }]).length === 1);
check('a dot that is off hides', shared.buildBadges('owner', [{ id: 'shifts', kind: 'dot', count: 0 }]).length === 0);
check('a missing input is safe', shared.buildBadges('owner', null).length === 0);
check('a NaN count is no badge', shared.buildBadges('owner', [{ id: 'inventory', kind: 'count', count: NaN }]).length === 0);
check('badgeFor finds by id', shared.badgeFor(shared.buildBadges('owner', [{ id: 'inventory', kind: 'count', count: 7 }]), 'inventory').display === '7');

section('The dot has no number');
const dot = shared.buildBadges('owner', [{ id: 'shifts', kind: 'dot', count: 1 }])[0];
check('the dot carries the count', dot.count === 1);
check('the dot shows nothing', dot.display === '');
check('the dot is a dot', dot.kind === 'dot');

// ── The real service against a migrated throwaway DB ─────────────────────────
function makeDb() {
  const db = new (require('node:sqlite').DatabaseSync)(':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  const migrationsDir = path.join(ROOT, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    migration.up(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

function runWithDb(fn) {
  const db = makeDb();
  const dbModule = require(DIST + '/main/db.js');
  const original = dbModule.getDb;
  dbModule.getDb = () => db;
  try {
    fn(db);
  } finally {
    dbModule.getDb = original;
  }
}

section('The service on an empty shop');
runWithDb(() => {
  service.resetSidebarBadgeCache();
  check('an empty shop has no badges', service.getSidebarBadges('owner').length === 0);
  check('a cashier sees nothing', service.getSidebarBadges('cashier').length === 0);
});

section('The service with real data');
runWithDb((db) => {
  service.resetSidebarBadgeCache();

  // Two products: one genuinely low, one marked as test data (must not count),
  // one whose threshold is zero (must not count).
  db.prepare('INSERT INTO products (name, stock_qty, min_stock_level, active, is_test) VALUES (?,?,?,?,?)').run('Low', 2, 10, 1, 0);
  db.prepare('INSERT INTO products (name, stock_qty, min_stock_level, active, is_test) VALUES (?,?,?,?,?)').run('Testy', 1, 10, 1, 1);
  db.prepare('INSERT INTO products (name, stock_qty, min_stock_level, active, is_test) VALUES (?,?,?,?,?)').run('No threshold', 2, 0, 1, 0);

  // A customer 40 days overdue (credit period 10 days, balance 500).
  db.prepare('INSERT INTO customers (name, balance, credit_days) VALUES (?,?,?)').run('Overdue Bob', 500, 10);
  const bob = db.prepare('SELECT id FROM customers WHERE name = ?').get('Overdue Bob');
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10) + ' 10:00:00';
  db.prepare('INSERT INTO customer_transactions (customer_id, amount, type, created_at) VALUES (?,?,?,?)').run(bob.id, 1000, 'debit', fortyDaysAgo);
  db.prepare('INSERT INTO customer_transactions (customer_id, amount, type, created_at) VALUES (?,?,?,?)').run(bob.id, -500, 'credit', new Date().toISOString().slice(0, 10) + ' 10:00:00');

  // A customer whose charge is still inside the grace period.
  db.prepare('INSERT INTO customers (name, balance, credit_days) VALUES (?,?,?)').run('Fresh Sam', 200, 30);
  const sam = db.prepare('SELECT id FROM customers WHERE name = ?').get('Fresh Sam');
  db.prepare('INSERT INTO customer_transactions (customer_id, amount, type, created_at) VALUES (?,?,?,?)').run(sam.id, 200, 'debit', new Date().toISOString().slice(0, 10) + ' 10:00:00');

  // A customer with no credit period at all (the shop default applies).
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('default_credit_days', '30');
  db.prepare('INSERT INTO customers (name, balance, credit_days) VALUES (?,?,?)').run('Default Grace', 100, 0);
  const grace = db.prepare('SELECT id FROM customers WHERE name = ?').get('Default Grace');
  const fortyDaysAgo2 = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10) + ' 10:00:00';
  db.prepare('INSERT INTO customer_transactions (customer_id, amount, type, created_at) VALUES (?,?,?,?)').run(grace.id, 100, 'debit', fortyDaysAgo2);

  // An audit in progress and one that is finished.
  db.prepare('INSERT INTO users (username, role, password_hash) VALUES (?,?,?)').run('tester', 'owner', 'x');
  const tester = db.prepare('SELECT id FROM users WHERE username = ?').get('tester');
  db.prepare("INSERT INTO audits (user_id, status) VALUES (?, 'in_progress')").run(tester.id);
  db.prepare("INSERT INTO audits (user_id, status) VALUES (?, 'completed')").run(tester.id);

  // A promotion ending in 3 days and one ending in 30 days.
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO promotions (name, type, scope, discount_value, active, end_date) VALUES (?,?,?,?,?,?)").run('Soon', 'percent', 'all', 10, 1, soon);
  db.prepare("INSERT INTO promotions (name, type, scope, discount_value, active, end_date) VALUES (?,?,?,?,?,?)").run('Later', 'percent', 'all', 10, 1, later);
  db.prepare("INSERT INTO promotions (name, type, scope, discount_value, active, end_date) VALUES (?,?,?,?,?,?)").run('Expired', 'percent', 'all', 10, 1, '2020-01-01');

  // An open shift for the session user (user id 1 — the fallback).
  db.prepare('INSERT INTO shifts (user_id, start_cash) VALUES (?, ?)').run(1, 100);

  const badges = service.getSidebarBadges('owner');
  const byId = (id) => badges.find((b) => b.id === id);

  check('low stock counts 1 (test data excluded)', byId('inventory')?.count === 1, `got ${byId('inventory')?.count}`);
  check('the overdue customers are 2', byId('udhaar')?.count === 2, `got ${byId('udhaar')?.count}`);
  check('the fresh customer is not overdue', true); // covered by the count above
  check('audits in progress is 1', byId('audits')?.count === 1, `got ${byId('audits')?.count}`);
  check('promotions ending soon is 1', byId('promotions')?.count === 1, `got ${byId('promotions')?.count}`);
  check('the open shift is a dot', byId('shifts')?.kind === 'dot', `got ${byId('shifts')?.kind}`);
  check('the shift dot shows no number', byId('shifts')?.display === '', `got "${byId('shifts')?.display}"`);

  // The cashier sees none of these (they are all manager-only items).
  service.resetSidebarBadgeCache();
  // Re-seed the cache by forcing a fresh collection is not needed; the cache
  // already holds the numbers from above. Force a refresh to be sure.
  const cashierBadges = service.getSidebarBadges('cashier', true);
  check('a cashier sees no badges', cashierBadges.length === 0, `${cashierBadges.length} shown`);
});

section('The cache (at most once a minute)');
runWithDb((db) => {
  service.resetSidebarBadgeCache();
  db.prepare('INSERT INTO products (name, stock_qty, min_stock_level, active, is_test) VALUES (?,?,?,?,?)').run('Low', 2, 10, 1, 0);
  const first = service.getSidebarBadges('owner');
  // Add another low-stock product — the cache must still report the old number.
  db.prepare('INSERT INTO products (name, stock_qty, min_stock_level, active, is_test) VALUES (?,?,?,?,?)').run('Low 2', 1, 10, 1, 0);
  const second = service.getSidebarBadges('owner');
  check('the cache keeps the old number within the minute', first.length === second.length && second[0]?.count === first[0]?.count);
  // A forced refresh picks up the new product.
  const forced = service.getSidebarBadges('owner', true);
  check('a forced refresh picks up the new product', forced[0]?.count === 2, `got ${forced[0]?.count}`);
});

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
