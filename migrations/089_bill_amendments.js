/**
 * Migration 089 — amending a FINISHED bill.
 *
 * A finished bill is never silently overwritten. Every amendment is a new row
 * in `sale_amendments` that carries the FULL previous state (`before_json`),
 * the new state (`after_json`), the money it moved (`cash_effect`,
 * `credit_effect`), who did it and WHY.
 *
 * Additive and idempotent:
 *   - `sale_amendments` is a NEW table (created only when it is missing),
 *   - `sales.amended_count` / `sales.last_amended_at` are added with the
 *     `PRAGMA table_info` guard, so re-running changes nothing,
 *   - the two settings are inserted with `INSERT OR IGNORE`, so an owner's
 *     own choice is never reset.
 *
 * The existing `sale_events` table already accepts any `event_type` (a plain
 * TEXT column with no CHECK constraint), so the new `amend` event needs no
 * schema change there.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? true : false;

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  if (!hasTable('sale_amendments')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_amendments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id       INTEGER NOT NULL,
        user_id       INTEGER,
        reason        TEXT NOT NULL,
        kind          TEXT NOT NULL,
        before_json   TEXT,
        after_json    TEXT,
        cash_effect   REAL NOT NULL DEFAULT 0,
        credit_effect REAL NOT NULL DEFAULT 0,
        shift_id      INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z')
      );
      CREATE INDEX IF NOT EXISTS idx_sale_amendments_sale ON sale_amendments (sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_amendments_created ON sale_amendments (created_at);
      CREATE INDEX IF NOT EXISTS idx_sale_amendments_shift ON sale_amendments (shift_id);
    `);
    console.log('[migration 089] Added the sale_amendments table');
  }

  if (hasTable('sales')) {
    if (!hasColumn('sales', 'amended_count')) {
      db.exec('ALTER TABLE sales ADD COLUMN amended_count INTEGER DEFAULT 0');
      console.log('[migration 089] Added sales.amended_count');
    }
    if (!hasColumn('sales', 'last_amended_at')) {
      db.exec('ALTER TABLE sales ADD COLUMN last_amended_at TEXT');
      console.log('[migration 089] Added sales.last_amended_at');
    }
  }

  if (hasTable('admin_settings')) {
    db.exec(`
      INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
      VALUES ('amend_allow_manager', '1', CURRENT_TIMESTAMP);
      INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
      VALUES ('amend_max_days_back', '0', CURRENT_TIMESTAMP);
    `);
  }
};

exports.down = function () {
  // Non-destructive: an amendment is the shop's own audit record.
};
