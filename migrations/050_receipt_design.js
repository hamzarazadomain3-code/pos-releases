/**
 * Migration 050 — Receipt design (thermal redesign settings)
 *
 * New admin_settings that feed the redesigned thermal receipt:
 *   - receipt_header_lines   : JSON array of extra header lines (one per row)
 *     shown under the shop name / contact lines. Backward-compatible with the
 *     old single-line receipt_header_text.
 *   - receipt_terms_text     : multi-line terms shown above the footer message.
 *   - receipt_software_by    : the tradename under "---- SOFTWARE BY ----".
 *   - receipt_show_serial_number : show/hide the "#" column in the items table.
 *
 * The old default receipt_header_text ("Thank you for shopping with us!") is
 * moved to the footer (that's what the template now does), so a stale default
 * at the top of the receipt is cleared — but ONLY when it still equals the
 * seeded default, never a value the owner customised.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  const insert = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  insert.run('receipt_header_lines', '[]');
  insert.run('receipt_terms_text', '');
  insert.run('receipt_software_by', 'Rokar POS');
  insert.run('receipt_show_serial_number', 'true');

  // The seeded default was a top-of-receipt greeting; the redesign moved it to
  // the footer. Clear it only if the owner never touched it.
  const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'receipt_header_text'").get();
  if (row && row.value === 'Thank you for shopping with us!') {
    db.prepare("UPDATE admin_settings SET value = '', updated_at = CURRENT_TIMESTAMP WHERE key = 'receipt_header_text'").run();
  }
};

exports.down = function (db) {
  db.prepare("DELETE FROM admin_settings WHERE key IN ('receipt_header_lines', 'receipt_terms_text', 'receipt_software_by', 'receipt_show_serial_number')").run();
};