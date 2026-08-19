import { randomBytes } from 'node:crypto';
import { getDb } from '../db';
import { logActivity } from './activity';
import type { Category, Product, ProductInput, StockMovement, Unit } from '../../shared/types';

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

export function listProducts(search?: string, includeInactive = false): Product[] {
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
         WHERE p.barcode = ? AND p.active = 1`
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
         stock_qty, low_stock_threshold, tax_rate, expiry_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)`
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
      input.expiry_date ?? null
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
       low_stock_threshold = ?, tax_rate = ?, expiry_date = ?,
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

export function adjustStock(
  productId: number,
  changeQty: number,
  reason: string,
  refType?: string | null,
  refId?: number | null
): Product {
  const existing = getProduct(productId);
  if (!existing) throw new Error('Product not found');
  if (existing.stock_qty + changeQty < 0) {
    throw new Error('Insufficient stock: adjustment would make stock negative');
  }
  const db = getDb();
  if (changeQty > 0) {
    const latest = db
      .prepare(
        `SELECT * FROM product_batches WHERE product_id = ? AND quantity > 0
         ORDER BY received_date DESC, id DESC LIMIT 1`
      )
      .get(productId) as { id: number } | undefined;
    if (latest) {
      recordMovement(productId, changeQty, reason, refType, refId, latest.id);
    } else {
      createBatch(productId, 'ADJ-' + Date.now(), changeQty, existing.cost_price ?? 0, null);
      recordMovement(productId, changeQty, reason, refType, refId);
    }
  } else if (changeQty < 0) {
    const allocations = deductStockFIFO(productId, -changeQty);
    db.prepare('UPDATE products SET stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(-changeQty, productId);
    const ins = db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const a of allocations) {
      ins.run(productId, -a.qty, reason, refType ?? null, refId ?? null, a.batchId);
    }
  } else {
    recordMovement(productId, 0, reason, refType, refId);
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
       WHERE p.active = 1 AND p.low_stock_threshold > 0 AND p.stock_qty <= p.low_stock_threshold
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

export function createBatch(
  productId: number,
  batchNumber: string,
  quantity: number,
  costPrice: number,
  expiryDate: string | null
): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO product_batches (product_id, batch_number, quantity, cost_price, expiry_date, received_date)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(productId, batchNumber, quantity, costPrice, expiryDate);
  return Number(info.lastInsertRowid);
}

export function deductStockFIFO(productId: number, qty: number): { batchId: number; qty: number }[] {
  const db = getDb();
  const batches = getProductBatches(productId);
  const allocation: { batchId: number; qty: number }[] = [];
  let remaining = qty;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocation.push({ batchId: batch.id, qty: take });
    
    // Update batch quantity
    db.prepare('UPDATE product_batches SET quantity = quantity - ? WHERE id = ?')
      .run(take, batch.id);
    
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock in batches for product ${productId}`);
  }

  return allocation;
}

export function recordMovement(
  productId: number,
  changeQty: number,
  reason: string,
  refType?: string | null,
  refId?: number | null,
  batchId?: number | null
): void {
  const db = getDb();
  db.prepare(
    'UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(changeQty, productId);
  
  if (batchId !== undefined && batchId !== null) {
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(productId, changeQty, reason, refType ?? null, refId ?? null, batchId);
    
    if (changeQty > 0) {
      db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?')
        .run(changeQty, batchId);
    }
  } else {
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(productId, changeQty, reason, refType ?? null, refId ?? null);
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
