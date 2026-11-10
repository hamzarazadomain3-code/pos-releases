const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const src = "E:\\antigravty\\db-copy\\pos-copy.db";
const dest = "E:\\temp\\pos-check.db";

fs.copyFileSync(src, dest);
const stat = fs.statSync(dest);
fs.chmodSync(dest, stat.mode | 0o222);
console.log("Copied DB to", dest);

const db = new DatabaseSync(dest);
db.exec("PRAGMA foreign_keys = OFF;");

// Read migrations table
const recorded = new Set();
try {
  const rows = db.prepare("SELECT name FROM migrations").all();
  for (const r of rows) recorded.add(r.name);
} catch (e) {
  console.log("No migrations table:", e.message);
}
console.log("Already recorded migrations:", recorded.size);

const migrationsDir = path.join(__dirname, "..", "migrations");
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js")).sort();

const toRun = files.filter((f) => !recorded.has(f));
console.log("Migrations to run:", toRun.length);

const start = Date.now();
for (const file of toRun) {
  const t0 = Date.now();
  try {
    const migration = require(path.join(migrationsDir, file));
    if (typeof migration.up === "function") migration.up(db);
    const elapsed = Date.now() - t0;
    console.log(`  ${file}: ${elapsed}ms`);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  } catch (e) {
    console.log(`  ${file}: ERROR - ${e.message}`);
  }
}
const totalElapsed = Date.now() - start;
console.log("Total elapsed:", totalElapsed, "ms");

// Run 073 and 074 a second time
console.log("\nSecond run of 073 and 074:");
const m073 = require(path.join(migrationsDir, "073_sale_events_timeline.js"));
const m074 = require(path.join(migrationsDir, "074_shop_timezone.js"));
const t1 = Date.now();
m073.up(db);
console.log("  073 second run:", Date.now() - t1, "ms");
const t2 = Date.now();
m074.up(db);
console.log("  074 second run:", Date.now() - t2, "ms");

// Events per type
const counts = db.prepare("SELECT event_type, COUNT(*) AS c FROM sale_events GROUP BY event_type ORDER BY event_type").all();
console.log("\nEvents per type:");
for (const row of counts) {
  console.log(`  ${row.event_type}: ${row.c}`);
}

const totalEvents = db.prepare("SELECT COUNT(*) AS c FROM sale_events").get()?.c ?? 0;
console.log("Total events:", totalEvents);

// Sales without events
const salesWithoutEvents = db.prepare(`
  SELECT s.id, s.invoice_no, s.status
  FROM sales s
  WHERE s.status IN ('completed', 'voided', 'returned')
    AND NOT EXISTS (SELECT 1 FROM sale_events e WHERE e.sale_id = s.id)
`).all();
console.log("Sales without events:", salesWithoutEvents.length);

// Integrity check
const integrity = db.prepare("PRAGMA integrity_check").get();
console.log("Integrity check:", integrity.integrity_check);

db.close();
console.log("\nDone. Original DB untouched.");
