/**
 * Run 13 — the official brand colour as the default accent.
 *
 * The app's accent colour is a SHOP SETTING (`primary_color`), seeded as the
 * old blue (#2563eb) by migration 025. The official Rokar POS brand emerald is
 * #0B5D4B, so this migration re-seeds the setting **only when the shop never
 * changed it** (it still holds the old default). A shop that picked its own
 * colour keeps it.
 *
 * Additive and idempotent.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(table).length > 0;
  // The accent colour lives in `admin_settings` (migration 025 seeded it there).
  if (!hasTable('admin_settings')) return;

  db.prepare(
    "INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('primary_color', '#0B5D4B')"
  ).run();
  // Only overwrite the untouched old default.
  db.prepare(
    "UPDATE admin_settings SET value = '#0B5D4B' WHERE key = 'primary_color' AND (value IS NULL OR TRIM(value) = '' OR LOWER(TRIM(value)) = '#2563eb')"
  ).run();
};

exports.down = function () {
  // Non-destructive; the colour is managed from Settings.
};
