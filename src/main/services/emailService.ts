import nodemailer from 'nodemailer';
import { getAllAdminSettings } from './admin';
import { getAllSettings } from './settings';

interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const admin = getAllAdminSettings();
  const host = admin.email_smtp_host;
  const port = parseInt(admin.email_smtp_port || '587', 10);
  const user = admin.email_smtp_user;
  const pass = admin.email_smtp_pass;

  if (!host || !user || !pass) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
    });
  }
  return transporter;
}

export async function sendEmail(options: EmailOptions): Promise<{ ok: boolean; message: string }> {
  const transport = getTransporter();
  if (!transport) return { ok: false, message: 'Email not configured — set SMTP settings in Admin > Reports' };

  const admin = getAllAdminSettings();
  const from = admin.email_from || getAllSettings().shop_name || 'ShopKeeper POS';

  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  const validRecipients = recipients.filter(Boolean);
  if (validRecipients.length === 0) return { ok: false, message: 'No email recipients configured' };

  try {
    const result = await transport.sendMail({
      from,
      to: validRecipients.join(', '),
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    return { ok: true, message: `Email sent to ${validRecipients.length} recipient(s): ${result.messageId}` };
  } catch (err) {
    return { ok: false, message: `Email failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sendDailySalesReportEmail(): Promise<{ ok: boolean; message: string }> {
  const admin = getAllAdminSettings();
  if (admin.report_send_email !== 'true' && admin.report_send_email !== '1') {
    return { ok: false, message: 'Email reports disabled' };
  }

  const settings = getAllSettings();
  const recipients = [admin.report_email, settings.alert_manager_email, settings.alert_owner_email].filter(Boolean) as string[];
  if (recipients.length === 0) return { ok: false, message: 'No email recipients configured in Admin > Reports' };

  const today = new Date().toISOString().slice(0, 10);
  const { getDb } = require('../db');
  const db = getDb();

  const stats = db.prepare(`
    SELECT COUNT(*) as bill_count, COALESCE(SUM(total_amount), 0) as total_sales
    FROM sales WHERE DATE(created_at) = ?
  `).get(today) as { bill_count: number; total_sales: number };

  const topProducts = db.prepare(`
    SELECT p.name, SUM(si.quantity) as qty
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE DATE(s.created_at) = ? AND s.status = 'completed'
    GROUP BY p.id ORDER BY qty DESC LIMIT 5
  `).all(today) as Array<{ name: string; qty: number }>;

  const lowStock = db.prepare(`
    SELECT name, stock_qty FROM products
    WHERE active = 1 AND stock_qty <= COALESCE(min_stock_level, low_stock_threshold, 0)
    AND COALESCE(min_stock_level, low_stock_threshold, 0) > 0
    LIMIT 10
  `).all() as Array<{ name: string; stock_qty: number }>;

  let html = `<h2>ShopKeeper POS — Daily Report</h2>`;
  html += `<p><strong>Date:</strong> ${today}</p>`;
  html += `<h3>Sales</h3><ul>`;
  html += `<li>Bills: ${stats.bill_count}</li>`;
  html += `<li>Total: Rs ${stats.total_sales.toFixed(2)}</li></ul>`;

  if (topProducts.length) {
    html += `<h3>Top Products</h3><ol>`;
    topProducts.forEach((p) => { html += `<li>${p.name} (${p.qty} sold)</li>`; });
    html += `</ol>`;
  }

  if (lowStock.length) {
    html += `<h3>Low Stock</h3><ul>`;
    lowStock.forEach((p) => { html += `<li>${p.name}: ${p.stock_qty} left</li>`; });
    html += `</ul>`;
  }

  html += `<p style="color:#888;font-size:12px;margin-top:24px">Sent by ShopKeeper POS at ${new Date().toLocaleString()}</p>`;

  const text = `ShopKeeper POS — Daily Report\nDate: ${today}\nBills: ${stats.bill_count}\nTotal: Rs ${stats.total_sales.toFixed(2)}`;

  return sendEmail({
    to: recipients,
    subject: `ShopKeeper POS Daily Report — ${today}`,
    text,
    html,
  });
}
