import { getDb } from '../db';
import { formatDateYMD } from '../utils/timezone';

export interface ProductProfitRow {
  product_id: number;
  product_name: string;
  category: string | null;
  period: string;
  units_sold: number;
  cost_of_goods: number;
  revenue: number;
  gross_profit: number;
  profit_margin_pct: number;
  avg_cost: number;
  avg_selling_price: number;
}

export interface CategoryProfitRow {
  category_name: string | null;
  product_count: number;
  units_sold: number;
  revenue: number;
  cost_of_goods: number;
  gross_profit: number;
  profit_margin_pct: number;
}

export interface LowProfitRow {
  product_id: number;
  product_name: string;
  cost_price: number;
  sale_price: number;
  profit_per_unit: number;
  margin_pct: number;
  sold_last_30days: number;
  stock_qty: number;
}

export interface WorstProductRow {
  product_id: number;
  product_name: string;
  category: string | null;
  units_sold: number;
  revenue: number;
  cogs: number;
  total_profit: number;
  profit_margin_pct: number | null;
  stock_qty: number;
  days_no_sale: number | null;
}

export interface BreakEvenRow {
  product_id: number;
  product_name: string;
  cost_price: number;
  sale_price: number;
  break_even_price: number;
  units_to_breakeven: number | null;
  status: string;
}

function fmtQty(q: number | null | undefined): number {
  const v = Number(q ?? 0);
  return isNaN(v) ? 0 : v;
}

export class ProfitabilityService {
  private get db() {
    return getDb();
  }

  // ── Core period profitability query (shared logic) ──

  private computeProfitability(startDate: string, endDate: string): ProductProfitRow[] {
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        c.name AS category,
        SUM(si.qty) AS units_sold,
        SUM(si.qty * COALESCE(p.cost_price, 0)) AS cost_of_goods,
        SUM(si.line_total) AS revenue,
        SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0)) AS gross_profit,
        CASE
          WHEN SUM(si.line_total) = 0 THEN 0
          ELSE ROUND((SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0))) / SUM(si.line_total) * 100, 2)
        END AS profit_margin_pct,
        ROUND(COALESCE(AVG(p.cost_price), 0), 2) AS avg_cost,
        ROUND(COALESCE(AVG(si.price), 0), 2) AS avg_selling_price
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.status = 'completed'
        AND DATE(s.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY p.id, p.name, c.name
      ORDER BY gross_profit DESC
    `;

    const rows = this.db.prepare(query).all(startDate, endDate) as unknown as ProductProfitRow[];
    // Compute the period label
    const period = `${startDate} to ${endDate}`;
    return rows.map((r) => ({
      ...r,
      units_sold: fmtQty(r.units_sold),
      cost_of_goods: Number(r.cost_of_goods) || 0,
      revenue: Number(r.revenue) || 0,
      gross_profit: Number(r.gross_profit) || 0,
      profit_margin_pct: Number(r.profit_margin_pct) || 0,
      avg_cost: Number(r.avg_cost) || 0,
      avg_selling_price: Number(r.avg_selling_price) || 0,
      period,
    }));
  }

  // ── 1. DAILY ──

  getDailyProfitability(date: string): ProductProfitRow[] {
    return this.computeProfitability(date, date);
  }

  // ── 2. WEEKLY ──

  getWeeklyProfitability(weekStart: string, weekEnd: string): ProductProfitRow[] {
    return this.computeProfitability(weekStart, weekEnd);
  }

  // ── 3. MONTHLY ──

  getMonthlyProfitability(year: number, month: number): ProductProfitRow[] {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = formatDateYMD(new Date(year, month, 0));
    return this.computeProfitability(startDate, endDate);
  }

  // ── 4. CATEGORY PROFITABILITY ──

  getCategoryProfitability(startDate: string, endDate: string): CategoryProfitRow[] {
    const query = `
      SELECT
        c.name AS category_name,
        COUNT(DISTINCT p.id) AS product_count,
        SUM(si.qty) AS units_sold,
        SUM(si.line_total) AS revenue,
        SUM(si.qty * COALESCE(p.cost_price, 0)) AS cost_of_goods,
        SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0)) AS gross_profit,
        CASE
          WHEN SUM(si.line_total) = 0 THEN 0
          ELSE ROUND((SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0))) / SUM(si.line_total) * 100, 2)
        END AS profit_margin_pct
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.status = 'completed'
        AND DATE(s.created_at) BETWEEN DATE(?) AND DATE(?)
      GROUP BY c.id, c.name
      ORDER BY gross_profit DESC
    `;

    return this.db.prepare(query).all(startDate, endDate) as unknown as CategoryProfitRow[];
  }

  // ── 5. LOW PROFIT PRODUCTS ──

  getLowProfitProducts(threshold: number = 5): LowProfitRow[] {
    // Uses 10% threshold as default in break-even, but low-profit detection uses parameter
    const actualThreshold = threshold !== 0 ? threshold : 5;
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.cost_price,
        p.sale_price,
        ROUND(p.sale_price - p.cost_price, 2) AS profit_per_unit,
        CASE
          WHEN p.sale_price = 0 THEN 0
          ELSE ROUND((p.sale_price - p.cost_price) / p.sale_price * 100, 2)
        END AS margin_pct,
        COALESCE((
          SELECT SUM(si.qty)
          FROM sale_items si JOIN sales s ON si.sale_id = s.id
          WHERE si.product_id = p.id
            AND DATE(s.created_at) >= DATE('now', '-30 days')
            AND s.status = 'completed'
        ), 0) AS sold_last_30days,
        p.stock_qty
      FROM products p
      WHERE p.active = 1
        AND p.sale_price > 0
        AND p.cost_price > 0
        AND (p.sale_price - p.cost_price) / p.sale_price * 100 < ?
      ORDER BY margin_pct ASC
    `;

    return this.db.prepare(query).all(actualThreshold * 100) as unknown as LowProfitRow[];
  }

  // ── 6. TOP PROFIT PRODUCTS ──

  getTopProfitProducts(limit: number = 10, days: number = 30): ProductProfitRow[] {
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        c.name AS category,
        SUM(si.qty) AS units_sold,
        SUM(si.line_total) AS revenue,
        SUM(si.qty * COALESCE(p.cost_price, 0)) AS cost_of_goods,
        SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0)) AS gross_profit,
        CASE
          WHEN SUM(si.line_total) = 0 THEN 0
          ELSE ROUND((SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0))) / SUM(si.line_total) * 100, 2)
        END AS profit_margin_pct,
        ROUND(COALESCE(AVG(p.cost_price), 0), 2) AS avg_cost,
        ROUND(COALESCE(AVG(si.price), 0), 2) AS avg_selling_price,
        MIN(s.created_at) AS period_start,
        MAX(s.created_at) AS period_end
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.status = 'completed'
        AND DATE(s.created_at) >= DATE('now', '-${days} days')
      GROUP BY p.id, p.name, c.name
      ORDER BY gross_profit DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(limit) as unknown as (ProductProfitRow & { period_start: string; period_end: string })[];
    return rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      category: r.category,
      period: `${r.period_start} to ${r.period_end}`,
      units_sold: fmtQty(r.units_sold),
      cost_of_goods: Number(r.cost_of_goods) || 0,
      revenue: Number(r.revenue) || 0,
      gross_profit: Number(r.gross_profit) || 0,
      profit_margin_pct: Number(r.profit_margin_pct) || 0,
      avg_cost: Number(r.avg_cost) || 0,
      avg_selling_price: Number(r.avg_selling_price) || 0,
    }));
  }

  // ── 7. WORST PERFORMING ──

  getWorstPerformingProducts(limit: number = 10, days: number = 30): WorstProductRow[] {
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        c.name AS category,
        COALESCE(SUM(si.qty), 0) AS units_sold,
        COALESCE(SUM(si.line_total), 0) AS revenue,
        COALESCE(SUM(si.qty * COALESCE(p.cost_price, 0)), 0) AS cogs,
        COALESCE(SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0)), 0) AS total_profit,
        CASE
          WHEN SUM(si.line_total) IS NULL OR SUM(si.line_total) = 0 THEN NULL
          ELSE ROUND((SUM(si.line_total) - SUM(si.qty * COALESCE(p.cost_price, 0))) / SUM(si.line_total) * 100, 2)
        END AS profit_margin_pct,
        p.stock_qty,
        CASE
          WHEN SUM(si.qty) IS NULL THEN CAST(julianday('now', 'localtime') - julianday(MAX(p.updated_at)) AS INTEGER)
          ELSE CAST(julianday('now', 'localtime') - julianday(MAX(s.created_at)) AS INTEGER)
        END AS days_no_sale
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      LEFT JOIN sales s ON si.sale_id = s.id AND s.status = 'completed'
        AND DATE(s.created_at) >= DATE('now', '-${days} days')
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1
      GROUP BY p.id, p.name, c.name, p.stock_qty
      ORDER BY COALESCE(SUM(si.qty), 0) ASC
      LIMIT ?
    `;

    return this.db.prepare(query).all(limit) as unknown as WorstProductRow[];
  }

  // ── 8. BREAK-EVEN ANALYSIS ──

  getBreakEvenAnalysis(): BreakEvenRow[] {
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.cost_price,
        p.sale_price,
        ROUND(p.cost_price / (1 - 0.10), 2) AS break_even_price,
        CASE
          WHEN p.sale_price = 0 OR p.sale_price < (p.cost_price / (1 - 0.10))
          THEN NULL
          ELSE CAST(CEIL((p.cost_price * 100) / (p.sale_price * (1 - 0.10))) AS INTEGER)
        END AS units_to_breakeven,
        CASE
          WHEN p.sale_price >= (p.cost_price / (1 - 0.10)) THEN 'Profitable'
          WHEN p.sale_price > 0 THEN 'Below Break-Even'
          ELSE 'No Price'
        END AS status
      FROM products p
      WHERE p.active = 1 AND p.cost_price > 0
      ORDER BY p.name ASC
    `;

    return this.db.prepare(query).all() as unknown as BreakEvenRow[];
  }

  // ── 9. COMPUTE & STORE PERIOD PROFITABILITY ──

  computePeriodProfitability(date: string): Promise<void> {
    const start = `${date.substring(0, 8)}01`;
    const end = formatDateYMD(new Date(Number(date.substring(0, 4)), Number(date.substring(5, 7)), 0));

    const data = this.computeProfitability(start, end);

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO product_profitability
        (product_id, period_start, period_end, units_sold, cost_of_goods,
         revenue, gross_profit, profit_margin_pct, avg_selling_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      for (const row of data) {
        insert.run(
          row.product_id, start, end,
          row.units_sold, row.cost_of_goods, row.revenue,
          row.gross_profit, row.profit_margin_pct, row.avg_selling_price
        );
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }

    return Promise.resolve();
  }
}

let profitabilityServiceInstance: ProfitabilityService | null = null;

export function getProfitabilityService(): ProfitabilityService {
  if (!profitabilityServiceInstance) {
    profitabilityServiceInstance = new ProfitabilityService();
  }
  return profitabilityServiceInstance;
}
