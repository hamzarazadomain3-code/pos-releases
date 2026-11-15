/**
 * Migration 085 — the assistant's keyboard shortcut.
 *
 * `assistant_open` (default Ctrl+J) is admin-assignable, so it needs a row in
 * the `shortcuts` table like every other registry action. `INSERT OR IGNORE`
 * never touches a binding the owner already changed.
 *
 * Additive and idempotent.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? true : false;
  if (!hasTable('shortcuts')) return;

  db.prepare(
    "INSERT OR IGNORE INTO shortcuts (action, shortcut_key, description) VALUES (?, ?, ?)"
  ).run('assistant_open', 'Ctrl+J', 'Open the assistant');

  console.log('[migration 085] Added the assistant_open shortcut row');
};

exports.down = function () {
  // Non-destructive; the binding is managed from the admin UI.
};
