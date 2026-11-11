/**
 * Run 13 — the Esc gesture settings.
 *
 * Seeds the two Settings > Keyboard keys:
 *  - `escape_refresh_enabled`        ('true' = ON, the default)
 *  - `escape_double_tap_window_ms`  ('400' = the default window)
 *
 * Additive and idempotent.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table).length > 0;
  if (!hasTable('settings')) return;

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insert.run('escape_refresh_enabled', 'true');
  insert.run('escape_double_tap_window_ms', '400');
};

exports.down = function () {
  // Non-destructive; the values are managed from the Settings screen.
};
