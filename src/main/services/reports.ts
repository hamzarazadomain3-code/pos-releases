import { getDb } from '../db';
import { getAllSettings } from './settings';
import { BrowserWindow, dialog } from 'electron';
import { todayLocal, formatLocalString, daysAgo } from '../utils/timezone';
import { createWriteStream } from 'fs';
import type {
  SalesAnalysisResult,
  ProductPerformanceResult,
  CustomerAnalysisResult,
  InventoryAnalysisResult,
  FinancialReportResult,
  TaxReportResult,
  DailyClosingResult,
} from '../../shared/types';
import type PDFDocument from 'pdfkit';

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
  const fromD = from || daysAgo(30);
  const toD = to || todayLocal();
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

// ============================================================
// v1.6.0 — Professional Reports (7 types) + PDF Export
// ============================================================

function dateRange(from?: string, to?: string): string[] {
  const f = from || daysAgo(30);
  const t = to || todayLocal();
  return [f, t];
}

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 10000) / 100;
}

// 1) SALES ANALYSIS
export function getSalesAnalysis(from?: string, to?: string): SalesAnalysisResult {
  const [f, t] = dateRange(from, to);
  const db = getDb();
  const summary = one<{ total_sales: number; bill_count: number; avg_bill: number; total_discount: number; total_tax: number }>(
    `SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total_sales,
            COUNT(*) AS bill_count,
            COALESCE(AVG(total_amount - COALESCE(returned_amount,0)),0) AS avg_bill,
            COALESCE(SUM(discount_amount),0) AS total_discount,
            COALESCE(SUM(tax_amount),0) AS total_tax
     FROM sales
     WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`,
    f, t
  );
  const paymentBreakdownRaw = all<{ mode: string; total: number }>(
    `SELECT p.mode AS mode, COALESCE(SUM(p.amount),0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY p.mode ORDER BY total DESC`,
    f, t
  );
  const grand = paymentBreakdownRaw.reduce((a, r) => a + r.total, 0);
  const paymentBreakdown = paymentBreakdownRaw.map((r) => ({
    mode: r.mode,
    bill_count: 0,
    total: r.total,
    percentage: pct(r.total, grand),
  }));
  const dailyTrend = all<{ date: string; bills: number; total: number }>(
    `SELECT date(created_at) AS date, COUNT(*) AS bills,
            COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total
     FROM sales
     WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)
     GROUP BY date ORDER BY date`,
    f, t
  );
  return { summary, paymentBreakdown, dailyTrend, generatedAt: new Date().toISOString() };
}

// 2) PRODUCT PERFORMANCE
export function getProductPerformance(from?: string, to?: string): ProductPerformanceResult {
  const [f, t] = dateRange(from, to);
  const db = getDb();
  const topRaw = all<{ id: number; name: string; category: string | null; qty_sold: number; times_sold: number; revenue: number; cost: number }>(
    `SELECT p.id AS id, p.name AS name, c.name AS category,
            COALESCE(SUM(si.qty),0) AS qty_sold,
            COUNT(DISTINCT si.sale_id) AS times_sold,
            COALESCE(SUM(si.line_total),0) AS revenue,
            COALESCE(SUM(si.qty * p.cost_price),0) AS cost
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id ORDER BY revenue DESC LIMIT 20`,
    f, t
  );
  const grandRev = topRaw.reduce((a, r) => a + r.revenue, 0);
  const topProducts = topRaw.map((r) => {
    const profit = r.revenue - r.cost;
    return {
      ...r,
      profit,
      profit_margin_pct: pct(profit, r.revenue),
      revenue_pct: pct(r.revenue, grandRev),
    };
  });
  const slowMovers = all<{ id: number; name: string; category: string | null; stock_qty: number; cost_price: number; sale_price: number; last_sale_date: string | null; days_no_sale: number | null }>(
    `SELECT p.id AS id, p.name AS name, c.name AS category, p.stock_qty AS stock_qty,
            p.cost_price AS cost_price, p.sale_price AS sale_price,
            MAX(s.created_at) AS last_sale_date,
            CAST(julianday(date('now','localtime')) - julianday(MAX(s.created_at)) AS INTEGER) AS days_no_sale
     FROM products p
     LEFT JOIN sale_items si ON si.product_id = p.id
     LEFT JOIN sales s ON s.id = si.sale_id AND s.status='completed'
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1
     GROUP BY p.id
     HAVING days_no_sale IS NULL OR days_no_sale > 30
     ORDER BY days_no_sale DESC`,
  );
  const categoryAnalysis = all<{ category: string | null; product_count: number; qty_sold: number; revenue: number; avg_price: number }>(
    `SELECT c.name AS category,
            COUNT(DISTINCT p.id) AS product_count,
            COALESCE(SUM(si.qty),0) AS qty_sold,
            COALESCE(SUM(si.line_total),0) AS revenue,
            COALESCE(AVG(si.unit_price),0) AS avg_price
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY p.category_id ORDER BY revenue DESC`,
    f, t
  );
  return { topProducts, slowMovers, categoryAnalysis, generatedAt: new Date().toISOString() };
}

// 3) CUSTOMER ANALYSIS
export function getCustomerAnalysis(): CustomerAnalysisResult {
  const db = getDb();
  const topCustomersRaw = all<{ id: number; name: string; phone: string | null; udhaar_balance: number; purchase_count: number; total_spent: number; last_purchase: string | null }>(
    `SELECT c.id AS id, c.name AS name, c.phone AS phone, c.balance AS udhaar_balance,
            COUNT(s.id) AS purchase_count,
            COALESCE(SUM(s.total_amount - COALESCE(s.returned_amount,0)),0) AS total_spent,
            MAX(s.created_at) AS last_purchase
     FROM customers c
     LEFT JOIN sales s ON s.customer_id = c.id AND s.status='completed'
     GROUP BY c.id ORDER BY total_spent DESC LIMIT 20`
  );
  const topCustomers = topCustomersRaw.map((r) => {
    let segment: 'VIP' | 'Regular' | 'Udhaar' = 'Regular';
    if (r.udhaar_balance > 0) segment = 'Udhaar';
    else if (r.purchase_count > 10) segment = 'VIP';
    return {
      ...r,
      avg_purchase: r.purchase_count ? r.total_spent / r.purchase_count : 0,
      segment,
    };
  });
  const udhaarSummary = one<{ total_customers: number; with_balance: number; cleared: number; total_outstanding: number; avg_balance: number | null; max_balance: number }>(
    `SELECT COUNT(*) AS total_customers,
            COALESCE(SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END),0) AS with_balance,
            COALESCE(SUM(CASE WHEN balance = 0 THEN 1 ELSE 0 END),0) AS cleared,
            COALESCE(SUM(balance),0) AS total_outstanding,
            AVG(CASE WHEN balance > 0 THEN balance ELSE NULL END) AS avg_balance,
            COALESCE(MAX(balance),0) AS max_balance
     FROM customers`
  );
  const udhaarOverdue = all<{ id: number; name: string; phone: string | null; balance: number; last_purchase: string | null; days_since_purchase: number | null }>(
    `SELECT c.id AS id, c.name AS name, c.phone AS phone, c.balance AS balance,
            MAX(s.created_at) AS last_purchase,
            CAST(julianday(date('now','localtime')) - julianday(MAX(s.created_at)) AS INTEGER) AS days_since_purchase
     FROM customers c
     LEFT JOIN sales s ON s.customer_id = c.id AND s.status='completed'
     WHERE c.balance > 0
     GROUP BY c.id
     HAVING last_purchase IS NULL OR date(last_purchase) < date('now','localtime','-30 days')
     ORDER BY balance DESC`
  );
  return { topCustomers, udhaarSummary, udhaarOverdue, generatedAt: new Date().toISOString() };
}

// 4) INVENTORY ANALYSIS
export function getInventoryAnalysis(): InventoryAnalysisResult {
  const db = getDb();
  const stockSummary = one<{ total_skus: number; total_value: number; out_of_stock: number; below_minimum: number }>(
    `SELECT COUNT(*) AS total_skus,
            COALESCE(SUM(stock_qty * cost_price),0) AS total_value,
            COALESCE(SUM(CASE WHEN stock_qty = 0 THEN 1 ELSE 0 END),0) AS out_of_stock,
            COALESCE(SUM(CASE WHEN low_stock_threshold > 0 AND stock_qty <= low_stock_threshold THEN 1 ELSE 0 END),0) AS below_minimum
     FROM products WHERE active = 1`
  );
  const expiryAlertRaw = all<{ id: number; name: string; category: string | null; stock_qty: number; expiry_date: string; days_until_expiry: number | null }>(
    `SELECT p.id AS id, p.name AS name, c.name AS category, p.stock_qty AS stock_qty, p.expiry_date AS expiry_date,
            CAST(julianday(p.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_until_expiry
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1 AND p.expiry_date IS NOT NULL
     ORDER BY p.expiry_date ASC`
  );
  const expiryAlert = expiryAlertRaw.map((r) => {
    const d = r.days_until_expiry ?? 999;
    let status: 'EXPIRED' | 'URGENT' | 'WARNING' | 'OK' = 'OK';
    if (d <= 0) status = 'EXPIRED';
    else if (d <= 7) status = 'URGENT';
    else if (d <= 30) status = 'WARNING';
    return { ...r, days_until_expiry: d, status };
  });
  const turnoverRaw = all<{ id: number; name: string; stock_qty: number; last_sale_date: string | null; days_no_sale: number | null }>(
    `SELECT p.id AS id, p.name AS name, p.stock_qty AS stock_qty,
            MAX(s.created_at) AS last_sale_date,
            CAST(julianday(date('now','localtime')) - julianday(MAX(s.created_at)) AS INTEGER) AS days_no_sale
     FROM products p
     LEFT JOIN sale_items si ON si.product_id = p.id
     LEFT JOIN sales s ON s.id = si.sale_id AND s.status='completed'
     WHERE p.active = 1
     GROUP BY p.id`
  );
  const turnoverAnalysis = turnoverRaw
    .map((r) => {
      const d = r.days_no_sale;
      let velocity: 'Fast Mover' | 'Medium' | 'Slow' | 'Dead Stock' = 'Dead Stock';
      if (d == null) velocity = 'Dead Stock';
      else if (d < 7) velocity = 'Fast Mover';
      else if (d < 30) velocity = 'Medium';
      else if (d < 90) velocity = 'Slow';
      return { ...r, velocity };
    })
    .sort((a, b) => (a.days_no_sale ?? 999999) - (b.days_no_sale ?? 999999));
  return { stockSummary, expiryAlert, turnoverAnalysis, generatedAt: new Date().toISOString() };
}

// 5) FINANCIAL P&L (extended with margins + expenses)
export function getFinancialReport(from?: string, to?: string): FinancialReportResult {
  const [f, t] = dateRange(from, to);
  const gross_sales = one<{ v: number }>(`SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS v FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`, f, t).v;
  const discounts = one<{ v: number }>(`SELECT COALESCE(SUM(discount_amount),0) AS v FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`, f, t).v;
  const net_sales = one<{ v: number }>(`SELECT COALESCE(SUM(subtotal),0) AS v FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`, f, t).v;
  const cogs = one<{ v: number }>(
    `SELECT COALESCE(SUM(si.qty * p.cost_price),0) AS v
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)`,
    f, t
  ).v;
  const tax_paid = one<{ v: number }>(`SELECT COALESCE(SUM(tax_amount),0) AS v FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`, f, t).v;
  const expenses = one<{ v: number }>(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_date BETWEEN date(?) AND date(?)`, f, t).v;
  const gross_profit = net_sales - cogs;
  const net_profit = gross_profit - tax_paid;
  return {
    pnl: { gross_sales, discounts, net_sales, cogs, gross_profit, tax_paid, net_profit, expenses },
    margins: { gross_margin_pct: pct(gross_profit, net_sales), net_margin_pct: pct(net_profit, net_sales) },
    generatedAt: new Date().toISOString(),
  };
}

// 6) TAX REPORT (Pakistan FBR-style GST 17% inclusive)
export function getTaxReport(from?: string, to?: string): TaxReportResult {
  const [f, t] = dateRange(from, to);
  const db = getDb();
  const taxSummary = one<{ taxable_sales: number; tax_collected: number; transaction_count: number }>(
    `SELECT COALESCE(SUM(subtotal),0) AS taxable_sales,
            COALESCE(SUM(tax_amount),0) AS tax_collected,
            COUNT(*) AS transaction_count
     FROM sales
     WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`,
    f, t
  );
  const taxByCategory = all<{ category: string | null; sales: number; estimated_gst_17pct: number }>(
    `SELECT c.name AS category,
            COALESCE(SUM(si.line_total),0) AS sales,
            COALESCE(SUM(si.line_total * 17.0 / 117.0),0) AS estimated_gst_17pct
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status='completed' AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY p.category_id ORDER BY sales DESC`,
    f, t
  );
  return { taxSummary, taxByCategory, period: { startDate: f, endDate: t }, generatedAt: new Date().toISOString() };
}

// 7) DAILY CLOSING
export function getDailyClosing(date: string): DailyClosingResult {
  const db = getDb();
  const totals = one<{ bill_count: number; total_sales: number }>(
    `SELECT COUNT(*) AS bill_count,
            COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total_sales
     FROM sales WHERE status='completed' AND date(created_at) = date(?)`,
    date
  );
  const byMode = all<{ mode: string; total: number }>(
    `SELECT p.mode AS mode, COALESCE(SUM(p.amount),0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status='completed' AND date(s.created_at) = date(?)
     GROUP BY p.mode ORDER BY total DESC`,
    date
  );
  const expenses = one<{ v: number }>(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_date = date(?)`, date).v;
  const cashRow = byMode.find((r) => r.mode.toLowerCase() === 'cash');
  const expected_cash = cashRow ? cashRow.total : 0;
  return {
    date,
    bill_count: totals.bill_count,
    total_sales: totals.total_sales,
    by_mode: byMode,
    expenses,
    expected_cash,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// PDF EXPORT
// ============================================================

function pdfHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#666')
    .text(`Generated: ${formatLocalString(new Date())}`, { align: 'center' });
  doc.fillColor('#000').moveDown(0.8);
}

function pdfKvTable(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
  const startX = 50;
  const labelW = 180;
  doc.fontSize(10).font('Helvetica');
  rows.forEach(([k, v], i) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').text(k, startX, y, { width: labelW });
    doc.font('Helvetica').text(v, startX + labelW, y, { width: 360 });
    doc.moveDown(0.3);
  });
  doc.moveDown(0.5);
}

function pdfGridTable(doc: PDFKit.PDFDocument, headers: string[], rows: (string | number)[][]): void {
  if (rows.length === 0) {
    doc.fontSize(10).fillColor('#888').text('(no data)').fillColor('#000').moveDown(0.5);
    return;
  }
  const colW = Math.floor(500 / headers.length);
  const startX = 50;
  let y = doc.y;
  doc.fontSize(9).font('Helvetica-Bold');
  headers.forEach((h, i) => doc.text(h, startX + i * colW, y, { width: colW }));
  y += 16;
  doc.moveTo(startX, y).lineTo(550, y).stroke();
  y += 4;
  doc.font('Helvetica').fontSize(9);
  for (const row of rows) {
    if (y > 750) { doc.addPage(); y = 50; }
    row.forEach((cell, i) => {
      const s = typeof cell === 'number' ? cell.toLocaleString() : String(cell ?? '');
      doc.text(s, startX + i * colW, y, { width: colW });
    });
    y += 14;
  }
  doc.moveDown(1);
}

function fmt(n: number): string {
  return (n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export async function exportReportPDF(reportType: string, data: unknown): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const defaultName = `${reportType}-report-${todayLocal()}.pdf`;
  const result = win
    ? await dialog.showSaveDialog(win, {
        title: `Save ${reportType} report as PDF`,
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    : { canceled: true, filePath: undefined as string | undefined };
  if (result.canceled || !result.filePath) return null;
  const filePath = result.filePath;

  const PDFDocumentMod = require('pdfkit');
  const doc = new PDFDocumentMod({ margin: 50, size: 'A4' });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  const d = data as any;
  switch (reportType) {
    case 'sales': {
      pdfHeader(doc, 'Sales Analysis');
      pdfKvTable(doc, [
        ['Total Sales', `Rs ${fmt(d.summary.total_sales)}`],
        ['Bill Count', String(d.summary.bill_count)],
        ['Avg Bill', `Rs ${fmt(d.summary.avg_bill)}`],
        ['Total Discount', `Rs ${fmt(d.summary.total_discount)}`],
        ['Total Tax', `Rs ${fmt(d.summary.total_tax)}`],
      ]);
      pdfGridTable(doc, ['Mode', 'Total (Rs)', '%'], d.paymentBreakdown.map((r: any) => [r.mode, fmt(r.total), `${r.percentage}%`]));
      pdfGridTable(doc, ['Date', 'Bills', 'Sales (Rs)'], d.dailyTrend.map((r: any) => [r.date, r.bills, fmt(r.total)]));
      break;
    }
    case 'products': {
      pdfHeader(doc, 'Product Performance');
      pdfGridTable(doc, ['Product', 'Category', 'Qty', 'Revenue', 'Margin %', '% of Total'], d.topProducts.map((p: any) => [p.name, p.category ?? '', fmt(p.qty_sold), fmt(p.revenue), `${p.profit_margin_pct}%`, `${p.revenue_pct}%`]));
      pdfGridTable(doc, ['Product', 'Category', 'Stock', 'Days No Sale'], d.slowMovers.map((p: any) => [p.name, p.category ?? '', fmt(p.stock_qty), p.days_no_sale ?? '—']));
      pdfGridTable(doc, ['Category', 'Products', 'Qty Sold', 'Revenue'], d.categoryAnalysis.map((c: any) => [c.category ?? 'Uncategorised', c.product_count, fmt(c.qty_sold), fmt(c.revenue)]));
      break;
    }
    case 'customers': {
      pdfHeader(doc, 'Customer Analysis');
      pdfKvTable(doc, [
        ['Total Customers', String(d.udhaarSummary.total_customers)],
        ['With Balance', String(d.udhaarSummary.with_balance)],
        ['Cleared', String(d.udhaarSummary.cleared)],
        ['Total Outstanding', `Rs ${fmt(d.udhaarSummary.total_outstanding)}`],
        ['Avg Balance', `Rs ${fmt(d.udhaarSummary.avg_balance)}`],
        ['Max Balance', `Rs ${fmt(d.udhaarSummary.max_balance)}`],
      ]);
      pdfGridTable(doc, ['Customer', 'Phone', 'Purchases', 'Total Spent', 'Segment'], d.topCustomers.map((c: any) => [c.name, c.phone ?? '', c.purchase_count, fmt(c.total_spent), c.segment]));
      if (d.udhaarOverdue.length) {
        doc.addPage();
        pdfGridTable(doc, ['Customer', 'Phone', 'Outstanding', 'Days'], d.udhaarOverdue.map((c: any) => [c.name, c.phone ?? '', fmt(c.balance), c.days_since_purchase ?? '—']));
      }
      break;
    }
    case 'inventory': {
      pdfHeader(doc, 'Inventory Analysis');
      pdfKvTable(doc, [
        ['Total SKUs', String(d.stockSummary.total_skus)],
        ['Total Value (cost)', `Rs ${fmt(d.stockSummary.total_value)}`],
        ['Out of Stock', String(d.stockSummary.out_of_stock)],
        ['Below Minimum', String(d.stockSummary.below_minimum)],
      ]);
      const exp = d.expiryAlert.filter((e: any) => e.status !== 'OK');
      pdfGridTable(doc, ['Product', 'Category', 'Stock', 'Expiry', 'Days', 'Status'], exp.map((e: any) => [e.name, e.category ?? '', fmt(e.stock_qty), e.expiry_date, e.days_until_expiry, e.status]));
      pdfGridTable(doc, ['Product', 'Stock', 'Velocity', 'Days No Sale'], d.turnoverAnalysis.map((t: any) => [t.name, fmt(t.stock_qty), t.velocity, t.days_no_sale ?? '—']));
      break;
    }
    case 'financial': {
      pdfHeader(doc, 'Profit & Loss Statement');
      const p = d.pnl;
      pdfKvTable(doc, [
        ['Gross Sales', `Rs ${fmt(p.gross_sales)}`],
        ['Discounts', `-Rs ${fmt(p.discounts)}`],
        ['Net Sales', `Rs ${fmt(p.net_sales)}`],
        ['Cost of Goods', `-Rs ${fmt(p.cogs)}`],
        [`Gross Profit (${d.margins.gross_margin_pct}%)`, `Rs ${fmt(p.gross_profit)}`],
        ['Tax Paid', `-Rs ${fmt(p.tax_paid)}`],
        [`NET PROFIT (${d.margins.net_margin_pct}%)`, `Rs ${fmt(p.net_profit)}`],
        ['Expenses', `-Rs ${fmt(p.expenses)}`],
      ]);
      break;
    }
    case 'tax': {
      pdfHeader(doc, `Tax Report (${d.period.startDate} → ${d.period.endDate})`);
      pdfKvTable(doc, [
        ['Taxable Sales', `Rs ${fmt(d.taxSummary.taxable_sales)}`],
        ['Tax Collected', `Rs ${fmt(d.taxSummary.tax_collected)}`],
        ['Transactions', String(d.taxSummary.transaction_count)],
      ]);
      pdfGridTable(doc, ['Category', 'Sales (Rs)', 'Est. GST 17% (Rs)'], d.taxByCategory.map((t: any) => [t.category ?? 'Uncategorised', fmt(t.sales), fmt(t.estimated_gst_17pct)]));
      break;
    }
    case 'closing': {
      pdfHeader(doc, `Daily Closing — ${d.date}`);
      pdfKvTable(doc, [
        ['Total Sales', `Rs ${fmt(d.total_sales)}`],
        ['Bill Count', String(d.bill_count)],
        ['Expenses', `-Rs ${fmt(d.expenses)}`],
        ['Expected Cash', `Rs ${fmt(d.expected_cash)}`],
      ]);
      pdfGridTable(doc, ['Mode', 'Total (Rs)'], d.by_mode.map((m: any) => [m.mode, fmt(m.total)]));
      break;
    }
    default: {
      pdfHeader(doc, 'Report');
      doc.fontSize(10).text(JSON.stringify(d, null, 2));
    }
  }

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve(filePath)));
}

export async function exportReportExcel(reportType: string, data: unknown): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const defaultName = `${reportType}-report-${todayLocal()}.xlsx`;
  const result = win
    ? await dialog.showSaveDialog(win, {
        title: `Save ${reportType} report as Excel`,
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
    : { canceled: true, filePath: undefined as string | undefined };
  if (result.canceled || !result.filePath) return null;
  const filePath = result.filePath;

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const d = data as any;

  function addSheet(name: string, headers: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }

  switch (reportType) {
    case 'sales': {
      addSheet('Summary', ['Metric', 'Value'], [
        ['Total Sales', fmt(d.summary.total_sales)],
        ['Bill Count', d.summary.bill_count],
        ['Avg Bill', fmt(d.summary.avg_bill)],
        ['Total Discount', fmt(d.summary.total_discount)],
        ['Total Tax', fmt(d.summary.total_tax)],
      ]);
      addSheet('Payment Breakdown', ['Mode', 'Total (Rs)', '%'], d.paymentBreakdown.map((r: any) => [r.mode, r.total, r.percentage]));
      addSheet('Daily Trend', ['Date', 'Bills', 'Sales (Rs)'], d.dailyTrend.map((r: any) => [r.date, r.bills, r.total]));
      break;
    }
    case 'products': {
      addSheet('Top Products', ['Product', 'Category', 'Qty', 'Revenue', 'Margin %', '% of Total'], d.topProducts.map((p: any) => [p.name, p.category ?? '', p.qty_sold, p.revenue, p.profit_margin_pct, p.revenue_pct]));
      addSheet('Slow Movers', ['Product', 'Category', 'Stock', 'Days No Sale'], d.slowMovers.map((p: any) => [p.name, p.category ?? '', p.stock_qty, p.days_no_sale ?? '']));
      addSheet('Categories', ['Category', 'Products', 'Qty Sold', 'Revenue'], d.categoryAnalysis.map((c: any) => [c.category ?? 'Uncategorised', c.product_count, c.qty_sold, c.revenue]));
      break;
    }
    case 'customers': {
      addSheet('Summary', ['Metric', 'Value'], [
        ['Total Customers', d.udhaarSummary.total_customers],
        ['With Balance', d.udhaarSummary.with_balance],
        ['Total Outstanding', d.udhaarSummary.total_outstanding],
        ['Avg Balance', d.udhaarSummary.avg_balance],
      ]);
      addSheet('Top Customers', ['Customer', 'Phone', 'Purchases', 'Total Spent', 'Segment'], d.topCustomers.map((c: any) => [c.name, c.phone ?? '', c.purchase_count, c.total_spent, c.segment]));
      if (d.udhaarOverdue.length) {
        addSheet('Overdue', ['Customer', 'Phone', 'Outstanding', 'Days'], d.udhaarOverdue.map((c: any) => [c.name, c.phone ?? '', c.balance, c.days_since_purchase ?? '']));
      }
      break;
    }
    case 'inventory': {
      addSheet('Stock Summary', ['Metric', 'Value'], [
        ['Total SKUs', d.stockSummary.total_skus],
        ['Total Value (cost)', d.stockSummary.total_value],
        ['Out of Stock', d.stockSummary.out_of_stock],
        ['Below Minimum', d.stockSummary.below_minimum],
      ]);
      const exp = d.expiryAlert.filter((e: any) => e.status !== 'OK');
      addSheet('Expiry Alerts', ['Product', 'Category', 'Stock', 'Expiry', 'Days', 'Status'], exp.map((e: any) => [e.name, e.category ?? '', e.stock_qty, e.expiry_date, e.days_until_expiry, e.status]));
      addSheet('Turnover', ['Product', 'Stock', 'Velocity', 'Days No Sale'], d.turnoverAnalysis.map((t: any) => [t.name, t.stock_qty, t.velocity, t.days_no_sale ?? '']));
      break;
    }
    case 'financial': {
      const p = d.pnl;
      addSheet('Profit & Loss', ['Metric', 'Value'], [
        ['Gross Sales', p.gross_sales],
        ['Discounts', -p.discounts],
        ['Net Sales', p.net_sales],
        ['Cost of Goods', -p.cogs],
        [`Gross Profit (${d.margins.gross_margin_pct}%)`, p.gross_profit],
        ['Tax Paid', -p.tax_paid],
        [`NET PROFIT (${d.margins.net_margin_pct}%)`, p.net_profit],
        ['Expenses', -p.expenses],
      ]);
      break;
    }
    case 'tax': {
      addSheet('Tax Summary', ['Metric', 'Value'], [
        ['Taxable Sales', d.taxSummary.taxable_sales],
        ['Tax Collected', d.taxSummary.tax_collected],
        ['Transactions', d.taxSummary.transaction_count],
      ]);
      addSheet('By Category', ['Category', 'Sales (Rs)', 'Est. GST 17% (Rs)'], d.taxByCategory.map((t: any) => [t.category ?? 'Uncategorised', t.sales, t.estimated_gst_17pct]));
      break;
    }
    case 'closing': {
      addSheet('Daily Closing', ['Metric', 'Value'], [
        ['Date', d.date],
        ['Total Sales', d.total_sales],
        ['Bill Count', d.bill_count],
        ['Expenses', -d.expenses],
        ['Expected Cash', d.expected_cash],
      ]);
      addSheet('By Payment Mode', ['Mode', 'Total (Rs)'], d.by_mode.map((m: any) => [m.mode, m.total]));
      break;
    }
    default: {
      addSheet('Report', ['Data'], [[JSON.stringify(d, null, 2)]]);
    }
  }

  XLSX.writeFile(wb, filePath);
  return filePath;
}