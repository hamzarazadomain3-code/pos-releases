import { getDb } from '../db';
import { logError } from '../logger';

export interface CustomReportRow {
  id: number;
  name: string;
  description: string | null;
  base_table: string;
  columns_json: string;
  filters_json: string | null;
  group_by_json: string | null;
  order_by_json: string | null;
  limit_rows: number | null;
  is_public: number;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportScheduleRow {
  id: number;
  report_id: number;
  report_name?: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  format: 'xlsx' | 'csv' | 'pdf';
  recipients_json: string | null;
  is_active: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

interface TableSchema {
  [table: string]: string[];
}

const TABLE_SCHEMAS: TableSchema = {
  sales: ['id', 'invoice_no', 'customer_id', 'user_id', 'shift_id', 'subtotal', 'tax_amount', 'discount_amount', 'total_amount', 'status', 'created_at'],
  sale_items: ['id', 'sale_id', 'product_id', 'qty', 'unit_price', 'discount', 'tax_rate', 'line_total'],
  products: ['id', 'sku', 'barcode', 'name', 'category_id', 'unit_id', 'cost_price', 'sale_price', 'stock_qty', 'created_at'],
  customers: ['id', 'name', 'phone', 'address', 'balance', 'credit_limit', 'created_at'],
  purchases: ['id', 'supplier_id', 'status', 'total_amount', 'created_at'],
  purchase_items: ['id', 'purchase_order_id', 'product_id', 'qty', 'unit_cost'],
  expenses: ['id', 'category_id', 'user_id', 'title', 'amount', 'expense_date', 'status'],
  categories: ['id', 'name'],
  users: ['id', 'username', 'role'],
};

export function listReports(userId?: number): CustomReportRow[] {
  try {
    const db = getDb();
    let sql = `SELECT r.*, u.username as created_by_name FROM custom_reports r LEFT JOIN users u ON r.created_by = u.id`;
    const params: any[] = [];
    if (userId) {
      sql += ' WHERE r.created_by = ? OR r.is_public = 1';
      params.push(userId);
    }
    sql += ' ORDER BY r.updated_at DESC';
    return db.prepare(sql).all(...params) as unknown as CustomReportRow[];
  } catch (e) { logError('listReports', e); return []; }
}

export function getReport(id: number): CustomReportRow | null {
  try {
    return getDb().prepare(`SELECT * FROM custom_reports WHERE id = ?`).get(id) as unknown as CustomReportRow | null;
  } catch (e) { logError('getReport', e); return null; }
}

export function createReport(input: {
  name: string;
  description?: string;
  base_table: string;
  columns_json: string;
  filters_json?: string;
  group_by_json?: string;
  order_by_json?: string;
  limit_rows?: number;
  is_public?: boolean;
  created_by: number;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    if (!TABLE_SCHEMAS[input.base_table]) {
      return { ok: false, message: 'Invalid base table' };
    }
    const res = db.prepare(`
      INSERT INTO custom_reports (name, description, base_table, columns_json, filters_json, group_by_json, order_by_json, limit_rows, is_public, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name, input.description || null, input.base_table, input.columns_json,
      input.filters_json || null, input.group_by_json || null, input.order_by_json || null,
      input.limit_rows || null, input.is_public ? 1 : 0, input.created_by
    );
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createReport', e); return { ok: false, message: String(e) }; }
}

export function updateReport(id: number, input: Partial<{
  name: string; description: string; columns_json: string; filters_json: string;
  group_by_json: string; order_by_json: string; limit_rows: number; is_public: boolean;
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = []; const vals: any[] = [];
    const map: Record<string, string> = {
      name: 'name', description: 'description', columns_json: 'columns_json',
      filters_json: 'filters_json', group_by_json: 'group_by_json',
      order_by_json: 'order_by_json', limit_rows: 'limit_rows', is_public: 'is_public'
    };
    for (const [k, col] of Object.entries(map)) {
      if (input[k as keyof typeof input] !== undefined) { fields.push(`${col} = ?`); vals.push(input[k as keyof typeof input]); }
    }
    if (fields.length === 0) return { ok: true };
    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`); vals.push(id);
    db.prepare(`UPDATE custom_reports SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateReport', e); return { ok: false, message: String(e) }; }
}

export function deleteReport(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM custom_reports WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteReport', e); return { ok: false, message: String(e) }; }
}

export function getTableSchema(table: string): string[] | null {
  return TABLE_SCHEMAS[table] || null;
}

export function listTables(): string[] {
  return Object.keys(TABLE_SCHEMAS);
}

export function executeReport(reportId: number, limit?: number): { columns: string[]; rows: any[][] } | null {
  try {
    const report = getReport(reportId);
    if (!report) return null;

    const columns = JSON.parse(report.columns_json) as string[];
    const filters = report.filters_json ? JSON.parse(report.filters_json) : {};
    const groupBy = report.group_by_json ? JSON.parse(report.group_by_json) : [];
    const orderBy = report.order_by_json ? JSON.parse(report.order_by_json) : [];
    const limitRows = report.limit_rows || limit || 1000;

    const db = getDb();
    let sql = `SELECT ${columns.join(', ')} FROM ${report.base_table}`;
    const params: any[] = [];

    // Apply filters
    if (Object.keys(filters).length > 0) {
      const where: string[] = [];
      for (const [col, val] of Object.entries(filters)) {
        if (val && typeof val === 'object' && 'op' in val) {
          const { op, value } = val as any;
          switch (op) {
            case 'eq': where.push(`${col} = ?`); break;
            case 'neq': where.push(`${col} != ?`); break;
            case 'gt': where.push(`${col} > ?`); break;
            case 'gte': where.push(`${col} >= ?`); break;
            case 'lt': where.push(`${col} < ?`); break;
            case 'lte': where.push(`${col} <= ?`); break;
            case 'like': where.push(`${col} LIKE ?`); break;
            case 'in': where.push(`${col} IN (${Array.isArray(value) ? value.map(() => '?').join(',') : '?'})`); break;
          }
          if (Array.isArray((val as any).value)) {
            params.push(...(val as any).value);
          } else {
            params.push((val as any).value);
          }
        } else {
          where.push(`${col} = ?`);
          params.push(val);
        }
      }
      if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    }

    if (groupBy.length > 0) sql += ' GROUP BY ' + groupBy.join(', ');
    if (orderBy.length > 0) sql += ' ORDER BY ' + orderBy.join(', ');
    sql += ` LIMIT ${limitRows}`;

    const rows = db.prepare(sql).all(...params) as Record<string, any>[];
    const data = rows.map(row => columns.map(c => row[c]));
    return { columns, rows: data };
  } catch (e) { logError('executeReport', e); return null; }
}

export function listSchedules(): ReportScheduleRow[] {
  try {
    return getDb().prepare(`
      SELECT s.*, r.name as report_name
      FROM report_schedules s
      LEFT JOIN custom_reports r ON s.report_id = r.id
      ORDER BY s.next_run
    `).all() as unknown as ReportScheduleRow[];
  } catch (e) { logError('listSchedules', e); return []; }
}

export function createSchedule(input: {
  report_id: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week?: number | null;
  day_of_month?: number | null;
  time_of_day: string;
  format?: 'xlsx' | 'csv' | 'pdf';
  recipients_json?: string;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO report_schedules (report_id, frequency, day_of_week, day_of_month, time_of_day, format, recipients_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.report_id, input.frequency, input.day_of_week || null, input.day_of_month || null,
      input.time_of_day, input.format || 'xlsx', input.recipients_json || null
    );
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createSchedule', e); return { ok: false, message: String(e) }; }
}

export function updateSchedule(id: number, input: Partial<{
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  format: 'xlsx' | 'csv' | 'pdf';
  recipients_json: string | null;
  is_active: boolean;
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = []; const vals: any[] = [];
    const map: Record<string, string> = {
      frequency: 'frequency', day_of_week: 'day_of_week', day_of_month: 'day_of_month',
      time_of_day: 'time_of_day', format: 'format', recipients_json: 'recipients_json', is_active: 'is_active'
    };
    for (const [k, col] of Object.entries(map)) {
      if (input[k as keyof typeof input] !== undefined) { fields.push(`${col} = ?`); vals.push(input[k as keyof typeof input]); }
    }
    if (fields.length === 0) return { ok: true };
    vals.push(id);
    db.prepare(`UPDATE report_schedules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateSchedule', e); return { ok: false, message: String(e) }; }
}

export function deleteSchedule(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM report_schedules WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteSchedule', e); return { ok: false, message: String(e) }; }
}

export const customReportsService = {
  list: listReports,
  get: getReport,
  create: createReport,
  update: updateReport,
  delete: deleteReport,
  getTableSchema,
  listTables,
  execute: executeReport,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
};