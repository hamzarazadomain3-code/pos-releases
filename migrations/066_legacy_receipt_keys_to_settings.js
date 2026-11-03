/**
 * Migration 066 — move the remaining legacy `receipt_settings` keys into the
 * Shop Profile (`settings`).
 *
 * Migration 065 retired the legacy shop *identity* rows (name / address /
 * phone / WhatsApp / website / footer) and made the Shop Profile win. Four
 * keys were intentionally left in `receipt_settings` because the profile did
 * not own them yet:
 *
 *   paper_width, show_logo, facebook_page, tax_id
 *
 * From now on the Shop Profile is the primary store for those too. This
 * migration copies each legacy value into `settings` ONLY when `settings` has
 * no row for the key, so:
 *
 *   • an owner who already set the value in the profile keeps it;
 *   • an install that only ever used the old receipt screen keeps printing
 *     exactly what it printed before;
 *   • a second run is a no-op (idempotent).
 *
 * `tax_id` is additionally adopted as `tax_no` — that is the key the renderer
 * reads (`toShopProfile()`), so an old tax id actually reaches the receipt.
 *
 * The legacy table is NOT deleted: readers still fall back to it when a key is
 * missing from `settings` (read-only fallback, see `getPrintSettings()`).
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('receipt_settings') || !hasTable('settings')) return;

  const readLegacy = (key) => {
    const row = db.prepare('SELECT value FROM receipt_settings WHERE key = ?').get(key);
    return row && row.value != null ? String(row.value) : null;
  };
  const settingsHas = (key) =>
    db.prepare('SELECT 1 AS present FROM settings WHERE key = ?').get(key) !== undefined;
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  // legacy key -> one or more profile keys (first profile key that is missing
  // gets the value; `tax_id` feeds both the raw key and the rendered `tax_no`).
  const adopt = [
    ['paper_width', ['paper_width']],
    ['show_logo', ['show_logo']],
    ['facebook_page', ['facebook_page']],
    ['tax_id', ['tax_id', 'tax_no']],
  ];

  db.exec('BEGIN');
  try {
    for (const [legacyKey, profileKeys] of adopt) {
      const value = readLegacy(legacyKey);
      if (value === null) continue;
      for (const profileKey of profileKeys) {
        if (!settingsHas(profileKey)) insertSetting.run(profileKey, value);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

exports.down = function () {
  // Additive data migration: legacy rows are untouched and the profile copies
  // are only created when the profile had no value. Nothing to undo safely.
};
