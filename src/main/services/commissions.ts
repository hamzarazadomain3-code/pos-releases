import { getDb } from '../db';
import { logError } from '../logger';

export interface CommissionRuleRow {
  id: number;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  scope: 'global' | 'category' | 'product';
  category_id: number | null;
  product_id: number | null;
  min_qty: number;
  max_qty: number | null;
  min_amount: number | null;
  max_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface SalesmanCommissionRow {
  id: number;
  sale_id: number;
  sale_item_id: number | null;
  salesman_id: number;
  salesman_name?: string;
  rule_id: number | null;
  commission_amount: number;
  base_amount: number;
  commission_type: 'percent' | 'fixed';
  commission_rate: number;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: number | null;
  paid_at: string | null;
  paid_by: number | null;
}

function getSetting(key: string): string | null {
  try {
    return getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  } catch { return null; }
}

function isEnabled(): boolean {
  return getSetting('commission_enabled') !== 'false';
}

function isAutoApprove(): boolean {
  return getSetting('commission_auto_approve') === 'true';
}

export function listRules(activeOnly = true): CommissionRuleRow[] {
  try {
    const sql = activeOnly ? 'WHERE is_active = 1' : '';
    return getDb().prepare(`SELECT * FROM commission_rules ${sql} ORDER BY priority DESC, id`).all() as unknown as CommissionRuleRow[];
  } catch (e) { logError('listRules', e); return []; }
}

export function getRule(id: number): CommissionRuleRow | null {
  try { return getDb().prepare(`SELECT * FROM commission_rules WHERE id = ?`).get(id) as unknown as CommissionRuleRow | null; } catch { return null; }
}

export function createRule(input: {
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  scope: 'global' | 'category' | 'product';
  category_id?: number | null;
  product_id?: number | null;
  min_qty?: number;
  max_qty?: number | null;
  min_amount?: number | null;
  max_amount?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  priority?: number;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO commission_rules (name, type, value, scope, category_id, product_id, min_qty, max_qty, min_amount, max_amount, start_date, end_date, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name, input.type, input.value, input.scope,
      input.category_id ?? null, input.product_id ?? null,
      input.min_qty ?? 1, input.max_qty ?? null, input.min_amount ?? null, input.max_amount ?? null,
      input.start_date ?? null, input.end_date ?? null, input.priority ?? 0
    );
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createRule', e); return { ok: false, message: String(e) }; }
}

export function updateRule(id: number, input: Partial<{
  name: string; type: 'percent' | 'fixed'; value: number; scope: 'global' | 'category' | 'product';
  category_id: number | null; product_id: number | null; min_qty: number; max_qty: number | null;
  min_amount: number | null; max_amount: number | null; start_date: string | null; end_date: string | null;
  is_active: boolean; priority: number;
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = []; const vals: any[] = [];
    const map: Record<string, string> = {
      name: 'name', type: 'type', value: 'value', scope: 'scope',
      category_id: 'category_id', product_id: 'product_id',
      min_qty: 'min_qty', max_qty: 'max_qty', min_amount: 'min_amount', max_amount: 'max_amount',
      start_date: 'start_date', end_date: 'end_date', is_active: 'is_active', priority: 'priority'
    };
    for (const [k, col] of Object.entries(map)) {
      if (input[k as keyof typeof input] !== undefined) { fields.push(`${col} = ?`); vals.push(input[k as keyof typeof input]); }
    }
    if (fields.length === 0) return { ok: true };
    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`); vals.push(id);
    db.prepare(`UPDATE commission_rules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateRule', e); return { ok: false, message: String(e) }; }
}

export function deleteRule(id: number): { ok: boolean; message?: string } {
  try { getDb().prepare(`DELETE FROM commission_rules WHERE id = ?`).run(id); return { ok: true }; } catch (e) { logError('deleteRule', e); return { ok: false, message: String(e) }; }
}

export function listSalesmen(): Array<{ id: number; username: string; commission_rate: number }> {
  try {
    return getDb().prepare(`SELECT id, username, commission_rate FROM users WHERE is_salesman = 1`).all() as any[];
  } catch { return []; }
}

/**
 * Find applicable commission rule for a sale item
 */
function findMatchingRule(productId: number, categoryId: number | null, qty: number, amount: number): CommissionRuleRow | null {
  try {
    const rules = listRules(true);
    const today = new Date().toISOString().slice(0, 10);
    for (const rule of rules) {
      if (rule.start_date && rule.start_date > today) continue;
      if (rule.end_date && rule.end_date < today) continue;

      if (rule.scope === 'global') return rule;
      if (rule.scope === 'category' && rule.category_id === categoryId) return rule;
      if (rule.scope === 'product' && rule.product_id === productId) return rule;

      if (rule.min_qty && qty < rule.min_qty) continue;
      if (rule.max_qty && qty > rule.max_qty) continue;
      if (rule.min_amount && amount < rule.min_amount) continue;
      if (rule.max_amount && amount > rule.max_amount) continue;

      return rule;
    }
    return null;
  } catch { return null; }
}

/**
 * Calculate and record commissions for a sale
 */
export function calculateCommissions(saleId: number): { count: number; total: number } {
  if (!isEnabled()) return { count: 0, total: 0 };

  try {
    const db = getDb();
    const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId) as any;
    if (!sale) return { count: 0, total: 0 };

    const salesmanId = sale.user_id; // salesman is the user who made the sale
    if (!salesmanId) return { count: 0, total: 0 };

    const items = db.prepare(`
      SELECT si.*, p.category_id, p.name as product_name
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `).all(saleId) as any[];

    let totalCommission = 0;
    let count = 0;

    const autoApprove = isAutoApprove();
    const initialStatus = autoApprove ? 'approved' : 'pending';

    for (const item of items) {
      const rule = findMatchingRule(item.product_id, item.category_id, item.qty, item.line_total);
      if (!rule) continue;

      let commissionAmount = 0;
      if (rule.type === 'percent') {
        commissionAmount = (item.line_total * rule.value) / 100;
      } else {
        commissionAmount = rule.value;
      }

      const res = db.prepare(`
        INSERT INTO salesman_commissions (sale_id, sale_item_id, salesman_id, rule_id, commission_amount, base_amount, commission_type, commission_rate, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(saleId, item.id, salesmanId, rule.id, commissionAmount, item.line_total, rule.type, rule.value, initialStatus);

      totalCommission += commissionAmount;
      count++;
    }

    return { count, total: totalCommission };
  } catch (e) { logError('calculateCommissions', e); return { count: 0, total: 0 }; }
}

export function listCommissions(filters: { salesman_id?: number; status?: string; from?: string; to?: string } = {}): SalesmanCommissionRow[] {
  try {
    let sql = `
      SELECT sc.*, u.username as salesman_name
      FROM salesman_commissions sc
      JOIN users u ON sc.salesman_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (filters.salesman_id) { sql += ' AND sc.salesman_id = ?'; params.push(filters.salesman_id); }
    if (filters.status) { sql += ' AND sc.status = ?'; params.push(filters.status); }
    if (filters.from) { sql += ' AND date(sc.created_at) >= ?'; params.push(filters.from); }
    if (filters.to) { sql += ' AND date(sc.created_at) <= ?'; params.push(filters.to); }
    sql += ' ORDER BY sc.created_at DESC LIMIT 500';
    return getDb().prepare(sql).all(...params) as unknown as SalesmanCommissionRow[];
  } catch (e) { logError('listCommissions', e); return []; }
}

export function updateCommissionStatus(id: number, status: string, userId: number): { ok: boolean; message?: string } {
  try {
    const validStatuses = ['pending', 'approved', 'paid', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return { ok: false, message: 'Invalid status' };
    }
    const db = getDb();
    const fields: string[] = ['status = ?'];
    const vals: (string | number)[] = [status];
    if (status === 'approved') { fields.push(`approved_at = datetime('now', 'utc') || 'Z'`); fields.push(`approved_by = ?`); vals.push(userId); }
    if (status === 'paid') { fields.push(`paid_at = datetime('now', 'utc') || 'Z'`); fields.push(`paid_by = ?`); vals.push(userId); }
    vals.push(id);
    db.prepare(`UPDATE salesman_commissions SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateCommissionStatus', e); return { ok: false, message: String(e) }; }
}

export function getSalesmanSummary(salesmanId: number, from?: string, to?: string): { total: number; pending: number; paid: number; count: number } {
  try {
    let sql = `SELECT status, SUM(commission_amount) as total, COUNT(*) as count FROM salesman_commissions WHERE salesman_id = ?`;
    const params: any[] = [salesmanId];
    if (from) { sql += ' AND date(created_at) >= ?'; params.push(from); }
    if (to) { sql += ' AND date(created_at) <= ?'; params.push(to); }
    sql += ' GROUP BY status';
    const rows = getDb().prepare(sql).all(...params) as { status: string; total: number; count: number }[];
    let total = 0, pending = 0, paid = 0, count = 0;
    for (const r of rows) {
      total += r.total; count += r.count;
      if (r.status === 'pending') pending += r.total;
      if (r.status === 'paid') paid += r.total;
    }
    return { total, pending, paid, count };
  } catch { return { total: 0, pending: 0, paid: 0, count: 0 }; }
}

export const commissionsService = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  listSalesmen,
  calculateCommissions,
  listCommissions,
  updateCommissionStatus,
  getSalesmanSummary,
};