/**
 * X/Z Reports using the Receipt Designer (Phase 5).
 *
 * X Report = End of shift report (read-only, does not reset counters).
 * Z Report = End of day report (resets daily counters after printing).
 *
 * Both use the same Receipt Designer layout engine so the shop owner can
 * customise the report appearance exactly like receipts.
 */

import { getDb } from '../db';
import { getAdminSetting, getAllAdminSettings } from './admin';
import { getSale, listSales } from './sales';
import { getUser } from './auth';
import { getPrintSettings } from './printDocs';
import { buildDesignedReceiptAsync, buildSampleSale, resolveAppliedDesign } from './receiptDesigner';
import { defaultReceiptDesign, ReceiptDesign, ReceiptPaper } from '../../shared/receiptDesign';
import { printDocument, PrintJob } from './printService';

export type ReportKind = 'x' | 'z';

interface ReportData {
  kind: ReportKind;
  shiftId?: number;
  from: string;
  to: string;
  sales: Array<{
    invoice_no: string;
    created_at: string;
    customer_name: string | null;
    total_amount: number;
    paid: number;
    balance: number;
    payments: Array<{ mode: string; amount: number }>;
    items: Array<{ product_name: string; qty: number; line_total: number }>;
  }>;
  totals: {
    gross: number;
    net: number;
    tax: number;
    discount: number;
    payments: Record<string, number>;
    itemsCount: number;
    transactions: number;
  };
  shift?: {
    id: number;
    opened_at: string;
    closed_at: string | null;
    opening_cash: number;
    expected_cash: number;
    actual_cash: number;
  };
}

function makeMoney(currency: string) {
  return (n: number) => (currency + ' ' + Number(n).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getCurrency(): string {
  return getAdminSetting('currency_symbol') || 'Rs';
}

/** Build a report using the applied receipt design (paper = thermal80). */
async function buildReportHtml(data: ReportData, design: ReceiptDesign): Promise<string> {
  const currency = getCurrency();
  const fmt = makeMoney(currency);

  // Create a synthetic "sale" object that represents the report totals
  // The designer's tokenMap will pick up fields from this object
  const reportSale = {
    invoice_no: data.kind.toUpperCase() + ' REPORT',
    created_at: new Date().toISOString(),
    customer_name: 'Z Report' as const,
    customer_id: 0,
    customer_balance: 0,
    cashier: 'System',
    status: 'completed',
    items: data.sales.flatMap((s) => s.items.map((it) => ({
      product_name: it.product_name,
      unit_name: 'pcs',
      qty: it.qty,
      unit_price: it.line_total / it.qty,
      discount: 0,
      tax_rate: 0,
      line_total: it.line_total,
    }))),
    subtotal: data.totals.gross,
    discount_amount: data.totals.discount,
    tax_amount: data.totals.tax,
    service_charge: 0,
    freight: 0,
    total_amount: data.totals.net,
    paid: data.totals.net,
    payments: Object.entries(data.totals.payments).map(([mode, amount]) => ({ mode, amount })),
    returned_amount: 0,
    branch: '',
  };

  const settings = getPrintSettings();
  const sample = buildSampleSale(settings, 'sale');
  // Override sample with report data
  Object.assign(sample, reportSale);

  // Use the applied design for thermal80
  const paper: ReceiptPaper = 'thermal80';
  const html = await buildDesignedReceiptAsync(sample, paper, design);
  return html;
}

/** Collect data for an X or Z report. */
export async function collectReportData(kind: ReportKind, shiftId?: number): Promise<ReportData> {
  const db = getDb();

  let from: string, to: string;

  if (kind === 'x') {
    // X Report: current shift (or specified shift)
    let shift = null;
    if (shiftId) {
      shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
    } else {
      // Current open shift
      shift = db.prepare('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get();
    }
    if (!shift) throw new Error('No open shift found for X report');

    from = String(shift.opened_at);
    to = new Date().toISOString();

    const sales = db.prepare(`
      SELECT s.*, c.name as customer_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.shift_id = ? AND s.status = 'completed'
      ORDER BY s.created_at
    `).all(shift.id);

    return buildReportTotals(sales, shift, from, to);
  } else {
    // Z Report: entire day (all shifts closed today)
    const today = new Date().toISOString().split('T')[0];
    from = today + 'T00:00:00Z';
    to = today + 'T23:59:59Z';

    const sales = db.prepare(`
      SELECT s.*, c.name as customer_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.created_at BETWEEN ? AND ? AND s.status = 'completed'
      ORDER BY s.created_at
    `).all(from, to);

    // For Z report, also mark the day as closed (optional: close all open shifts)
    const shifts = db.prepare('SELECT * FROM shifts WHERE closed_at IS NULL').all();
    for (const sh of shifts) {
      db.prepare('UPDATE shifts SET closed_at = ? WHERE id = ?').run(new Date().toISOString(), sh.id);
    }

    return buildReportTotals(sales, null, from, to);
  }
}

function buildReportTotals(sales: any[], shift: any, from: string, to: string): ReportData {
  const totals = {
    gross: 0,
    net: 0,
    tax: 0,
    discount: 0,
    payments: {} as Record<string, number>,
    itemsCount: 0,
    transactions: sales.length,
  };

  const processedSales = sales.map((s) => {
    const paid = s.payments ? s.payments.reduce((a: number, p: any) => a + p.amount, 0) : 0;
    const balance = Math.max(0, s.total_amount - paid);
    totals.gross += s.subtotal;
    totals.net += s.total_amount;
    totals.tax += s.tax_amount || 0;
    totals.discount += s.discount_amount || 0;
    totals.itemsCount += s.items ? s.items.length : 0;

    if (s.payments) {
      for (const p of s.payments) {
        totals.payments[p.mode] = (totals.payments[p.mode] || 0) + p.amount;
      }
    }

    return {
      invoice_no: s.invoice_no,
      created_at: s.created_at,
      customer_name: s.customer_name,
      total_amount: s.total_amount,
      paid,
      balance,
      payments: s.payments || [],
      items: s.items || [],
    };
  });

  return {
    kind: shift ? 'x' : 'z',
    shiftId: shift?.id,
    from,
    to,
    sales: processedSales,
    totals,
    shift: shift ? {
      id: shift.id,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      opening_cash: shift.opening_cash,
      expected_cash: shift.expected_cash,
      actual_cash: shift.actual_cash,
    } : undefined,
  };
}

/** Print an X or Z report using the receipt designer layout. */
export async function printReport(kind: ReportKind, shiftId?: number): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await collectReportData(kind, shiftId);
    const paper: ReceiptPaper = 'thermal80';
    const design = resolveAppliedDesign(paper);
    const html = await buildReportHtml(data, design);

    const job: PrintJob = {
      html,
      paper,
      printerKey: 'receipt',
      jobName: `${kind.toUpperCase()} Report`,
    };

    const result = await printDocument(job);
    return result;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Preview an X or Z report. */
export async function previewReport(kind: ReportKind, shiftId?: number): Promise<string | null> {
  try {
    const data = await collectReportData(kind, shiftId);
    const paper: ReceiptPaper = 'thermal80';
    const design = resolveAppliedDesign(paper);
    return await buildReportHtml(data, design);
  } catch (e) {
    return null;
  }
}