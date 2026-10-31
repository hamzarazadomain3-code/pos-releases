/**
 * Migration 064 — Purchase import (Excel/CSV) + partial receive.
 *
 * Additive only, safe defaults:
 *
 *   purchase_orders   + reference_no, document_type ('purchase_order' |
 *                       'purchase_invoice'), import_id, invoice_date
 *   purchase_items    + batch_no, expiry_date, discount_pct, tax_pct,
 *                       received_qty (0 = nothing received yet), sale_price,
 *                       wholesale_price (only written when the import options
 *                       say so)
 *   purchase_imports    new table: one row per confirmed import, carrying the
 *                       undo payload so the last import can be reversed
 *                       (stock + supplier ledger) within the session.
 *
 * No data is deleted; every new column defaults to NULL/0.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const addColumn = (table, column, ddl) => {
    if (hasTable(table) && !hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };

  addColumn('purchase_orders', 'reference_no', 'reference_no TEXT');
  addColumn('purchase_orders', 'document_type', "document_type TEXT DEFAULT 'purchase_order'");
  addColumn('purchase_orders', 'import_id', 'import_id INTEGER');
  addColumn('purchase_orders', 'invoice_date', 'invoice_date TEXT');

  addColumn('purchase_items', 'batch_no', 'batch_no TEXT');
  addColumn('purchase_items', 'expiry_date', 'expiry_date TEXT');
  addColumn('purchase_items', 'discount_pct', 'discount_pct REAL DEFAULT 0');
  addColumn('purchase_items', 'tax_pct', 'tax_pct REAL DEFAULT 0');
  addColumn('purchase_items', 'received_qty', 'received_qty REAL DEFAULT 0');
  addColumn('purchase_items', 'sale_price', 'sale_price REAL');
  addColumn('purchase_items', 'wholesale_price', 'wholesale_price REAL');

  if (!hasTable('purchase_imports')) {
    db.exec(`
      CREATE TABLE purchase_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER,
        document_type TEXT DEFAULT 'purchase_order',
        reference_no TEXT,
        file_name TEXT,
        row_count INTEGER DEFAULT 0,
        imported_count INTEGER DEFAULT 0,
        created_count INTEGER DEFAULT 0,
        skipped_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        payload_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_purchase_imports_created ON purchase_imports(created_at)');
  }
};

exports.down = function (db) {
  // Columns are intentionally left in place (SQLite cannot drop them safely);
  // only the bookkeeping table is removed.
  db.exec('DROP TABLE IF EXISTS purchase_imports');
};
