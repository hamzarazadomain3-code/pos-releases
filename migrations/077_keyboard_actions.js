/**
 * Run 13 — the two new keyboard actions.
 *
 * Adds the admin-assignable rows for:
 *  - `customer_search` (default F6) — the Billing customer combobox
 *  - `bill_focus`      (default Pause, second default F4) — edit the current bill
 *
 * `INSERT OR IGNORE` never touches a row the owner already customised.
 * Additive and idempotent.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table).length > 0;
  if (!hasTable('shortcuts')) return;

  const insert = db.prepare(
    "INSERT OR IGNORE INTO shortcuts (action, shortcut_key, description) VALUES (?, ?, ?)"
  );
  insert.run('customer_search', 'F6', 'Customer search (name, phone or code)');
  insert.run('bill_focus', 'Pause', 'Pause - edit the current bill from the keyboard');
};

exports.down = function () {
  // Non-destructive; the bindings are managed from the admin UI.
};
