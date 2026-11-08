/**
 * Migration 071 safety test (Run 11).
 *
 * Verifies:
 *   - Only 'Wiring Test Item%' and exact 'AG0ENT6N' are marked
 *   - Products with history in sale_items/purchase_items/stock_movements are skipped (unless Wiring Test Item)
 *   - INIT-% products are NOT marked
 *   - Idempotent: second run changes nothing
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

async function makeMigratedDb() {
  const db = new (require("node:sqlite").DatabaseSync)(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js")).sort();
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    if (typeof migration.up === "function") {
      await migration.up(db);
    }
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  }
  db.exec("PRAGMA foreign_keys = OFF;");
  return db;
}

async function seedTestData(db) {
  const dbModule = require("../dist/main/db.js");
  const originalGetDb = dbModule.getDb;
  dbModule.getDb = () => db;

  db.exec("PRAGMA foreign_keys = OFF;");
  // User already created by migration 011
  db.prepare("INSERT INTO categories (id, name) VALUES (1, 'Test Category')").run();
  // Wiring Test Item (should be marked)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (1, 'Wiring Test Item A', 'SKU-1', 100, 50, 10, 1, 1, 0, '2026-01-01')").run();
  // AG0ENT6N exact match (should be marked, no history)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (2, 'AG0ENT6N', 'SKU-2', 100, 50, 5, 1, 1, 0, '2026-01-01')").run();
  // AG0ENT6N with history (should be skipped due to history)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (3, 'AG0ENT6N', 'SKU-3', 100, 50, 5, 1, 1, 0, '2026-01-01')").run();
  db.prepare("INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (1, 3, 1, 100, 100)").run();
  // INIT-Real Product (should NOT be marked)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (4, 'INIT-Real Product', 'SKU-4', 100, 50, 10, 1, 1, 0, '2026-01-01')").run();
  // Normal product (should NOT be marked)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (5, 'Normal Product', 'SKU-5', 100, 50, 10, 1, 1, 0, '2026-01-01')").run();
  // Wiring Test Item with history (should still be marked)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, category_id, is_test, created_at) VALUES (6, 'Wiring Test Item B', 'SKU-6', 100, 50, 5, 1, 1, 0, '2026-01-01')").run();
  db.prepare("INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (2, 6, 1, 100, 100)").run();

  db.exec("PRAGMA foreign_keys = OFF;");

  return originalGetDb;
}

console.log("\n=== Migration 071 safety tests ===");

async function runTests() {
  const db = await makeMigratedDb();
  const originalGetDb = await seedTestData(db);

  // Run migration 071 AFTER seeding test data
  const m71 = require('../migrations/071_mark_test_products.js');
  await m71.up(db);

  try {
    await test("Migration 071 marks Wiring Test Item A (no history)", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'Wiring Test Item A' AND is_test = 1").get().cnt;
      assertEqual(count, 1, "Wiring Test Item A should be marked");
    });

    await test("Migration 071 marks Wiring Test Item B (has history, but Wiring Test Item pattern)", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'Wiring Test Item B' AND is_test = 1").get().cnt;
      assertEqual(count, 1, "Wiring Test Item B should be marked despite history");
    });

    await test("Migration 071 marks AG0ENT6N (exact match, no history)", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'AG0ENT6N' AND is_test = 1 AND id = 2").get().cnt;
      assertEqual(count, 1, "AG0ENT6N (id=2, no history) should be marked");
    });

    await test("Migration 071 SKIPS AG0ENT6N with history (id=3)", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'AG0ENT6N' AND is_test = 1 AND id = 3").get().cnt;
      assertEqual(count, 0, "AG0ENT6N (id=3, has history) should NOT be marked");
    });

    await test("Migration 071 does NOT mark INIT-Real Product", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'INIT-Real Product' AND is_test = 1").get().cnt;
      assertEqual(count, 0, "INIT-Real Product should NOT be marked");
    });

    await test("Migration 071 does NOT mark Normal Product", async () => {
      const count = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE name = 'Normal Product' AND is_test = 1").get().cnt;
      assertEqual(count, 0, "Normal Product should NOT be marked");
    });

    await test("Migration 071 is idempotent (second run changes nothing)", async () => {
      const m71 = require('../migrations/071_mark_test_products.js');
      await m71.up(db);

      const marked = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_test = 1").get().cnt;
      // Should still be 3 (Wiring Test Item A, Wiring Test Item B, AG0ENT6N id=2)
      assertEqual(marked, 3, "Second run should not change anything");
    });

    console.log("\n" + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exitCode = 1;
    else console.log("ALL PASSED");
  } finally {
    const dbModule = require("../dist/main/db.js");
    dbModule.getDb = originalGetDb;
    db.close();
  }
}

runTests().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});