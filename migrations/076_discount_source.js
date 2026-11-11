/**
 * PHASE 3d fix-up Item 6 — customer discount source tracking.
 *
 * Adds to `sales`:
 *  - bill_discount REAL DEFAULT 0
 *  - discount_type TEXT DEFAULT 'amount' ('percent'|'amount')
 *  - discount_source TEXT ('customer_percent'|'customer_fixed'|'manual'|'promotion'|NULL)
 *
 * Additive and idempotent.
 */
exports.up = async (db) => {
  if (!hasColumn(db, 'sales', 'bill_discount')) {
    db.exec('ALTER TABLE sales ADD COLUMN bill_discount REAL DEFAULT 0');
  }
  if (!hasColumn(db, 'sales', 'discount_type')) {
    db.exec("ALTER TABLE sales ADD COLUMN discount_type TEXT DEFAULT 'amount'");
  }
  if (!hasColumn(db, 'sales', 'discount_source')) {
    db.exec("ALTER TABLE sales ADD COLUMN discount_source TEXT");
  }
  if (!hasColumn(db, 'sales', 'customer_discount_amount')) {
    db.exec('ALTER TABLE sales ADD COLUMN customer_discount_amount REAL DEFAULT 0');
  }
  if (!hasColumn(db, 'sales', 'bill_discount_amount')) {
    db.exec('ALTER TABLE sales ADD COLUMN bill_discount_amount REAL DEFAULT 0');
  }
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN easily; leave as-is.
};

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}