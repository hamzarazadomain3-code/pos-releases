/**
 * Test-data cleanup.
 *
 * Phase B found 19 `Wiring Test Item` products (plus `AG0ENT6N`) in the live
 * database. Deleting them outright would break the sales/stock history that
 * references them, so this service is deliberately conservative:
 *
 *   - A preview (dry run) lists exactly which products match and how many
 *     historical rows reference each one. It never writes.
 *   - Removal always creates a local backup first.
 *   - Products with no history at all are deleted for real.
 *   - Products that appear in any transaction/report table are quarantined
 *     instead: `is_test = 1` and `active = 0`, which hides them from billing,
 *     quick sale, reports and alerts while preserving history. This matches
 *     the intent of migration 068.
 *
 * The operation is idempotent: already-quarantined products no longer match,
 * so a second run is a no-op.
 */
import { getDb } from '../db';
import { logActivity } from './activity';

/** Approved test-product name patterns (case-insensitive, additive). */
export const TEST_PRODUCT_PATTERNS = [
  '%Wiring Test Item%',
  'INIT-%',
  '%AG0ENT6N%',
];

/** Tables that reference `products(id)` through a `product_id` column. */
const REFERENCE_TABLES = [
  'stock_movements',
  'sale_items',
  'purchase_items',
  'purchase_price_history',
  'return_items',
  'audit_items',
  'promotions',
  'product_batches',
  'product_units',
  'inventory_snapshots',
  'product_profitability',
  'alert_log',
  'quotation_items',
  'product_variants',
  'commission_rules',
];

export const REMOVE_TEST_DATA_PHRASE = 'REMOVE TEST DATA';

export interface TestProductRow {
  id: number;
  name: string;
  sku: string | null;
  stock_qty: number;
  references: number;
  action: 'delete' | 'quarantine';
}

export interface TestDataPreview {
  products: TestProductRow[];
  total_products: number;
  delete_count: number;
  quarantine_count: number;
}

export interface RemoveTestDataResult {
  backupPath: string;
  deleted: number;
  quarantined: number;
  products: TestProductRow[];
}

function tableExists(db: ReturnType<typeof getDb>, name: string): boolean {
  return db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .all(name).length > 0;
}

function columnExists(db: ReturnType<typeof getDb>, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).some(
    (c) => c.name === column
  );
}

/** Count every row in the reference tables that points at this product. */
function countReferences(db: ReturnType<typeof getDb>, productId: number): number {
  let total = 0;
  for (const table of REFERENCE_TABLES) {
    if (!columnExists(db, table, 'product_id')) continue;
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE product_id = ?`)
      .get(productId) as { c: number };
    total += row?.c ?? 0;
  }
  return total;
}

/**
 * Read-only preview. Matches products by the approved patterns unless they are
 * already flagged `is_test`, which keeps repeated runs idempotent.
 */
export function previewTestData(): TestDataPreview {
  const db = getDb();
  const hasIsTest = columnExists(db, 'products', 'is_test');
  const patternClause = TEST_PRODUCT_PATTERNS.map(() => 'name LIKE ?').join(' OR ');
  const sql = hasIsTest
    ? `SELECT id, name, sku, stock_qty FROM products
       WHERE COALESCE(is_test, 0) = 0 AND (${patternClause})
       ORDER BY id`
    : `SELECT id, name, sku, stock_qty FROM products WHERE (${patternClause}) ORDER BY id`;

  const rows = db.prepare(sql).all(...TEST_PRODUCT_PATTERNS) as Array<{
    id: number;
    name: string;
    sku: string | null;
    stock_qty: number;
  }>;

  const products: TestProductRow[] = rows.map((row) => {
    const references = countReferences(db, row.id);
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      stock_qty: row.stock_qty,
      references,
      action: references === 0 ? 'delete' : 'quarantine',
    };
  });

  return {
    products,
    total_products: products.length,
    delete_count: products.filter((p) => p.action === 'delete').length,
    quarantine_count: products.filter((p) => p.action === 'quarantine').length,
  };
}

/**
 * Remove/quarantine matching test products.
 *
 * Requires the exact confirmation phrase and an owner (checked at the IPC
 * boundary as well). Always writes a local backup before touching the data.
 */
export async function removeTestData(
  confirmText: string,
  backupFn?: () => string
): Promise<RemoveTestDataResult> {
  if (confirmText !== REMOVE_TEST_DATA_PHRASE) {
    throw new Error(`Type "${REMOVE_TEST_DATA_PHRASE}" to confirm test-data cleanup`);
  }

  const preview = previewTestData();
  if (preview.total_products === 0) {
    return { backupPath: '', deleted: 0, quarantined: 0, products: [] };
  }

  // Back up before any write. runLocalBackup also records the backup time.
  // The import is lazy so this service can be unit-tested without Electron.
  let backupPath = '';
  if (backupFn) {
    backupPath = backupFn();
  } else {
    const { runLocalBackup } = await import('./backup');
    backupPath = runLocalBackup();
  }

  const db = getDb();
  const hasIsTest = columnExists(db, 'products', 'is_test');
  let deleted = 0;
  let quarantined = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const product of preview.products) {
      if (product.action === 'delete') {
        db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
        deleted++;
      } else {
        if (hasIsTest) {
          db.prepare('UPDATE products SET is_test = 1, active = 0 WHERE id = ?').run(product.id);
        } else {
          // Without migration 068 the only safe hide is `active = 0`.
          db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(product.id);
        }
        quarantined++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* transaction already rolled back */
    }
    throw e;
  }

  logActivity(
    'test_data_removed',
    'product',
    null,
    `deleted=${deleted} quarantined=${quarantined} backup=${backupPath}`
  );

  return { backupPath, deleted, quarantined, products: preview.products };
}
