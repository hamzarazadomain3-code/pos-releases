/**
 * Migration 061 — Receipt Phase 5 settings
 *
 * Admin settings that back the phase-5 receipt enhancements. Every one is read
 * with a safe code default, so an install that never runs this migration (or a shop
 * that never opens these controls) behaves exactly as before:
 *
 *   - receipt_return_policy     : return/refund policy printed on receipt (default empty).
 *   - receipt_thank_you         : override the auto thank you message (default empty → auto per language).
 *   - receipt_language          : language for auto thank you ("en"/"ur", default "en").
 *   - loyalty_enabled           : print loyalty points earned on receipt ("true"/"false", default "false").
 *   - points_per_rupee          : loyalty points earned per Rs. spent (default "0").
 *
 * The loyalty points feature also uses the existing `loyalty_enabled` and
 * `points_per_rupee` settings if they were already present (they were added
 * in a prior migration but not wired to the receipt until now).
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  );
  insert.run('receipt_return_policy', '');
  insert.run('receipt_thank_you', '');
  insert.run('receipt_language', 'en');
  insert.run('loyalty_enabled', 'false');
  insert.run('points_per_rupee', '0');
  insert.run('fbr_invoice_url', '');
};

exports.down = function (db) {
  db.prepare(
    "DELETE FROM admin_settings WHERE key IN ('receipt_return_policy', 'receipt_thank_you', 'receipt_language', 'loyalty_enabled', 'points_per_rupee', 'fbr_invoice_url')"
  ).run();
};