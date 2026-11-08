/**
 * Migration 072 test (Run 11).
 *
 * Verifies:
 *   - a fresh migrated DB stores settings.max_negative_qty = '0' (0 = no cap)
 *   - an existing value is never overwritten
 *   - a legacy admin_settings value is adopted when settings has no key
 *   - the real settings service reads the seeded value
 *   - idempotent: a second run changes nothing
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const migration = require("../migrations/072_max_negative_qty_default.js");

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
  }
}

let passed = 0;
let failed = 0;

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

function makeDb({ withAdminSettings = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (withAdminSettings) {
    db.exec("CREATE TABLE admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }
  return db;
}

console.log("\n=== Migration 072 tests ===");

async function runTests() {
  test("fresh DB seeds max_negative_qty = 0", () => {
    const db = makeDb();
    migration.up(db);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'").get();
    assert(row, "max_negative_qty row should exist");
    assertEqual(row.value, "0", "default value");
    db.close();
  });

  test("existing value is never overwritten", () => {
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_negative_qty', '7')").run();
    migration.up(db);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'").get();
    assertEqual(row.value, "7", "existing cap preserved");
    db.close();
  });

  test("legacy admin_settings value is adopted when settings is empty", () => {
    const db = makeDb({ withAdminSettings: true });
    db.prepare(
      "INSERT INTO admin_settings (key, value) VALUES ('max_negative_qty', '4')"
    ).run();
    migration.up(db);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'").get();
    assertEqual(row.value, "4", "legacy cap adopted");
    db.close();
  });

  test("settings wins over a stale admin_settings value", () => {
    const db = makeDb({ withAdminSettings: true });
    db.prepare(
      "INSERT INTO admin_settings (key, value) VALUES ('max_negative_qty', '9')"
    ).run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_negative_qty', '1')").run();
    migration.up(db);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'").get();
    assertEqual(row.value, "1", "canonical settings value wins");
    db.close();
  });

  test("migration is idempotent", () => {
    const db = makeDb();
    migration.up(db);
    migration.up(db);
    const rows = db
      .prepare("SELECT COUNT(*) AS cnt FROM settings WHERE key = 'max_negative_qty'")
      .get();
    assertEqual(rows.cnt, 1, "exactly one row");
    const row = db.prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'").get();
    assertEqual(row.value, "0", "value unchanged");
    db.close();
  });

  test("real settings service reads the seeded value", () => {
    const db = makeDb();
    migration.up(db);
    const dbModule = require("../dist/main/db.js");
    const originalGetDb = dbModule.getDb;
    dbModule.getDb = () => db;
    try {
      const settings = require("../dist/main/services/settings.js");
      assertEqual(settings.getSetting("max_negative_qty"), "0", "getSetting returns default");
    } finally {
      dbModule.getDb = originalGetDb;
      db.close();
    }
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
  else if (passed === 0) {
    console.error("No tests ran");
    process.exitCode = 1;
  } else console.log("ALL PASSED");
}

runTests().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
