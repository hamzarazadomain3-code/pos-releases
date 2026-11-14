/**
 * Migration 081 — the "Page to open after login" setting.
 *
 * The app has always opened **Billing** after a login, for every role. The
 * seeded value keeps that exactly: an existing install must not notice the
 * upgrade. The owner can change it to Dashboard, to the last page they were
 * on, or to "follow the role" (a cashier lands on Billing, an owner or a
 * manager on the Dashboard).
 *
 * Additive and idempotent.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table).length > 0;
  if (!hasTable('settings')) return;

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('page_after_login', 'billing')").run();
  console.log("[migration 081] Added page_after_login = billing (unchanged behaviour)");
};

exports.down = function () {
  // Non-destructive; the setting is managed from Settings.
};
