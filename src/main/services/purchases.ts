import { getDb } from '../db';
import { getProduct, recordMovement, createBatch } from './inventory';
import { logActivity } from './activity';
import type { PurchaseOrder, PurchaseItem, Supplier, SupplierTransaction } from '../../shared/types';

export interface PurchaseLineInput {
  product_id: number;
  qty: number;
  unit_cost: number;
}

export function listSuppliers(): Supplier[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE')
    .all() as unknown as Supplier[];
}

export function createSupplier(name: string, phone?: string, address?: string): Supplier {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO suppliers (name, phone, address) VALUES (?, ?, ?)')
    .run(name.trim(), phone?.trim() || null, address?.trim() || null);
  logActivity('supplier_created', 'supplier', Number(info.lastInsertRowid), name.trim());
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as Supplier;
}

export function createPurchaseOrder(supplierId: number, items: PurchaseLineInput[]): PurchaseOrder {
  const db = getDb();
  if (!items.length) throw new Error('Purchase order has no items');
  for (const it of items) {
    if (it.qty <= 0) throw new Error('Quantity must be positive');
    if (!getProduct(it.product_id)) throw new Error(`Product ${it.product_id} not found`);
  }
  const total = items.reduce((s, i) => s + i.qty * i.unit_cost, 0);

  db.exec('BEGIN');
  try {
    const info = db
      .prepare("INSERT INTO purchase_orders (supplier_id, status, total_amount) VALUES (?, 'pending', ?)")
      .run(supplierId, total);
    const poId = Number(info.lastInsertRowid);
    const insItem = db.prepare(
      'INSERT INTO purchase_items (purchase_order_id, product_id, qty, unit_cost) VALUES (?, ?, ?, ?)'
    );
    for (const it of items) {
      insItem.run(poId, it.product_id, it.qty, it.unit_cost);
    }
    db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?').run(total, supplierId);
    db.prepare(
      'INSERT INTO supplier_transactions (supplier_id, purchase_order_id, amount, type) VALUES (?, ?, ?, ?)'
    ).run(supplierId, poId, total, 'purchase');
    db.exec('COMMIT');
    logActivity('purchase_created', 'purchase_order', poId, `supplier=${supplierId} | total=${total}`);
    const po = getPurchaseOrder(poId);
    if (!po) throw new Error('Failed to load purchase order');
    return po;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getPurchaseOrder(id: number): (PurchaseOrder & { items: PurchaseItem[] }) | null {
  const db = getDb();
  const po = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name
       FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ?`
    )
    .get(id) as unknown as PurchaseOrder | undefined;
  if (!po) return null;
  const items = db
    .prepare(
      `SELECT i.*, pr.name AS product_name
       FROM purchase_items i LEFT JOIN products pr ON pr.id = i.product_id
       WHERE i.purchase_order_id = ?`
    )
    .all(id) as unknown as PurchaseItem[];
  return { ...po, items };
}

export function listPurchaseOrders(
  status?: string,
  from?: string,
  to?: string,
  supplierId?: number
): PurchaseOrder[] {
  const db = getDb();
  let sql = `
    SELECT p.*, s.name AS supplier_name
    FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  if (status) {
    sql += ' AND p.status = ?';
    params.push(status);
  }
  if (from) {
    sql += ' AND date(p.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(p.created_at) <= date(?)';
    params.push(to);
  }
  if (supplierId) {
    sql += ' AND p.supplier_id = ?';
    params.push(supplierId);
  }
  sql += ' ORDER BY p.id DESC LIMIT 500';
  return db.prepare(sql).all(...params) as unknown as PurchaseOrder[];
}

export function receivePurchaseOrder(id: number): PurchaseOrder {
  const db = getDb();
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'pending') throw new Error(`Order already ${po.status}`);

  db.exec('BEGIN');
  try {
    for (const it of po.items) {
      // Create a new batch for this received stock
      const batchNumber = `PO-${id}-${it.product_id}-${Date.now()}`;
      createBatch(it.product_id, batchNumber, it.qty, it.unit_cost, null);
      
      // Update product cost price
      db.prepare('UPDATE products SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        it.unit_cost,
        it.product_id
      );
      db.prepare(
        'INSERT INTO purchase_price_history (product_id, unit_cost, purchase_order_id) VALUES (?, ?, ?)'
      ).run(it.product_id, it.unit_cost, id);
      // Stock-in: batch already holds the qty, so recordMovement must NOT be given a batchId
      // (it would add the qty to the batch a second time). It updates product stock + movement log.
      recordMovement(it.product_id, it.qty, 'Purchase stock-in', 'purchase', id);
    }
    db.prepare("UPDATE purchase_orders SET status = 'received' WHERE id = ?").run(id);
    db.exec('COMMIT');
    logActivity('purchase_received', 'purchase_order', id, `stock-in applied, ${po.items.length} items`);
    const updated = getPurchaseOrder(id);
    if (!updated) throw new Error('Failed to reload order');
    return updated;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function cancelPurchaseOrder(id: number): boolean {
  const db = getDb();
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'pending') throw new Error('Only pending orders can be cancelled');

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(id);
    db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(po.total_amount, po.supplier_id);
    db.prepare(
      'INSERT INTO supplier_transactions (supplier_id, purchase_order_id, amount, type) VALUES (?, ?, ?, ?)'
    ).run(po.supplier_id, id, -po.total_amount, 'purchase_cancelled');
    db.exec('COMMIT');
    logActivity('purchase_cancelled', 'purchase_order', id, `supplier=${po.supplier_id} | total=${po.total_amount}`);
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function supplierLedger(supplierId: number): SupplierTransaction[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, supplier_id, purchase_order_id, amount, type, created_at,
              SUM(amount) OVER (ORDER BY id) AS running
       FROM supplier_transactions
       WHERE supplier_id = ?
       ORDER BY id`
    )
    .all(supplierId) as unknown as SupplierTransaction[];
}

export function paySupplier(supplierId: number, amount: number, mode: string, note?: string): Supplier {
  const db = getDb();
  const sup = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as unknown as Supplier | undefined;
  if (!sup) throw new Error('Supplier not found');
  if (amount <= 0) throw new Error('Payment amount must be positive');
  if (amount > sup.balance) throw new Error(`Amount exceeds outstanding balance (${sup.balance})`);

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO supplier_transactions (supplier_id, amount, type, purchase_order_id) VALUES (?, ?, ?, NULL)'
    ).run(supplierId, -amount, `payment:${mode}` + (note ? `:${note}` : ''));
    db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(amount, supplierId);
    db.exec('COMMIT');
    logActivity('supplier_payment', 'supplier', supplierId, `amount=${amount} | mode=${mode}`);
    return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as unknown as Supplier;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function purchasePriceHistory(productId: number): { id: number; unit_cost: number; created_at?: string; product_name?: string | null }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT h.id, h.unit_cost, h.created_at, p.name AS product_name
       FROM purchase_price_history h LEFT JOIN products p ON p.id = h.product_id
       WHERE h.product_id = ?
       ORDER BY h.id DESC LIMIT 50`
    )
    .all(productId) as unknown as { id: number; unit_cost: number; created_at?: string; product_name?: string | null }[];
}