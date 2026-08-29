import { getDb } from '../db';
import { getSessionUserId } from './auth';
import { logActivity } from './activity';

export interface CashDrawerSession {
  id: number;
  shift_id: number;
  opening_cash: number;
  opening_time: string;
  opened_by: number;
  closing_cash: number | null;
  closing_time: string | null;
  closed_by: number | null;
  variance: number;
  notes: string | null;
  opened_by_name?: string;
  closed_by_name?: string;
}

export interface CashDrawerBreakdown {
  cash_sales: number;
  card_sales: number;
  cheque_sales: number;
  easypaisa_sales: number;
  jazzcash_sales: number;
  udhaar_sales: number;
  refunds: number;
  total_bills: number;
  average_bill: number;
}

export function openDrawer(shiftId: number, openingCash: number): CashDrawerSession {
  if (typeof openingCash !== 'number' || openingCash < 0 || !Number.isFinite(openingCash)) {
    throw new Error('Opening cash must be a valid non-negative amount');
  }
  const db = getDb();
  const uid = getSessionUserId() ?? 1;

  const existing = db
    .prepare('SELECT id FROM cash_drawer_sessions WHERE shift_id = ? AND closing_time IS NULL')
    .get(shiftId) as { id: number } | undefined;
  if (existing) {
    throw new Error('Cash drawer is already open for this shift');
  }

  const info = db
    .prepare('INSERT INTO cash_drawer_sessions (shift_id, opening_cash, opened_by) VALUES (?, ?, ?)')
    .run(shiftId, openingCash, uid);

  logActivity('cash_drawer_opened', 'cash_drawer', Number(info.lastInsertRowid), `shift=${shiftId} opening=${openingCash}`, uid);

  return getSession(Number(info.lastInsertRowid))!;
}

export function closeDrawer(shiftId: number, closingCash: number, notes?: string): CashDrawerSession {
  if (typeof closingCash !== 'number' || closingCash < 0 || !Number.isFinite(closingCash)) {
    throw new Error('Closing cash must be a valid non-negative amount');
  }
  const db = getDb();
  const uid = getSessionUserId() ?? 1;

  const session = db
    .prepare('SELECT * FROM cash_drawer_sessions WHERE shift_id = ? AND closing_time IS NULL')
    .get(shiftId) as CashDrawerSession | undefined;
  if (!session) {
    throw new Error('No open cash drawer session found for this shift');
  }

  const breakdown = getBreakdown(shiftId);
  const expected = session.opening_cash + breakdown.cash_sales - breakdown.refunds;
  const variance = closingCash - expected;

  db.prepare(
    `UPDATE cash_drawer_sessions SET closing_cash = ?, closing_time = CURRENT_TIMESTAMP, closed_by = ?, variance = ?, notes = ?
     WHERE id = ?`
  ).run(closingCash, uid, variance, notes?.trim() || null, session.id);

  logActivity('cash_drawer_closed', 'cash_drawer', session.id, `closing=${closingCash} expected=${expected} variance=${variance}`, uid);

  return getSession(session.id)!;
}

export function getCurrentDrawer(shiftId: number): CashDrawerSession | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cds.*, u1.username AS opened_by_name, u2.username AS closed_by_name
       FROM cash_drawer_sessions cds
       LEFT JOIN users u1 ON u1.id = cds.opened_by
       LEFT JOIN users u2 ON u2.id = cds.closed_by
       WHERE cds.shift_id = ? AND cds.closing_time IS NULL
       ORDER BY cds.id DESC LIMIT 1`
    )
    .get(shiftId) as CashDrawerSession | undefined;
  return row ?? null;
}

export function getSession(id: number): CashDrawerSession | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cds.*, u1.username AS opened_by_name, u2.username AS closed_by_name
       FROM cash_drawer_sessions cds
       LEFT JOIN users u1 ON u1.id = cds.opened_by
       LEFT JOIN users u2 ON u2.id = cds.closed_by
       WHERE cds.id = ?`
    )
    .get(id) as CashDrawerSession | undefined;
  return row ?? null;
}

export function getBreakdown(shiftId: number): CashDrawerBreakdown {
  const db = getDb();

  const cashSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'cash'`
    )
    .get(shiftId) as { t: number };

  const cardSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'card'`
    )
    .get(shiftId) as { t: number };

  const chequeSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'cheque'`
    )
    .get(shiftId) as { t: number };

  const easypaisaSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'easypaisa'`
    )
    .get(shiftId) as { t: number };

  const jazzcashSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'jazzcash'`
    )
    .get(shiftId) as { t: number };

  const udhaarSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'udhaar'`
    )
    .get(shiftId) as { t: number };

  const refunds = db
    .prepare(
      `SELECT COALESCE(SUM(r.refund_amount), 0) AS t FROM returns r
       JOIN sales s ON s.id = r.sale_id
       WHERE s.shift_id = ? AND r.refund_mode = 'cash'`
    )
    .get(shiftId) as { t: number };

  const plainCashRefunds = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM cash_refunds WHERE shift_id = ?')
    .get(shiftId) as { t: number };

  const totalBills = db
    .prepare(
      `SELECT COUNT(*) AS t FROM sales WHERE shift_id = ? AND status = 'completed'`
    )
    .get(shiftId) as { t: number };

  const totalSales = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS t FROM sales WHERE shift_id = ? AND status = 'completed'`
    )
    .get(shiftId) as { t: number };

  const totalRefunds = Number(refunds?.t ?? 0) + Number(plainCashRefunds?.t ?? 0);

  return {
    cash_sales: Number(cashSales?.t ?? 0),
    card_sales: Number(cardSales?.t ?? 0),
    cheque_sales: Number(chequeSales?.t ?? 0),
    easypaisa_sales: Number(easypaisaSales?.t ?? 0),
    jazzcash_sales: Number(jazzcashSales?.t ?? 0),
    udhaar_sales: Number(udhaarSales?.t ?? 0),
    refunds: totalRefunds,
    total_bills: Number(totalBills?.t ?? 0),
    average_bill: totalBills?.t > 0 ? Number(totalSales?.t ?? 0) / Number(totalBills.t) : 0,
  };
}

export function getDrawerHistory(shiftId?: number): CashDrawerSession[] {
  const db = getDb();
  if (shiftId) {
    return db
      .prepare(
        `SELECT cds.*, u1.username AS opened_by_name, u2.username AS closed_by_name
         FROM cash_drawer_sessions cds
         LEFT JOIN users u1 ON u1.id = cds.opened_by
         LEFT JOIN users u2 ON u2.id = cds.closed_by
         WHERE cds.shift_id = ?
         ORDER BY cds.id DESC`
      )
      .all(shiftId) as unknown as CashDrawerSession[];
  }
  return db
    .prepare(
      `SELECT cds.*, u1.username AS opened_by_name, u2.username AS closed_by_name
       FROM cash_drawer_sessions cds
       LEFT JOIN users u1 ON u1.id = cds.opened_by
       LEFT JOIN users u2 ON u2.id = cds.closed_by
       ORDER BY cds.id DESC LIMIT 50`
    )
    .all() as unknown as CashDrawerSession[];
}
