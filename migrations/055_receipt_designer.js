/**
 * Migration 055 — Receipt Designer (phase 2) settings
 *
 *   - receipt_design_json     : the editable ReceiptDesign (JSON). Absent means
 *     "use the built-in default" (see shared/receiptDesign.ts
 *     `defaultReceiptDesign`), so nothing is seeded here.
 *   - receipt_design_enabled  : whether the SAVED design drives printed receipts.
 *     Seeded to 'false' so an existing install's receipts are byte-identical to
 *     before until the owner actively applies a design from the designer. This is
 *     the safety switch that makes Phase 2 opt-in.
 *
 * Both are read with safe code defaults in `receiptDesigner.ts`, so an install
 * that never runs this migration still behaves correctly.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_settings')) return;

  db.prepare(
    'INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run('receipt_design_enabled', 'false');
};

exports.down = function (db) {
  db.prepare("DELETE FROM admin_settings WHERE key IN ('receipt_design_json', 'receipt_design_enabled')").run();
};
