/**
 * Migration 051 — Shortcut registry: add "save & print"
 *
 * The canonical shortcut defaults now live in `src/shared/shortcuts.ts` (the
 * main process seeds `admin.shortcuts` from it). This migration only makes the
 * new `save_print` action visible/editable in Admin → Shortcuts on databases
 * created before it existed. `INSERT OR IGNORE` never touches a customized row.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (hasTable('shortcuts')) {
    db.prepare(
      "INSERT OR IGNORE INTO shortcuts (action, shortcut_key, description) VALUES ('save_print', 'Ctrl+Shift+S', 'Save the bill and print the receipt')"
    ).run();
  }
};

exports.down = function () {
  // Non-destructive; default bindings are managed from the admin UI.
};
