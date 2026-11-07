/**
 * Migration 067 — one configurable default credit period.
 *
 * Migration 025 seeded `admin_settings.payment_due_days = 30`, but nothing ever
 * read it: udhaar overdue checks used each customer's `credit_days`, whose
 * column default is 0 ("never overdue"). This migration moves that value into
 * the Shop Profile (`settings.default_credit_days`) so the shared
 * `resolveCreditDays()` helper has a single source:
 *
 *   customer credit_days > 0  -> that number
 *   else shop default         -> default_credit_days (seeded from the old
 *                                payment_due_days value when present, else 30)
 *
 * Additive + idempotent: INSERT OR IGNORE, no existing value is overwritten and
 * a second run is a no-op.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('settings')) return;

  const existing = db
    .prepare("SELECT value FROM settings WHERE key = 'default_credit_days'")
    .get();
  if (existing) return;

  let value = '30';
  if (hasTable('admin_settings')) {
    const legacy = db
      .prepare("SELECT value FROM admin_settings WHERE key = 'payment_due_days'")
      .get();
    if (legacy && String(legacy.value).trim() !== '') value = String(legacy.value).trim();
  }

  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
    'default_credit_days',
    value
  );
};

exports.down = function () {
  // Additive migration only — keep the setting so a rollback never changes
  // which udhaar rows the shop considers overdue.
};
