/**
 * Migration 059 — Receipt print (phase 4) settings
 *
 * Admin settings that back the phase-4 printing work. Every one is read with a
 * safe code default, so an install that never runs this migration (or a shop
 * that never opens these controls) behaves exactly as before:
 *
 *   - receipt_copies             : how many copies a receipt prints (default "1").
 *   - cash_drawer_kick           : pulse the cash drawer after a FRESH sale print
 *     ("true"/"false", default "false" — a physical kick is opt-in; reprints
 *     never kick).
 *   - receipt_duplicate_label    : stamp "DUPLICATE COPY" on a reprint of an
 *     already-issued sale ("true"/"false", default "true").
 *   - receipt_bottom_feed_mm     : trailing roll feed before the page ends — the
 *     cut margin ("4" keeps the historical behaviour, so nothing re-flows).
 *
 * There is no `default printer` setting here: "print to the system default
 * printer" is the `default` sentinel value stored in the existing per-slot
 * printer keys by the Settings dropdown, not a new key.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  );
  insert.run('receipt_copies', '1');
  insert.run('cash_drawer_kick', 'false');
  insert.run('receipt_duplicate_label', 'true');
  insert.run('receipt_bottom_feed_mm', '4');
};

exports.down = function (db) {
  db.prepare(
    "DELETE FROM admin_settings WHERE key IN ('receipt_copies', 'cash_drawer_kick', 'receipt_duplicate_label', 'receipt_bottom_feed_mm')"
  ).run();
};
