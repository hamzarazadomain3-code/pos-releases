/**
 * Migration 056 — Receipt template library (phase 3) settings
 *
 *   - receipt_design_library_json : the named template store (JSON) plus the
 *     default template per paper size and per branch. Absent means "the built-in
 *     templates with NO defaults set" (see shared/receiptDesign.ts
 *     `defaultLibrary`), so nothing meaningful is seeded here.
 *
 * The library is read with a safe code default in `receiptDesigner.ts`, so an
 * install that never runs this migration still behaves correctly. Because no
 * default is pre-set, an install that never opens the designer keeps the phase-2
 * applied design (`receipt_design_json`) driving the printer — byte-identical.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  db.prepare(
    'INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run('receipt_design_library_json', '');
};

exports.down = function (db) {
  db.prepare("DELETE FROM admin_settings WHERE key IN ('receipt_design_library_json')").run();
};
