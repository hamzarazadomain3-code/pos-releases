import { getDb } from '../db';
import { getProduct, recordMovement } from './inventory';
import { logActivity } from './activity';
import { getSale } from './sales';
import { currentShift } from './shifts';
import { getSessionUserId } from './auth';
import type { CashRefundRow, ReturnItemRow, ReturnRow } from '../../shared/types';

export interface ReturnInputItem {
  sale_item_id: number;
  qty: number;
  unit_price: number;
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
  for (const it of valid) {
    const si = sale.items.find((i) => i.id === it.sale_item_id);
    if (!si) throw new Error('Sale item not found');
    const remaining = si.qty - (si.returned_qty ?? 0);
    if (it.qty > remaining)
      throw new Error(`Only ${remaining} returnable for this item (already returned ${si.returned_qty ?? 0})`);
    if (it.unit_price < 0) throw new Error('Unit price cannot be negative');
    refund += it.qty * it.unit_price;
  }
  const unrefunded = sale.total_amount - (sale.returned_amount ?? 0);
  if (refund > unrefunded)
    throw new Error(`Refund (${refund.toFixed(2)}) exceeds unrefunded sale amount (${unrefunded.toFixed(2)})`);

  const paid = sale.payments.reduce((s, p) => s + p.amount, 0);

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO returns (sale_id, reason, refund_amount, refund_mode, restock)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.sale_id, input.reason?.trim() || null, refund, input.refund_mode, input.restock ? 1 : 0);
    const returnId = Number(info.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO return_items (return_id, sale_item_id, product_id, qty, unit_price)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const it of valid) {
      const si = sale.items.find((i) => i.id === it.sale_item_id)!;
      insItem.run(returnId, si.id, si.product_id, it.qty, it.unit_price);
      if (input.restock) {
        const batchId = (si as any).batch_id;
        if (batchId) {
          // Restore to specific batch
          db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?')
            .run(it.qty, batchId);
          db.prepare('UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(it.qty, si.product_id);
          db.prepare(
            `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(si.product_id, it.qty, 'Returned to stock', 'return', returnId, batchId);
        } else {
          // Legacy: no batch tracking
          recordMovement(si.product_id, it.qty, 'Returned to stock', 'return', returnId);
        }
      }
      db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(it.qty, si.id);
    }

    db.prepare('UPDATE sales SET returned_amount = returned_amount + ? WHERE id = ?').run(refund, input.sale_id);

    if (sale.customer_id) {
      let balanceAdjust = 0;
      if (input.refund_mode === 'credit') {
        balanceAdjust = refund;
      } else if (refund > paid) {
        balanceAdjust = refund - paid;
      }
      if (balanceAdjust > 0) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(balanceAdjust, sale.customer_id);
        db.prepare(
          'INSERT INTO customer_transactions (customer_id, sale_id, amount, type) VALUES (?, ?, ?, ?)'
        ).run(sale.customer_id, input.sale_id, -balanceAdjust, 'return');
      }
    }

    db.exec('COMMIT');
    logActivity(
      'return_created',
      'return',
      returnId,
      `${sale.invoice_no} | refund=${refund} | mode=${input.refund_mode} | restock=${input.restock}${input.reason ? ' | ' + input.reason : ''}`
    );
    const created = getReturn(returnId);
    if (!created) throw new Error('Failed to load created return');
    return created;
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

export function listReturns(from?: string, to?: string): ReturnRow[] {
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