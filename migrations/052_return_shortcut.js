/**
 * Migration 052 — Return / Refund shortcut moves to Ctrl+Shift+F
 *
 * `new_return` shipped on Ctrl+Shift+R, which collided with the app menu's
 * dev-only force-reload accelerator (and reads like "reload"). The registry
 * default (`src/shared/shortcuts.ts`) is now **Ctrl+Shift+F**; this migration
 * moves any shop still sitting on the old default so the F1 help, the footer
 * hint and the actual key agree on an existing database. A customized binding
 * is left alone, and owners can always rebind it in Admin → Shortcuts.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (hasTable('shortcuts')) {
    db.prepare(
      "UPDATE shortcuts SET shortcut_key = 'Ctrl+Shift+F', updated_at = CURRENT_TIMESTAMP WHERE action = 'new_return' AND shortcut_key = 'Ctrl+Shift+R'"
    ).run();
  }
};

exports.down = function () {
  // Non-destructive; the binding is managed from the admin UI.
};
