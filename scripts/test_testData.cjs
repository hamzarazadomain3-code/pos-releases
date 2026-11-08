/**
 * Test-data cleanup regression (B/C2).
 *
 * Verifies src/main/services/testData.ts against a real schema built from the
 * migrations, using an in-memory database:
 *   - preview is read-only
 *   - an unreferenced test product is deleted
 *   - a test product with history is quarantined (is_test=1, active=0)
 *   - non-test products are untouched
 *   - the exact confirmation phrase is required
 *   - a second run is a no-op (idempotent)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
}

async function test(name, fn) {
  try {
    await fn();
    console.log('  ok  ' + name);
    passed++;
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error('      ' + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

async function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    await migration.up(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

function seed(db) {
  // Unreferenced test product -> should be deleted.
  db.prepare("INSERT INTO products (name, stock_qty) VALUES (?, ?)").run('Wiring Test Item A', 5);
  const aId = db.prepare("SELECT id FROM products WHERE name = 'Wiring Test Item A'").get().id;

  // Test product with history -> should be quarantined.
  db.prepare("INSERT INTO products (name, stock_qty) VALUES (?, ?)").run('Wiring Test Item B', 7);
  const bId = db.prepare("SELECT id FROM products WHERE name = 'Wiring Test Item B'").get().id;
  db.prepare('INSERT INTO stock_movements (product_id, change_qty, reason) VALUES (?, ?, ?)').run(
    bId,
    1,
    'test seed'
  );

  // Production product -> must not change.
  db.prepare("INSERT INTO products (name, stock_qty) VALUES (?, ?)").run('Real Product', 9);
  const realId = db.prepare("SELECT id FROM products WHERE name = 'Real Product'").get().id;

  return { aId, bId, realId };
}

console.log('\n=== test-data cleanup tests ===');

let db;
let ids;
let dbModule;
let originalGetDb;

const { previewTestData, removeTestData, REMOVE_TEST_DATA_PHRASE } = require('../dist/main/services/testData.js');

async function run() {
  db = await makeDb();
  ids = seed(db);

  // Patch the db module BEFORE using the service (compiled CJS resolves getDb
  // through the module object at call time, so either order works).
  dbModule = require('../dist/main/db.js');
  originalGetDb = dbModule.getDb;
  dbModule.getDb = () => db;

  await test('preview finds only approved test products', () => {
    const preview = previewTestData();
    assertEqual(preview.total_products, 2, 'Should match two test products');
    assertEqual(preview.delete_count, 1, 'One product has no history');
    assertEqual(preview.quarantine_count, 1, 'One product has history');
    assert(
      preview.products.every((p) => p.name.startsWith('Wiring Test Item')),
      'Only test-pattern products should be listed'
    );
    assertEqual(REMOVE_TEST_DATA_PHRASE, 'REMOVE TEST DATA', 'Confirmation phrase is stable');
  });

  await test('preview is read-only', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    previewTestData();
    const after = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    assertEqual(after, before, 'Preview must not change the product count');
    const flag = db.prepare('SELECT is_test FROM products WHERE id = ?').get(ids.bId).is_test;
    assertEqual(flag, 0, 'Preview must not change is_test');
  });

  await test('removal rejects a wrong confirmation phrase', async () => {
    let threw = false;
    try {
      await removeTestData('please', () => 'backup.db');
    } catch {
      threw = true;
    }
    assert(threw, 'Wrong phrase must throw');
    const stillThere = db.prepare('SELECT COUNT(*) c FROM products WHERE id = ?').get(ids.aId).c;
    assertEqual(stillThere, 1, 'Wrong phrase must not delete anything');
  });

  await test('removal deletes unreferenced and quarantines referenced products', async () => {
    const result = await removeTestData(REMOVE_TEST_DATA_PHRASE, () => 'E:/temp/fake-backup.db');
    assertEqual(result.deleted, 1, 'One product deleted');
    assertEqual(result.quarantined, 1, 'One product quarantined');
    assertEqual(result.backupPath, 'E:/temp/fake-backup.db', 'Backup path is reported');

    const gone = db.prepare('SELECT COUNT(*) c FROM products WHERE id = ?').get(ids.aId).c;
    assertEqual(gone, 0, 'Unreferenced test product is deleted');

    const b = db.prepare('SELECT is_test, active FROM products WHERE id = ?').get(ids.bId);
    assertEqual(b.is_test, 1, 'Referenced test product is flagged is_test=1');
    assertEqual(b.active, 0, 'Referenced test product is deactivated');

    const real = db.prepare('SELECT is_test, active FROM products WHERE id = ?').get(ids.realId);
    assertEqual(real.is_test, 0, 'Production product is not flagged');
    assertEqual(real.active, 1, 'Production product stays active');

    const history = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?').get(ids.bId).c;
    assertEqual(history, 1, 'History rows are preserved for quarantined products');
  });

  await test('a second removal is a no-op (idempotent)', () => {
    const before = previewTestData();
    assertEqual(before.total_products, 0, 'No test products remain');
    return removeTestData(REMOVE_TEST_DATA_PHRASE, () => 'unused.db').then((result) => {
      assertEqual(result.deleted, 0, 'Nothing deleted on second run');
      assertEqual(result.quarantined, 0, 'Nothing quarantined on second run');
      assertEqual(result.backupPath, '', 'No backup made when nothing matches');
    });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
  else console.log('ALL PASSED');
}

run().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
}).finally(() => {
  if (dbModule && originalGetDb) dbModule.getDb = originalGetDb;
  if (db) db.close();
});
