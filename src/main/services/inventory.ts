import { randomBytes } from 'node:crypto';
import { getDb } from '../db';
import { logActivity } from './activity';
import { getSessionUserId } from './auth';
import { roundQty } from '../../shared/units';
import { isExpiredOn } from '../../shared/expiry';
import type { Category, Product, ProductInput, StockMovement, Unit } from '../../shared/types';

/**
 * The branch the till is on right now (null when the shop has no branches).
 * Read straight from the settings table so the stock ledger never depends on
 * the branches service (which would be a cycle).
 */
export function currentBranchId(): number | null {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'current_branch_id'")
      .get() as { value?: string } | undefined;
    const id = Number(row?.value);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function roundStock(qty: number): number {
  // Phase 1, item 1.13 — the stock precision now lives in ONE place
  // (`src/shared/units.ts`), the same module the purchase maths uses. Before
  // this the purchase maths rounded to 4 decimals and the stock to 3, so a
  // batch quantity and `products.stock_qty` could drift apart.
  return roundQty(qty);
}

export interface ProductBatch {
  id: number;
  product_id: number;
  batch_number: string;
  quantity: number;
  cost_price: number;
  expiry_date: string | null;
  received_date: string;
  created_at: string;
}

function generateEan13(): string {
  let digits = '2' + String(Date.now()).slice(-4) + Array.from(randomBytes(7)).map((b) => b % 10).join('');
  return digits.slice(0, 12);
}

function generateSku(): string {
  return 'SKU' + Date.now().toString(36).toUpperCase() + randomBytes(2).toString('hex').toUpperCase();
}

export function listProducts(
  search?: string,
  includeInactive = false,
  categoryId?: number,
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'negative_stock' | 'below_cost' | 'test',
  supplierId?: number,
  expiryFrom?: string,
  expiryTo?: string
): Product[] {
  const db = getDb();
  let sql = `
    SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE 1=1
  `;
  const params: (string | number | null)[] = [];
  if (!includeInactive) {
    sql += ' AND p.active = 1';
  }
  if (search && search.trim()) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.shelf_location LIKE ?)';
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like);
  }
  if (categoryId) {
    sql += ' AND p.category_id = ?';
    params.push(categoryId);
  }
  if (stockStatus) {
    if (stockStatus === 'out_of_stock') {
      sql += ' AND p.stock_qty <= 0';
    } else if (stockStatus === 'negative_stock') {
      // Phase 1: products whose stock has gone below zero (oversold)
      sql += ' AND p.stock_qty < 0';
    } else if (stockStatus === 'below_cost') {
      sql += ' AND COALESCE(p.cost_price, 0) > 0 AND p.sale_price < p.cost_price';
    } else if (stockStatus === 'test') {
      sql += ' AND COALESCE(p.is_test, 0) = 1';
    } else if (stockStatus === 'low_stock') {
      sql += ' AND p.low_stock_threshold > 0 AND p.stock_qty > 0 AND p.stock_qty <= p.low_stock_threshold';
    } else if (stockStatus === 'in_stock') {
      sql += ' AND p.stock_qty > p.low_stock_threshold';
    }
  }
  if (supplierId) {
    sql += ` AND EXISTS (
      SELECT 1 FROM purchase_orders po
      JOIN purchase_items pi ON pi.purchase_order_id = po.id
      WHERE pi.product_id = p.id AND po.supplier_id = ?
    )`;
    params.push(supplierId);
  }
  if (expiryFrom) {
    sql += ' AND p.expiry_date IS NOT NULL AND date(p.expiry_date) >= date(?)';
    params.push(expiryFrom);
  }
  if (expiryTo) {
    sql += ' AND p.expiry_date IS NOT NULL AND date(p.expiry_date) <= date(?)';
    params.push(expiryTo);
  }
  if (stockStatus !== 'test') {
    sql += ' AND COALESCE(p.is_test, 0) = 0';
  }
  sql += ' ORDER BY p.name COLLATE NOCASE';
  const products = db.prepare(sql).all(...params) as unknown as Product[];
  const unitRows = db.prepare('SELECT * FROM product_units ORDER BY product_id, level').all() as unknown as ProductUnit[];
  const unitsByProduct = new Map<number, ProductUnit[]>();
  for (const row of unitRows) {
    const arr = unitsByProduct.get(row.product_id) ?? [];
    arr.push(row);
    unitsByProduct.set(row.product_id, arr);
  }
  for (const p of products) {
    p.units = unitsByProduct.get(p.id) ?? [];
  }
  return products;
}

export function getProduct(id: number): Product | null {
  const db = getDb();
  const product = (
    db
      .prepare(
        `SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN units u ON u.id = p.unit_id
         WHERE p.id = ?`
      )
      .get(id) as unknown as Product | undefined
  ) ?? null;

  if (product) {
    product.units = getUnits(id);
  }

  return product;
}

export function getProductByBarcode(barcode: string): Product | null {
  const db = getDb();
  const product = (
    db
      .prepare(
        `SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN units u ON u.id = p.unit_id
         WHERE p.barcode = ? AND p.active = 1
           AND COALESCE(p.is_test, 0) = 0`
      )
      .get(barcode) as unknown as Product | undefined
  ) ?? null;

  if (product) {
    product.units = getUnits(product.id);
  }

  return product;
}

export function createProduct(input: ProductInput): Product {
  const db = getDb();
  const barcode = input.barcode && input.barcode.trim() ? input.barcode.trim() : generateEan13();
  const sku = input.sku && input.sku.trim() ? input.sku.trim() : generateSku();
  const stockQty = input.stock_qty ?? 0;

  const info = db
    .prepare(
      `INSERT INTO products
        (sku, barcode, name, category_id, unit_id, cost_price, sale_price, wholesale_price, shelf_location,
         stock_qty, low_stock_threshold, tax_rate, expiry_date, image, net_weight, is_loose, mfg_date, batch_no, active, is_test, min_stock_level, reorder_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      sku,
      barcode,
      input.name.trim(),
      input.category_id ?? null,
      input.unit_id ?? null,
      input.cost_price ?? 0,
      input.sale_price ?? 0,
      input.wholesale_price ?? null,
      input.shelf_location ?? null,
      input.low_stock_threshold ?? 0,
      input.tax_rate ?? 0,
      input.expiry_date ?? null,
      input.image ?? null,
      input.net_weight ?? null,
      input.is_loose ? 1 : 0,
      input.mfg_date ?? null,
      input.batch_no ?? null,
      input.is_test ? 1 : 0,
      // The reorder level: the new column first, the legacy threshold as the
      // fallback, so a product without an explicit level still behaves.
      input.min_stock_level ?? input.low_stock_threshold ?? 0,
      input.reorder_qty ?? null
    );

  const id = Number(info.lastInsertRowid);

  // Save product units if provided
  if (input.units && input.units.length > 0) {
    const insUnit = db.prepare(
      `INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of input.units) {
      insUnit.run(
        id,
        u.level,
        u.name,
        u.quantity_in_base_units,
        u.barcode || null,
        u.price ?? null,
        u.is_base ? 1 : 0
      );
    }
  }

  if (stockQty !== 0) {
    if (stockQty > 0) {
      createBatch(id, 'INIT-' + id, stockQty, input.cost_price ?? 0, input.expiry_date ?? null);
    }
    recordMovement(id, stockQty, 'Initial stock');
  }

  ensureGramUnit(id);

  const product = getProduct(id);
  if (!product) throw new Error('Failed to create product');
  logActivity('product_created', 'product', id, `${product.name} | barcode=${product.barcode}`);
  return product;
}

export function updateProduct(id: number, input: ProductInput): Product {
  const db = getDb();
  const existing = getProduct(id);
  if (!existing) throw new Error('Product not found');

  const barcode = input.barcode && input.barcode.trim() ? input.barcode.trim() : existing.barcode;
  const sku = input.sku && input.sku.trim() ? input.sku.trim() : existing.sku;

  db.prepare(
    `UPDATE products SET
       sku = ?, barcode = ?, name = ?, category_id = ?, unit_id = ?,
       cost_price = ?, sale_price = ?, wholesale_price = ?, shelf_location = ?,
       low_stock_threshold = ?, tax_rate = ?, expiry_date = ?, image = ?,
       net_weight = ?, is_loose = ?, is_test = ?, mfg_date = ?, batch_no = ?, min_stock_level = ?, reorder_qty = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    sku,
    barcode,
    input.name.trim(),
    input.category_id ?? null,
    input.unit_id ?? null,
    input.cost_price ?? existing.cost_price,
    input.sale_price ?? existing.sale_price,
    input.wholesale_price !== undefined ? input.wholesale_price : existing.wholesale_price,
    input.shelf_location !== undefined ? input.shelf_location : existing.shelf_location,
    input.low_stock_threshold ?? existing.low_stock_threshold,
    input.tax_rate ?? existing.tax_rate,
    input.expiry_date ?? existing.expiry_date,
    input.image !== undefined ? input.image : existing.image ?? null,
    input.net_weight !== undefined ? input.net_weight : existing.net_weight ?? null,
    input.is_loose !== undefined ? (input.is_loose ? 1 : 0) : existing.is_loose ?? 0,
    input.is_test !== undefined ? (input.is_test ? 1 : 0) : existing.is_test ?? 0,
    input.mfg_date !== undefined ? input.mfg_date : existing.mfg_date ?? null,
    input.batch_no !== undefined ? input.batch_no : existing.batch_no ?? null,
    // The reorder level: keep the product's own, fall back to the legacy
    // threshold so a product never ends up with two different levels.
    input.min_stock_level ?? existing.min_stock_level ?? input.low_stock_threshold ?? existing.low_stock_threshold ?? 0,
    input.reorder_qty !== undefined ? input.reorder_qty : existing.reorder_qty ?? null,
    id
  );

  // Update product units if provided
  if (input.units && input.units.length > 0) {
    // Delete existing units for this product
    db.prepare('DELETE FROM product_units WHERE product_id = ?').run(id);
    // Insert new units
    const insUnit = db.prepare(
      `INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of input.units) {
      insUnit.run(
        id,
        u.level,
        u.name,
        u.quantity_in_base_units,
        u.barcode || null,
        u.price ?? null,
        u.is_base ? 1 : 0
      );
    }
  }

  ensureGramUnit(id);

  const product = getProduct(id);
  if (!product) throw new Error('Failed to update product');
  logActivity('product_updated', 'product', id, product.name);
  return product;
}

export function deleteProduct(id: number): boolean {
  const db = getDb();
  const refs = db.prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?').get(id) as { c: number };
  if (refs.c > 0) {
    throw new Error('Cannot delete product with sale history (FOREIGN KEY constraint failed)');
  }
  db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM product_batches WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM product_units WHERE product_id = ?').run(id);
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (info.changes > 0) logActivity('product_deleted', 'product', id);
  return info.changes > 0;
}

/**
 * A manual stock correction (the Inventory screen, the assistant, the udhaar
 * write-off).
 *
 * Phase 1, item 1.1 — the whole adjustment is now ATOMIC. It runs inside a
 * SAVEPOINT (a savepoint, not `BEGIN`, because the caller may already own a
 * transaction — the udhaar write-off does). Before this a refused negative
 * adjustment left the batches short while the product stock and the ledger
 * stayed untouched.
 */
export function adjustStock(
  productId: number,
  changeQty: number,
  reason: string,
  refType?: string | null,
  refId?: number | null
): Product {
  const existing = getProduct(productId);
  if (!existing) throw new Error('Product not found');
  // Allow negative stock - check is done at the billing level via settings
  const db = getDb();
  const userId = getSessionUserId();
  const branchId = currentBranchId();
  db.exec('SAVEPOINT rokar_stock_adjust');
  try {
    if (changeQty > 0) {
      const latest = db
        .prepare(
          `SELECT * FROM product_batches WHERE product_id = ? AND quantity > 0
           ORDER BY received_date DESC, id DESC LIMIT 1`
        )
        .get(productId) as { id: number } | undefined;
      if (latest) {
        recordMovement(productId, changeQty, reason, refType, refId, latest.id, userId, branchId);
      } else {
        createBatch(productId, 'ADJ-' + Date.now(), changeQty, existing.cost_price ?? 0, null);
        recordMovement(productId, changeQty, reason, refType, refId, null, userId, branchId);
      }
    } else if (changeQty < 0) {
      const allocations = deductStockFIFO(productId, roundStock(-changeQty));
      db.prepare('UPDATE products SET stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(roundStock(-changeQty), productId);
      const ins = db.prepare(
        `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id, user_id, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of allocations) {
        ins.run(productId, -a.qty, reason, refType ?? null, refId ?? null, a.batchId, userId, branchId);
      }
    } else {
      recordMovement(productId, 0, reason, refType, refId, null, userId, branchId);
    }
    db.exec('RELEASE SAVEPOINT rokar_stock_adjust');
  } catch (e) {
    try { db.exec('ROLLBACK TO SAVEPOINT rokar_stock_adjust'); db.exec('RELEASE SAVEPOINT rokar_stock_adjust'); } catch { /* ignore */ }
    throw e;
  }
  logActivity('stock_adjust', 'product', productId, `change=${changeQty} | reason=${reason}`);
  const product = getProduct(productId);
  if (!product) throw new Error('Failed to adjust stock');
  return product;
}

export function listMovements(productId?: number): StockMovement[] {
  const db = getDb();
  let sql = `
    SELECT m.*, p.name AS product_name
    FROM stock_movements m
    LEFT JOIN products p ON p.id = m.product_id
  `;
  const params: (string | number | null)[] = [];
  if (productId) {
    sql += ' WHERE m.product_id = ?';
    params.push(productId);
  }
  sql += ' ORDER BY m.created_at DESC, m.id DESC LIMIT 500';
  return db.prepare(sql).all(...params) as unknown as StockMovement[];
}

export function listLowStock(): Product[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE p.active = 1 AND COALESCE(p.is_test, 0) = 0 AND p.low_stock_threshold > 0 AND p.stock_qty <= p.low_stock_threshold
       ORDER BY (p.stock_qty - p.low_stock_threshold) ASC`
    )
    .all() as unknown as Product[];
}

export function listCategories(): Category[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE')
    .all() as unknown as Category[];
}

export function createCategory(name: string): Category {
  const db = getDb();
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
  return { id: Number(info.lastInsertRowid), name: name.trim() };
}

export function listUnits(): Unit[] {
  const db = getDb();
  return db.prepare('SELECT * FROM units ORDER BY id').all() as unknown as Unit[];
}

/**
 * How much of a product's stock may be sold today.
 *
 * Phase 1, item 1.6 — the sale used to look at ONE thing: the product's own
 * `expiry_date`. The batch it actually consumed was never checked, so a batch
 * that was past its expiry could be sold silently. This helper splits the
 * batches into what is fresh and what is expired.
 *
 * A product with NO batches at all (a legacy product that only ever had a
 * running `stock_qty`) keeps the product-level expiry rule.
 */
export interface BatchStockState {
  /** The product has at least one batch with stock on it. */
  hasBatches: boolean;
  /** The stock in the batches that are still sellable. */
  freshQty: number;
  /** The stock in the batches that are past their expiry date. */
  expiredQty: number;
}

export function batchStockState(productId: number, today: string): BatchStockState {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT expiry_date, quantity FROM product_batches WHERE product_id = ? AND quantity > 0'
    )
    .all(productId) as { expiry_date: string | null; quantity: number }[];
  if (!rows.length) return { hasBatches: false, freshQty: 0, expiredQty: 0 };
  let freshQty = 0;
  let expiredQty = 0;
  for (const r of rows) {
    const qty = roundStock(Number(r.quantity) || 0);
    if (isExpiredOn(r.expiry_date, today)) expiredQty += qty;
    else freshQty += qty;
  }
  return { hasBatches: true, freshQty: roundStock(freshQty), expiredQty: roundStock(expiredQty) };
}

export function getProductBatches(productId: number): ProductBatch[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM product_batches 
       WHERE product_id = ? AND quantity > 0 
       ORDER BY expiry_date ASC NULLS LAST, received_date ASC`
    )
    .all(productId) as unknown as ProductBatch[];
}

/**
 * Put a batch on the shelf.
 *
 * Phase 1, item 1.3 — `quantity_received` is written here. It used to stay 0,
 * and the separate FIFO engine (`fifoEngine.ts`) filters on
 * `quantity_received > 0`, so EVERY real batch (the initial stock, a manual
 * adjustment, a purchase receipt) showed up with ZERO available in the FIFO
 * Stock Report. The column is the "how much did we ever receive" truth; the
 * `quantity` column is "how much is on the shelf right now".
 */
export function createBatch(
  productId: number,
  batchNumber: string,
  quantity: number,
  costPrice: number,
  expiryDate: string | null
): number {
  const db = getDb();
  const qty = roundStock(quantity);
  const info = db
    .prepare(
      `INSERT INTO product_batches (product_id, batch_number, quantity, quantity_received, cost_price, expiry_date, received_date)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(productId, batchNumber, qty, qty, costPrice, expiryDate);
  return Number(info.lastInsertRowid);
}

/**
 * Take stock off the shelf, oldest (and earliest-expiring) batch first.
 *
 * Phase 1, item 1.1 — the batch rows are NO LONGER left half-deducted when the
 * stock is not enough. Before this the function wrote `quantity -= take` for
 * every batch it touched and only THEN checked whether it had enough; the
 * error was thrown with the batches already short. `adjustStock()` has no
 * transaction of its own, so a refused manual adjustment silently destroyed
 * batch stock while `products.stock_qty` and the ledger stayed untouched.
 *
 * Phase 1, item 1.6 — `skipExpired` makes the FIFO skip the batches that are
 * past their expiry date, so an expired batch can never be sold. The caller
 * decides whether "nothing sellable left" is an error (a sale) or a manual
 * correction (an adjustment).
 */
export function deductStockFIFO(
  productId: number,
  qty: number,
  allowNegative = false,
  options: { today?: string; skipExpired?: boolean } = {}
): { batchId: number; qty: number }[] {
  const db = getDb();
  const batches = getProductBatches(productId);
  const allocation: { batchId: number; qty: number }[] = [];
  let remaining = roundStock(qty);
  const today = options.today ?? null;
  const skipExpired = !!options.skipExpired && !!today;

  for (const batch of batches) {
    if (remaining <= 0) break;
    // An expired batch is not sellable stock.
    if (skipExpired && today && isExpiredOn(batch.expiry_date, today)) continue;
    const take = roundStock(Math.min(batch.quantity, remaining));
    if (take <= 0) continue;
    allocation.push({ batchId: batch.id, qty: take });

    // Update batch quantity
    db.prepare('UPDATE product_batches SET quantity = quantity - ? WHERE id = ?')
      .run(take, batch.id);

    remaining = roundStock(remaining - take);
  }

  if (remaining > 0 && !allowNegative) {
    // Put back what we took: the deduction must be all-or-nothing.
    for (const a of allocation) {
      db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?')
        .run(a.qty, a.batchId);
    }
    throw new Error(`Insufficient stock in batches for product ${productId}`);
  }

  return allocation;
}

/**
 * Record FIFO allocations for a sale item (creates fifo_allocations records)
 * Should be called after sale_items are inserted with known sale_item_id
 */
export function recordFIFOAllocations(saleItemId: number, productId: number, allocations: { batchId: number; qty: number }[]): void {
  const db = getDb();
  const ins = db.prepare(`
    INSERT INTO fifo_allocations (sale_item_id, product_batch_id, allocated_qty, unit_cost)
    VALUES (?, ?, ?, ?)
  `);
  for (const alloc of allocations) {
    const batch = db.prepare(`SELECT cost_price FROM product_batches WHERE id = ?`).get(alloc.batchId) as { cost_price: number } | undefined;
    ins.run(saleItemId, alloc.batchId, alloc.qty, batch?.cost_price ?? 0);
  }
}

/**
 * The ONE writer of the stock ledger (`stock_movements`) + the product's
 * running stock.
 *
 * Phase 1, item 1.8 — the ledger now records WHO moved the stock and from
 * WHICH branch. Before this the function could not write `user_id` or
 * `branch_id` at all, so every sale, purchase, return, audit correction and
 * manual adjustment was an anonymous line and the branch columns were dead.
 */
export function recordMovement(
  productId: number,
  changeQty: number,
  reason: string,
  refType?: string | null,
  refId?: number | null,
  batchId?: number | null,
  userId?: number | null,
  branchId?: number | null
): void {
  const db = getDb();
  const roundedQty = roundStock(changeQty);
  db.prepare(
    'UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(roundedQty, productId);
   
  if (batchId !== undefined && batchId !== null) {
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id, user_id, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, roundedQty, reason, refType ?? null, refId ?? null, batchId, userId ?? null, branchId ?? null);
    
    if (roundedQty > 0) {
      db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?')
        .run(roundedQty, batchId);
    }
  } else {
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, user_id, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, roundedQty, reason, refType ?? null, refId ?? null, userId ?? null, branchId ?? null);
  }
}

export function getBatches(productId: number): ProductBatch[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM product_batches 
       WHERE product_id = ? 
       ORDER BY expiry_date ASC NULLS LAST, received_date ASC`
    )
    .all(productId) as unknown as ProductBatch[];
}

export interface ProductUnit {
  id: number;
  product_id: number;
  level: 0 | 1 | 2;
  name: string;
  quantity_in_base_units: number;
  barcode: string | null;
  price: number | null;
  is_base: boolean;
  created_at: string;
}

export function getUnits(productId: number): ProductUnit[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM product_units 
       WHERE product_id = ? 
       ORDER BY level ASC`
    )
    .all(productId) as unknown as ProductUnit[];
}

export function ensureGramUnit(productId: number): void {
  const db = getDb();
  const p = db.prepare('SELECT unit_id FROM products WHERE id = ?').get(productId) as
    | { unit_id: number | null }
    | undefined;
  if (!p) return;

  let isKg = false;
  if (p.unit_id != null) {
    const u = db.prepare('SELECT name FROM units WHERE id = ?').get(p.unit_id) as
      | { name: string }
      | undefined;
    isKg = !!u && u.name.toLowerCase() === 'kilogram';
  }
  if (!isKg) {
    const base = db
      .prepare('SELECT name FROM product_units WHERE product_id = ? AND is_base = 1')
      .get(productId) as { name: string } | undefined;
    isKg = !!base && base.name.toLowerCase() === 'kilogram';
  }
  if (!isKg) return;

  const hasGram = db
    .prepare("SELECT 1 FROM product_units WHERE product_id = ? AND LOWER(name) = 'gram'")
    .get(productId);
  if (hasGram) return;

  const maxLevel = db
    .prepare('SELECT COALESCE(MAX(level), 0) AS m FROM product_units WHERE product_id = ?')
    .get(productId) as { m: number };
  db.prepare(
    `INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
     VALUES (?, ?, 'Gram', 0.001, NULL, NULL, 0)`
  ).run(productId, maxLevel.m + 1);
}

