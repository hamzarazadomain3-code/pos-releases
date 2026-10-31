import { getDb } from '../db';
import { getProduct, recordMovement, createBatch } from './inventory';
import { logActivity } from './activity';
import type { PurchaseOrder, PurchaseItem, Supplier, SupplierTransaction } from '../../shared/types';

export interface PurchaseLineInput {
  product_id: number;
  qty: number;
  unit_cost: number;
  /** Phase 3 (import): optional per-line extras, all additive. */
  batch_no?: string | null;
  expiry_date?: string | null;
  discount_pct?: number;
  tax_pct?: number;
  sale_price?: number | null;
  wholesale_price?: number | null;
}

export interface PurchaseOrderOptions {
  /** 'purchase_order' (stock later, via receive) or 'purchase_invoice' (stock now). */
  document_type?: 'purchase_order' | 'purchase_invoice';
  reference_no?: string | null;
  invoice_date?: string | null;
  import_id?: number | null;
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

/** Money-safe add: never NaN, rounded to 2 dp. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Line total including the import's discount/tax percentages (no NaN). */
export function purchaseLineTotal(it: PurchaseLineInput): number {
  const qty = Number(it.qty) || 0;
  const cost = Number(it.unit_cost) || 0;
  const gross = qty * cost;
  const afterDisc = gross - gross * ((Number(it.discount_pct) || 0) / 100);
  const withTax = afterDisc + afterDisc * ((Number(it.tax_pct) || 0) / 100);
  return round2(withTax);
}

/**
 * Insert the purchase document + items + supplier ledger row.
 * The CALLER owns the transaction (imports wrap several writes in ONE tx).
 */
export function insertPurchaseOrderCore(
  supplierId: number,
  items: PurchaseLineInput[],
  opts: PurchaseOrderOptions = {}
): { id: number; total: number } {
  const db = getDb();
  if (!items.length) throw new Error('Purchase order has no items');
  for (const it of items) {
    if (!(Number(it.qty) > 0)) throw new Error('Quantity must be positive');
    if (!getProduct(it.product_id)) throw new Error(`Product ${it.product_id} not found`);
  }
  const docType = opts.document_type === 'purchase_invoice' ? 'purchase_invoice' : 'purchase_order';
  // Line totals honour discount % / tax % when present (import); plain orders
  // have neither and keep the historical qty * unit_cost total.
  const total = round2(items.reduce((s, i) => s + purchaseLineTotal(i), 0));

  const info = db
    .prepare(
      `INSERT INTO purchase_orders (supplier_id, status, total_amount, reference_no, document_type, import_id, invoice_date)
       VALUES (?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      supplierId,
      total,
      opts.reference_no ?? null,
      docType,
      opts.import_id ?? null,
      opts.invoice_date ?? null
    );
  const poId = Number(info.lastInsertRowid);
  const insItem = db.prepare(
    `INSERT INTO purchase_items
       (purchase_order_id, product_id, qty, unit_cost, batch_no, expiry_date, discount_pct, tax_pct, received_qty, sale_price, wholesale_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  for (const it of items) {
    insItem.run(
      poId,
      it.product_id,
      round2(Number(it.qty) || 0),
      round2(Number(it.unit_cost) || 0),
      it.batch_no ?? null,
      it.expiry_date ?? null,
      Number(it.discount_pct) || 0,
      Number(it.tax_pct) || 0,
      it.sale_price ?? null,
      it.wholesale_price ?? null
    );
  }
  db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?').run(total, supplierId);
  db.prepare(
    'INSERT INTO supplier_transactions (supplier_id, purchase_order_id, amount, type) VALUES (?, ?, ?, ?)'
  ).run(supplierId, poId, total, docType === 'purchase_invoice' ? 'purchase_invoice' : 'purchase');
  return { id: poId, total };
}

export function createPurchaseOrder(
  supplierId: number,
  items: PurchaseLineInput[],
  opts: PurchaseOrderOptions = {}
): PurchaseOrder {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const { id: poId, total } = insertPurchaseOrderCore(supplierId, items, opts);
    db.exec('COMMIT');
    const docType = opts.document_type === 'purchase_invoice' ? 'purchase_invoice' : 'purchase_order';
    logActivity('purchase_created', 'purchase_order', poId, `supplier=${supplierId} | total=${total} | type=${docType}`);
    const po = getPurchaseOrder(poId);
    if (!po) throw new Error('Failed to load purchase order');
    return po;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
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

/**
 * Receive a purchase order into stock.
 *
 * Phase 3: supports PARTIAL receive — pass `lines` ([{ product_id, qty }]) to
 * receive only some of what is outstanding; omit it to receive everything
 * remaining (the historical behaviour). The order stays `pending` until every
 * line is fully received, becomes `partial` while some remain, then `received`.
 * Stock-in only covers the received quantity, and the cost price update uses
 * the received cost.
 */
export function receivePurchaseOrder(id: number, lines?: { product_id: number; qty: number }[]): PurchaseOrder {
  const db = getDb();
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'pending' && po.status !== 'partial') throw new Error(`Order already ${po.status}`);

  // Work out how much to receive per line (default: everything outstanding).
  const wanted = new Map<number, number>();
  for (const l of lines ?? []) {
    const qty = Number(l.qty) || 0;
    if (qty > 0) wanted.set(l.product_id, (wanted.get(l.product_id) ?? 0) + qty);
  }
  const plan: { item: PurchaseItem & { received_qty?: number | null }; qty: number }[] = [];
  for (const it of po.items) {
    const already = Number(it.received_qty) || 0;
    const outstanding = round2(Number(it.qty) - already);
    if (outstanding <= 0) continue;
    const want = lines ? wanted.get(it.product_id) ?? 0 : outstanding;
    const qty = round2(Math.min(want, outstanding));
    if (qty > 0) plan.push({ item: it, qty });
  }
  if (!plan.length) throw new Error('Nothing to receive');

  const nowIso = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const p of plan) {
      const it = p.item;
      const batchNumber = it.batch_no || `PO-${id}-${it.product_id}-${Date.now()}`;
      createBatch(it.product_id, batchNumber, p.qty, it.unit_cost, it.expiry_date ?? null);

      // Update product cost price + price history for the received cost
      db.prepare('UPDATE products SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        it.unit_cost,
        it.product_id
      );
      db.prepare(
        'INSERT INTO purchase_price_history (product_id, unit_cost, purchase_order_id) VALUES (?, ?, ?)'
      ).run(it.product_id, it.unit_cost, id);
      // Stock-in: batch already holds the qty, so recordMovement must NOT be given a batchId
      // (it would add the qty to the batch a second time). It updates product stock + movement log.
      recordMovement(it.product_id, p.qty, 'Purchase stock-in', 'purchase', id);
      db.prepare('UPDATE purchase_items SET received_qty = COALESCE(received_qty, 0) + ? WHERE id = ?').run(
        p.qty,
        it.id
      );
    }
    const rows = db
      .prepare('SELECT qty, COALESCE(received_qty, 0) AS received_qty FROM purchase_items WHERE purchase_order_id = ?')
      .all(id) as { qty: number; received_qty: number }[];
    const fullyReceived = rows.every((r) => Number(r.received_qty) >= Number(r.qty) - 1e-9);
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(fullyReceived ? 'received' : 'partial', id);
    db.exec('COMMIT');
    logActivity(
      'purchase_received',
      'purchase_order',
      id,
      `stock-in applied, ${plan.length} line(s), status=${fullyReceived ? 'received' : 'partial'}, at=${nowIso}`
    );
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