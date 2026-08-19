import { getDb } from '../db';
import { can, getSessionUserId } from './auth';
import { logActivity } from './activity';
import type { ShiftRow } from '../../shared/types';

function mapShift(r: any): ShiftRow {
  return {
    id: r.id,
    user_id: r.user_id,
    username: r.username,
    start_cash: r.start_cash,
    end_cash: r.end_cash,
    expected_cash: r.expected_cash,
    variance: r.variance,
    forced: r.forced,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    notes: r.notes,
  };
}

export function openShift(openingCash: number): ShiftRow {
  if (typeof openingCash !== 'number' || openingCash < 0 || !Number.isFinite(openingCash)) {
    throw new Error('Opening cash must be a valid non-negative amount');
  }
  const db = getDb();
  const uid = getSessionUserId() ?? 1;
  const open = db
    .prepare('SELECT id FROM shifts WHERE user_id = ? AND closed_at IS NULL')
    .get(uid) as { id: number } | undefined;
  if (open) {
    throw new Error('You already have an open shift — close it before opening a new one');
  }
  const info = db
    .prepare('INSERT INTO shifts (user_id, start_cash) VALUES (?, ?)')
    .run(uid, openingCash);
  const shift = db
    .prepare(
      `SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(Number(info.lastInsertRowid)) as unknown as Record<string, any>;
  logActivity('shift_opened', 'shift', Number(info.lastInsertRowid), `opening=${openingCash}`, uid);
  return mapShift(shift);
}

export function currentShift(): ShiftRow | null {
  const db = getDb();
  const uid = getSessionUserId() ?? 1;
  const shift = db
    .prepare(
      `SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ? AND s.closed_at IS NULL`
    )
    .get(uid) as unknown as Record<string, any> | undefined;
  return shift ? mapShift(shift) : null;
}

export function shiftTotals(shiftId: number): { cash_sales: number; cash_refunds: number; expected: number } {
  const db = getDb();
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as
    | { start_cash: number }
    | undefined;
  if (!shift) throw new Error('Shift not found');
  const cashSales = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.shift_id = ? AND s.status = 'completed' AND LOWER(p.mode) = 'cash'`
    )
    .get(shiftId) as { t: number };
  const cashRefunds = db
    .prepare(
      `SELECT COALESCE(SUM(r.refund_amount), 0) AS t FROM returns r
       JOIN sales s ON s.id = r.sale_id
       WHERE s.shift_id = ? AND r.refund_mode = 'cash'`
    )
    .get(shiftId) as { t: number };
  const plainCashRefunds = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM cash_refunds WHERE shift_id = ?`
    )
    .get(shiftId) as { t: number };
  const cashSalesN = Number(cashSales?.t ?? 0);
  const cashRefundsN = Number(cashRefunds?.t ?? 0) + Number(plainCashRefunds?.t ?? 0);
  return { cash_sales: cashSalesN, cash_refunds: cashRefundsN, expected: shift.start_cash + cashSalesN - cashRefundsN };
}

export function closeShift(id: number, countedCash: number, notes?: string): ShiftRow {
  if (typeof countedCash !== 'number' || countedCash < 0 || !Number.isFinite(countedCash)) {
    throw new Error('Counted cash must be a valid non-negative amount');
  }
  const db = getDb();
  const uid = getSessionUserId() ?? 1;
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as
    | { user_id: number; closed_at: string | null }
    | undefined;
  if (!shift) throw new Error('Shift not found');
  if (shift.closed_at) throw new Error('This shift is already closed');
  if (shift.user_id !== uid && !can('manager')) {
    throw new Error('You can only close your own shift');
  }
  const { expected } = shiftTotals(id);
  const variance = countedCash - expected;
  db.prepare(
    `UPDATE shifts SET closed_at = CURRENT_TIMESTAMP, end_cash = ?, expected_cash = ?, variance = ?, forced = 0, notes = ?
     WHERE id = ?`
  ).run(countedCash, expected, variance, notes?.trim() || null, id);
  logActivity('shift_closed', 'shift', id, `counted=${countedCash} expected=${expected} variance=${variance}`, uid);
  const updated = db
    .prepare(`SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .get(id) as unknown as Record<string, any>;
  return mapShift(updated);
}

export function forceCloseShift(id: number, countedCash?: number, notes?: string): ShiftRow {
  if (!can('manager')) throw new Error('Only the owner or manager can force-close a shift');
  const db = getDb();
  const uid = getSessionUserId() ?? 1;
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as
    | { user_id: number; closed_at: string | null }
    | undefined;
  if (!shift) throw new Error('Shift not found');
  if (shift.closed_at) throw new Error('This shift is already closed');
  const { expected } = shiftTotals(id);
  const counted = countedCash ?? expected;
  const variance = counted - expected;
  db.prepare(
    `UPDATE shifts SET closed_at = CURRENT_TIMESTAMP, end_cash = ?, expected_cash = ?, variance = ?, forced = 1, notes = ?
     WHERE id = ?`
  ).run(counted, expected, variance, notes?.trim() || null, id);
  logActivity('shift_force_closed', 'shift', id, `user=${shift.user_id} counted=${counted} expected=${expected}`, uid);
  const updated = db
    .prepare(`SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .get(id) as unknown as Record<string, any>;
  return mapShift(updated);
}

export function listShifts(): ShiftRow[] {
  if (!can('manager')) throw new Error('Only the owner or manager can view shift history');
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id
         ORDER BY s.id DESC`
      )
      .all() as unknown as Record<string, any>[]
  ).map(mapShift);
}

export function getShift(
  id: number
): ShiftRow & { sales: any[]; cash_sales: number; cash_refunds: number; expected_preview: number } {
  if (!can('manager')) throw new Error('Only the owner or manager can view shift details');
  const db = getDb();
  const shift = db
    .prepare(`SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .get(id) as unknown as Record<string, any> | undefined;
  if (!shift) throw new Error('Shift not found');
  const { cash_sales, cash_refunds, expected } = shiftTotals(id);
  const sales = db
    .prepare(
      `SELECT id, invoice_no, total_amount, status, created_at FROM sales WHERE shift_id = ? ORDER BY id`
    )
    .all(id) as unknown as any[];
  return { ...mapShift(shift), sales, cash_sales, cash_refunds, expected_preview: expected };
}
