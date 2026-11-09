/**
 * PHASE 3d — Sales History timeline test.
 *
 * Runs the REAL compiled main-process code (`dist/main`) against a fully
 * migrated in-memory DB. It covers:
 *  - the pure local-time helpers (23:50 / 00:10 / 04:55 + a 04:00 business day)
 *  - the default filter (today + every event type)
 *  - a sale and its later void as TWO events with two timestamps
 *  - negative return / cash-refund rows
 *  - a held-bill create → resume → create → delete lifecycle with a snapshot
 *  - summary parity with Dashboard Today minus returns/refunds
 *  - cashier "only my events" restriction
 *  - the 073 backfill being idempotent
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbModule = require("../dist/main/db.js");
const auth = require("../dist/main/services/auth.js");
const sales = require("../dist/main/services/sales.js");
const returns = require("../dist/main/services/returns.js");
const history = require("../dist/main/services/salesHistory.js");
const reports = require("../dist/main/services/reports.js");
const shared = require("../dist/shared/salesHistory.js");

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
  }
}

function closeTo(actual, expected, message) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    throw new Error(message + ": expected " + expected + ", got " + actual);
  }
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
  const db = new DatabaseSync(":memory:");
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
    if (typeof migration.up === "function") await migration.up(db);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  }
  db.exec("PRAGMA foreign_keys = OFF;");
  return db;
}

function utcNowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  const db = await makeMigratedDb();
  dbModule.getDb = () => db;

  // ── pure helpers ─────────────────────────────────────────────────────────
  await test("local day: 23:50 PKT is still the same day", () => {
    assertEqual(shared.localDayOf("2026-11-09T18:50:00Z"), "2026-11-09", "23:50 PKT");
  });
  await test("local day: 00:10 PKT rolls to the next day", () => {
    assertEqual(shared.localDayOf("2026-11-09T19:10:00Z"), "2026-11-10", "00:10 PKT");
  });
  await test("local day: 04:55 PKT is the next day", () => {
    assertEqual(shared.localDayOf("2026-11-09T23:55:00Z"), "2026-11-10", "04:55 PKT");
  });
  await test("bare DB timestamps are treated as UTC", () => {
    assertEqual(shared.localDayOf("2026-11-09 19:10:00"), "2026-11-10", "bare UTC -> local");
  });
  await test("business day 00:00 bounds are local midnight", () => {
    const b = shared.businessDayBounds("2026-11-09", "2026-11-09", 0);
    assertEqual(b.fromUtc, "2026-11-08 19:00:00", "from");
    assertEqual(b.toUtc, "2026-11-09 19:00:00", "to");
  });
  await test("business day 04:00 shifts the boundary by four hours", () => {
    const b = shared.businessDayBounds("2026-11-09", "2026-11-09", 4);
    assertEqual(b.fromUtc, "2026-11-08 23:00:00", "from");
    assertEqual(b.toUtc, "2026-11-09 23:00:00", "to");
  });
  await test("04:00 anchor: 02:00 belongs to the previous business day", () => {
    assertEqual(
      shared.currentBusinessDate(4, new Date("2026-11-09T21:00:00Z")),
      "2026-11-09",
      "02:00 PKT 10 Nov"
    );
  });
  await test("04:00 anchor: 04:30 belongs to the new business day", () => {
    assertEqual(
      shared.currentBusinessDate(4, new Date("2026-11-09T23:30:00Z")),
      "2026-11-10",
      "04:30 PKT 10 Nov"
    );
  });
  await test("default filters = today + every event type", () => {
    const f = shared.defaultHistoryFilters("2026-11-09");
    assertEqual(f.from, "2026-11-09", "from");
    assertEqual(f.to, "2026-11-09", "to");
    assertEqual(f.types.length, shared.HISTORY_EVENT_TYPES.length, "all types");
  });

  // ── seed users / product / shift ─────────────────────────────────────────
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'owner', 'x', 'owner')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (2, 'cashier2', 'x', 'cashier')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO products (id, name, sku, sale_price, cost_price, stock_qty, active) VALUES (1, 'Timeline Product', 'TL-1', 100, 50, 100, 1)"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO shifts (id, user_id, start_cash, opened_at) VALUES (1, 1, 0, ?)"
  ).run(new Date().toISOString());
  auth.setSessionUser(1);

  // A completed bill at 10:00 PKT on a fixed old day, so it never pollutes
  // Dashboard's "today" numbers. The void happens NOW (later timestamp).
  db.prepare(
    `INSERT INTO sales (id, invoice_no, customer_id, user_id, shift_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES (10, 'INV-OLDTEST-0001', NULL, 1, 1, 100, 0, 0, 100, 'completed', '2020-01-01T05:00:00.000Z')`
  ).run();
  db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total) VALUES (10, 1, 1, 100, 0, 0, 100)"
  ).run();
  db.prepare("INSERT INTO payments (sale_id, mode, amount) VALUES (10, 'Cash', 100)").run();
  history.recordSaleEvent({
    event_type: "sale",
    sale_id: 10,
    invoice_no: "INV-OLDTEST-0001",
    user_id: 1,
    amount: 100,
    snapshot: { state: "completed", total: 100 },
    created_at: "2020-01-01T05:00:00.000Z",
  });

  // A live bill created NOW: Dashboard and the timeline must agree on it.
  const nowIso = new Date().toISOString();
  const nowSql = utcNowSql();
  db.prepare(
    `INSERT INTO sales (id, invoice_no, customer_id, user_id, shift_id, subtotal, tax_amount, discount_amount, total_amount, status, created_at)
     VALUES (11, 'INV-TODAY-0001', NULL, 1, 1, 100, 0, 0, 100, 'completed', ?)`
  ).run(nowIso);
  db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total) VALUES (11, 1, 1, 100, 0, 0, 100)"
  ).run();
  db.prepare("INSERT INTO payments (sale_id, mode, amount) VALUES (11, 'Cash', 100)").run();
  history.recordSaleEvent({
    event_type: "sale",
    sale_id: 11,
    invoice_no: "INV-TODAY-0001",
    user_id: 1,
    amount: 100,
    snapshot: { state: "completed", total: 100 },
    created_at: nowIso,
  });

  // ── void: two separate events ────────────────────────────────────────────
  await test("voiding a 10:00 sale creates a SECOND event, not an edit", () => {
    const wide = { from: "2020-01-01", to: shared.currentBusinessDate(0) };
    const before = history.listHistoryEvents(wide).rows;
    assertEqual(before.filter((e) => e.sale_id === 10).length, 1, "sale event before void");
    sales.voidSale(10, "customer changed mind");
    const rows = history.listHistoryEvents(wide).rows;
    const forSale = rows.filter((e) => e.sale_id === 10);
    assertEqual(forSale.length, 2, "sale + void events");
    const saleEvent = forSale.find((e) => e.event_type === "sale");
    const voidEvent = forSale.find((e) => e.event_type === "void");
    assert(!!saleEvent && !!voidEvent, "both event types present");
    assertEqual(saleEvent.occurred_at, "2020-01-01T05:00:00.000Z", "sale keeps its own time");
    assert(voidEvent.occurred_at !== saleEvent.occurred_at, "void has its own timestamp");
    assertEqual(voidEvent.reason, "customer changed mind", "void reason recorded");
    assertEqual(voidEvent.amount, -100, "void is negative");
    assertEqual(voidEvent.status, "voided", "void status");
  });
  await test("void without a reason is rejected", () => {
    let threw = false;
    try {
      sales.voidSale(11, "   ");
    } catch {
      threw = true;
    }
    assert(threw, "voidSale must require a reason");
  });

  // ── return + cash refund: negative rows ─────────────────────────────────
  const ret = returns.createReturnBill({
    items: [{ product_id: 1, qty: 1, unit_price: 30 }],
    reason: "damaged pack",
    refund_mode: "cash",
    restock: true,
    linked_sale_id: 11,
  });
  const refund = returns.createCashRefund(50, "goodwill refund", "cash");
  assert(!!refund && refund.id > 0, "cash refund row written");

  const today = shared.currentBusinessDate(0);
  const todayFilters = { from: today, to: today };

  await test("return and cash refund are negative timeline rows", () => {
    const rows = history.listHistoryEvents(todayFilters).rows;
    const r = rows.find((e) => e.event_type === "return");
    const c = rows.find((e) => e.event_type === "cash_refund");
    assert(!!r, "return event present");
    assert(!!c, "cash_refund event present");
    closeTo(r.amount, -30, "return amount");
    closeTo(c.amount, -50, "cash refund amount");
  });

  // ── hold lifecycle ──────────────────────────────────────────────────────
  const payload = { items: [{ product_id: 1, qty: 2, price: 100, name: "Timeline Product" }], total: 200 };
  const heldA = sales.holdBill("held", "customer A", payload);
  sales.resumeHeldBill(heldA.id);
  const heldB = sales.holdBill("held", "customer B", payload);
  sales.deleteHeldBill(heldB.id, "customer left");

  await test("held bill create → resume → create → delete = four rows", () => {
    const rows = history.listHistoryEvents(todayFilters).rows.filter(
      (e) => e.held_bill_id === heldA.id || e.held_bill_id === heldB.id
    );
    const types = rows.map((e) => e.event_type);
    assert(types.includes("hold_created"), "hold_created");
    assert(types.includes("hold_resumed"), "hold_resumed");
    assert(types.includes("hold_deleted"), "hold_deleted");
    assertEqual(types.filter((t) => t === "hold_created").length, 2, "two holds created");
  });
  await test("deleted held bill is hidden from the Held list but keeps its snapshot", () => {
    const list = sales.listHeldBills("held");
    assert(!list.some((h) => h.id === heldB.id), "deleted bill hidden");
    const row = history
      .listHistoryEvents(todayFilters)
      .rows.find((e) => e.event_type === "hold_deleted" && e.held_bill_id === heldB.id);
    assert(!!row, "delete event present");
    assertEqual(row.reason, "customer left", "delete reason");
    const detail = history.getHistoryDetail(row.event_id);
    assert(!!detail, "detail found");
    assertEqual(detail.snapshot.state, "deleted", "snapshot state");
    assertEqual(detail.snapshot.label, "customer B", "snapshot label");
  });
  await test("delete without a reason is rejected", () => {
    let threw = false;
    try {
      sales.deleteHeldBill(heldA.id, "");
    } catch {
      threw = true;
    }
    assert(threw, "deleteHeldBill must require a reason");
  });

  // ── summary parity with Dashboard Today ─────────────────────────────────
  await test("NET sales = Dashboard Today - returns - refunds", () => {
    const s = history.historySummary(todayFilters);
    const d = reports.dashboard();
    closeTo(s.salesTotal, d.today_sales, "gross sales match Dashboard");
    closeTo(s.netSales, d.today_sales - s.returnsTotal - s.cashRefundsTotal, "net parity");
    closeTo(s.returnsTotal, 30, "returns total");
    closeTo(s.cashRefundsTotal, 50, "refund total");
  });
  await test("type counts and open-held badge", () => {
    const counts = history.historyTypeCounts(todayFilters);
    const saleCount = counts.find((c) => c.event_type === "sale")?.count ?? 0;
    assert(saleCount >= 1, "sale count");
    assertEqual(history.historyOpenHeldCount(), 1, "one bill still on hold (A was resumed)");
  });

  // ── cashier restriction ─────────────────────────────────────────────────
  await test("cashier 'only my events' hides other users", () => {
    history.recordSaleEvent({
      event_type: "hold_created",
      invoice_no: "HOLD-CASHIER",
      user_id: 2,
      amount: 0,
      snapshot: { state: "open", label: "cashier test" },
    });
    auth.setSessionUser(2);
    const rows = history.listHistoryEvents({ ...todayFilters, onlyMySales: true }).rows;
    assert(rows.length > 0, "cashier has events");
    assert(rows.every((r) => r.user === "cashier2"), "only cashier2 events");
    auth.setSessionUser(1);
  });

  // ── newest first ────────────────────────────────────────────────────────
  await test("events are newest first", () => {
    const rows = history.listHistoryEvents(todayFilters).rows;
    for (let i = 1; i < rows.length; i++) {
      // Mixed DB formats are expected (bare SQL timestamps + JS ISO); use the
      // shared parser so both are compared as the same UTC instant.
      // The list orders by SQLite `datetime()` (whole seconds); two events in
      // the same second are then ordered by id, so compare at that resolution.
      const prev = Math.floor(shared.parseDbTimestamp(rows[i - 1].occurred_at).getTime() / 1000);
      const cur = Math.floor(shared.parseDbTimestamp(rows[i].occurred_at).getTime() / 1000);
      assert(prev >= cur, "row " + i + " is not older than the previous row");
    }
  });

  // ── backfill idempotency ────────────────────────────────────────────────
  await test("re-running migration 073 does not duplicate events", async () => {
    const migration = require("../migrations/073_sale_events_timeline.js");
    await migration.up(db);
    const after1 = db.prepare("SELECT COUNT(*) AS c FROM sale_events").get().c;
    await migration.up(db);
    const after2 = db.prepare("SELECT COUNT(*) AS c FROM sale_events").get().c;
    assertEqual(after2, after1, "second backfill is a no-op");
  });

  // Keep `nowSql` referenced so the linter/eyes see the fixed timestamp intent.
  assert(typeof nowSql === "string" && nowSql.length === 19, "now SQL is a UTC string");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
