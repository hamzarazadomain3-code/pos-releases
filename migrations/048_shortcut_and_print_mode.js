/**
 * Migration 048 — Shortcut key + print mode defaults
 *
 * 1. Move the cash drawer shortcut from F12 to Ctrl+D (F12 is reserved for the
 *    Held Bills list on the billing screen). Only rows still on the default F12
 *    binding are touched — anything a shop has customized is left alone.
 * 2. Seed the print_mode admin setting (silent | dialog). 'silent' prints
 *    straight to the default printer without the OS dialog.
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table);
    return rows.length > 0;
  };

  if (hasTable('shortcuts')) {
    db.prepare("UPDATE shortcuts SET shortcut_key = 'Ctrl+D', updated_at = CURRENT_TIMESTAMP WHERE action = 'cash_drawer' AND shortcut_key = 'F12'").run();
  }

  if (hasTable('admin_settings')) {
    db.prepare("INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES ('print_mode', 'silent', CURRENT_TIMESTAMP)").run();
  }
};

exports.down = function (db) {
  // Non-destructive; default rebinds are managed from the admin UI.
};