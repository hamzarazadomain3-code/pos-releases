/**
 * Migration 054 — Receipt layout (phase 1) settings
 *
 * New admin_settings that back the phase-1 receipt fixes (conditional rows,
 * logo sizing, removable software credit, items summary):
 *
 *   - receipt_logo_max_height_px : logo max height in px (default 64). The old
 *     layout hard-coded 12mm (~45px); thermal logos were unreadably small.
 *   - receipt_logo_grayscale     : render the logo greyscale/high-contrast so it
 *     survives a 1-bit thermal head ("true"/"false", default "true").
 *   - receipt_show_software_credit : show the "---- SOFTWARE BY ----" footer
 *     block at all ("true"/"false", default "true").
 *   - receipt_show_items_summary : show the "Items: N, Qty: N" line under the
 *     items table ("true"/"false", default "true").
 *
 * All four are read with safe code defaults in `getPrintSettings()`, so an
 * install that never runs this migration still behaves sensibly.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  );
  insert.run('receipt_logo_max_height_px', '64');
  insert.run('receipt_logo_grayscale', 'true');
  insert.run('receipt_show_software_credit', 'true');
  insert.run('receipt_show_items_summary', 'true');
};

exports.down = function (db) {
  db.prepare(
    "DELETE FROM admin_settings WHERE key IN ('receipt_logo_max_height_px', 'receipt_logo_grayscale', 'receipt_show_software_credit', 'receipt_show_items_summary')"
  ).run();
};
