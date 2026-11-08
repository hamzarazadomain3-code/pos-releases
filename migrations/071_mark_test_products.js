/**
 * Migration 071 - Mark test products as is_test=1.
 *
 * This migration identifies products matching the approved test patterns
 * and sets their `is_test` flag to 1, so they are hidden from normal
 * billing, quick sale, reports and alerts while preserving their history.
 *
 * Patterns:
 *   - %Wiring Test Item% (case-insensitive)
 *   - AG0ENT6N (exact match, case-insensitive)
 *
 * Products with history in sale_items, purchase_items, or stock_movements
 * are NOT marked unless their name matches '%Wiring Test Item%' pattern.
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
  // Only %Wiring Test Item% and AG0ENT6N (exact match) are marked
  const patterns = [
    { pattern: '%Wiring Test Item%', label: 'Wiring Test Item', checkHistory: false },
    { pattern: 'AG0ENT6N', label: 'AG0ENT6N', checkHistory: true, exactMatch: true },
  ];

  let totalMarked = 0;

  for (const { pattern, label, checkHistory, exactMatch } of patterns) {
    // Find candidate products
    let candidates;
    if (exactMatch) {
      candidates = db.prepare(`
        SELECT id, name FROM products
        WHERE LOWER(name) = LOWER(?) AND COALESCE(is_test, 0) = 0
      `).all(pattern);
    } else {
      candidates = db.prepare(`
        SELECT id, name FROM products
        WHERE name LIKE ? AND COALESCE(is_test, 0) = 0
      `).all(pattern);
    }

    if (candidates.length === 0) {
      console.log(`[migration 071] No products to mark for pattern: ${label}`);
      continue;
    }

    for (const product of candidates) {
      let shouldMark = true;

      if (checkHistory) {
        // Check if product has history in sale_items, purchase_items, or stock_movements
        const hasSaleHistory = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1').get(product.id);
        const hasPurchaseHistory = db.prepare('SELECT 1 FROM purchase_items WHERE product_id = ? LIMIT 1').get(product.id);
        const hasStockHistory = db.prepare('SELECT 1 FROM stock_movements WHERE product_id = ? LIMIT 1').get(product.id);
        const hasHistory = hasSaleHistory || hasPurchaseHistory || hasStockHistory;

        if (hasHistory) {
          shouldMark = false;
          console.log(`[migration 071] SKIP product id=${product.id} name="${product.name}" (has history in sale_items/purchase_items/stock_movements)`);
        }
      }

      if (shouldMark) {
        db.prepare('UPDATE products SET is_test = 1 WHERE id = ?').run(product.id);
        console.log(`[migration 071] Marked product id=${product.id} name="${product.name}" as is_test=1 (pattern: ${label})`);
        totalMarked++;
      }
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