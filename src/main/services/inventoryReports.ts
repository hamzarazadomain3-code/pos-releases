import { getDb } from '../db';
import { formatDateYMD } from '../utils/timezone';

// ── Types ──

export interface PurchaseHistoryRow {
  id: number;
  product_id: number;
  product_name: string;
  supplier_name: string;
  supplier_id: number;
  quantity_ordered: number;
  quantity_received: number | null;
  unit_name: string | null;
  cost_per_unit: number;
  total_cost: number;
  order_date: string;
  delivery_date: string | null;
  delivery_status: string;
  batch_number: string | null;
  expiry_date: string | null;
}

export interface DailyInventoryRow {
  product_id: number;
  product_name: string;
  unit_name: string | null;
  opening_qty: number;
  purchases_qty: number;
  sales_qty: number;
  closing_qty: number;
  variance_qty: number;
  stock_qty: number;
}

export interface WeeklyInventoryRow {
  product_id: number;
  product_name: string;
  unit_name: string | null;
  opening_qty: number;
  purchases_qty: number;
  sales_qty: number;
  variance_qty: number;
  days_tracked: number;
}

export interface MonthlyInventoryRow {
  product_id: number;
  product_name: string;
  category_name: string | null;
  total_purchased: number;
  total_sold: number;
  supplier_count: number;
  avg_cost: number;
  avg_selling_price: number;
  current_stock: number;
  unit_name: string | null;
}

export interface SupplierMetricRow {
  supplier_id: number;
  supplier_name: string;
  total_orders: number;
  total_spent: number;
  on_time_pct: number;
  average_cost: number;
  reliability_score: number;
  last_order_date: string | null;
  first_order_date: string | null;
  is_active: number;
}

export interface ProductPurchaseSummaryRow {
  id: number;
  order_date: string;
  supplier_name: string;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  delivery_status: string;
  expiry_date: string | null;
  batch_number: string | null;
  qty_sold_since: number;
}

export interface SnapshotResult {
  created: number;
  date: string;
}

// ── Helpers ──

function fmtQty(q: number | null | undefined): number {
  const v = Number(q ?? 0);
  return isNaN(v) ? 0 : v;
}

// ── Core Service ──

export class InventoryReportsService {
  private get db() {
    return getDb();
  }

  // ── 1. PURCHASE HISTORY ──

  getPurchaseHistory(productId?: number, dateRange?: { start: string; end: string }): PurchaseHistoryRow[] {
    let query = `
      SELECT
        pi.id,
        pi.product_id,
        p.name AS product_name,
        s.name AS supplier_name,
        s.id AS supplier_id,
        COALESCE(pi.quantity_ordered, pi.qty) AS quantity_ordered,
        pi.quantity_received,
        pi.unit_name,
        pi.unit_cost AS cost_per_unit,
        COALESCE(pi.total_cost, (pi.qty * pi.unit_cost)) AS total_cost,
        po.created_at AS order_date,
        po.delivery_date,
        pi.expiry_date,
        pi.batch_number,
        CASE
          WHEN po.delivery_date IS NULL THEN 'Pending'
          WHEN DATE(po.delivery_date) <= DATE(po.created_at, '+7 days') THEN 'On Time'
          ELSE 'Late'
        END AS delivery_status
      FROM purchase_items pi
      JOIN purchase_orders po ON pi.purchase_order_id = po.id
      JOIN products p ON pi.product_id = p.id
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (productId != null) {
      query += ' AND pi.product_id = ?';
      params.push(productId);
    }

    if (dateRange) {
      query += ' AND DATE(po.created_at) BETWEEN DATE(?) AND DATE(?)';
      params.push(dateRange.start, dateRange.end);
    }

    query += ' ORDER BY po.created_at DESC, pi.id DESC';

    return this.db.prepare(query).all(...params) as unknown as PurchaseHistoryRow[];
  }

  // ── 2. DAILY INVENTORY ──

  computeDailyInventory(date: string): DailyInventoryRow[] {
    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        pu.name AS unit_name,
        -- Opening: previous day's closing OR current stock if no snapshot
        COALESCE(
          (SELECT s.closing_qty FROM inventory_snapshots s
           WHERE s.product_id = p.id AND s.snapshot_date = DATE(?, '-1 day')),
          p.stock_qty
        ) AS opening_qty,
        -- Purchases: received on this date
        COALESCE(
          (SELECT SUM(COALESCE(pi.quantity_received, pi.qty))
           FROM purchase_items pi
           JOIN purchase_orders po ON pi.purchase_order_id = po.id
           WHERE pi.product_id = p.id
             AND po.status = 'received'
             AND DATE(po.delivery_date) = DATE(?)
          ), 0
        ) AS purchases_qty,
        -- Sales: sold on this date
        COALESCE(
          (SELECT SUM(si.qty)
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           WHERE si.product_id = p.id AND DATE(s.created_at) = DATE(?)
             AND s.status = 'completed'
          ), 0
        ) AS sales_qty,
        -- Current stock from products table
        p.stock_qty AS stock_qty,
        -- Variance = (opening + purchases - sales) - current_stock
        (COALESCE(
          (SELECT s.closing_qty FROM inventory_snapshots s
           WHERE s.product_id = p.id AND s.snapshot_date = DATE(?, '-1 day')),
          p.stock_qty
        ) + COALESCE(
          (SELECT SUM(COALESCE(pi.quantity_received, pi.qty))
           FROM purchase_items pi JOIN purchase_orders po ON pi.purchase_order_id = po.id
           WHERE pi.product_id = p.id AND DATE(po.delivery_date) = DATE(?) AND po.status = 'received'
          ), 0
        ) - COALESCE(
          (SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON si.sale_id = s.id
           WHERE si.product_id = p.id AND DATE(s.created_at) = DATE(?) AND s.status = 'completed'
          ), 0
        )) - p.stock_qty AS variance_qty
      FROM products p
      LEFT JOIN product_units pu ON p.id = pu.product_id AND pu.is_base = 1
      WHERE p.active = 1
      ORDER BY p.name ASC
    `;

    const rows = this.db.prepare(query).all(date, date, date, date, date, date) as unknown as DailyInventoryRow[];
    // Closing = opening + purchases - sales
    return rows.map((r) => ({
      ...r,
      closing_qty: fmtQty(r.opening_qty) + fmtQty(r.purchases_qty) - fmtQty(r.sales_qty),
    }));
  }

  // ── 3. DAILY SNAPSHOT (writes to inventory_snapshots) ──

  createDailySnapshot(date: string): SnapshotResult {
    const inventory = this.computeDailyInventory(date);
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO inventory_snapshots
        (snapshot_date, product_id, opening_qty, purchases_qty, sales_qty, closing_qty, variance_qty, variance_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    this.db.exec('BEGIN');
    try {
      for (const item of inventory) {
        const closing = fmtQty(item.opening_qty) + fmtQty(item.purchases_qty) - fmtQty(item.sales_qty);
        const variance = fmtQty(closing) - fmtQty(item.closing_qty);
        // variance_value: value the variance at the product's cost price
        const prod = this.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(item.product_id) as { cost_price: number } | undefined;
        const cp = prod?.cost_price ?? 0;
        const varianceValue = variance * cp;

        insert.run(
          date,
          item.product_id,
          fmtQty(item.opening_qty),
          fmtQty(item.purchases_qty),
          fmtQty(item.sales_qty),
          fmtQty(closing),
          variance,
          varianceValue
        );
        count++;
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }

    return { created: count, date };
  }

  // ── 4. WEEKLY INVENTORY ──

  getWeeklyInventory(weekStart: string, weekEnd: string): WeeklyInventoryRow[] {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatDateYMD(d));
    }

    const dailyData: Record<number, WeeklyInventoryRow> = {};

    for (const date of dates) {
      const daily = this.computeDailyInventory(date);
      for (const item of daily) {
        if (!dailyData[item.product_id]) {
          dailyData[item.product_id] = {
            product_id: item.product_id,
            product_name: item.product_name,
            unit_name: item.unit_name,
            opening_qty: fmtQty(item.opening_qty),
            purchases_qty: 0,
            sales_qty: 0,
            variance_qty: 0,
            days_tracked: 0,
          };
        }
        const d = dailyData[item.product_id];
        d.purchases_qty += fmtQty(item.purchases_qty);
        d.sales_qty += fmtQty(item.sales_qty);
        d.variance_qty += fmtQty(item.variance_qty);
        d.days_tracked += 1;
      }
    }

    return Object.values(dailyData).sort((a, b) => a.product_name.localeCompare(b.product_name));
  }

  // ── 5. MONTHLY INVENTORY ──

  getMonthlyInventory(year: number, month: number): MonthlyInventoryRow[] {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = formatDateYMD(new Date(year, month, 0));

    const query = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        c.name AS category_name,
        COALESCE(SUM(
          (SELECT SUM(COALESCE(pi.quantity_received, pi.qty))
           FROM purchase_items pi JOIN purchase_orders po ON pi.purchase_order_id = po.id
           WHERE pi.product_id = p.id
             AND DATE(po.delivery_date) BETWEEN DATE(?) AND DATE(?))
        ), 0) AS total_purchased,
        COALESCE(SUM(
          (SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON si.sale_id = s.id
           WHERE si.product_id = p.id
             AND DATE(s.created_at) BETWEEN DATE(?) AND DATE(?))
        ), 0) AS total_sold,
        COUNT(DISTINCT po.supplier_id) AS supplier_count,
        COALESCE(AVG(pi.unit_cost), 0) AS avg_cost,
        COALESCE(AVG(si.price), 0) AS avg_selling_price,
        MAX(p.stock_qty) AS current_stock,
        pu.name AS unit_name
      FROM products p
      LEFT JOIN purchase_items pi ON p.id = pi.product_id
      LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
        AND DATE(po.delivery_date) BETWEEN DATE(?) AND DATE(?)
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_units pu ON p.id = pu.product_id AND pu.is_base = 1
      LEFT JOIN sale_items si ON p.id = si.product_id AND DATE(s.created_at) BETWEEN DATE(?) AND DATE(?)
      WHERE p.active = 1
      GROUP BY p.id
      ORDER BY total_sold DESC
    `;

    return this.db.prepare(query).all(startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate) as unknown as MonthlyInventoryRow[];
  }

  // ── 6. SUPPLIER METRICS ──

  getSupplierMetrics(supplierId?: number): SupplierMetricRow[] {
    let query = `
      SELECT
        s.id AS supplier_id,
        s.name AS supplier_name,
        COALESCE(s.total_orders, 0) AS total_orders,
        COALESCE(SUM(po.total_amount), 0) AS total_spent,
        CASE
          WHEN COALESCE(s.total_orders, 0) = 0 THEN 100.0
          ELSE ROUND(
            (SUM(CASE WHEN po.delivery_date IS NOT NULL
              AND DATE(po.delivery_date) <= DATE(po.created_at, '+7 days')
              THEN 1 ELSE 0 END) * 100.0) /
            NULLIF(COUNT(CASE WHEN po.delivery_date IS NOT NULL THEN 1 END), 0), 2
          )
        END AS on_time_pct,
        COALESCE(AVG(pi.unit_cost), 0) AS average_cost,
        COALESCE(s.reliability_score, 5.0) AS reliability_score,
        MAX(po.created_at) AS last_order_date,
        MIN(po.created_at) AS first_order_date,
        COALESCE(s.is_active, 1) AS is_active
      FROM suppliers s
      LEFT JOIN purchase_orders po ON s.id = po.supplier_id
      LEFT JOIN purchase_items pi ON po.id = pi.purchase_order_id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];
    if (supplierId != null) {
      query += ' AND s.id = ?';
      params.push(supplierId);
    }

    query += ' GROUP BY s.id ORDER BY total_spent DESC';

    return this.db.prepare(query).all(...params) as unknown as SupplierMetricRow[];
  }

  // ── 7. PRODUCT PURCHASE SUMMARY ──

  getProductPurchaseSummary(productId: number, months: number = 3): ProductPurchaseSummaryRow[] {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const dateStr = formatDateYMD(cutoffDate);

    const query = `
      SELECT
        po.id AS id,
        po.created_at AS order_date,
        s.name AS supplier_name,
        COALESCE(pi.quantity_ordered, pi.qty) AS quantity,
        pi.unit_cost AS cost_per_unit,
        COALESCE(pi.total_cost, (pi.qty * pi.unit_cost)) AS total_cost,
        CASE
          WHEN po.delivery_date IS NULL THEN 'Pending'
          WHEN DATE(po.delivery_date) <= DATE(po.created_at, '+7 days') THEN 'Received'
          ELSE 'Late'
        END AS delivery_status,
        pi.expiry_date,
        pi.batch_number,
        (SELECT COALESCE(SUM(si2.qty), 0)
         FROM sale_items si2 JOIN sales s2 ON si2.sale_id = s2.id
         WHERE si2.product_id = ?
           AND DATE(s2.created_at) >= DATE(po.created_at)
           AND DATE(s2.created_at) <= DATE(po.delivery_date)
        ) AS qty_sold_since
      FROM purchase_items pi
      JOIN purchase_orders po ON pi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE pi.product_id = ? AND DATE(po.created_at) >= ?
      ORDER BY po.created_at DESC
    `;

    return this.db.prepare(query).all(productId, productId, dateStr) as unknown as ProductPurchaseSummaryRow[];
  }

  // ── 8. CREATE PURCHASE ORDER (for new purchase entry) ──

  addPurchaseOrder(supplierId: number, items: Array<{ product_id: number; qty: number; unit_cost: number; unit_name?: string; quantity_received?: number; expiry_date?: string | null; batch_number?: string | null }>, notes?: string) {
    const total = items.reduce((sum, i) => sum + i.qty * i.unit_cost, 0);

    this.db.exec('BEGIN');
    try {
      const poResult = this.db
        .prepare(`INSERT INTO purchase_orders (supplier_id, status, total_amount, delivery_date, notes)
                   VALUES (?, 'received', ?, DATE('now','localtime'), ?)`)
        .run(supplierId, total, notes || null) as unknown as { lastInsertRowid: number };
      const poId = Number(poResult.lastInsertRowid);

      const insItem = this.db.prepare(`
        INSERT INTO purchase_items
          (purchase_order_id, product_id, qty, unit_cost, total_cost,
           quantity_received, unit_name, expiry_date, batch_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateStock = this.db.prepare(`
        UPDATE products
        SET stock_qty = stock_qty + ?,
            cost_price = ?,
            last_supplier_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const updateSupplierStats = this.db.prepare(`
        UPDATE suppliers
        SET total_orders = total_orders + 1,
            average_rate = (average_rate * (total_orders) + ?) / (total_orders + 1)
        WHERE id = ?
      `);

      for (const item of items) {
        const received = item.quantity_received ?? item.qty;
        const totalCost = item.qty * item.unit_cost;

        insItem.run(
          poId, item.product_id, item.qty, item.unit_cost, totalCost,
          received, item.unit_name || null, item.expiry_date || null, item.batch_number || null
        );

        // Update product stock
        updateStock.run(received, item.unit_cost, supplierId, item.product_id);
      }

      this.db.exec('COMMIT');
      return { success: true, po_id: poId, total };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

let inventoryReportsInstance: InventoryReportsService | null = null;

export function getInventoryReports(): InventoryReportsService {
  if (!inventoryReportsInstance) {
    inventoryReportsInstance = new InventoryReportsService();
  }
  return inventoryReportsInstance;
}
