/**
 * Test for the promotions service (dist/main/services/promotions.js).
 * Tests:
 *   - Expired promotion not applied by resolvePromotions
 *   - listPromotions changes no row (read-only)
 *   - expirePromotions idempotent
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const { activePromotions, resolvePromotions, listPromotions, expirePromotions, createPromotion, updatePromotion, deletePromotion } = require('../dist/main/services/promotions.js');

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(message + ': expected ' + e + ', got ' + a);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
    passed++;
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error('      ' + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

console.log('\n=== promotions tests ===');

// Helper to create a fresh DB with migrations
function createTestDb() {
  const db = new (require('node:sqlite').DatabaseSync)(':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  
  // Run all migration files from the repo's migrations folder
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();
  
  for (const file of migrationFiles) {
    const migration = require(path.join(migrationsDir, file));
    migration.up(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
  
  return db;
}

function makeDb() {
  const db = new (require('node:sqlite').DatabaseSync)(':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  
  // Create migrations table first
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Run all migration files
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();
  
  for (const file of migrationFiles) {
    const migration = require(path.join(migrationsDir, file));
    migration.up(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
  
  // Disable foreign keys after migrations (they might have been enabled by migrations)
  db.exec('PRAGMA foreign_keys = OFF;');
  
  return db;
}

function injectDb(db) {
  // Monkey-patch the getDb function in the promotions module
  // This is a hack for testing - in production we'd use dependency injection
  const mod = require('../dist/main/services/promotions.js');
  mod.__test_db = db;
  return mod;
}

function runWithDb(fn) {
  const db = makeDb();
  const originalGetDb = require('../dist/main/db.js').getDb;
  require('../dist/main/db.js').getDb = () => db;
  
  try {
    fn();
  } finally {
    require('../dist/main/db.js').getDb = originalGetDb;
  }
}

console.log('\n=== promotions tests ===');

// Test 1: Expired promotion not applied by resolvePromotions
test('Expired promotion not applied by resolvePromotions', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Create an expired promotion
    const promoId = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('Expired Promo', 1, yesterday, yesterday).lastInsertRowid;
    
    // Create an active promotion
    const activePromoId = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 15, ?, ?, 1)
    `).run('Active Promo', 1, today, tomorrow).lastInsertRowid;
    
    // Resolve promotions for product 1
    const result = resolvePromotions([{ product_id: 1, qty: 1, price: 100 }]);
    
    // Should apply the active promo, not the expired one
    assertEqual(result[0].promo_id, activePromoId);
    assertEqual(result[0].saved, 15); // 15% of 100 = 15
    assertEqual(result[0].promo_name, 'Active Promo');
  });
});

// Test 2: Promotion with end_date in past is expired
test('Promotion with end_date yesterday is not applied', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 20, ?, ?, 1)
    `).run('Expired 20%', 1, '2024-01-01', yesterday);
    
    const result = resolvePromotions([{ product_id: 1, qty: 1, price: 100 }]);
    
    // Should not apply expired promo
    assertEqual(result[0].promo_id, null);
    assertEqual(result[0].saved, 0);
  });
});

// Test 3: Promotion with start_date in future is not applied
test('Promotion with start_date tomorrow is not applied', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 25, ?, ?, 1)
    `).run('Future Promo', 1, tomorrow, dayAfter);
    
    const result = resolvePromotions([{ product_id: 1, qty: 1, price: 100 }]);
    
    // Should not apply future promo
    assertEqual(result[0].promo_id, null);
    assertEqual(result[0].saved, 0);
  });
});

// Test 4: listPromotions changes no row (read-only)
test('listPromotions is read-only (no mutations)', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Insert a test promotion
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('Test Promo', 1, '2024-01-01', tomorrow);
    
    const before = db.prepare('SELECT * FROM promotions').all();
    
    // Call listPromotions
    const promos = listPromotions();
    
    const after = db.prepare('SELECT * FROM promotions').all();
    
    // Verify no mutations
    assertEqual(before.length, after.length);
    for (let i = 0; i < before.length; i++) {
      assertDeepEqual(before[i], after[i]);
    }
    
    // Verify the returned data is correct
    assert(promos.length >= 1, 'promos.length >= 1');
    const found = promos.find(p => p.name === 'Test Promo');
    assert(found, 'Test promo should be in list');
    assertEqual(found.active, 1);
  });
});

// Test 5: expirePromotions idempotent
test('expirePromotions is idempotent', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Insert expired promotions
    const id1 = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('Expired 1', 1, '2024-01-01', yesterday).lastInsertRowid;
    
    const id2 = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('Expired 2', 2, '2024-01-01', yesterday).lastInsertRowid;
    
    // First run
    const changes1 = expirePromotions();
    assert(changes1 >= 2, 'First run should expire at least 2 promotions');
    
    // Check both are now inactive
    const p1 = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id1);
    const p2 = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id2);
    assertEqual(p1.active, 0);
    assertEqual(p2.active, 0);
    
    // Second run - should be idempotent (0 changes)
    const changes2 = expirePromotions();
    assertEqual(changes2, 0, 'Second run should be idempotent (0 changes)');
    
    // Verify still inactive
    const p1b = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id1);
    const p2b = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id2);
    assertEqual(p1b.active, 0);
    assertEqual(p2b.active, 0);
  });
});

// Test 5: Active promotion within date range is applied
test('Active promotion within date range is applied', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 25, ?, ?, 1)
    `).run('Valid Promo', 1, yesterday, tomorrow);
    
    const result = resolvePromotions([{ product_id: 1, qty: 1, price: 200 }]);
    
    assert(result[0].promo_id !== null, 'Should apply active promo');
    assertEqual(result[0].saved, 50); // 25% of 200 = 50
    assertEqual(result[0].promo_name, 'Valid Promo');
  });
});

// Test 6: Category-scoped promotion works
test('Category-scoped promotion applies to products in category', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Create a category
    const catId = db.prepare('INSERT INTO categories (name) VALUES (?)').run('Test Category').lastInsertRowid;
    
    // Create products in that category
    const prod1 = db.prepare('INSERT INTO products (name, category_id, sale_price, active) VALUES (?, ?, 100, 1)').run('Prod A', catId).lastInsertRowid;
    const prod2 = db.prepare('INSERT INTO products (name, category_id, sale_price, active) VALUES (?, ?, 200, 1)').run('Prod B', catId).lastInsertRowid;
    
    // Create category-scoped promotion
    db.prepare(`
      INSERT INTO promotions (name, type, scope, category_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'category', ?, 15, ?, ?, 1)
    `).run('Cat Promo', catId, yesterday, tomorrow);
    
    // Resolve for both products
    const result = resolvePromotions([
      { product_id: prod1, qty: 1, price: 100 },
      { product_id: prod2, qty: 1, price: 200 }
    ]);
    
    assertEqual(result[0].promo_id !== null, true);
    assertEqual(result[1].promo_id !== null, true);
    assertEqual(result[0].saved, 15); // 15% of 100
    assertEqual(result[1].saved, 30); // 15% of 200
  });
});

// Test 7: BOGO promotion works
test('BOGO promotion calculates free items correctly', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, buy_qty, free_qty, start_date, end_date, active)
      VALUES (?, 'bogo', 'product', ?, 100, 2, 1, ?, ?, 1)
    `).run('BOGO 2+1', 1, yesterday, tomorrow);
    
    // Buy 3, get 1 free (2+1 bundle = 3, so 1 full bundle = 1 free)
    const result = resolvePromotions([{ product_id: 1, qty: 3, price: 100 }]);
    
    assertEqual(result[0].saved, 100); // 1 free item worth 100
  });
});

// Test 8: expirePromotions only affects active promotions with end_date
test('expirePromotions only affects active promotions with end_date', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Active with future end_date - should NOT expire
    const id1 = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('Future Promo', 1, '2024-01-01', nextWeek).lastInsertRowid;
    
    // Inactive with past end_date - should NOT change (already inactive)
    const id2 = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 0)
    `).run('Inactive Promo', 1, '2024-01-01', '2024-01-15').lastInsertRowid;
    
    // Active with no end_date - should NOT expire (no end date)
    const id3 = db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('No End Date', 1, '2024-01-01', '').lastInsertRowid;
    
    const changes = expirePromotions();
    assertEqual(changes, 0);
    
    // Verify all unchanged
    const p1 = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id1);
    const p2 = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id2);
    const p3 = db.prepare('SELECT active FROM promotions WHERE id = ?').get(id3);
    assertEqual(p1.active, 1);
    assertEqual(p2.active, 0);
    assertEqual(p3.active, 1);
  });
});

// Test 9: Promotion with no end_date never expires
test('Promotion with no end_date never expires', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('No End Date', 1, yesterday, '');
    
    const changes = expirePromotions();
    assertEqual(changes, 0, 'Promotion with no end_date should not expire');
    
    const promo = db.prepare('SELECT active, end_date FROM promotions WHERE name = ?').get('No End Date');
    assertEqual(promo.active, 1);
    assertEqual(promo.end_date, '');
  });
});

// Test 10: resolvePromotions picks best promotion (lowest effective price)
test('resolvePromotions picks best promotion (lowest effective price)', () => {
  runWithDb(() => {
    const db = require('../dist/main/db.js').getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // 10% off
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 10, ?, ?, 1)
    `).run('10% Off', 1, '2024-01-01', tomorrow);
    
    // 20% off
    db.prepare(`
      INSERT INTO promotions (name, type, scope, product_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'product', ?, 20, ?, ?, 1)
    `).run('20% Off', 1, '2024-01-01', tomorrow);
    
    // 15% off (category)
    const catId = require('../dist/main/db.js').getDb().prepare('INSERT INTO categories (name) VALUES (?)').run('Cat').lastInsertRowid;
    require('../dist/main/db.js').getDb().prepare('INSERT INTO products (name, category_id, sale_price, active) VALUES (?, ?, 100, 1)').run('Prod', catId);
    db.prepare(`
      INSERT INTO promotions (name, type, scope, category_id, discount_value, start_date, end_date, active)
      VALUES (?, 'percent', 'category', ?, 15, ?, ?, 1)
    `).run('Cat 15%', catId, '2024-01-01', tomorrow);
    
    // Should pick 20% off (best effective price)
    const result = resolvePromotions([{ product_id: 1, qty: 1, price: 100 }]);
    assertEqual(result[0].saved, 20); // 20% of 100 = 20
    assertEqual(result[0].promo_name, '20% Off');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
else console.log('ALL PASSED');