/**
 * Migration 072 - explicit max_negative_qty default.
 *
 * `max_negative_qty` is the per-product cap on how far stock may go below zero
 * while `allow_negative_stock` is yes/warn. Both the sale service
 * (`src/main/services/sales.ts`) and the till UI (`Billing.tsx`,
 * `QuickSaleGrid.tsx`, `Settings.tsx`) already read it from the Shop Profile
 * (`settings`), but no migration ever seeded the key: "0 = no cap" existed only
 * as a `?? 0` fallback in code. Seed it explicitly so the stored policy is
 * inspectable and fresh installs match the documented default.
 *
 * Any legacy value is honoured: if an old build wrote the key to
 * `admin_settings`, that value is adopted instead of silently discarding it.
 *
 * Additive + idempotent: INSERT OR IGNORE, existing settings are never
 * overwritten and a second run is a no-op.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('settings')) return;

  const existing = db
    .prepare("SELECT value FROM settings WHERE key = 'max_negative_qty'")
    .get();
  if (existing) return;

  let value = '0';
  if (hasTable('admin_settings')) {
    const legacy = db
      .prepare("SELECT value FROM admin_settings WHERE key = 'max_negative_qty'")
      .get();
    if (legacy && String(legacy.value).trim() !== '') value = String(legacy.value).trim();
  }

  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
    'max_negative_qty',
    value
  );
};

exports.down = function () {
  // Additive migration only - keep the setting so a rollback never changes the
  // shop's negative-stock policy.
};
