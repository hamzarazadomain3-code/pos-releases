import { getDb } from '../db';
import { getAllSettings } from './settings';
import { todayLocal, formatLocalString } from '../utils/timezone';

export interface AlertRow {
  id: number;
  alert_type: string;
  product_id: number | null;
  supplier_id: number | null;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  is_read: boolean;
  action_taken: string | null;
  created_at: string;
  resolved_at: string | null;
}

function fmtQty(q: number | null | undefined): number {
  const v = Number(q ?? 0);
  return isNaN(v) ? 0 : v;
}

export class AlertService {
  private get db() {
    return getDb();
  }

  // ── INSERT alert (with dedup by type + product + date) ──

  private createAlert(
    alertType: string,
    message: string,
    severity: 'critical' | 'warning' | 'info',
    productId?: number,
    supplierId?: number
  ): void {
    // Dedup: skip if same alert type + product (or supplier) exists today and is unresolved
    const dedup = this.db.prepare(`
      SELECT 1 FROM alert_log
      WHERE alert_type = ? AND is_read = 0
        AND DATE(created_at) = DATE('now', 'localtime')
        AND (product_id = COALESCE(?, product_id) OR product_id IS NULL)
        AND (supplier_id = COALESCE(?, supplier_id) OR supplier_id IS NULL)
      LIMIT 1
    `).get(alertType, productId ?? null, supplierId ?? null) as { '1': number } | undefined;

    if (dedup) return;

    this.db.prepare(`
      INSERT INTO alert_log (alert_type, product_id, supplier_id, message, severity, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    `).run(alertType, productId ?? null, supplierId ?? null, message, severity);
  }

  // ── 1. CHECK ALL AND CREATE ALERTS ──

  checkAndCreateAlerts(): number {
    const count =
      this.checkLowStock() +
      this.checkExpiry() +
      this.checkLowProfit() +
      this.checkSlowMovers();
    return count;
  }

  // ── 2. LOW STOCK ──

  checkLowStock(): number {
    const threshold = this.getSetting('low_stock_warning_days', 7);
    const query = `
      SELECT id, name, stock_qty, min_stock_level, low_stock_threshold
      FROM products
      WHERE active = 1
        AND stock_qty <= COALESCE(min_stock_level, low_stock_threshold, 0)
        AND COALESCE(min_stock_level, low_stock_threshold, 0) > 0
      ORDER BY name ASC
    `;

    const rows = this.db.prepare(query).all() as Array<{
      id: number; name: string; stock_qty: number;
      min_stock_level: number | null; low_stock_threshold: number | null;
    }>;

    let count = 0;
    for (const r of rows) {
      const level = r.min_stock_level ?? r.low_stock_threshold ?? 0;
      if (r.stock_qty <= level) {
        const severity = r.stock_qty === 0 ? 'critical' : 'warning';
        const msg = r.stock_qty === 0
          ? `${r.name} is out of stock! Immediate reorder needed.`
          : `${r.name} is below minimum stock (current: ${r.stock_qty}, minimum: ${level}).`;
        this.createAlert('low_stock', msg, severity, r.id);
        count++;
      }
    }
    return count;
  }

  // ── 3. EXPIRY ──

  checkExpiry(): number {
    const warningDays = this.getSetting('expiry_warning_days', 30);
    const query = `
      SELECT
        pi.id,
        p.name AS product_name,
        p.id AS product_id,
        pi.batch_number,
        pi.expiry_date,
        CAST(julianday(pi.expiry_date) - julianday('now', 'localtime') AS INTEGER) AS days_to_expiry
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.expiry_date IS NOT NULL
        AND DATE(pi.expiry_date) >= DATE('now', 'localtime')
        AND DATE(pi.expiry_date) <= DATE('now', 'localtime', '+${warningDays} days')
        AND pi.quantity_received IS NOT NULL
        AND (pi.qty - pi.quantity_received) > 0
      ORDER BY pi.expiry_date ASC
    `;

    const rows = this.db.prepare(query).all() as Array<{
      product_id: number; product_name: string;
      batch_number: string | null; expiry_date: string; days_to_expiry: number;
    }>;

    let count = 0;
    for (const r of rows) {
      const severity = r.days_to_expiry <= 7 ? 'critical' : 'warning';
      const msg = `${r.product_name} (Batch: ${r.batch_number || 'N/A'}) expires in ${r.days_to_expiry} day(s) on ${r.expiry_date}.`;
      this.createAlert('expiry', msg, severity, r.product_id);
      count++;
    }
    return count;
  }

  // ── 4. LOW PROFIT ──

  checkLowProfit(): number {
    // Reuse profitability service logic inline for simplicity
    const threshold = this.getSetting('low_profit_threshold', 5);
    const query = `
      SELECT id, name, cost_price, sale_price,
        ROUND(sale_price - cost_price, 2) AS profit_per_unit,
        CASE WHEN sale_price = 0 THEN 0 ELSE ROUND((sale_price - cost_price) / sale_price * 100, 2) END AS margin_pct
      FROM products
      WHERE active = 1 AND sale_price > 0 AND cost_price > 0
        AND ((sale_price - cost_price) / sale_price * 100) < ?
      ORDER BY margin_pct ASC
    `;

    const rows = this.db.prepare(query).all(threshold) as Array<{
      id: number; name: string; cost_price: number; sale_price: number;
      profit_per_unit: number; margin_pct: number;
    }>;

    let count = 0;
    for (const r of rows) {
      const msg = `${r.name} has low profit margin (${r.margin_pct}%). Cost: ${r.cost_price}, Price: ${r.sale_price}.`;
      this.createAlert('low_profit', msg, 'warning', r.id);
      count++;
    }
    return count;
  }

  // ── 5. SLOW MOVERS ──

  checkSlowMovers(): number {
    const days = this.getSetting('slow_mover_days', 60);
    const query = `
      SELECT
        p.id, p.name, p.stock_qty,
        MAX(s.created_at) AS last_sale_date,
        CAST(julianday('now', 'localtime') - julianday(MAX(s.created_at)) AS INTEGER) AS days_no_sale
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      LEFT JOIN sales s ON si.sale_id = s.id AND s.status = 'completed'
      WHERE p.active = 1 AND p.stock_qty > 0
      GROUP BY p.id
      HAVING days_no_sale >= ?
      ORDER BY days_no_sale DESC
    `;

    const rows = this.db.prepare(query).all(days) as Array<{
      id: number; name: string; stock_qty: number;
      last_sale_date: string | null; days_no_sale: number;
    }>;

    let count = 0;
    for (const r of rows) {
      if (r.days_no_sale && r.days_no_sale >= days) {
        const severity = r.days_no_sale >= 90 ? 'warning' : 'info';
        const msg = `${r.name} hasn't sold in ${r.days_no_sale} day(s) (last sale: ${r.last_sale_date || 'Never'}). Stock: ${r.stock_qty}.`;
        this.createAlert('slow_mover', msg, severity, r.id);
        count++;
      }
    }
    return count;
  }

  // ── 6. GET ALL ──

  getAll(): AlertRow[] {
    return this.db.prepare(`
      SELECT id, alert_type, product_id, supplier_id, message, severity, is_read, action_taken, created_at, resolved_at
      FROM alert_log
      ORDER BY created_at DESC LIMIT 100
    `).all() as unknown as AlertRow[];
  }

  // ── 7. GET UNREAD ──

  getUnread(): AlertRow[] {
    return this.db.prepare(`
      SELECT id, alert_type, product_id, supplier_id, message, severity, is_read, action_taken, created_at, resolved_at
      FROM alert_log
      WHERE is_read = 0
      ORDER BY created_at DESC LIMIT 100
    `).all() as unknown as AlertRow[];
  }

  // ── 8. MARK AS READ ──

  markAsRead(id: number): boolean {
    const result = this.db.prepare('UPDATE alert_log SET is_read = 1 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── 9. RESOLVE ──

  resolve(id: number, action: string): boolean {
    const result = this.db.prepare(
      'UPDATE alert_log SET is_read = 1, action_taken = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(action || 'Resolved', id);
    return result.changes > 0;
  }

  // ── 10. SEND CRITICAL ALERTS VIA WHATSAPP ──

  async sendAlertsWhatsApp(): Promise<{ sent: number; errors: number }> {
    const settings = getAllSettings();
    if (settings.alert_whatsapp_enabled !== '1') return { sent: 0, errors: 0 };

    const phoneNumbers = [settings.alert_manager_phone, settings.alert_owner_phone].filter(Boolean);
    if (phoneNumbers.length === 0) return { sent: 0, errors: 0 };

    // Dynamically import whatsapp gateway to avoid circular deps
    const { sendWhatsAppReceipt } = await import('../whatsapp-gateway');

    const alerts = this.db.prepare(`
      SELECT id, alert_type, message, severity
      FROM alert_log
      WHERE is_read = 0 AND severity IN ('critical', 'warning')
      ORDER BY severity DESC, created_at DESC
      LIMIT 10
    `).all() as Array<{ id: number; alert_type: string; message: string; severity: string }>;

    if (alerts.length === 0) return { sent: 0, errors: 0 };

    const lines = alerts.map((a) => `${a.severity === 'critical' ? '🔴' : '⚠️'} ${a.message}`);
    const text = `*ShopKeeper POS Alerts*\n\n${lines.join('\n')}\n\n_Sent at ${formatLocalString(new Date())}_`;

    let sent = 0;
    let errors = 0;
    for (const phone of phoneNumbers) {
      try {
        const res = await sendWhatsAppReceipt(phone, text);
        if (res.ok) sent++;
        else errors++;
      } catch {
        errors++;
      }
    }
    return { sent, errors };
  }

  // ── 11. SEND DAILY SALES SUMMARY VIA WHATSAPP ──

  async sendDailySalesSummary(): Promise<{ ok: boolean; message: string }> {
    const settings = getAllSettings();
    if (settings.alert_whatsapp_enabled !== '1') return { ok: false, message: 'WhatsApp alerts disabled' };

    const phoneNumbers = [settings.alert_manager_phone, settings.alert_owner_phone].filter(Boolean);
    if (phoneNumbers.length === 0) return { ok: false, message: 'No phone numbers configured' };

    const { sendWhatsAppReceipt } = await import('../whatsapp-gateway');

    const today = todayLocal();
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(total_amount), 0) as total_sales,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) as completed_sales
      FROM sales
      WHERE DATE(created_at) = ?
    `).get(today) as { bill_count: number; total_sales: number; completed_sales: number };

    const topProducts = this.db.prepare(`
      SELECT p.name, SUM(si.quantity) as qty
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.created_at) = ? AND s.status = 'completed'
      GROUP BY p.id
      ORDER BY qty DESC
      LIMIT 5
    `).all(today) as Array<{ name: string; qty: number }>;

    const lowStock = this.db.prepare(`
      SELECT name, stock_qty FROM products
      WHERE active = 1 AND stock_qty <= COALESCE(min_stock_level, low_stock_threshold, 0)
        AND COALESCE(min_stock_level, low_stock_threshold, 0) > 0
      LIMIT 5
    `).all() as Array<{ name: string; stock_qty: number }>;

    let text = `*ShopKeeper POS — Daily Summary*\n`;
    text += `📅 ${today}\n\n`;
    text += `*Sales:*\n`;
    text += `• Bills: ${stats.bill_count}\n`;
    text += `• Total: Rs ${stats.completed_sales.toFixed(2)}\n\n`;

    if (topProducts.length) {
      text += `*Top Products:*\n`;
      topProducts.forEach((p, i) => { text += `${i + 1}. ${p.name} (${p.qty} sold)\n`; });
      text += '\n';
    }

    if (lowStock.length) {
      text += `*Low Stock:*\n`;
      lowStock.forEach((p) => { text += `• ${p.name}: ${p.stock_qty} left\n`; });
    }

    let sent = 0;
    for (const phone of phoneNumbers) {
      try {
        const res = await sendWhatsAppReceipt(phone, text);
        if (res.ok) sent++;
      } catch { /* ignore */ }
    }
    return { ok: sent > 0, message: `Summary sent to ${sent}/${phoneNumbers.length} recipients` };
  }

  // ── Helpers ──

  private getSetting(key: string, defaultValue: number): number {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return defaultValue;
    const v = parseInt(row.value, 10);
    return isNaN(v) ? defaultValue : v;
  }
}

let alertServiceInstance: AlertService | null = null;

export function getAlertService(): AlertService {
  if (!alertServiceInstance) {
    alertServiceInstance = new AlertService();
  }
  return alertServiceInstance;
}
