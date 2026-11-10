/**
 * PHASE 3d fix-up Item 6 — customer discount model.
 *
 * Adds:
 *  - customers.discount_type TEXT NOT NULL DEFAULT 'percent' ('percent'|'fixed')
 *  - customers.discount_min_bill REAL NOT NULL DEFAULT 0
 *
 * Additive and idempotent.
 */
exports.up = async (db) => {
  if (!hasColumn(db, 'customers', 'discount_type')) {
    db.exec("ALTER TABLE customers ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'percent'");
  }
  if (!hasColumn(db, 'customers', 'discount_min_bill')) {
    db.exec('ALTER TABLE customers ADD COLUMN discount_min_bill REAL NOT NULL DEFAULT 0');
  }
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN easily; leave as-is.
};

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}
