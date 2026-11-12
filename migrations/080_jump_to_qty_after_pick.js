/**
 * Migration 080: Add jump_to_qty_after_pick setting (default ON)
 *
 * When enabled, after picking a product from the Billing search dropdown
 * (Enter or mouse click), the cart line's quantity field is focused with
 * text selected. The cashier can type the quantity and press Enter to confirm.
 * Scanner/barcode picks keep focus in the search box.
 */

exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table).length > 0;
  if (!hasTable('admin_settings')) return;

  db.prepare(
    "INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('jump_to_qty_after_pick', 'true')"
  ).run();
  console.log('[migration 080] Added jump_to_qty_after_pick = true (default ON)');
};

exports.down = function () {
  // Non-destructive; the setting is managed from Settings.
};