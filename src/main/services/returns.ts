import { getDb } from '../db';
import { recordMovement, roundStock } from './inventory';
import { logActivity } from './activity';
import { getSale } from './sales';
import { currentShift } from './shifts';
import { can, getSessionUserId } from './auth';
import { getAdminSetting } from './admin';
import type { CashRefundRow, ReturnItemRow, ReturnRow } from '../../shared/types';

export interface ReturnInputItem {
  sale_item_id: number;
  qty: number;
  unit_price: number;
}

/** A return line resolved to a real sale-item row, ready to be written. */
interface ResolvedReturnLine {
  sale_item_id: number;
  product_id: number;
  qty: number;
  unit_price: number;
  batch_id?: number | null;
}

/** One cart line the Billing "Return / Refund" flow sends (no invoice required). */
export interface ReturnBillItemInput {
  product_id: number;
  qty: number;
  unit_price: number;
}

export interface ReturnBillInput {
  items: ReturnBillItemInput[];
  customer_id?: number | null;
  reason?: string;
  note?: string;
  /** 'cash' | 'credit' | any configured payment mode. Defaults to 'cash'. */
  refund_mode: string;
  restock: boolean;
  /** Optional original invoice the return is being filed against. */
  linked_sale_id?: number | null;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** `RET-YYYYMMDD-NNNN` — a return bill never collides with an `INV-` bill. */
function nextReturnInvoiceNo(db: ReturnType<typeof getDb>): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const prefix = `RET-${stamp}-`;
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM sales WHERE invoice_no LIKE ?')
    .get(`${prefix}%`) as { c: number };
  return `${prefix}${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

/**
 * Put a returned line back on the shelf. Batch-tracked lines go back to their
 * original batch; legacy lines go through `recordMovement`.
 */
function restockLine(db: ReturnType<typeof getDb>, line: ResolvedReturnLine, returnId: number): void {
  if (line.batch_id) {
    db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?').run(
      roundStock(line.qty),
      line.batch_id
    );
    db.prepare(
      'UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(roundStock(line.qty), line.product_id);
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(line.product_id, roundStock(line.qty), 'Returned to stock', 'return', returnId, line.batch_id);
  } else {
    recordMovement(line.product_id, line.qty, 'Returned to stock', 'return', returnId);
  }
}

/**
 * The one place a `returns` row (and its `return_items` + stock + ledger side
 * effects) is written. Both the invoice-based flow (`createReturn`) and the
 * Billing cart flow (`createReturnBill`) go through here, so the two can never
 * drift apart. The CALLER owns the transaction.
 */
function writeReturn(
  db: ReturnType<typeof getDb>,
  args: {
    saleId: number;
    lines: ResolvedReturnLine[];
    refund: number;
    reason?: string | null;
    refundMode: string;
    restock: boolean;
    /** Credit the customer ledger by this much (credit refunds / overpayment). */
    credit: { customerId: number; amount: number } | null;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO returns (sale_id, reason, refund_amount, refund_mode, restock)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(args.saleId, args.reason?.trim() || null, args.refund, args.refundMode, args.restock ? 1 : 0);
  const returnId = Number(info.lastInsertRowid);

  const insItem = db.prepare(
    `INSERT INTO return_items (return_id, sale_item_id, product_id, qty, unit_price)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const line of args.lines) {
    insItem.run(returnId, line.sale_item_id, line.product_id, line.qty, line.unit_price);
    if (args.restock) restockLine(db, line, returnId);
  }

  if (args.credit && args.credit.amount > 0) {
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(
      args.credit.amount,
      args.credit.customerId
    );
    db.prepare(
      'INSERT INTO customer_transactions (customer_id, sale_id, amount, type) VALUES (?, ?, ?, ?)'
    ).run(args.credit.customerId, args.saleId, -args.credit.amount, 'return');
  }

  return returnId;
}

export function createReturn(input: {
  sale_id: number;
  items: ReturnInputItem[];
  reason?: string;
  refund_mode: 'cash' | 'credit';
  restock: boolean;
}): ReturnRow & { items: ReturnItemRow[] } {
  const db = getDb();
  const sale = getSale(input.sale_id);
  if (!sale) throw new Error('Sale not found');
  if (sale.status !== 'completed') throw new Error('Only completed sales can have returns');

  const valid = input.items.filter((i) => i.qty > 0);
  if (!valid.length) throw new Error('Select at least one item to return');

  let refund = 0;
  const lines: ResolvedReturnLine[] = [];
  for (const it of valid) {
    const si = sale.items.find((i) => i.id === it.sale_item_id);
    if (!si) throw new Error('Sale item not found');
    const remaining = si.qty - (si.returned_qty ?? 0);
    if (it.qty > remaining)
      throw new Error(`Only ${remaining} returnable for this item (already returned ${si.returned_qty ?? 0})`);
    if (it.unit_price < 0) throw new Error('Unit price cannot be negative');
    refund += it.qty * it.unit_price;
    lines.push({
      sale_item_id: si.id,
      product_id: si.product_id,
      qty: it.qty,
      unit_price: it.unit_price,
      batch_id: (si as unknown as { batch_id?: number | null }).batch_id ?? null,
    });
  }
  const unrefunded = sale.total_amount - (sale.returned_amount ?? 0);
  if (refund > unrefunded)
    throw new Error(`Refund (${refund.toFixed(2)}) exceeds unrefunded sale amount (${unrefunded.toFixed(2)})`);

  const paid = sale.payments.reduce((s, p) => s + p.amount, 0);

  let creditAmount = 0;
  if (sale.customer_id) {
    if (input.refund_mode === 'credit') creditAmount = refund;
    else if (refund > paid) creditAmount = refund - paid;
  }

  db.exec('BEGIN');
  try {
    const returnId = writeReturn(db, {
      saleId: input.sale_id,
      lines,
      refund,
      reason: input.reason,
      refundMode: input.refund_mode,
      restock: input.restock,
      credit:
        sale.customer_id && creditAmount > 0
          ? { customerId: sale.customer_id, amount: creditAmount }
          : null,
    });

    for (const line of lines) {
      db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(
        roundStock(line.qty),
        line.sale_item_id
      );
    }
    db.prepare('UPDATE sales SET returned_amount = returned_amount + ? WHERE id = ?').run(
      refund,
      input.sale_id
    );

    db.exec('COMMIT');
    logActivity(
      'return_created',
      'return',
      returnId,
      `${sale.invoice_no} | refund=${refund} | mode=${input.refund_mode} | restock=${input.restock}${
        input.reason ? ' | ' + input.reason : ''
      }`
    );
    return getReturn(returnId)!;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Billing's "Return / Refund" — converts the CURRENT cart into a return bill
 * without leaving the till screen.
 *
 * The cart is not tied to a completed sale, so the return is recorded as its
 * own **negative sale** (`status = 'returned'`, `total_amount < 0`). Reports,
 * dashboards and the cash drawer all filter `status = 'completed'`, so it stays
 * out of every revenue figure — the cash-out is picked up by the `returns` row
 * that `shiftTotals()` joins on `shift_id` (exactly how an invoice return is
 * counted), and stock/ledger/audit go through the same shared core the Returns
 * page uses.
 */
export function createReturnBill(input: ReturnBillInput): ReturnRow & { items: ReturnItemRow[] } {
  const db = getDb();

  const items = (input.items ?? []).filter((i) => i && i.product_id && Number(i.qty) > 0);
  if (!items.length) throw new Error('Add at least one item to return');

  let refund = 0;
  for (const it of items) {
    if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0)
      throw new Error('Return quantity must be a positive number');
    if (!Number.isFinite(Number(it.unit_price)) || Number(it.unit_price) < 0)
      throw new Error('Unit price cannot be negative');
    refund += Number(it.qty) * Number(it.unit_price);
  }
  refund = round2(refund);
  if (refund <= 0) throw new Error('Refund amount must be greater than zero');

  // Role permission: a refund above the configured amount needs a manager.
  const threshold = Number(getAdminSetting('refund_manager_threshold') ?? 0) || 0;
  if (threshold > 0 && refund > threshold && !can('manager')) {
    throw new Error(
      `Refunds above ${threshold} need a manager — sign in as a manager or ask one to approve`
    );
  }

  const mode = String(input.refund_mode || 'cash').toLowerCase();
  const restock = input.restock !== false;
  const reason = input.reason?.trim() || null;
  const note = input.note?.trim() || null;
  const customerId = input.customer_id ?? null;

  // The cash drawer must be open to refund: an invoice return inherits the
  // original sale's shift, but a cart return has no shift of its own.
  const shift = currentShift();
  if (!shift) throw new Error('Open a shift before issuing a refund');

  const userId = getSessionUserId() ?? 1;

  db.exec('BEGIN');
  try {
    const invoiceNo = nextReturnInvoiceNo(db);
    const nowIso = new Date().toISOString();
    const noteText =
      note ??
      (input.linked_sale_id ? `Return against sale #${input.linked_sale_id}` : null);

    const saleInfo = db
      .prepare(
        `INSERT INTO sales (invoice_no, customer_id, user_id, shift_id, subtotal, tax_amount, discount_amount, total_amount, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'returned', ?, ?)`
      )
      .run(invoiceNo, customerId, userId, shift.id, -refund, -refund, noteText, nowIso);
    const returnSaleId = Number(saleInfo.lastInsertRowid);

    // A payment equal to the (negative) total keeps the printed receipt's
    // CHANGE/BALANCE maths at zero. Excluded from every report because the sale
    // is 'returned', not 'completed'.
    db.prepare('INSERT INTO payments (sale_id, mode, amount) VALUES (?, ?, ?)').run(
      returnSaleId,
      mode === 'credit' ? 'udhaar' : mode,
      -refund
    );

    const insItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    );
    const lines: ResolvedReturnLine[] = [];
    for (const it of items) {
      const info = insItem.run(
        returnSaleId,
        it.product_id,
        it.qty,
        it.unit_price,
        -round2(Number(it.qty) * Number(it.unit_price))
      );
      lines.push({
        sale_item_id: Number(info.lastInsertRowid),
        product_id: it.product_id,
        qty: it.qty,
        unit_price: it.unit_price,
        batch_id: null,
      });
    }

    const returnId = writeReturn(db, {
      saleId: returnSaleId,
      lines,
      refund,
      reason,
      refundMode: mode,
      restock,
      credit:
        mode === 'credit' && customerId ? { customerId, amount: refund } : null,
    });

    db.exec('COMMIT');
    logActivity(
      'return_created',
      'return',
      returnId,
      `${invoiceNo} | refund=${refund} | mode=${mode} | restock=${restock}${
        reason ? ' | ' + reason : ''
      }${note ? ' | note=' + note : ''}${input.linked_sale_id ? ' | sale=' + input.linked_sale_id : ''}`
    );
    return getReturn(returnId)!;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getReturn(id: number): (ReturnRow & { items: ReturnItemRow[] }) | null {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT r.*, s.invoice_no, c.name AS customer_name
       FROM returns r
       JOIN sales s ON s.id = r.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE r.id = ?`
    )
    .get(id) as unknown as ReturnRow | undefined;
  if (!r) return null;
  const items = db
    .prepare(
      `SELECT i.*, p.name AS product_name
       FROM return_items i LEFT JOIN products p ON p.id = i.product_id
       WHERE i.return_id = ?`
    )
    .all(id) as unknown as ReturnItemRow[];
  return { ...r, items };
}

export function listReturns(
  from?: string,
  to?: string,
  customerId?: number,
  productId?: number
): ReturnRow[] {
  const db = getDb();
  let sql = `
    SELECT r.*, s.invoice_no, c.name AS customer_name
    FROM returns r
    JOIN sales s ON s.id = r.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  if (from) {
    sql += ' AND date(r.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(r.created_at) <= date(?)';
    params.push(to);
  }
  if (customerId) {
    sql += ' AND s.customer_id = ?';
    params.push(customerId);
  }
  if (productId) {
    sql += ` AND EXISTS (
      SELECT 1 FROM return_items ri WHERE ri.return_id = r.id AND ri.product_id = ?
    )`;
    params.push(productId);
  }
  sql += ' ORDER BY r.id DESC LIMIT 500';
  return db.prepare(sql).all(...params) as unknown as ReturnRow[];
}

export function createCashRefund(amount: number, reason?: string, mode: string = 'cash'): CashRefundRow {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Refund amount must be a positive number');
  }
  const db = getDb();
  const shift = currentShift();
  if (!shift) throw new Error('No open shift — please open a shift before issuing a refund');
  const info = db
    .prepare(
      `INSERT INTO cash_refunds (amount, reason, mode, user_id, shift_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      amount,
      reason?.trim() || null,
      mode,
      getSessionUserId() ?? 1,
      shift.id
    );
  const id = Number(info.lastInsertRowid);
  logActivity('cash_refund', 'refund', id, `amount=${amount}${reason ? ' | ' + reason : ''}`);
  const row = db
    .prepare(
      `SELECT r.*, u.username FROM cash_refunds r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`
    )
    .get(id) as unknown as CashRefundRow;
  return row;
}

export function listCashRefunds(from?: string, to?: string): CashRefundRow[] {
  const db = getDb();
  let sql = `
    SELECT r.*, u.username FROM cash_refunds r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  if (from) {
    sql += ' AND date(r.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(r.created_at) <= date(?)';
    params.push(to);
  }
  sql += ' ORDER BY r.id DESC LIMIT 500';
  return db.prepare(sql).all(...params) as unknown as CashRefundRow[];
}
