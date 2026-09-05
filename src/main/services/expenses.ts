import { getDb } from '../db';
import { logError } from '../logger';

export interface ExpenseCategoryRow {
  id: number;
  name: string;
  description: string | null;
  color: string;
  is_active: number;
  created_at: string;
}

export interface ExpenseRow {
  id: number;
  category_id: number;
  category_name?: string;
  category_color?: string;
  user_id: number;
  username?: string;
  title: string;
  description: string | null;
  amount: number;
  expense_date: string;
  attachment_path: string | null;
  is_recurring: number;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | null;
  recurrence_end: string | null;
  status: 'active' | 'paused' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export function listCategories(activeOnly = true): ExpenseCategoryRow[] {
  try {
    const sql = activeOnly ? 'WHERE is_active = 1' : '';
    return getDb().prepare(`SELECT * FROM expense_categories ${sql} ORDER BY name`).all() as unknown as ExpenseCategoryRow[];
  } catch (e) { logError('listExpenseCategories', e); return []; }
}

export function createCategory(input: { name: string; description?: string; color?: string }): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO expense_categories (name, description, color) VALUES (?, ?, ?)
    `).run(input.name, input.description || null, input.color || '#6B7280');
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createExpenseCategory', e); return { ok: false, message: String(e) }; }
}

export function updateCategory(id: number, input: Partial<{ name: string; description: string; color: string; is_active: boolean }>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = []; const vals: any[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); vals.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); vals.push(input.description); }
    if (input.color !== undefined) { fields.push('color = ?'); vals.push(input.color); }
    if (input.is_active !== undefined) { fields.push('is_active = ?'); vals.push(input.is_active ? 1 : 0); }
    if (fields.length === 0) return { ok: true };
    vals.push(id);
    db.prepare(`UPDATE expense_categories SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateExpenseCategory', e); return { ok: false, message: String(e) }; }
}

export function deleteCategory(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM expense_categories WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteExpenseCategory', e); return { ok: false, message: String(e) }; }
}

export interface ExpenseInput {
  category_id: number;
  user_id: number;
  title: string;
  description?: string;
  amount: number;
  expense_date: string;
  attachment_path?: string;
  is_recurring?: boolean;
  recurrence_type?: 'daily' | 'weekly' | 'monthly' | null;
  recurrence_end?: string | null;
}

export function listExpenses(filters: { category_id?: number; user_id?: number; from?: string; to?: string; status?: string } = {}): ExpenseRow[] {
  try {
    let sql = `
      SELECT e.*, c.name as category_name, c.color as category_color, u.username
      FROM expenses e
      JOIN expense_categories c ON e.category_id = c.id
      JOIN users u ON e.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (filters.category_id) { sql += ' AND e.category_id = ?'; params.push(filters.category_id); }
    if (filters.user_id) { sql += ' AND e.user_id = ?'; params.push(filters.user_id); }
    if (filters.from) { sql += ' AND date(e.expense_date) >= ?'; params.push(filters.from); }
    if (filters.to) { sql += ' AND date(e.expense_date) <= ?'; params.push(filters.to); }
    if (filters.status) { sql += ' AND e.status = ?'; params.push(filters.status); }
    sql += ' ORDER BY e.expense_date DESC, e.id DESC LIMIT 500';
    return getDb().prepare(sql).all(...params) as unknown as ExpenseRow[];
  } catch (e) { logError('listExpenses', e); return []; }
}

export function createExpense(input: ExpenseInput): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO expenses (category_id, user_id, title, description, amount, expense_date, attachment_path, is_recurring, recurrence_type, recurrence_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.category_id, input.user_id, input.title, input.description || null,
      input.amount, input.expense_date, input.attachment_path || null,
      input.is_recurring ? 1 : 0, input.recurrence_type || null, input.recurrence_end || null
    );
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createExpense', e); return { ok: false, message: String(e) }; }
}

export function getExpense(id: number): ExpenseRow | null {
  try {
    return getDb().prepare(`
      SELECT e.*, c.name as category_name, c.color as category_color, u.username
      FROM expenses e
      JOIN expense_categories c ON e.category_id = c.id
      JOIN users u ON e.user_id = u.id
      WHERE e.id = ?
    `).get(id) as unknown as ExpenseRow | null;
  } catch (e) { logError('getExpense', e); return null; }
}

export function updateExpense(id: number, input: Partial<{
  category_id: number; title: string; description: string; amount: number;
  expense_date: string; attachment_path: string; is_recurring: boolean;
  recurrence_type: 'daily' | 'weekly' | 'monthly' | null; recurrence_end: string | null;
  status: 'active' | 'paused' | 'cancelled';
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = []; const vals: any[] = [];
    const map: Record<string, string> = {
      category_id: 'category_id', title: 'title', description: 'description',
      amount: 'amount', expense_date: 'expense_date', attachment_path: 'attachment_path',
      is_recurring: 'is_recurring', recurrence_type: 'recurrence_type',
      recurrence_end: 'recurrence_end', status: 'status'
    };
    for (const [k, col] of Object.entries(map)) {
      if (input[k as keyof typeof input] !== undefined) { fields.push(`${col} = ?`); vals.push(input[k as keyof typeof input]); }
    }
    if (fields.length === 0) return { ok: true };
    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`); vals.push(id);
    db.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateExpense', e); return { ok: false, message: String(e) }; }
}

export function deleteExpense(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM expenses WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteExpense', e); return { ok: false, message: String(e) }; }
}

export function getExpenseSummary(from?: string, to?: string): { total: number; byCategory: Array<{ category: string; total: number; count: number }>; byStatus: Array<{ status: string; total: number; count: number }> } {
  try {
    const db = getDb();
    let sql = `SELECT e.amount, c.name as category, e.status FROM expenses e JOIN expense_categories c ON e.category_id = c.id WHERE e.status = 'active'`;
    const params: any[] = [];
    if (from) { sql += ' AND date(e.expense_date) >= ?'; }
    if (to) { sql += ' AND date(e.expense_date) <= ?'; }
    if (from) params.push(from);
    if (to) params.push(to);

    const rows = db.prepare(sql).all(...params) as { amount: number; category: string; status: string }[];

    let total = 0;
    const byCat: Record<string, { total: number; count: number }> = {};
    const byStatus: Record<string, { total: number; count: number }> = {};

    for (const r of rows) {
      total += r.amount;
      byCat[r.category] = byCat[r.category] || { total: 0, count: 0 };
      byCat[r.category].total += r.amount;
      byCat[r.category].count += 1;
      byStatus[r.status] = byStatus[r.status] || { total: 0, count: 0 };
      byStatus[r.status].total += r.amount;
      byStatus[r.status].count += 1;
    }

    return {
      total,
      byCategory: Object.entries(byCat).map(([category, v]) => ({ category, ...v })),
      byStatus: Object.entries(byStatus).map(([status, v]) => ({ status, ...v })),
    };
  } catch (e) { logError('getExpenseSummary', e); return { total: 0, byCategory: [], byStatus: [] }; }
}

export const expensesService = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listExpenses,
  createExpense,
  getExpense,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
};