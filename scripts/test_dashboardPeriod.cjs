/**
 * Dashboard period test (Run 10).
 *
 * Verifies getDailyStats, getDailySalesTrend, getDailySalesTrendDaily, getTopProducts
 * return different results for different periods (today/week/month) on a
 * migrated temp DB with sales on different dates.
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const reports = require("../dist/main/services/reports.js");
const { getDailyStats, getDailySalesTrend, getDailySalesTrendDaily, getTopProducts } = reports;

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(message + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
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

/**
 * Seed test data with sales on specific dates.
 * Uses the real schema via the reports module's internal DB.
 * We patch the reports module's getDb to use our test DB.
 */
async function seedTestData(db) {
  // Patch the db module used by reports.ts
  const dbModule = require("../dist/main/db.js");
  const originalGetDb = dbModule.getDb;
  dbModule.getDb = () => db;

  // Seed: 3 products, 1 customer (user already created by migration 011)
  db.exec("PRAGMA foreign_keys = OFF;");
  db.prepare("INSERT INTO customers (id, name, phone, status, credit_days, balance, created_at) VALUES (1, 'Test Customer', '123', 'active', 30, 0, '2026-01-01')").run();
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, created_at) VALUES (1, 'Product A', 'SKU-A', 100, 50, 100, 1, '2026-01-01')").run();
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, created_at) VALUES (2, 'Product B', 'SKU-B', 200, 80, 50, 1, '2026-01-01')").run();
  db.prepare("INSERT INTO products (id, name, sku, sale_price, cost_price, stock_qty, active, created_at) VALUES (3, 'Product C', 'SKU-C', 300, 120, 20, 1, '2026-01-01')").run();

  // Sales on three different dates:
  // Today (2026-11-08): 2 sales
  // Week ago (2026-11-02): 1 sale
  // Month ago (2026-10-08): 1 sale
  const today = "2026-11-08";
  const weekAgo = "2026-11-02";
  const monthAgo = "2026-10-08";

  function makeSale(id, dateStr, items) {
    const total = items.reduce((s, i) => s + i.qty * i.price, 0);
    db.prepare("INSERT INTO sales (id, customer_id, user_id, total_amount, status, created_at, invoice_no) VALUES (?, ?, 1, ?, 'completed', ?, ?)").run(
      id, 1, total, dateStr + "T12:00:00Z", "INV-" + id
    );
    for (const item of items) {
      db.prepare("INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?)").run(
        id, item.product_id, item.qty, item.price, item.qty * item.price
      );
    }
  }

  makeSale(1, today, [{ product_id: 1, qty: 2, price: 100 }, { product_id: 2, qty: 1, price: 200 }]); // 400
  makeSale(2, today, [{ product_id: 3, qty: 1, price: 300 }]); // 300
  makeSale(3, weekAgo, [{ product_id: 1, qty: 5, price: 100 }]); // 500
  makeSale(4, monthAgo, [{ product_id: 2, qty: 2, price: 200 }]); // 400

  db.exec("PRAGMA foreign_keys = OFF;");

  return { today, weekAgo, monthAgo, originalGetDb: require("../dist/main/db.js").getDb };
}

console.log("\n=== Dashboard period tests (migrated temp DB) ===");

async function runTests() {
  const db = await makeMigratedDb();
  const dates = await seedTestData(db);
  const { today, weekAgo, monthAgo, originalGetDb } = dates;

  try {
    test("getDailyStats today returns today's sales only", () => {
      const stats = getDailyStats(today, today);
      assertEqual(stats.bill_count, 2, "today has 2 bills");
      assertEqual(stats.total_sales, 700, "today total 700 (400+300)");
    });

    test("getDailyStats week returns today + week ago", () => {
      const stats = getDailyStats(weekAgo, today);
      assertEqual(stats.bill_count, 3, "week has 3 bills (today 2 + week ago 1)");
      assertEqual(stats.total_sales, 1200, "week total 1200 (700+500)");
    });

    test("getDailyStats month returns all 4 bills", () => {
      const stats = getDailyStats(monthAgo, today);
      assertEqual(stats.bill_count, 4, "month has 4 bills");
      assertEqual(stats.total_sales, 1600, "month total 1600 (700+500+400)");
    });

    test("getDailySalesTrend today returns hourly data for today only", () => {
      const trend = getDailySalesTrend(today, today);
      const total = trend.reduce((s, h) => s + h.amount, 0);
      assertEqual(total, 700, "hourly trend total matches today's sales");
    });

    test("getDailySalesTrend week returns hourly data for week", () => {
      const trend = getDailySalesTrend(weekAgo, today);
      const total = trend.reduce((s, h) => s + h.amount, 0);
      assertEqual(total, 1200, "hourly trend total matches week's sales");
    });

    test("getDailySalesTrendDaily today returns 1 day", () => {
      const trend = getDailySalesTrendDaily(today, today);
      assertEqual(trend.length, 1, "today returns 1 day");
      assertEqual(trend[0].amount, 700, "today amount 700");
    });

    test("getDailySalesTrendDaily week returns 7 days (inclusive)", () => {
      const trend = getDailySalesTrendDaily(weekAgo, today);
      assertEqual(trend.length, 7, "week returns 7 days inclusive (Nov 2-8)");
      const total = trend.reduce((s, d) => s + d.amount, 0);
      assertEqual(total, 1200, "daily trend total matches week");
    });

    test("getDailySalesTrendDaily month returns all days with zeros filled", () => {
      const trend = getDailySalesTrendDaily(monthAgo, today);
      assert(trend.length >= 31, "month returns ~31 days");
      const total = trend.reduce((s, d) => s + d.amount, 0);
      assertEqual(total, 1600, "daily trend total matches month");
    });

    test("getTopProducts today returns top by qty", () => {
      const top = getTopProducts(3, today, today);
      assertEqual(top.length, 3, "today has 3 products sold (A, B, C)");
      // Product A: 2 units, Product B: 1 unit, Product C: 1 unit
      assertEqual(top[0].name, "Product A", "top today is Product A");
      assertEqual(top[0].qty_sold, 2, "Product A qty 2");
    });

    test("getTopProducts week returns top by qty", () => {
      const top = getTopProducts(3, weekAgo, today);
      // Product A: 2 (today) + 5 (week ago) = 7
      // Product B: 1 (today)
      // Product C: 1 (today)
      assertEqual(top[0].name, "Product A", "top week is Product A");
      assertEqual(top[0].qty_sold, 7, "Product A qty 7");
    });

    test("getTopProducts month returns top by qty", () => {
      const top = getTopProducts(3, monthAgo, today);
      // Product A: 7, Product B: 1+2=3, Product C: 1
      assertEqual(top[0].name, "Product A", "top month is Product A");
      assertEqual(top[0].qty_sold, 7, "Product A qty 7");
      assertEqual(top[1].name, "Product B", "2nd month is Product B");
      assertEqual(top[1].qty_sold, 3, "Product B qty 3");
    });

    console.log("\n" + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exitCode = 1;
    else console.log("ALL PASSED");
  } finally {
    // Restore
    const dbModule = require("../dist/main/db.js");
    dbModule.getDb = originalGetDb;
    db.close();
  }
}

runTests().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});