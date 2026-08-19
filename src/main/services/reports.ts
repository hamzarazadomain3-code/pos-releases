import { getDb } from '../db';
import { getAllSettings } from './settings';

export interface ExpiringRow {
  id: number;
  name: string;
  stock_qty: number;
  expiry_date: string;
  days_left: number;
  category_name?: string | null;
}

export interface DashboardData {
  today_sales: number;
  today_bills: number;
  udhaar_due: number;
  low_stock: number;
  today_expenses: number;
  top_products: { name: string; qty: number; revenue: number }[];
  recent_sales: { id: number; invoice_no: string; customer_name: string | null; total_amount: number; created_at?: string }[];
  low_stock_items: { id: number; name: string; stock_qty: number; low_stock_threshold: number }[];
  expiring_soon: ExpiringRow[];
  expiry_warning_days: number;
}

export interface SalesDayRow {
  day: string;
  bills: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
}

export interface ProfitLoss {
  revenue: number;
  cogs: number;
  gross: number;
  expenses: number;
  net: number;
  udhaar_collected: number;
}

export interface BestSellerRow {
  name: string;
  qty: number;
  revenue: number;
}

export interface StockValuation {
  cost_value: number;
  retail_value: number;
  products: number;
  by_category: { name: string | null; cost: number; retail: number; products: number }[];
}

export interface Expense {
  id: number;
  title: string;
  category: string;
  amount: number;
  expense_date: string;
  notes: string | null;
  created_at?: string;
}

function one<T>(sql: string, ...params: (string | number)[]): T {
  return getDb().prepare(sql).get(...params) as unknown as T;
}

function all<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return getDb().prepare(sql).all(...params) as unknown as T[];
}

export function getExpiryWarningDays(): number {
  const raw = getAllSettings().expiry_warning_days;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

export function listExpiringSoon(days = 30): ExpiringRow[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT p.id, p.name, p.stock_qty, p.expiry_date,
                CAST(julianday(p.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left,
                c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1 AND p.expiry_date IS NOT NULL
           AND CAST(julianday(p.expiry_date) - julianday(date('now','localtime')) AS INTEGER) <= ?
         ORDER BY p.expiry_date ASC, p.name COLLATE NOCASE
         LIMIT 50`
      )
      .all(days) as unknown as ExpiringRow[]
  );
}

export function dashboard(): DashboardData {
  const db = getDb();
  const today = one<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total, COUNT(*) AS count
     FROM sales WHERE status='completed' AND date(created_at) = date('now','localtime')`
  );
  const udhaar = one<{ due: number }>('SELECT COALESCE(SUM(balance),0) AS due FROM customers');
  const low = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM products WHERE active=1 AND low_stock_threshold > 0 AND stock_qty <= low_stock_threshold`
  );
  const expensesToday = one<{ total: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date = date('now','localtime')`
  );
  const topProducts = all<BestSellerRow>(
    `SELECT p.name AS name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.status='completed' AND date(s.created_at) >= date('now','localtime','-7 days')
     GROUP BY i.product_id ORDER BY qty DESC LIMIT 5`
  );
  const recentSales = all<DashboardData['recent_sales'][number]>(
    `SELECT s.id, s.invoice_no, c.name AS customer_name, s.total_amount, s.created_at
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.status='completed' ORDER BY s.id DESC LIMIT 5`
  );
  const lowStockItems = all<DashboardData['low_stock_items'][number]>(
    `SELECT id, name, stock_qty, low_stock_threshold FROM products
     WHERE active=1 AND low_stock_threshold > 0 AND stock_qty <= low_stock_threshold
     ORDER BY (stock_qty - low_stock_threshold) ASC LIMIT 10`
  );
  const expiryDays = getExpiryWarningDays();
  return {
    today_sales: today.total,
    today_bills: today.count,
    udhaar_due: udhaar.due,
    low_stock: low.c,
    today_expenses: expensesToday.total,
    top_products: topProducts,
    recent_sales: recentSales,
    low_stock_items: lowStockItems,
    expiring_soon: listExpiringSoon(expiryDays),
    expiry_warning_days: expiryDays,
  };
}

export function salesReport(from?: string, to?: string): SalesDayRow[] {
  return all<SalesDayRow>(
    `SELECT date(created_at) AS day, COUNT(*) AS bills,
            COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(tax_amount),0) AS tax,
            COALESCE(SUM(discount_amount),0) AS discount, COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total
     FROM sales
     WHERE status='completed'
       AND date(created_at) BETWEEN date(COALESCE(?, date('now','localtime','-30 days'))) AND date(COALESCE(?, date('now','localtime')))
     GROUP BY day ORDER BY day`,
    from ?? null,
    to ?? null
  );
}

export function profitLoss(from?: string, to?: string): ProfitLoss {
  const fromD = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const toD = to || new Date().toISOString().slice(0, 10);
  const rev = one<{ total: number }>(
    `SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total FROM sales
     WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`,
    fromD, toD
  );
  const cogs = one<{ total: number }>(
    `SELECT COALESCE(SUM(i.qty * p.cost_price),0) AS total
     FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)`,
    fromD, toD
  );
  const exp = one<{ total: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE expense_date BETWEEN date(?) AND date(?)`,
    fromD, toD
  );
  const collected = one<{ total: number }>(
    `SELECT COALESCE(SUM(-amount),0) AS total FROM customer_transactions
     WHERE type LIKE 'payment%' AND date(created_at) BETWEEN date(?) AND date(?)`,
    fromD, toD
  );
  const gross = rev.total - cogs.total;
  return {
    revenue: rev.total,
    cogs: cogs.total,
    gross,
    expenses: exp.total,
    net: gross - exp.total,
    udhaar_collected: collected.total,
  };
}

export function bestSellers(from?: string, to?: string, limit = 10): BestSellerRow[] {
  return all<BestSellerRow>(
    `SELECT p.name AS name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.status='completed'
       AND date(s.created_at) BETWEEN date(COALESCE(?, date('now','localtime','-30 days'))) AND date(COALESCE(?, date('now','localtime')))
     GROUP BY i.product_id ORDER BY qty DESC LIMIT ?`,
    from ?? null,
    to ?? null,
    limit
  );
}

export function stockValuation(): StockValuation {
  const totals = one<{ cost: number; retail: number; products: number }>(
    `SELECT COALESCE(SUM(stock_qty*cost_price),0) AS cost,
            COALESCE(SUM(stock_qty*sale_price),0) AS retail,
            COUNT(*) AS products
     FROM products WHERE active=1`
  );
  const byCategory = all<StockValuation['by_category'][number]>(
    `SELECT c.name AS name,
            COALESCE(SUM(p.stock_qty*p.cost_price),0) AS cost,
            COALESCE(SUM(p.stock_qty*p.sale_price),0) AS retail,
            COUNT(*) AS products
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.active=1 GROUP BY p.category_id ORDER BY cost DESC`
  );
  return { cost_value: totals.cost, retail_value: totals.retail, products: totals.products, by_category: byCategory };
}

export function listExpenses(from?: string, to?: string): Expense[] {
  return all<Expense>(
    `SELECT * FROM expenses
     WHERE expense_date BETWEEN date(COALESCE(?, date('now','localtime','-30 days'))) AND date(COALESCE(?, date('now','localtime')))
     ORDER BY expense_date DESC, id DESC`,
    from ?? null,
    to ?? null
  );
}

export function addExpense(input: { title: string; category: string; amount: number; expense_date?: string; notes?: string }): Expense {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO expenses (title, category, amount, expense_date, notes) VALUES (?, ?, ?, COALESCE(?, date('now','localtime')), ?)`
    )
    .run(
      input.title.trim(),
      input.category.trim() || 'Other',
      input.amount,
      input.expense_date || null,
      input.notes?.trim() || null
    );
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as Expense;
}

export function deleteExpense(id: number): boolean {
  return getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id).changes > 0;
}

export interface HourlyTrendRow {
  hour: string;
  amount: number;
}

export interface TopProductRow {
  id: number;
  name: string;
  qty_sold: number;
  revenue: number;
}

export interface DailyStats {
  total_sales: number;
  bill_count: number;
  avg_bill: number;
}

export function getDailySalesTrend(): HourlyTrendRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT strftime('%H:00', created_at) AS hour,
              COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS amount
       FROM sales
       WHERE status='completed' AND date(created_at) = date('now','localtime')
       GROUP BY strftime('%H', created_at)
       ORDER BY hour`
    )
    .all() as unknown as HourlyTrendRow[];
  const allHours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  const map = new Map(rows.map((r) => [r.hour, r.amount]));
  return allHours.map((hour) => ({ hour, amount: map.get(hour) ?? 0 }));
}

export function getTopProducts(limit = 5): TopProductRow[] {
  return all<TopProductRow>(
    `SELECT p.id, p.name, SUM(i.qty) AS qty_sold, SUM(i.line_total) AS revenue
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE DATE(s.created_at) = date('now','localtime')
       AND s.status = 'completed'
     GROUP BY p.id
     ORDER BY qty_sold DESC
     LIMIT ?`,
    limit
  );
}

export function getDailyStats(): DailyStats {
  const row = one<{ total_sales: number; bill_count: number; avg_bill: number }>(
    `SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total_sales,
            COUNT(id) AS bill_count,
            COALESCE(AVG(total_amount - COALESCE(returned_amount,0)),0) AS avg_bill
     FROM sales
     WHERE DATE(created_at) = date('now','localtime')
       AND status = 'completed'`
  );
  return {
    total_sales: row.total_sales,
    bill_count: row.bill_count,
    avg_bill: row.avg_bill,
  };
}

export function getReceiptSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM receipt_settings').all() as unknown as {
    key: string;
    value: string;
  }[];
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  return settings;
}

export function updateReceiptSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO receipt_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`
  ).run(key, value);
}