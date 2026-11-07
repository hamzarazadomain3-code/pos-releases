/**
 * Migration 068 - test-data flag.
 *
 * Adds `products.is_test` so diagnostic/test data can be marked instead of
 * being deleted. Products with approved test names may be flagged; they remain
 * hidden from normal billing, quick sale, reports and alerts while retaining
 * their history. The column defaults to 0 (production product).
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;
  if (!hasTable('products')) return;

  const cols = db.prepare("PRAGMA table_info('products')").all().map((c) => c.name);
  if (!cols.includes('is_test')) {
    db.exec("ALTER TABLE products ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
  }
  db.prepare("UPDATE products SET is_test = COALESCE(is_test, 0)").run();
};

exports.down = function () {
  // Additive migration only.
};