import { getDb } from '../db';
import { logError } from '../logger';

export interface CreditCheckResult {
  allowed: boolean;
  reason?: string;
  severity: 'ok' | 'warning' | 'blocked';
  current_balance: number;
  credit_limit: number;
  available: number;
  utilization_pct: number;
  warning_threshold_pct: number;
}

export interface CreditLimitHistoryRow {
  id: number;
  customer_id: number;
  customer_name?: string;
  old_limit: number | null;
  new_limit: number | null;
  old_block_flag: number | null;
  new_block_flag: number | null;
  reason: string | null;
  changed_by: number | null;
  changed_by_name?: string;
  created_at: string;
}

function getCustomer(customerId: number): any {
  return getDb().prepare(`
    SELECT id, name, balance, credit_limit, block_on_exceed, warning_threshold_pct
    FROM customers WHERE id = ?
  `).get(customerId);
}

/**
 * Check if a sale/credit transaction is allowed for a customer.
 * Returns severity: ok | warning | blocked
 */
export function checkCredit(customerId: number, additionalAmount = 0): CreditCheckResult {
  try {
    const db = getDb();
    const c = getCustomer(customerId);
    if (!c) {
      return {
        allowed: true, severity: 'ok',
        current_balance: 0, credit_limit: 0, available: 0,
        utilization_pct: 0, warning_threshold_pct: 80,
      };
    }
    const limit = c.credit_limit || 0;
    const balance = c.balance || 0;
    const projected = balance + additionalAmount;
    const warningPct = c.warning_threshold_pct || 80;

    // No limit set → always allowed
    if (limit <= 0) {
      return {
        allowed: true, severity: 'ok',
        current_balance: balance, credit_limit: 0, available: Infinity,
        utilization_pct: 0, warning_threshold_pct: warningPct,
      };
    }

    const utilization = (projected / limit) * 100;
    const available = Math.max(0, limit - projected);

    if (c.block_on_exceed && projected > limit) {
      return {
        allowed: false,
        reason: `Customer credit limit exceeded. Limit: ${limit}, Current: ${balance}, This sale: ${additionalAmount}`,
        severity: 'blocked',
        current_balance: balance, credit_limit: limit, available: 0,
        utilization_pct: utilization, warning_threshold_pct: warningPct,
      };
    }

    if (utilization >= warningPct) {
      return {
        allowed: true,
        reason: `Customer at ${utilization.toFixed(0)}% of credit limit`,
        severity: 'warning',
        current_balance: balance, credit_limit: limit, available,
        utilization_pct: utilization, warning_threshold_pct: warningPct,
      };
    }

    return {
      allowed: true, severity: 'ok',
      current_balance: balance, credit_limit: limit, available,
      utilization_pct: utilization, warning_threshold_pct: warningPct,
    };
  } catch (e) {
    logError('checkCredit', e);
    return {
      allowed: true, severity: 'ok',
      current_balance: 0, credit_limit: 0, available: 0,
      utilization_pct: 0, warning_threshold_pct: 80,
    };
  }
}

/**
 * Update credit limit for a customer. Logs to history.
 */
export function setCustomerLimit(
  customerId: number,
  limit: number,
  blockOnExceed: boolean,
  changedBy: number,
  reason?: string,
  warningThresholdPct?: number
): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const c = getCustomer(customerId);
    if (!c) return { ok: false, message: 'Customer not found' };

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE customers
        SET credit_limit = ?, block_on_exceed = ?, warning_threshold_pct = COALESCE(?, warning_threshold_pct)
        WHERE id = ?
      `).run(limit, blockOnExceed ? 1 : 0, warningThresholdPct ?? null, customerId);

      db.prepare(`
        INSERT INTO credit_limit_history (customer_id, old_limit, new_limit, old_block_flag, new_block_flag, reason, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(customerId, c.credit_limit || 0, limit, c.block_on_exceed || 0, blockOnExceed ? 1 : 0, reason || null, changedBy);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    return { ok: true };
  } catch (e) {
    logError('setCustomerLimit', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function setSupplierLimit(
  supplierId: number,
  limit: number,
  blockOnExceed: boolean,
  warningThresholdPct?: number
): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`
      UPDATE suppliers SET credit_limit = ?, block_on_exceed = ?, warning_threshold_pct = COALESCE(?, warning_threshold_pct)
      WHERE id = ?
    `).run(limit, blockOnExceed ? 1 : 0, warningThresholdPct ?? null, supplierId);
    return { ok: true };
  } catch (e) {
    logError('setSupplierLimit', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function getCreditHistory(customerId: number, limit = 50): CreditLimitHistoryRow[] {
  try {
    return getDb().prepare(`
      SELECT h.*, c.name as customer_name, u.username as changed_by_name
      FROM credit_limit_history h
      LEFT JOIN customers c ON h.customer_id = c.id
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.customer_id = ?
      ORDER BY h.created_at DESC LIMIT ?
    `).all(customerId, limit) as unknown as CreditLimitHistoryRow[];
  } catch (e) {
    logError('getCreditHistory', e);
    return [];
  }
}

/**
 * Return all customers that are over their limit or near threshold.
 */
export function listCreditRisks(): Array<{
  id: number; name: string; phone: string | null;
  balance: number; credit_limit: number; available: number;
  utilization_pct: number; severity: 'warning' | 'blocked';
}> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, name, phone, balance, credit_limit, warning_threshold_pct, block_on_exceed
      FROM customers
      WHERE credit_limit > 0
    `).all() as any[];

    return rows.map((c) => {
      const projected = c.balance || 0;
      const utilization = (projected / c.credit_limit) * 100;
      const available = Math.max(0, c.credit_limit - projected);
      const severity: 'warning' | 'blocked' = projected > c.credit_limit && c.block_on_exceed ? 'blocked' : 'warning';
      return {
        id: c.id, name: c.name, phone: c.phone,
        balance: projected, credit_limit: c.credit_limit, available,
        utilization_pct: utilization, severity,
      };
    })
    .filter((c) => c.utilization_pct >= 80)
    .sort((a, b) => b.utilization_pct - a.utilization_pct);
  } catch (e) {
    logError('listCreditRisks', e);
    return [];
  }
}

/**
 * Recalculate avg_payment_days and credit_rating for all customers based on payment history.
 * Can be run periodically (e.g., daily).
 */
export function refreshCreditRatings(): { updated: number } {
  try {
    const db = getDb();
    const customers = db.prepare(`SELECT id FROM customers`).all() as unknown as Array<{ id: number }>;
    let updated = 0;
    const upd = db.prepare(`
      UPDATE customers
      SET avg_payment_days = ?, total_credit_sales = ?, last_payment_date = ?, last_payment_amount = ?, credit_rating = ?
      WHERE id = ?
    `);

    for (const c of customers) {
      const stats = db.prepare(`
        SELECT
          AVG(julianday(payment_date) - julianday(sale_date)) as avg_days,
          SUM(amount) as total_paid,
          MAX(payment_date) as last_date,
          (SELECT SUM(total_amount) FROM sales WHERE customer_id = ? AND status = 'completed') as total_credit
      `).get(c.id) as any;

      const avgDays = stats?.avg_days ?? 0;
      const lastDate = stats?.last_date ?? null;
      const lastAmount = 0; // Could be derived separately

      let rating = 'A';
      if (avgDays > 90) rating = 'D';
      else if (avgDays > 60) rating = 'C';
      else if (avgDays > 30) rating = 'B';

      upd.run(avgDays || 0, stats?.total_credit || 0, lastDate, lastAmount, rating, c.id);
      updated++;
    }
    return { updated };
  } catch (e) {
    logError('refreshCreditRatings', e);
    return { updated: 0 };
  }
}

export const creditLimitsService = {
  check: checkCredit,
  setCustomerLimit,
  setSupplierLimit,
  getHistory: getCreditHistory,
  listRisks: listCreditRisks,
  refreshRatings: refreshCreditRatings,
};
