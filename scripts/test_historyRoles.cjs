/**
 * Run 13 Item B — server-side history roles, no cost/profit leakage.
 *
 * A real cashier session calls all five history entry points with
 * `onlyMySales:false`; every one must still return only the cashier's events.
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbModule = require("../dist/main/db.js");
const auth = require("../dist/main/services/auth.js");
const history = require("../dist/main/services/salesHistory.js");
const printService = require("../dist/main/services/printService.js");
const { stripCostFields } = require("../dist/shared/historyPrivacy.js");

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
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'owner', 'x', 'owner')"
  ).run();
  db.prepare("UPDATE users SET role = 'owner' WHERE id = 1").run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (2, 'cashier2', 'x', 'cashier')"
  ).run();
  db.prepare("UPDATE users SET role = 'cashier' WHERE id = 2").run();
  db.prepare(
    "INSERT INTO products (id, name, sale_price, cost_price, stock_qty, active) VALUES (1, 'Tea', 100, 50, 100, 1)"
  ).run();

  const sale = db.prepare(
    `INSERT INTO sales (id, invoice_no, user_id, total_amount, status, created_at)
     VALUES (?, ?, ?, ?, 'completed', ?)`
  );
  const item = db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (?, 1, 1, ?, ?)"
  );
  const event = db.prepare(
    `INSERT INTO sale_events (event_type, sale_id, invoice_no, user_id, amount, snapshot_json, created_at)
     VALUES ('sale', ?, ?, ?, ?, ?, ?)`
  );

  sale.run(100, "INV-OWNER", 1, 1000, "2026-11-09 10:00:00");
  item.run(100, 1000, 1000);
  event.run(
    100,
    "INV-OWNER",
    1,
    1000,
    JSON.stringify({ state: "completed", total: 1000, cost_price: 500, profit: 500 }),
    "2026-11-09 10:00:00"
  );

  sale.run(200, "INV-CASHIER", 2, 200, "2026-11-09 11:00:00");
  item.run(200, 200, 200);
  event.run(
    200,
    "INV-CASHIER",
    2,
    200,
    JSON.stringify({
      state: "completed",
      total: 200,
      lines: [{ product_id: 1, qty: 1, unit_price: 200, cost_price: 120, profit: 80 }],
    }),
    "2026-11-09 11:00:00"
  );

  db.prepare(
    `INSERT INTO sale_events (event_type, invoice_no, user_id, amount, created_at)
     VALUES ('hold_created', 'HOLD-CASHIER', 2, 0, '2026-11-09 12:00:00')`
  ).run();
}

console.log("\n=== Run 13 · history role rules (real services) ===");

(async () => {
  const db = await makeMigratedDb();
  const original = dbModule.getDb;
  dbModule.getDb = () => db;
  seed(db);

  const filters = { from: "2026-11-09", to: "2026-11-09", onlyMySales: false };
  let printedHtml = "";
  const originalPrint = printService.printDocument;
  printService.printDocument = async (job) => {
    printedHtml = String(job?.html ?? "");
    return { ok: true };
  };

  try {
    auth.setSessionUser(2);

    await test("listHistoryEvents ignores onlyMySales:false for a cashier", () => {
      const rows = history.listHistoryEvents(filters, 1, 100).rows;
      assert(rows.length === 2, "two cashier events, not the owner's");
      assert(rows.every((r) => r.user === "cashier2"), "only cashier2 rows");
      assert(!rows.some((r) => r.invoice_no === "INV-OWNER"), "owner invoice hidden");
    });

    await test("historySummary only sums the cashier's own events", () => {
      const s = history.historySummary(filters);
      assertEqual(s.salesCount, 1, "one own sale");
      assertEqual(s.salesTotal, 200, "own sale only (owner 1000 excluded)");
      assertEqual(s.holdCreatedCount, 1, "own hold event");
    });

    await test("historyTypeCounts only counts the cashier's own events", () => {
      const counts = history.historyTypeCounts(filters);
      const sale = counts.find((c) => c.event_type === "sale");
      const hold = counts.find((c) => c.event_type === "hold_created");
      assertEqual(sale?.count, 1, "one own sale");
      assertEqual(hold?.count, 1, "one own hold");
    });

    await test("getHistoryDetail returns null for another user's event", () => {
      const ownerEvent = db
        .prepare("SELECT id FROM sale_events WHERE invoice_no = 'INV-OWNER'")
        .get();
      assert(history.getHistoryDetail(ownerEvent.id) === null, "owner detail blocked");
    });

    await test("getHistoryDetail strips cost/profit from an own snapshot", () => {
      const ownEvent = db
        .prepare("SELECT id FROM sale_events WHERE invoice_no = 'INV-CASHIER'")
        .get();
      const detail = history.getHistoryDetail(ownEvent.id);
      assert(detail !== null, "own detail allowed");
      const snap = detail.snapshot;
      assert(snap && typeof snap === "object", "snapshot present");
      assert(!("cost_price" in snap), "top-level cost_price removed");
      assert(!("profit" in snap), "top-level profit removed");
      assert(!("cost_price" in (snap.lines?.[0] ?? {})), "line cost_price removed");
      assertEqual(snap.lines[0].unit_price, 200, "price still visible");
    });

    await test("printHistoryReport with onlyMySales:false prints own rows only", async () => {
      const result = await history.printHistoryReport(filters);
      assert(result?.ok === true, "print stub called");
      assert(printedHtml.includes("INV-CASHIER"), "own invoice printed");
      assert(!printedHtml.includes("INV-OWNER"), "owner invoice never printed");
      assert(!/cost|profit/i.test(printedHtml), "no cost/profit text in report");
    });

    await test("stripCostFields is recursive and case-insensitive", () => {
      const cleaned = stripCostFields({
        Cost_Price: 1,
        keep: 2,
        nested: [{ PROFIT_PCT: 3, margin: 4, name: "x" }],
      });
      assertEqual(JSON.stringify(cleaned), JSON.stringify({ keep: 2, nested: [{ name: "x" }] }), "cleaned");
    });
  } finally {
    auth.setSessionUser(1);
    printService.printDocument = originalPrint;
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
