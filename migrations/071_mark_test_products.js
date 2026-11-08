/**
 * Migration 071 - Mark test products as is_test=1.
 *
 * This migration identifies products matching the approved test patterns
 * and sets their `is_test` flag to 1, so they are hidden from normal
 * billing, quick sale, reports and alerts while preserving their history.
 *
 * Patterns (case-insensitive):
 *   - %Wiring Test Item%
 *   - INIT-%
 *   - %AG0ENT6N%
 *
 * This migration is additive and idempotent - it only sets is_test=1
 * and never deletes any data.
 */
exports.up = async function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('products')) return;

  const cols = db.prepare("PRAGMA table_info('products')").all().map((c) => c.name);
  if (!cols.includes('is_test')) {
    // If is_test column doesn't exist (e.g., migration 068 not run), add it
    db.exec("ALTER TABLE products ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
  }

  // First, ensure all products have a valid is_test value
  db.prepare("UPDATE products SET is_test = COALESCE(is_test, 0)").run();

  // Define test product patterns
  const patterns = [
    { pattern: '%Wiring Test Item%', label: 'Wiring Test Item' },
    { pattern: 'INIT-%', label: 'INIT-' },
    { pattern: '%AG0ENT6N%', label: 'AG0ENT6N' },
  ];

  let totalMarked = 0;

  for (const { pattern, label } of patterns) {
    // Count products matching this pattern that are not already marked
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM products
      WHERE name LIKE ? AND COALESCE(is_test, 0) = 0
    `).get(pattern).cnt;

    if (count > 0) {
      // Mark them as test products
      db.prepare(`
        UPDATE products SET is_test = 1
        WHERE name LIKE ? AND COALESCE(is_test, 0) = 0
      `).run(pattern);

      console.log(`[migration 071] Marked ${count} product(s) as is_test=1 (pattern: ${label})`);
      totalMarked += count;
    } else {
      console.log(`[migration 071] No products to mark for pattern: ${label}`);
    }
  }

  console.log(`[migration 071] Total products marked as is_test=1: ${totalMarked}`);
};

exports.down = function () {
  // This is an additive migration - we don't unmark products automatically
  // as that would require knowing which were marked by this specific migration
  // vs manually. The is_test flag can be manually reset if needed.
  console.log('[migration 071] Down: No automatic reversal - is_test flags preserved');
};