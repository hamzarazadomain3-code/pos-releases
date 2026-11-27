import { getDb } from '../db';
import { getProduct, recordMovement, addToBatch as createBatchOrAdd } from './inventory';
import { logActivity } from './activity';
import { currentShift } from './shifts';
import { can, getSessionUserId } from './auth';
import {
  baseQty,
  computeTotals,
  costPerBaseUnit,
  lineTotal,
  round2,
  safeNumber,
  unitsInBase,
  validatePo,
  VALIDATION_MESSAGES,
} from '../../shared/purchaseCalc';
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
  /** How many base units ONE purchase unit holds (1 = the piece / kg). */
  units_in_base?: number | null;
  /** The name of the purchase unit, e.g. "box". */
  unit_name?: string | null;
}

export interface PurchaseOrderOptions {
  /** 'purchase_order' (stock later, via receive) or 'purchase_invoice' (stock now). */
  document_type?: 'purchase_order' | 'purchase_invoice';
  reference_no?: string | null;
  invoice_date?: string | null;
  import_id?: number | null;
  /**
   * The status of the new order.
   *   - 'draft'   — a saved draft; it costs nothing and touches no stock,
   *   - 'ordered' — the order was created; it waits for the goods,
   *   - 'pending' — the LEGACY name of 'ordered' (the import path still uses
   *     it, and old rows keep it). Both names mean "open".
   */
  status?: 'draft' | 'ordered' | 'pending';
  /** The expected delivery date (the `delivery_date` column). */
  expected_date?: string | null;
  /** The order's note. */
  notes?: string | null;
  /** A discount on the whole order: an amount or a percent. */
  discount_type?: 'amount' | 'percent';
  discount_value?: number;
  /** Freight / other charges. */
  freight?: number;
  /** What was paid right now (cash or bank). */
  paid_amount?: number;
  /** How the paid amount was paid. */
  payment_method?: 'cash' | 'bank' | null;
}

/** The statuses that mean "the order is still open". */
export function isOpenPurchaseStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'pending' || s === 'ordered' || s === 'draft' || s === 'partial';
}

/**
 * Phase 3, item 5 — the purchases screen is a MANAGER screen, so the SERVICE
 * enforces it.
 *
 * Before this the rule lived ONLY in the sidebar (`minRole: 'manager'`): a
 * cashier could not see the Purchases page, but the IPC handlers were still
 * open, so anyone with a dev-tools console could create a purchase order, put
 * stock on the shelf or cancel an order. The role check now lives where the
 * money moves — in the service — and it reads the SAME role map the menu
 * reads (`src/shared/roles.ts`).
 */
export function requirePurchasePermission(action = 'manage purchases'): void {
  if (!can('manager')) {
    throw new Error(`You do not have permission to ${action}.`);
  }
}

/** The branch the till is on right now (null when the shop has no branches). */
function currentBranchId(): number | null {
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

/**
 * The received quantity of a purchase line — the LEGACY counter included.
 *
 * Phase 3, item 8 — `received_qty` (migration 064) and `quantity_received`
 * (migration 024) are the same number in two columns. Rows written before
 * migration 064 carry the truth only in the LEGACY column, so a plain
 * `COALESCE(received_qty, quantity_received)` would read 0 for them (the new
 * column exists and is 0 — it is not NULL) and the shop would be told that
 * nothing had been received while the goods were on the shelf.
 *
 * The rule is the same everywhere: the NEW counter wins whenever it holds a
 * number; the legacy one fills in only when the new one is still empty.
 */
export const RECEIVED_QTY_SQL = `CASE
      WHEN COALESCE(received_qty, 0) = 0 AND COALESCE(quantity_received, 0) > 0
        THEN quantity_received
      ELSE COALESCE(received_qty, 0)
    END`;

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

/**
 * Line total including the import's discount/tax percentages (no NaN).
 *
 * The maths lives in the shared pure module, so the PO screen, the import
 * wizard and this service can never disagree — and the legacy rounding (once,
 * at the end of the line) is kept, so an imported invoice totals exactly what
 * it totals today.
 */
export function purchaseLineTotal(it: PurchaseLineInput): number {
  return lineTotal({
    qty: it.qty,
    unit_cost: it.unit_cost,
    units_in_base: it.units_in_base,
    discount_pct: it.discount_pct,
    tax_pct: it.tax_pct,
  });
}

/**
 * Insert the purchase document + items + supplier ledger row.
 * The CALLER owns the transaction (imports wrap several writes in ONE tx).
 *
 * The money comes from the shared pure module (`computeTotals`), so the
 * number the PO screen showed is the number that is stored. A DRAFT costs
 * nothing: it does not touch the supplier's balance and it writes no ledger
 * row — a draft is a note, not a debt.
 */
export function insertPurchaseOrderCore(
  supplierId: number,
  items: PurchaseLineInput[],
  opts: PurchaseOrderOptions = {}
): { id: number; total: number } {
  const db = getDb();
  if (!items.length) throw new Error('Purchase order has no items');
  for (const it of items) {
    if (!Number.isFinite(Number(it.qty)) || !Number.isFinite(Number(it.unit_cost))) {
      throw new Error('Quantity and unit cost must be valid numbers');
    }
    if (!(Number(it.qty) > 0)) throw new Error('Quantity must be positive');
    if (Number(it.unit_cost) < 0) throw new Error('Unit cost cannot be negative');
    // Phase 3, item 6 — the tax on a line can never be negative. A negative
    // tax is a silent discount the shop never asked for.
    if (Number(it.tax_pct ?? 0) < 0) throw new Error('Tax cannot be negative');
    if (Number(it.discount_pct ?? 0) < 0 || Number(it.discount_pct ?? 0) > 100) {
      throw new Error('Line discount must be between 0 and 100 percent');
    }
    if (!getProduct(it.product_id)) throw new Error(`Product ${it.product_id} not found`);
  }
  // Phase 3, item 6 — the header money is validated by the SAME rules the
  // screen shows (`validatePo` in the shared pure module), so a service call
  // can never store an order the screen would refuse.
  const headerCheck = validatePo({
    supplierId,
    lines: items.map((i) => ({
      product_id: i.product_id,
      qty: i.qty,
      unit_cost: i.unit_cost,
      units_in_base: i.units_in_base,
      discount_pct: i.discount_pct,
      tax_pct: i.tax_pct,
    })),
    discount_type: opts.discount_type,
    discount_value: opts.discount_value,
    freight: opts.freight,
    paid_amount: opts.status === 'draft' ? 0 : opts.paid_amount,
  });
  if (!headerCheck.ok) {
    // The duplicate-product rule is a SCREEN rule (the screen merges the two
    // lines for the owner); the service accepts them because a line may
    // legitimately be split by batch.
    const blocking = headerCheck.errors.filter((e) => e !== 'duplicate_product');
    if (blocking.length) {
      throw new Error(blocking.map((e) => VALIDATION_MESSAGES[e]).join(' '));
    }
  }
  const docType = opts.document_type === 'purchase_invoice' ? 'purchase_invoice' : 'purchase_order';
  const isDraft = opts.status === 'draft';
  const status = isDraft ? 'draft' : opts.status === 'ordered' ? 'ordered' : 'pending';
  // The totals: the same pure maths the PO screen shows.
  const totals = computeTotals({
    lines: items.map((i) => ({
      qty: i.qty,
      unit_cost: i.unit_cost,
      units_in_base: i.units_in_base,
      discount_pct: i.discount_pct,
      tax_pct: i.tax_pct,
    })),
    discount_type: opts.discount_type,
    discount_value: opts.discount_value,
    freight: opts.freight,
    paid_amount: isDraft ? 0 : opts.paid_amount,
  });
  const total = isDraft ? 0 : totals.grandTotal;
  const paid = isDraft ? 0 : totals.paid;

  const info = db
    .prepare(
      `INSERT INTO purchase_orders
         (supplier_id, status, total_amount, reference_no, document_type, import_id, invoice_date,
          delivery_date, notes, subtotal, tax_total, discount_type, discount_value, discount_amount,
          freight, paid_amount, payment_method, branch_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(
      supplierId,
      status,
      total,
      opts.reference_no ?? null,
      docType,
      opts.import_id ?? null,
      opts.invoice_date ?? null,
      opts.expected_date ?? null,
      opts.notes ?? null,
      isDraft ? 0 : totals.subtotal,
      isDraft ? 0 : totals.tax,
      opts.discount_type ?? 'amount',
      isDraft ? 0 : safeNumber(opts.discount_value, 0),
      isDraft ? 0 : totals.discount,
      isDraft ? 0 : totals.freight,
      paid,
      opts.payment_method ?? null,
      // Phase 3, item 9 — the branch the order was made at. The column
      // existed (migration 038) but was never written, so every PO looked
      // like it belonged to no branch.
      currentBranchId()
    );
  const poId = Number(info.lastInsertRowid);
  // Phase 1, item 1.10 — the line snapshot is COMPLETE.
  //
  // It used to write `batch_no` + `received_qty` only. Three things were lost:
  //   - `unit_name` — the printed order and the purchase history showed no unit;
  //   - `total_cost` — every report had to recompute the line money;
  //   - `batch_number` + `quantity_received` — the LEGACY twins of the two
  //     columns above. The expiry alert (`alertService.checkExpiry`) reads
  //     `quantity_received` and `batch_number`, so every purchase made through
  //     this path was invisible to the "this batch expires soon" alert.
  const insItem = db.prepare(
    `INSERT INTO purchase_items
       (purchase_order_id, product_id, qty, unit_cost, unit_name, total_cost,
        batch_no, batch_number, expiry_date, discount_pct, tax_pct,
        received_qty, quantity_received, sale_price, wholesale_price, unit_multiplier, base_qty, cost_per_base,
        branch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`
  );
  const branchId = currentBranchId();
  for (const it of items) {
    const multiplier = unitsInBase(it.units_in_base);
    const qty = round2(safeNumber(it.qty, 0));
    const unitCost = round2(safeNumber(it.unit_cost, 0));
    const batchNo = it.batch_no ?? null;
    insItem.run(
      poId,
      it.product_id,
      qty,
      unitCost,
      it.unit_name ?? null,
      round2(qty * unitCost),
      batchNo,
      batchNo,
      it.expiry_date ?? null,
      Number(it.discount_pct) || 0,
      Number(it.tax_pct) || 0,
      it.sale_price ?? null,
      it.wholesale_price ?? null,
      multiplier,
      baseQty(qty, multiplier),
      costPerBaseUnit(unitCost, multiplier),
      branchId
    );
  }
  if (isDraft) return { id: poId, total };

  // The supplier owes the order total. A "paid now" amount is a SECOND ledger
  // row (the payment) that comes off the balance — the caller adds it.
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
  // Phase 3, item 5 — the permission is checked in the SERVICE.
  requirePurchasePermission('create a purchase order');
  const db = getDb();
  db.exec('BEGIN');
  try {
    const { id: poId, total } = insertPurchaseOrderCore(supplierId, items, opts);
    // The "paid now" money: the SAME supplier payment the supplier ledger
    // already knows, tied to the OPEN shift when it was cash.
    let shiftId: number | null = null;
    const paid = safeNumber(opts.paid_amount, 0);
    if (opts.status !== 'draft' && paid > 0) {
      const method = opts.payment_method === 'bank' ? 'bank' : 'cash';
      if (method === 'cash') {
        const shift = currentShift();
        if (!shift) throw new Error('Open a shift before paying a supplier in cash');
        shiftId = shift.id;
      }
      db.prepare(
        'INSERT INTO supplier_transactions (supplier_id, amount, type, purchase_order_id, shift_id) VALUES (?, ?, ?, ?, ?)'
      ).run(supplierId, -paid, `payment:${method}`, poId, shiftId);
      db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(paid, supplierId);
    }
    db.exec('COMMIT');
    const docType = opts.document_type === 'purchase_invoice' ? 'purchase_invoice' : 'purchase_order';
    logActivity(
      'purchase_created',
      'purchase_order',
      poId,
      `supplier=${supplierId} | total=${total} | type=${docType} | status=${opts.status ?? 'pending'}`
    );
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
      `SELECT i.*,
              ${RECEIVED_QTY_SQL} AS received_qty,
              pr.name AS product_name
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
    if (status === 'ordered') {
      // `ordered` is the current name of the legacy `pending` — the filter
      // shows BOTH, so an old order is never lost from the list.
      sql += " AND p.status IN ('ordered', 'pending')";
    } else {
      sql += ' AND p.status = ?';
      params.push(status);
    }
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
 * remaining (the historical behaviour). The order stays open (`pending` /
 * `ordered`) until every line is fully received, becomes `partial` while some
 * remain, then `received`.
 *
 * The stock-in is in BASE units: a line ordered in boxes adds
 * boxes × quantity_in_base_units pieces, and the batch carries the cost of ONE
 * base unit. The cost price follows the shop's costing setting.
 */
/**
 * Receive a purchase order (fully or partially).
 *
 * Phase 3, item 3 — the receipt is addressed to a LINE (`item_id`), never to
 * a product.
 *
 * The old code aggregated the requested quantities into a `Map<product_id, …>`
 * and then read that map for EVERY line of the product. An order with TWO
 * lines of the same product (two batches, two prices) therefore received the
 * requested amount TWICE — the shop got more stock than it paid for, and the
 * order closed as fully received while the second line was never touched.
 * `item_id` addresses the exact line; the product id is still accepted for the
 * old callers, but then it is applied to the FIRST outstanding line only.
 */
export function receivePurchaseOrder(
  id: number,
  lines?: { item_id?: number; product_id?: number; qty: number }[]
): PurchaseOrder {
  // Phase 3, item 5 — the permission is checked in the SERVICE.
  requirePurchasePermission('receive a purchase order');
  const db = getDb();
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'pending' && po.status !== 'ordered' && po.status !== 'partial') {
    throw new Error(`Order already ${po.status}`);
  }

  // How much to receive per LINE (the line id is the key).
  const wanted = new Map<number, number>();
  for (const l of lines ?? []) {
    const qty = Number(l.qty) || 0;
    if (qty <= 0) continue;
    const lineId = Number(l.item_id);
    if (Number.isFinite(lineId) && lineId > 0) {
      wanted.set(lineId, (wanted.get(lineId) ?? 0) + qty);
      continue;
    }
    // The legacy shape (product id only): the FIRST outstanding line of that
    // product takes the quantity — never every line of the same product.
    const pid = Number(l.product_id) || 0;
    if (!pid) continue;
    const first = po.items.find(
      (it) =>
        it.product_id === pid &&
        round2(Number(it.qty) - (Number(it.received_qty) || 0)) > 0 &&
        !wanted.has(it.id)
    );
    if (first) wanted.set(first.id, (wanted.get(first.id) ?? 0) + qty);
  }
  const plan: { item: PurchaseItem & { received_qty?: number | null }; qty: number }[] = [];
  for (const it of po.items) {
    const already = Number(it.received_qty) || 0;
    const outstanding = round2(Number(it.qty) - already);
    if (outstanding <= 0) continue;
    const want = lines ? wanted.get(it.id) ?? 0 : outstanding;
    const qty = round2(Math.min(want, outstanding));
    if (qty > 0) plan.push({ item: it, qty });
  }
  if (!plan.length) throw new Error('Nothing to receive');

  const nowIso = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const p of plan) {
      const it = p.item;
      // Phase 3, item 12 — the batch number is UNIQUE per line. The old code
      // built it from the product id + a timestamp, so two lines of the SAME
      // product received in the same millisecond shared a batch number and
      // the FIFO report merged them.
      const batchNumber =
        it.batch_no || `PO-${id}-${it.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      // The stock is kept in BASE units (the piece / kg). A line ordered in
      // boxes puts BOXES × quantity_in_base_units into the stock — 2 boxes of
      // 12 must add 24 pieces, never 2.
      const multiplier = unitsInBase((it as { unit_multiplier?: number | null }).unit_multiplier);
      const baseReceived = baseQty(p.qty, multiplier);
      // The batch carries the BASE quantity at the cost of ONE base unit, so
      // the FIFO report and the cost of goods sold stay right.
      const costPerBase = costPerBaseUnit(it.unit_cost, multiplier);
      createBatchOrAdd(it.product_id, batchNumber, baseReceived, costPerBase, it.expiry_date ?? null);

      // The product's cost price + the price history follow the shop's costing
      // setting. The history ALWAYS records the received cost (that is the
      // "last purchase cost" the PO screen compares against).
      const updateCost = poCostingUpdatesCostPrice();
      if (updateCost) {
        db.prepare('UPDATE products SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          costPerBase,
          it.product_id
        );
      }
      db.prepare(
        'INSERT INTO purchase_price_history (product_id, unit_cost, purchase_order_id) VALUES (?, ?, ?)'
      ).run(it.product_id, costPerBase, id);
      // The last supplier of the product.
      db.prepare('UPDATE products SET last_supplier_id = ? WHERE id = ?').run(po.supplier_id, it.product_id);
      // Stock-in: batch already holds the qty, so recordMovement must NOT be given a batchId
      // (it would add the qty to the batch a second time). It updates product stock + movement log.
      recordMovement(it.product_id, baseReceived, 'Purchase stock-in', 'purchase', id);
      db.prepare('UPDATE purchase_items SET received_qty = COALESCE(received_qty, 0) + ?, quantity_received = COALESCE(quantity_received, 0) + ? WHERE id = ?').run(
        p.qty,
        p.qty,
        it.id
      );
    }
    const rows = db
      .prepare('SELECT qty, COALESCE(received_qty, 0) AS received_qty FROM purchase_items WHERE purchase_order_id = ?')
      .all(id) as { qty: number; received_qty: number }[];
    const fullyReceived = rows.every((r) => Number(r.received_qty) >= Number(r.qty) - 1e-9);
    // Phase 3, item 9 — the order's `updated_at` moves with its status.
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      fullyReceived ? 'received' : 'partial',
      id
    );
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

/**
 * Cancel an order.
 *
 * A cancelled order NEVER touches the stock (it never received anything) and
 * it never changes a batch. What it reverses is the SUPPLIER's balance: the
 * part of the order that was still payable. A "paid now" amount is NOT
 * reversed here — it stays as the shop's credit with that supplier (the owner
 * takes it back or uses it on the next order), so the ledger stays honest.
 */
export function cancelPurchaseOrder(id: number, reason?: string): boolean {
  // Phase 3, item 5 — the permission is checked in the SERVICE.
  requirePurchasePermission('cancel a purchase order');
  const db = getDb();
  const po = getPurchaseOrder(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'pending' && po.status !== 'ordered' && po.status !== 'draft') {
    throw new Error(`Only an open order can be cancelled (this one is ${po.status})`);
  }
  // Phase 3, item 7 — the status alone is NOT enough.
  //
  // A legacy row can carry a status of 'ordered' while its lines were already
  // received. Cancelling it then reversed the payable while the stock stayed
  // in the shop: the supplier's ledger said the goods were never bought, but
  // the shelf said they were. The received quantity is the truth.
  const receivedRow = db
    .prepare(
      `SELECT COALESCE(SUM(${RECEIVED_QTY_SQL}), 0) AS received FROM purchase_items WHERE purchase_order_id = ?`
    )
    .get(id) as { received?: number } | undefined;
  const received = Number(receivedRow?.received) || 0;
  if (received > 0) {
    throw new Error(
      `This order already received ${received} — reverse the receipt first, then cancel the rest.`
    );
  }
  const paid = safeNumber((po as { paid_amount?: number | null }).paid_amount, 0);
  const payable = Math.max(0, round2(safeNumber(po.total_amount, 0) - paid));

  db.exec('BEGIN');
  try {
    db.prepare(
      "UPDATE purchase_orders SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(reason?.trim() || null, id);
    if (payable > 0) {
      db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(payable, po.supplier_id);
      db.prepare(
        'INSERT INTO supplier_transactions (supplier_id, purchase_order_id, amount, type) VALUES (?, ?, ?, ?)'
      ).run(po.supplier_id, id, -payable, 'purchase_cancelled');
    }
    db.exec('COMMIT');
    logActivity(
      'purchase_cancelled',
      'purchase_order',
      id,
      `supplier=${po.supplier_id} | payable=${payable} | reason=${reason?.trim() || '-'}`
    );
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
  // Phase 3, item 5 — the permission is checked in the SERVICE.
  requirePurchasePermission('pay a supplier');
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

/* ═══════════════════════════════════════════════════════════════════════════
   The Purchase Order screen — the LIVE inventory master data.

   The rule of this screen: it READS the inventory master data, it never
   copies it. Everything below is a query against the products / units /
   purchases tables, so whatever the shop changed in Inventory shows up here
   the moment the row is drawn.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read a PO setting.
 *
 * The SHOP PROFILE first (the Settings > Inventory/Purchases rows write
 * there), the admin table as a fallback, and the caller's default last.
 */
export function poSetting(key: string, fallback: string): string {
  const db = getDb();
  for (const table of ['settings', 'admin_settings']) {
    try {
      const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key) as
        | { value: string | null }
        | undefined;
      const value = row?.value;
      if (value !== undefined && value !== null && String(value) !== '') return String(value);
    } catch {
      /* the table may not exist in an old database */
    }
  }
  return fallback;
}

/** The cost-change warning threshold, in percent (default 10). */
export function poCostChangeWarnPct(): number {
  const n = Number(poSetting('po_cost_change_warn_pct', '10'));
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/** The minimum margin a row must keep (0 = off). */
export function poMinMarginPct(): number {
  const n = Number(poSetting('po_min_margin_pct', '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Should the PO offer the low-stock items when it opens? */
export function poAutoSuggestLowStock(): boolean {
  return poSetting('po_auto_suggest_low_stock', '1') !== '0';
}

/** The default "paid now" method. */
export function poDefaultPaymentMethod(): 'cash' | 'bank' {
  return poSetting('po_default_payment_method', 'cash') === 'bank' ? 'bank' : 'cash';
}

/** Does receiving an order update the product's own `cost_price`? */
export function poCostingUpdatesCostPrice(): boolean {
  return poSetting('po_update_cost_price', '1') !== '0';
}

export interface PurchaseProductUnit {
  id: number;
  product_id: number;
  level: number;
  name: string;
  quantity_in_base_units: number;
  barcode: string | null;
  price: number | null;
  is_base: boolean;
}

export interface PurchaseProductRow {
  product_id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock_qty: number;
  min_stock_level: number;
  low_stock_threshold: number;
  reorder_qty: number | null;
  cost_price: number;
  sale_price: number;
  wholesale_price: number | null;
  tax_rate: number;
  is_loose: number | null;
  batch_no: string | null;
  expiry_date: string | null;
  /** The supplier the shop buys this product from (the product's own field). */
  last_supplier_id: number | null;
  last_supplier_name: string | null;
  /** The cost of the LAST purchase of this product (the warning baseline). */
  last_purchase_cost: number | null;
  last_purchase_at: string | null;
  /** The purchase units (piece / box / carton). */
  units: PurchaseProductUnit[];
}

const PRODUCT_ROW_SQL = `
  SELECT p.id AS product_id, p.name, p.sku, p.barcode,
         COALESCE(p.stock_qty, 0) AS stock_qty,
         COALESCE(p.min_stock_level, 0) AS min_stock_level,
         COALESCE(p.low_stock_threshold, 0) AS low_stock_threshold,
         p.reorder_qty,
         COALESCE(p.cost_price, 0) AS cost_price,
         COALESCE(p.sale_price, 0) AS sale_price,
         p.wholesale_price,
         COALESCE(p.tax_rate, 0) AS tax_rate,
         p.is_loose, p.batch_no, p.expiry_date,
         p.last_supplier_id,
         (SELECT s.name FROM suppliers s WHERE s.id = p.last_supplier_id) AS last_supplier_name,
         (SELECT h.unit_cost FROM purchase_price_history h
           WHERE h.product_id = p.id ORDER BY h.id DESC LIMIT 1) AS last_purchase_cost,
         (SELECT h.created_at FROM purchase_price_history h
           WHERE h.product_id = p.id ORDER BY h.id DESC LIMIT 1) AS last_purchase_at
  FROM products p
`;

function unitsOf(db: ReturnType<typeof getDb>, productId: number): PurchaseProductUnit[] {
  return db
    .prepare(
      `SELECT id, product_id, level, name, quantity_in_base_units, barcode, price, is_base
       FROM product_units WHERE product_id = ?
       ORDER BY level, id`
    )
    .all(productId) as unknown as PurchaseProductUnit[];
}

/** The LIVE inventory data of ONE product, for one PO row. */
export function purchaseProductRow(productId: number): PurchaseProductRow | null {
  const db = getDb();
  const row = db.prepare(`${PRODUCT_ROW_SQL} WHERE p.id = ?`).get(productId) as unknown as PurchaseProductRow | undefined;
  if (!row) return null;
  return { ...row, units: unitsOf(db, productId) };
}

/**
 * The products that are LOW on stock — the "Add low-stock items" list.
 *
 * The reorder level is the product's own `min_stock_level` when it has one,
 * the legacy `low_stock_threshold` otherwise.
 */
export function listLowStockPurchaseProducts(limit = 100): PurchaseProductRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `${PRODUCT_ROW_SQL}
       WHERE p.active = 1
         AND COALESCE(p.is_test, 0) = 0
         AND (CASE WHEN COALESCE(p.min_stock_level, 0) > 0
                   THEN p.min_stock_level
                   ELSE COALESCE(p.low_stock_threshold, 0) END) > 0
         AND COALESCE(p.stock_qty, 0) <= (CASE WHEN COALESCE(p.min_stock_level, 0) > 0
                                                THEN p.min_stock_level
                                                ELSE COALESCE(p.low_stock_threshold, 0) END)
       ORDER BY p.name COLLATE NOCASE
       LIMIT ?`
    )
    .all(limit) as unknown as PurchaseProductRow[];
  return rows.map((r) => ({ ...r, units: unitsOf(db, r.product_id) }));
}

/**
 * The products the shop buys from ONE supplier — the "Add this supplier's
 * products" list. The link is the product's own `last_supplier_id`, the same
 * field the product form shows.
 */
export function listSupplierPurchaseProducts(supplierId: number, limit = 200): PurchaseProductRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `${PRODUCT_ROW_SQL}
       WHERE p.active = 1
         AND COALESCE(p.is_test, 0) = 0
         AND p.last_supplier_id = ?
       ORDER BY p.name COLLATE NOCASE
       LIMIT ?`
    )
    .all(supplierId, limit) as unknown as PurchaseProductRow[];
  return rows.map((r) => ({ ...r, units: unitsOf(db, r.product_id) }));
}

export interface LastPurchaseInfo {
  /** The cost of the last purchase (per BASE unit). */
  last_cost: number | null;
  /** The supplier of that purchase. */
  last_supplier_id: number | null;
  last_supplier_name: string | null;
  /** When it was received. */
  last_received_at: string | null;
}

/**
 * The last purchase of a product — the read-only block the product form
 * shows ("Last purchase cost / last supplier / last received date").
 */
export function lastPurchaseInfo(productId: number): LastPurchaseInfo {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT h.unit_cost, h.created_at, po.supplier_id, s.name AS supplier_name
       FROM purchase_price_history h
       LEFT JOIN purchase_orders po ON po.id = h.purchase_order_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE h.product_id = ?
       ORDER BY h.id DESC LIMIT 1`
    )
    .get(productId) as
    | { unit_cost: number; created_at: string | null; supplier_id: number | null; supplier_name: string | null }
    | undefined;
  if (!row) return { last_cost: null, last_supplier_id: null, last_supplier_name: null, last_received_at: null };
  return {
    last_cost: safeNumber(row.unit_cost, 0),
    last_supplier_id: row.supplier_id ?? null,
    last_supplier_name: row.supplier_name ?? null,
    last_received_at: row.created_at ?? null,
  };
}