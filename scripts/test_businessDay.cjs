/**
 * Run 13 Item A — one "Today" everywhere.
 *
 * Fixed instants (never today's clock) against the REAL compiled services:
 *  - 02:00 PKT with a 04:00 anchor => dashboard(), getDailyStats(), listReturns()
 *    and Sales History defaults all resolve the previous business date.
 *  - 23:50 / 00:10 with anchor 0 split on local midnight.
 *  - Asia/Karachi, Asia/Dubai and America/New_York (both sides of DST).
 *  - presetRange today/yesterday/week/month/lastmonth with a fixed now.
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbModule = require("../dist/main/db.js");
const reports = require("../dist/main/services/reports.js");
const returns = require("../dist/main/services/returns.js");
const history = require("../dist/main/services/salesHistory.js");
const shared = require("../dist/shared/salesHistory.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
  }
}

function test(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

async function makeMigratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  const dir = path.join(__dirname, "..", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
    const migration = require(path.join(dir, file));
    if (typeof migration.up === "function") await migration.up(db);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  }
  db.exec("PRAGMA foreign_keys = OFF;");
  return db;
}

function seed(db) {
  db.prepare(
    "INSERT INTO customers (id, name, phone, status, balance) VALUES (1, 'Walk-in', '000', 'active', 0)"
  ).run();
  db.prepare(
    "INSERT INTO products (id, name, sale_price, cost_price, stock_qty, active) VALUES (1, 'Tea', 100, 50, 100, 1)"
  ).run();

  const sale = db.prepare(
    `INSERT INTO sales (id, customer_id, user_id, total_amount, status, created_at, invoice_no)
     VALUES (?, 1, 1, ?, 'completed', ?, ?)`
  );
  const item = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total)
     VALUES (?, 1, 1, ?, ?)`
  );
  const event = db.prepare(
    `INSERT INTO sale_events (event_type, sale_id, invoice_no, user_id, amount, created_at)
     VALUES ('sale', ?, ?, 1, ?, ?)`
  );
  const ret = db.prepare(
    `INSERT INTO returns (sale_id, refund_amount, refund_mode, restock, created_at)
     VALUES (?, ?, 'cash', 1, ?)`
  );

  function addSale(id, amount, at) {
    sale.run(id, amount, at, "INV-" + id);
    item.run(id, amount, amount);
    event.run(id, "INV-" + id, amount, at);
  }

  // Asia/Karachi (UTC+5) with a 04:00 anchor:
  // business date 2026-11-09 runs 2026-11-08 23:00Z .. 2026-11-09 23:00Z.
  addSale(1, 100, "2026-11-09 10:00:00");
  addSale(2, 200, "2026-11-09 23:30:00"); // 04:30 on 10 Nov => next business day
  ret.run(1, 10, "2026-11-09 12:00:00");
  ret.run(2, 20, "2026-11-09 23:30:00");

  // Local midnight split (anchor 0): 23:50 PKT vs 00:10 PKT.
  addSale(3, 300, "2026-11-10 18:55:00"); // 23:55 on 10 Nov
  addSale(4, 400, "2026-11-10 19:05:00"); // 00:05 on 11 Nov
}

console.log("\n=== Run 13 · one Today (fixed instants, real services) ===");

(async () => {
  const db = await makeMigratedDb();
  const original = dbModule.getDb;
  dbModule.getDb = () => db;
  seed(db);

  const at2am = new Date("2026-11-09T21:00:00Z"); // 02:00 PKT on 10 Nov
  const anchor4 = { now: at2am, startHour: 4, timezone: "Asia/Karachi" };

  try {
    test("business range at 02:00 with a 04:00 anchor is the previous date", () => {
      const r = shared.resolveBusinessRange(null, null, 4, "Asia/Karachi", at2am);
      assertEqual(r.businessDate, "2026-11-09", "business date");
      assertEqual(r.from, "2026-11-09", "from");
      assertEqual(r.to, "2026-11-09", "to");
      assertEqual(r.fromUtc, "2026-11-08 23:00:00", "from UTC");
      assertEqual(r.toUtc, "2026-11-09 23:00:00", "to UTC");
    });

    test("dashboard() at 02:00 shows the previous business day only", () => {
      const d = reports.dashboard(anchor4);
      assertEqual(d.today_sales, 100, "today_sales excludes 04:30 bill");
    });

    test("getDailyStats() at 02:00 shows the previous business day only", () => {
      const s = reports.getDailyStats(undefined, undefined, anchor4);
      assertEqual(s.total_sales, 100, "total_sales");
      assertEqual(s.bill_count, 1, "bill_count");
    });

    test("getDailySalesTrend()/getTopProducts() use the same boundary", () => {
      const hourly = reports.getDailySalesTrend(undefined, undefined, anchor4);
      assertEqual(
        hourly.reduce((sum, h) => sum + h.amount, 0),
        100,
        "trend total"
      );
      const top = reports.getTopProducts(5, undefined, undefined, anchor4);
      assertEqual(top.length, 1, "one product");
      assertEqual(top[0].qty_sold, 1, "qty");
    });

    test("listReturns()/listCashRefunds() default to the same business day", () => {
      const rows = returns.listReturns(undefined, undefined, undefined, undefined, anchor4);
      assertEqual(rows.length, 1, "one return");
      assertEqual(rows[0].refund_amount, 10, "inside-boundary return only");
      const refunds = returns.listCashRefunds(undefined, undefined, anchor4);
      assertEqual(refunds.length, 0, "no cash refunds seeded");
    });

    test("Sales History defaults to the same business day", () => {
      const f = history.historyDefaults(4, { now: at2am, timezone: "Asia/Karachi" });
      assertEqual(f.from, "2026-11-09", "history from");
      assertEqual(f.to, "2026-11-09", "history to");
      const summary = history.historySummary(f);
      assertEqual(summary.salesTotal, 100, "history summary sale total");
    });

    test("23:50 and 00:10 split on local midnight with anchor 0", () => {
      const before = shared.resolveBusinessRange(
        null,
        null,
        0,
        "Asia/Karachi",
        new Date("2026-11-10T18:50:00Z")
      );
      const after = shared.resolveBusinessRange(
        null,
        null,
        0,
        "Asia/Karachi",
        new Date("2026-11-10T19:10:00Z")
      );
      assertEqual(before.businessDate, "2026-11-10", "23:50 date");
      assertEqual(after.businessDate, "2026-11-11", "00:10 date");
      assertEqual(
        reports.getDailyStats(undefined, undefined, {
          now: new Date("2026-11-10T18:50:00Z"),
          startHour: 0,
          timezone: "Asia/Karachi",
        }).total_sales,
        500,
        "23:50 sees the 23:55 bill and the 04:30 bill from the morning"
      );
      assertEqual(
        reports.getDailyStats(undefined, undefined, {
          now: new Date("2026-11-10T19:10:00Z"),
          startHour: 0,
          timezone: "Asia/Karachi",
        }).total_sales,
        400,
        "00:10 sees the 00:05 bill"
      );
    });

    test("Asia/Dubai is UTC+4 at the same wall clock", () => {
      assertEqual(shared.getTzOffsetMinutes("Asia/Dubai", at2am), 240, "Dubai offset");
      const r = shared.resolveBusinessRange(null, null, 4, "Asia/Dubai", at2am);
      assertEqual(r.businessDate, "2026-11-09", "Dubai business date (01:00 local, before 04:00)");
      assertEqual(r.fromUtc, "2026-11-09 00:00:00", "Dubai from UTC");
    });

    test("America/New_York spring DST day is 23 hours", () => {
      const b = shared.businessDayBounds("2026-03-08", "2026-03-08", 0, "America/New_York");
      assertEqual(b.fromUtc, "2026-03-08 05:00:00", "midnight EST");
      assertEqual(b.toUtc, "2026-03-09 04:00:00", "next midnight EDT");
    });

    test("America/New_York fall DST day is 25 hours", () => {
      const b = shared.businessDayBounds("2026-11-01", "2026-11-01", 0, "America/New_York");
      assertEqual(b.fromUtc, "2026-11-01 04:00:00", "midnight EDT");
      assertEqual(b.toUtc, "2026-11-02 05:00:00", "next midnight EST");
    });

    test("New York offset changes across the spring DST instant", () => {
      assertEqual(
        shared.getTzOffsetMinutes("America/New_York", new Date("2026-03-08T06:59:00Z")),
        -300,
        "before 02:00"
      );
      assertEqual(
        shared.getTzOffsetMinutes("America/New_York", new Date("2026-03-08T07:00:00Z")),
        -240,
        "after 02:00"
      );
    });

    test("presetRange today/yesterday/week/month/lastmonth with fixed now", () => {
      const now = new Date("2026-11-10T18:50:00Z"); // 23:50 PKT
      assertEqual(shared.presetRange("today", 0, now, "Asia/Karachi").from, "2026-11-10", "today");
      assertEqual(
        shared.presetRange("yesterday", 0, now, "Asia/Karachi").from,
        "2026-11-09",
        "yesterday"
      );
      const week = shared.presetRange("week", 0, now, "Asia/Karachi");
      assertEqual(week.from, "2026-11-04", "week from");
      assertEqual(week.to, "2026-11-10", "week to");
      const month = shared.presetRange("month", 0, now, "Asia/Karachi");
      assertEqual(month.from, "2026-11-01", "month from");
      const last = shared.presetRange("lastmonth", 0, now, "Asia/Karachi");
      assertEqual(last.from, "2026-10-01", "lastmonth from");
      assertEqual(last.to, "2026-10-31", "lastmonth to");
    });

    test("historyPresetRange uses the same fixed clock", () => {
      const r = history.historyPresetRange("yesterday", {
        now: at2am,
        startHour: 4,
        timezone: "Asia/Karachi",
      });
      assertEqual(r.from, "2026-11-08", "yesterday relative to business date");
      assertEqual(r.to, "2026-11-08", "yesterday to");
    });
  } finally {
    dbModule.getDb = original;
    db.close();
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed > 0 || passed === 0) process.exitCode = 1;
  else console.log("ALL PASSED");
})().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
