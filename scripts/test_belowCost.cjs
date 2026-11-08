/**
 * Below-cost query test (Run 10).
 *
 * Verifies listBelowCostProducts():
 *   - includes products where sale_price <= cost_price
 *   - includes products where wholesale_price <= cost_price (and wholesale_price > 0)
 *   - excludes products where cost_price = 0
 *   - excludes products where is_test = 1
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const reports = require("../dist/main/services/reports.js");
const { listBelowCostProducts } = reports;

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => {
        console.log("  ok  " + name);
        passed++;
      }).catch((e) => {
        console.error("FAIL  " + name);
        console.error("      " + (e instanceof Error ? e.message : String(e)));
        failed++;
      });
    } else {
      console.log("  ok  " + name);
      passed++;
    }
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
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (1, 'Below Cost Retail', 'SKU-1', 80, 100, 90, 10, 1, 1, 0, '2026-01-01')").run(); // sale < cost
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (2, 'Below Cost Wholesale', 'SKU-2', 150, 100, 80, 20, 1, 1, 0, '2026-01-01')").run(); // wholesale < cost
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (3, 'Normal Product', 'SKU-3', 150, 100, 120, 30, 1, 1, 0, '2026-01-01')").run(); // above cost
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (4, 'Zero Cost', 'SKU-4', 100, 0, 0, 10, 1, 1, 0, '2026-01-01')").run(); // cost = 0 (excluded)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (5, 'Test Product', 'SKU-5', 50, 100, 60, 10, 1, 1, 1, '2026-01-01')").run(); // is_test = 1 (excluded)
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, wholesale_price, stock_qty, active, category_id, is_test, created_at) VALUES (6, 'Wholesale At Cost', 'SKU-6', 120, 100, 100, 10, 1, 1, 0, '2026-01-01')").run(); // wholesale = cost (included)
  db.exec("PRAGMA foreign_keys = OFF;");

  return originalGetDb;
}

console.log("\n=== Below-cost query tests (migrated temp DB) ===");

async function runTests() {
  const db = await makeMigratedDb();
  const originalGetDb = await seedTestData(db);

  try {
    test("includes product with sale_price < cost_price", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Below Cost Retail');
      assert(found, "Should find 'Below Cost Retail'");
      assertEqual(found.sale_price, 80, "sale_price should be 80");
      assertEqual(found.cost_price, 100, "cost_price should be 100");
      assertEqual(found.margin_retail, -20, "margin_retail should be -20");
      assertEqual(found.margin_pct_retail, -20.0, "margin_pct_retail should be -20%");
    });

    test("includes product with wholesale_price < cost_price", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Below Cost Wholesale');
      assert(found, "Should find 'Below Cost Wholesale'");
      assertEqual(found.wholesale_price, 80, "wholesale_price should be 80");
      assertEqual(found.cost_price, 100, "cost_price should be 100");
      assertEqual(found.margin_wholesale, -20, "margin_wholesale should be -20");
      assertEqual(found.margin_pct_wholesale, -20.0, "margin_pct_wholesale should be -20%");
    });

    test("includes product with wholesale_price = cost_price", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Wholesale At Cost');
      assert(found, "Should find 'Wholesale At Cost'");
      assertEqual(found.wholesale_price, 100, "wholesale_price should be 100");
      assertEqual(found.cost_price, 100, "cost_price should be 100");
      assertEqual(found.margin_wholesale, 0, "margin_wholesale should be 0");
      assertEqual(found.margin_pct_wholesale, 0.0, "margin_pct_wholesale should be 0%");
    });

    test("excludes product with cost_price = 0", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Zero Cost');
      assert(!found, "Should NOT find 'Zero Cost' (cost_price = 0)");
    });

    test("excludes product with is_test = 1", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Test Product');
      assert(!found, "Should NOT find 'Test Product' (is_test = 1)");
    });

    test("excludes product with sale_price > cost_price and wholesale_price > cost_price", () => {
      const results = listBelowCostProducts();
      const found = results.find(r => r.name === 'Normal Product');
      assert(!found, "Should NOT find 'Normal Product' (both prices above cost)");
    });

    test("total count is correct", () => {
      const results = listBelowCostProducts();
      // Should find: Below Cost Retail, Below Cost Wholesale, Wholesale At Cost = 3 products
      assertEqual(results.length, 3, "Should find exactly 3 below-cost products");
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