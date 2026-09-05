/**
 * Migration 047 — Add quantity_received column to product_batches
 *
 * Adds quantity_received to track original received quantity (separate from current quantity).
 * Backfills from existing quantity column.
 */
exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  if (!hasColumn('product_batches', 'quantity_received')) {
    db.exec('ALTER TABLE product_batches ADD COLUMN quantity_received REAL DEFAULT 0');

    // Backfill: copy current quantity to quantity_received for existing batches
    db.exec('UPDATE product_batches SET quantity_received = quantity WHERE quantity_received = 0');
  }
};

exports.down = function (db) {
  // SQLite doesn't support DROP COLUMN easily
};