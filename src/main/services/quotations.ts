import { getDb } from '../db';
import { logError } from '../logger';
import { getAllSettings } from './settings';
import { todayLocal, daysFromNow } from '../utils/timezone';

export interface QuotationRow {
  id: number;
  quote_no: string;
  customer_id: number | null;
  customer_name?: string;
  user_id: number;
  username?: string;
  shift_id: number | null;
  valid_until: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  discount_pct: number;
  total_amount: number;
  notes: string | null;
  terms: string | null;
  converted_sale_id: number | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface QuotationItemRow {
  id: number;
  quotation_id: number;
  product_id: number;
  product_name?: string;
  product_barcode?: string;
  qty: number;
  unit_price: number;
  unit_cost: number;
  discount: number;
  discount_pct: number;
  tax_rate: number;
  line_total: number;
}

export interface CreateQuotationInput {
  customer_id: number | null;
  user_id: number;
  shift_id?: number | null;
  valid_until?: string | null;
  items: Array<{
    product_id: number;
    qty: number;
    unit_price: number;
    unit_cost?: number;
    discount?: number;
    discount_pct?: number;
    tax_rate?: number;
    line_total: number;
  }>;
  discount_amount?: number;
  discount_pct?: number;
  tax_amount?: number;
  subtotal?: number;
  total_amount?: number;
  notes?: string;
  terms?: string;
  status?: 'draft' | 'sent';
}

function generateQuoteNo(): string {
  const db = getDb();
  const settings = getAllSettings();
  const prefix = (settings.quotation_prefix as string) || 'QT-';
    const today = todayLocal().replace(/-/g, '');
  const last = db.prepare(
    `SELECT quote_no FROM quotations WHERE quote_no LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}${today}-%`) as { quote_no: string } | undefined;
  let nextSeq = 1;
  if (last) {
    const m = last.quote_no.match(/-(\d+)$/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${today}-${String(nextSeq).padStart(4, '0')}`;
}

function computeTotals(items: CreateQuotationInput['items']) {
  let subtotal = 0;
  let tax = 0;
  for (const it of items) {
    const gross = it.qty * it.unit_price;
    const afterDisc = gross - (it.discount || 0);
    const lineTax = afterDisc * ((it.tax_rate || 0) / 100);
    subtotal += afterDisc;
    tax += lineTax;
  }
  return { subtotal, tax_amount: tax };
}

export function listQuotations(filters: {
  status?: string;
  customer_id?: number;
  from_date?: string;
  to_date?: string;
  search?: string;
} = {}): QuotationRow[] {
  try {
    const db = getDb();
    let sql = `
      SELECT q.*, c.name as customer_name, u.username,
        (SELECT COUNT(*) FROM quotation_items WHERE quotation_id = q.id) as item_count
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      LEFT JOIN users u ON q.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (filters.status) { sql += ' AND q.status = ?'; params.push(filters.status); }
    if (filters.customer_id) { sql += ' AND q.customer_id = ?'; params.push(filters.customer_id); }
    if (filters.from_date) { sql += ' AND date(q.created_at) >= ?'; params.push(filters.from_date); }
    if (filters.to_date) { sql += ' AND date(q.created_at) <= ?'; params.push(filters.to_date); }
    if (filters.search) {
      sql += ' AND (q.quote_no LIKE ? OR c.name LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    sql += ' ORDER BY q.created_at DESC LIMIT 500';
    return db.prepare(sql).all(...params) as unknown as QuotationRow[];
  } catch (e) {
    logError('listQuotations', e);
    return [];
  }
}

export function getQuotation(id: number): { quotation: QuotationRow; items: QuotationItemRow[] } | null {
  try {
    const db = getDb();
    const quotation = db.prepare(`
      SELECT q.*, c.name as customer_name, u.username
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      LEFT JOIN users u ON q.user_id = u.id
      WHERE q.id = ?
    `).get(id) as unknown as QuotationRow | undefined;
    if (!quotation) return null;
    const items = db.prepare(`
      SELECT qi.*, p.name as product_name, p.barcode as product_barcode
      FROM quotation_items qi
      LEFT JOIN products p ON qi.product_id = p.id
      WHERE qi.quotation_id = ?
      ORDER BY qi.id ASC
    `).all(id) as unknown as QuotationItemRow[];
    return { quotation, items };
  } catch (e) {
    logError('getQuotation', e);
    return null;
  }
}

export function createQuotation(input: CreateQuotationInput): { ok: boolean; id?: number; quote_no?: string; message?: string } {
  try {
    const db = getDb();
    if (!input.items || input.items.length === 0) {
      return { ok: false, message: 'At least one item is required' };
    }

    const totals = computeTotals(input.items);
    const subtotal = input.subtotal ?? totals.subtotal;
    const tax_amount = input.tax_amount ?? totals.tax_amount;
    const discount_amount = input.discount_amount ?? 0;
    const discount_pct = input.discount_pct ?? 0;
    const total_amount = input.total_amount ?? (subtotal + tax_amount - discount_amount);

    const settings = getAllSettings();
    const validDays = parseInt((settings.quotation_valid_days as string) || '7', 10);
    const validUntil = input.valid_until || daysFromNow(validDays);
    const terms = input.terms || (settings.quotation_terms as string) || '';

    const quoteNo = generateQuoteNo();
    const status = input.status || 'draft';

    let qId = 0;
    db.exec('BEGIN');
    try {
      const res = db.prepare(`
        INSERT INTO quotations
        (quote_no, customer_id, user_id, shift_id, valid_until, status, subtotal, tax_amount, discount_amount, discount_pct, total_amount, notes, terms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        quoteNo, input.customer_id, input.user_id, input.shift_id || null,
        validUntil, status, subtotal, tax_amount, discount_amount, discount_pct, total_amount,
        input.notes || null, terms
      );
      qId = Number(res.lastInsertRowid);

      const insItem = db.prepare(`
        INSERT INTO quotation_items (quotation_id, product_id, qty, unit_price, unit_cost, discount, discount_pct, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const it of input.items) {
        insItem.run(qId, it.product_id, it.qty, it.unit_price, it.unit_cost || 0,
          it.discount || 0, it.discount_pct || 0, it.tax_rate || 0, it.line_total);
      }

      db.prepare(`UPDATE quotations SET updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`).run(qId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true, id: qId, quote_no: quoteNo };
  } catch (e) {
    logError('createQuotation', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function updateQuotationStatus(id: number, status: string): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    if (!['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(status)) {
      return { ok: false, message: 'Invalid status' };
    }
    db.prepare(`UPDATE quotations SET status = ?, updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`).run(status, id);
    return { ok: true };
  } catch (e) {
    logError('updateQuotationStatus', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteQuotation(id: number): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const q = db.prepare(`SELECT status, converted_sale_id FROM quotations WHERE id = ?`).get(id) as any;
    if (!q) return { ok: false, message: 'Quotation not found' };
    if (q.converted_sale_id) return { ok: false, message: 'Cannot delete a converted quotation' };
    db.prepare(`DELETE FROM quotations WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) {
    logError('deleteQuotation', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Convert a quotation into a sale.
 * - Creates a sales record mirroring the quotation
 * - Decrements product stock
 * - Marks quotation as 'converted' and stores converted_sale_id
 */
export function convertToSale(quotationId: number, actorUserId: number): { ok: boolean; sale_id?: number; invoice_no?: string; message?: string } {
  try {
    const db = getDb();
    const q = db.prepare(`SELECT * FROM quotations WHERE id = ?`).get(quotationId) as unknown as QuotationRow | undefined;
    if (!q) return { ok: false, message: 'Quotation not found' };
    if (q.converted_sale_id) return { ok: false, message: 'Quotation already converted' };
    if (q.valid_until && new Date(q.valid_until) < new Date(todayLocal())) {
      return { ok: false, message: 'Quotation has expired' };
    }

    const items = db.prepare(`SELECT * FROM quotation_items WHERE quotation_id = ?`).all(quotationId) as unknown as QuotationItemRow[];

    // Generate sale invoice number (same scheme as sales service)
  const today = todayLocal().replace(/-/g, '');
    const lastSale = db.prepare(`SELECT invoice_no FROM sales WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`).get(`INV-${today}-%`) as any;
    let seq = 1;
    if (lastSale) {
      const m = lastSale.invoice_no.match(/-(\d+)$/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const invoiceNo = `INV-${today}-${String(seq).padStart(4, '0')}`;

    let saleId = 0;
    db.exec('BEGIN');
    try {
      const saleRes = db.prepare(`
        INSERT INTO sales (invoice_no, customer_id, user_id, subtotal, tax_amount, discount_amount, total_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
      `).run(invoiceNo, q.customer_id, actorUserId, q.subtotal, q.tax_amount, q.discount_amount, q.total_amount);
      saleId = Number(saleRes.lastInsertRowid);

      const insItem = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const decStock = db.prepare(`UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`);
      const insMove = db.prepare(`
        INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, user_id)
        VALUES (?, ?, 'sale', 'sale', ?, ?)
      `);

      for (const it of items) {
        insItem.run(saleId, it.product_id, it.qty, it.unit_price, it.discount, it.tax_rate, it.line_total);
        decStock.run(it.qty, it.product_id);
        insMove.run(it.product_id, -it.qty, saleId, actorUserId);
      }

      db.prepare(`
        UPDATE quotations
        SET status = 'converted', converted_sale_id = ?, converted_at = datetime('now', 'utc') || 'Z', updated_at = datetime('now', 'utc') || 'Z'
        WHERE id = ?
      `).run(saleId, quotationId);

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true, sale_id: saleId, invoice_no: invoiceNo };
  } catch (e) {
    logError('convertToSale', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Background helper: mark expired quotations (call from scheduler).
 */
export function expireOldQuotations(): number {
  try {
    const db = getDb();
    const today = todayLocal();
    const res = db.prepare(`
      UPDATE quotations
      SET status = 'expired', updated_at = datetime('now', 'utc') || 'Z'
      WHERE status IN ('draft','sent') AND valid_until IS NOT NULL AND date(valid_until) < date(?)
    `).run(today);
    return Number(res.changes) || 0;
  } catch (e) {
    logError('expireOldQuotations', e);
    return 0;
  }
}

export const quotationsService = {
  list: listQuotations,
  get: getQuotation,
  create: createQuotation,
  updateStatus: updateQuotationStatus,
  delete: deleteQuotation,
  convertToSale,
  expireOld: expireOldQuotations,
};
