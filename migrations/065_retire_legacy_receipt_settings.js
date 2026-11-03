/**
 * Migration 065 — retire the legacy `receipt_settings` shop identity
 *
 * Root cause of "the receipt still prints the old address / phone and editing
 * Shop Profile has no effect": `getPrintSettings()` merged the legacy
 * `receipt_settings` table LAST, so its pre-2026-08 `shop_*` rows silently
 * overrode everything the owner saved in the Shop Profile (`settings`).
 *
 * This migration makes the Shop Profile the only source of truth:
 *
 *   1. Adopt a legacy value into `settings` ONLY when `settings` has no row for
 *      that key. Existing owner values are never overwritten, so an install
 *      that never filled the profile keeps printing exactly what it printed
 *      before.
 *   2. Delete the shadowing legacy rows, so they can never act as hidden
 *      defaults again (a cleared profile field must print nothing).
 *   3. Normalise `admin_settings.receipt_header_lines` from the JSON text `[]`
 *      (seeded by migration 050) to an empty string, so the single renderer
 *      does not print a literal "[]" line.
 *
 * Keys that the Shop Profile does not own (`paper_width`, `show_logo`,
 * `facebook_page`, `tax_id`) are left in place; they are still read as
 * fallbacks.
 *
 * Idempotent: a second run finds no legacy rows and changes nothing.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('receipt_settings')) return;

  // Legacy key -> Shop Profile key. Only copied when the profile key is absent.
  const adopt = [
    ['shop_name', 'shop_name'],
    ['shop_address', 'shop_address'],
    ['shop_phone', 'shop_phone'],
    ['shop_whatsapp', 'shop_whatsapp'],
    ['shop_website', 'shop_website'],
    ['custom_footer', 'receipt_footer'],
  ];

  const canWriteSettings = hasTable('settings');

  const readLegacy = (key) => {
    const row = db.prepare('SELECT value FROM receipt_settings WHERE key = ?').get(key);
    return row && row.value != null ? String(row.value) : null;
  };
  const settingsHas = (key) =>
    db.prepare('SELECT 1 AS present FROM settings WHERE key = ?').get(key) !== undefined;
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const deleteLegacy = db.prepare('DELETE FROM receipt_settings WHERE key = ?');

  db.exec('BEGIN');
  try {
    if (canWriteSettings) {
      for (const [legacyKey, profileKey] of adopt) {
        const value = readLegacy(legacyKey);
        if (value !== null && !settingsHas(profileKey)) {
          insertSetting.run(profileKey, value);
        }
      }
    }

    // Only delete once the values are safely adopted (or the profile already
    // owned them). Without a settings table the legacy rows are the only copy.
    if (canWriteSettings) {
      for (const [legacyKey] of adopt) deleteLegacy.run(legacyKey);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // `receipt_header_lines` is a JSON array; "[]" must not print as a line.
  if (hasTable('admin_settings')) {
    const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'receipt_header_lines'").get();
    if (row && String(row.value).trim() === '[]') {
      db.prepare(
        "UPDATE admin_settings SET value = '', updated_at = CURRENT_TIMESTAMP WHERE key = 'receipt_header_lines'"
      ).run();
    }
  }
};

exports.down = function () {
  // Data migration: the legacy values were adopted into `settings` and the
  // shadowing rows deleted. Re-creating them would re-introduce the bug, so
  // down() is intentionally a no-op.
};
