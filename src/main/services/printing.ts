/**
 * Print facade.
 *
 * Every entry point here delegates to `printService`, which is the only module
 * that touches `webContents.print()`. Previously this file contained its own
 * hidden-window/`webContents.print()` implementation that never passed
 * `pageSize` or `margins`, which is why receipts printed as a narrow strip on
 * whatever paper the printer happened to be loaded with.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSale } from './sales';
import { getUser } from './auth';
import { formatLocalString } from '../utils/timezone';
import { log } from '../logger';
import {
  esc,
  getPrintSettings,
  makeMoney,
  buildInvoiceHtml,
  buildCalibrationHtml,
  todayLabel,
  fmtExpiryDate,
} from './printDocs';
import {
  buildReceiptHtml,
  getAvailableTemplates,
  fitTemplateToPaper,
  paperForTemplate,
  type ReceiptTemplate,
} from './receiptTemplates';
import {
  buildDesignedReceiptAsync,
  buildSampleSale,
  isReceiptDesignEnabled,
  renderAppliedReceipt,
} from './receiptDesigner';
import {
  printReport,
  previewReport,
} from './xzReports';
import { normalizeReceiptDesign, type ReceiptPaper } from '../../shared/receiptDesign';
import type { PrintSaleOptions } from '../../shared/types';
import { buildLabelBatchHtml, type LabelProduct } from './labelTemplates';
import { getProduct } from './inventory';
import { getAdminSetting } from './admin';
import { getDb } from '../db';
import {
  printDocument,
  previewDocument,
  printCalibration,
  printJobToPdf,
  printJobToPng,
  registerPrintProtocol,
  PAPER_SPECS,
  LABEL_SPECS,
  AUTO_PRINTER,
  getConfiguredPaper,
  getConfiguredPrinter,
  getLabelLayout,
  getReceiptCopies,
  invalidatePrinterCache,
  type LabelSize,
  type PaperKind,
  type PrintResult,
  type PrintJob,
} from './printService';

export { buildReceiptHtml, buildInvoiceHtml, getAvailableTemplates, registerPrintProtocol };
export type { PrintResult, ReceiptTemplate, LabelSize, PaperKind, PrintSaleOptions };

/** Is the "DUPLICATE COPY" stamp enabled? Default ON; only an explicit 'false' hides it. */
function duplicateLabelEnabled(): boolean {
  try {
    return getAdminSetting('receipt_duplicate_label') !== 'false';
  } catch {
    return true;
  }
}

/** Should a completed sale pulse the cash drawer? Opt-in: default OFF. */
function cashDrawerKickEnabled(): boolean {
  try {
    return getAdminSetting('cash_drawer_kick') === 'true';
  } catch {
    return false;
  }
}

/**
 * Record which sale was last sent to a printer, so "Reprint last receipt" works
 * after the sale modal is gone. Written straight to `admin_settings` (a
 * system-managed key) because `setAdminSetting` is owner-gated and a cashier
 * must be able to print.
 */
function recordLastPrintedSale(saleId: number): void {
  try {
    getDb()
      .prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('last_printed_sale_id', String(saleId));
  } catch {
    /* the reprint shortcut is a convenience — never fail a print over it */
  }
}

// ═══════════════════════════════════════════════════════════════════
//  RECEIPTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Which paper is physically loaded in the receipt printer.
 *
 * `receipt_paper` is a machine fact set in Settings, so it wins. Before anyone
 * sets it we fall back to the legacy `receipt_width` admin setting, then to
 * 80mm (the historical default).
 */
function resolveReceiptPaper(): PaperKind {
  const configured = getConfiguredPaper('receipt');
  if (configured === 'thermal58' || configured === 'thermal80' || configured === 'a4') return configured;
  const legacy = getPrintSettings().receipt_width;
  if (legacy === '58mm') return 'thermal58';
  return 'thermal80';
}

export function buildReceiptJob(saleId: number, template?: ReceiptTemplate, duplicate = false): PrintJob {
  const paper = resolveReceiptPaper();
  const requested: ReceiptTemplate = template || 'standard';
  const { template: fitted, adjusted } = fitTemplateToPaper(requested, paper);
  const warnings: string[] = [];
  if (adjusted) {
    warnings.push(
      `Note: the "${requested}" layout does not fit ${PAPER_SPECS[paper].label}, so the ${PAPER_SPECS[
        paperForTemplate(fitted)
      ].label} layout was used. Change the paper in Settings -> Printer if the roll width is wrong.`
    );
  }
  return {
    // `duplicate` stamps "DUPLICATE COPY"; default false keeps the shipped
    // layout byte-identical for every existing caller and the test harness.
    html: buildReceiptHtml(saleId, fitted, { duplicate }),
    paper,
    printerKey: 'receipt',
    jobName: 'Receipt',
    warnings,
  };
}

/**
 * The receipt job the REAL print/preview path uses. When a Receipt Design has
 * been applied (`receipt_design_enabled`), it renders through the designer's
 * builder so the printed roll matches the live preview exactly; otherwise it
 * falls back to the shipped `buildReceiptJob`. Kept ASYNC because the designed
 * QR/barcode blocks resolve bwip-js data URLs, while the sync `buildReceiptJob`
 * stays untouched for the test harness and any caller that needs a string now.
 */
export async function buildReceiptJobAsync(
  saleId: number,
  template?: ReceiptTemplate,
  opts: PrintSaleOptions = {}
): Promise<PrintJob> {
  const duplicate = !!opts.duplicate && duplicateLabelEnabled();
  if (isReceiptDesignEnabled()) {
    const paper = resolveReceiptPaper();
    try {
      const html = await renderAppliedReceipt(saleId, paper, duplicate);
      if (html) {
        return { html, paper, printerKey: 'receipt', jobName: 'Receipt', warnings: [] };
      }
    } catch (e) {
      log(`receipt design render failed, falling back to the shipped layout: ${e instanceof Error ? e.message : e}`);
    }
  }
  return buildReceiptJob(saleId, template, duplicate);
}

export async function printSale(
  saleId: number,
  template?: ReceiptTemplate,
  opts: PrintSaleOptions = {}
): Promise<PrintResult> {
  const job = await buildReceiptJobAsync(saleId, template, opts);
  const copies = opts.copies ?? getReceiptCopies();
  if (Number.isFinite(copies) && copies > 1) job.copies = Math.min(10, Math.floor(copies));
  const result = await printDocument(job);
  if (result.ok) {
    recordLastPrintedSale(saleId);
    // A reprint must not pop the drawer — only a fresh sale's print does.
    const kick = opts.kickDrawer ?? (!opts.duplicate && cashDrawerKickEnabled());
    if (kick) {
      // Fire-and-forget: a drawer that isn't wired must not fail the print.
      void openCashDrawer().then((r) => {
        if (!r.ok) log(`cash drawer kick after print: ${r.message}`);
      });
    }
  }
  return result;
}

export async function previewReceipt(
  saleId: number,
  template?: ReceiptTemplate,
  opts: PrintSaleOptions = {}
): Promise<PrintResult> {
  return previewDocument(await buildReceiptJobAsync(saleId, template, opts), {
    // Title is spec'd to read EXACTLY "Receipt preview".
    title: 'Receipt preview',
    printButtonLabel: 'Print receipt',
    saleId,
    copies: opts.copies ?? getReceiptCopies(),
  });
}

/**
 * Reprint the most recently printed sale. Stamped "DUPLICATE COPY" (when the
 * toggle is on) because by definition the original already went to paper.
 */
export async function reprintLastReceipt(): Promise<PrintResult> {
  let id = 0;
  try {
    id = Number(getAdminSetting('last_printed_sale_id')) || 0;
  } catch {
    id = 0;
  }
  if (!id) return { ok: false, message: 'No receipt has been printed yet.' };
  if (!getSale(id)) return { ok: false, message: 'The last printed sale could not be found.' };
  return printSale(id, undefined, { duplicate: true });
}

/**
 * Phase 4 "Test print": print the designer's representative SAMPLE sale using
 * the design currently on screen — including unsaved edits — so the owner can
 * hold the physical roll next to the preview before committing it.
 */
export async function printDesignSample(
  designInput: unknown,
  paper: ReceiptPaper = 'thermal80',
  copies = 1
): Promise<PrintResult> {
  const design = normalizeReceiptDesign(designInput);
  const sample = buildSampleSale(getPrintSettings(), 'sale');
  const html = await buildDesignedReceiptAsync(sample, paper, design);
  const job: PrintJob = {
    html,
    paper,
    printerKey: 'receipt',
    jobName: 'Receipt test print',
  };
  if (Number.isFinite(copies) && copies > 1) job.copies = Math.min(10, Math.floor(copies));
  return printDocument(job);
}

// ═══════════════════════════════════════════════════════════════════
//  INVOICES
// ═══════════════════════════════════════════════════════════════════

function resolveInvoicePaper(): 'a4' | 'a5' {
  const configured = getConfiguredPaper('invoice');
  return configured === 'a5' ? 'a5' : 'a4';
}

export function buildInvoiceJob(saleId: number): PrintJob {
  const paper = resolveInvoicePaper();
  return {
    // The layout is generated for the same paper the job will print on, so an
    // A5 invoice is a real 148mm document instead of a clipped 210mm one.
    html: buildInvoiceHtml(saleId, paper),
    paper,
    printerKey: 'invoice',
    jobName: 'Invoice',
  };
}

export async function printInvoice(saleId: number): Promise<PrintResult> {
  return printDocument(buildInvoiceJob(saleId));
}

export async function previewInvoice(saleId: number): Promise<PrintResult> {
  return previewDocument(buildInvoiceJob(saleId), { title: 'Invoice preview', printButtonLabel: 'Print invoice' });
}

// ═══════════════════════════════════════════════════════════════════
//  BARCODE LABELS
// ═══════════════════════════════════════════════════════════════════

function resolveLabelSize(): LabelSize {
  const configured = getConfiguredPaper('label');
  if (configured === '38x25' || configured === '50x30' || configured === '100x50') return configured;
  return '38x25';
}

/** Build the label print job. Exported so scripts/print_smoke.js can render
 *  the exact same document to PDF and assert its page size. */
export async function buildLabelJob(
  productIds: number[],
  size?: LabelSize,
  copies = 1,
  layoutOverride?: 'roll' | 'sheet',
  barcodeOnly = false
): Promise<PrintJob> {
  const chosen: LabelSize = size ?? resolveLabelSize();
  const layout = layoutOverride ?? getLabelLayout();
  const shopName = getPrintSettings().shop_name || '';

  const products: LabelProduct[] = [];
  for (const id of productIds) {
    const p = getProduct(id);
    if (!p) continue;
    products.push({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
      sale_price: p.sale_price,
      expiry_date: p.expiry_date ?? null,
    });
  }
  if (products.length === 0) throw new Error('None of the selected products could be loaded.');

  const batch = await buildLabelBatchHtml(products, chosen, layout, copies, shopName, barcodeOnly);
  return {
    html: batch.html,
    paper: chosen,
    labelLayout: layout,
    labelRows: batch.rows,
    printerKey: 'label',
    jobName: `${barcodeOnly ? 'Barcode-only label' : 'Barcode label'} x${batch.count}`,
  };
}

/** Print a batch of labels for many products at once. */
export async function printBarcodeBatch(
  productIds: number[],
  size?: LabelSize,
  copies = 1
): Promise<PrintResult> {
  return printDocument(await buildLabelJob(productIds, size, copies));
}

export async function previewBarcodeBatch(
  productIds: number[],
  size?: LabelSize,
  copies = 1
): Promise<PrintResult> {
  return previewDocument(await buildLabelJob(productIds, size, copies), {
    title: 'Barcode label preview',
    printButtonLabel: 'Print labels',
  });
}

/** Single-product label (used by the Inventory row buttons). */
export async function printLabel(productId: number, copies = 1): Promise<PrintResult> {
  return printDocument(await buildLabelJob([productId], undefined, copies));
}

/** Barcode-only label: shop name + barcode, no price/name/expiry. */
export async function printBarcodeLabel(productId: number, copies = 1): Promise<PrintResult> {
  return printDocument(await buildLabelJob([productId], undefined, copies, undefined, true));
}

// ═══════════════════════════════════════════════════════════════════
//  TEXT RECEIPT (SMS / WhatsApp / email body)
// ═══════════════════════════════════════════════════════════════════

export function buildReceiptText(saleId: number): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = makeMoney(currency);
  const cashier = getUser(sale.user_id ?? 0);

  const lines: string[] = [];
  if (s.shop_name) lines.push(s.shop_name);
  if (s.shop_address) lines.push(s.shop_address);
  if (s.shop_phone) lines.push(s.shop_phone);
  lines.push('----------------------------');
  lines.push(`Invoice: ${sale.invoice_no}`);
  lines.push(`Date: ${sale.created_at ? formatLocalString(sale.created_at) : ''}`);
  if (sale.customer_name) lines.push(`Customer: ${sale.customer_name}`);
  lines.push(`Cashier: ${cashier?.username ?? ''}`);
  lines.push('----------------------------');
  for (const it of sale.items) {
    const displayQty = it.display_qty;
    const unitName = it.unit_name;
    const useUnit = !!unitName && displayQty != null;
    const qtyLabel = useUnit ? `${displayQty} ${unitName}` : String(it.qty);
    const priceLabel = useUnit && displayQty > 0 ? fmt(it.line_total / displayQty) : fmt(it.unit_price);
    lines.push(`${it.product_name || `#${it.product_id}`}`);
    lines.push(`  ${qtyLabel} x ${priceLabel} = ${fmt(it.line_total)}`);
    if (it.promo_name) lines.push(`  Promo: ${it.promo_name}`);
  }
  lines.push('----------------------------');
  lines.push(`Subtotal: ${fmt(sale.subtotal)}`);
  if (sale.discount_amount > 0) lines.push(`Discount: -${fmt(sale.discount_amount)}`);
  if (sale.tax_amount > 0) lines.push(`Tax: ${fmt(sale.tax_amount)}`);
  if (sale.service_charge && sale.service_charge > 0) lines.push(`Service Charge: ${fmt(sale.service_charge)}`);
  if (sale.freight && sale.freight > 0) lines.push(`Freight/Delivery: ${fmt(sale.freight)}`);
  lines.push(`TOTAL: ${fmt(sale.total_amount)}`);
  for (const p of sale.payments) lines.push(`  ${p.mode}: ${fmt(p.amount)}`);
  lines.push('----------------------------');
  if (s.receipt_footer) lines.push(s.receipt_footer);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
//  CASH DRAWER
// ═══════════════════════════════════════════════════════════════════

export async function openCashDrawer(): Promise<{ ok: boolean; message: string }> {
  // The drawer is physically wired into the till's receipt printer, so it
  // follows that setting. Unlike a document it cannot fall back to the Windows
  // print dialog — there is nothing to show the user — so when no receipt
  // printer is configured we use the system default rather than failing.
  const configured = getConfiguredPrinter('receipt');
  const target = configured && configured !== AUTO_PRINTER ? configured.replace(/'/g, "''") : '';
  const script = `
$ErrorActionPreference = 'Stop'
$target = '${target}'
try {
  if ($target) {
    $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $target } | Select-Object -First 1
  }
  if (-not $printer) {
    $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
  }
  if (-not $printer) {
    Write-Output 'NO_PRINTER'
    exit 2
  }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DrawerPulse {
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 pDocInfo);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  [StructLayout(LayoutKind.Sequential)]
  public struct DOC_INFO_1 { public string pDocName; public string pOutputFile; public string pDatatype; }
}
'@
  $docInfo = New-Object DrawerPulse+DOC_INFO_1
  $docInfo.pDocName = 'Cash Drawer'
  $docInfo.pDatatype = 'RAW'
  $hPrinter = [IntPtr]::Zero
  if (-not [DrawerPulse]::OpenPrinter($printer.Name, [ref]$hPrinter, [IntPtr]::Zero)) {
    Write-Output 'OPEN_FAILED'
    exit 3
  }
  try {
    [DrawerPulse]::StartDocPrinter($hPrinter, 1, [ref]$docInfo) | Out-Null
    # ESC/POS cash drawer kick: ESC p m t1 t2  (pulse pin 2, 50ms on, 250ms off)
    $bytes = [byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA)
    $written = 0
    [DrawerPulse]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written) | Out-Null
    [DrawerPulse]::EndDocPrinter($hPrinter) | Out-Null
    Write-Output 'KICK_SENT'
  } finally {
    [DrawerPulse]::ClosePrinter($hPrinter) | Out-Null
  }
} catch {
  Write-Output ('ERROR: ' + $_.Exception.Message)
  exit 1
}
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        const out = String(stdout || '').trim();
        if (out.includes('NO_PRINTER')) {
          resolve({ ok: false, message: 'No default printer found. Connect a thermal printer to use the cash drawer.' });
          return;
        }
        if (out.includes('OPEN_FAILED')) {
          resolve({ ok: false, message: 'Could not open the printer for a drawer pulse. Check that the printer is online.' });
          return;
        }
        if (err || out.includes('ERROR:')) {
          resolve({
            ok: false,
            message: out.includes('ERROR:')
              ? out.replace('ERROR: ', '')
              : String(err?.message ?? 'Unknown printer error'),
          });
          return;
        }
        if (out.includes('KICK_SENT')) {
          resolve({ ok: true, message: 'Cash drawer pulse sent.' });
          return;
        }
        resolve({ ok: false, message: 'Cash drawer command failed — no response from printer.' });
      }
    );
  });
}

// ═══════════════════════════════════════════════════════════════════
//  DRAWER SUMMARY
// ═══════════════════════════════════════════════════════════════════

export function buildDrawerSummaryHtml(data: {
  opening_cash: number;
  closing_cash: number;
  cash_sales: number;
  card_sales: number;
  udhaar_sales: number;
  other_payments: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  opened_at: string;
  closed_at: string;
  cashier: string;
  notes?: string;
}): string {
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = makeMoney(currency);
  const spec = PAPER_SPECS[resolveReceiptPaper()];

  const css = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  width: ${spec.contentMm}mm; padding: 1.2mm ${(spec.widthMm - spec.contentMm) / 2}mm;
  font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #000;
  -webkit-print-color-adjust: exact;
}
h1 { font-size: 12pt; margin: 0 0 1mm; text-align: center; }
.shop { text-align: center; font-size: 8pt; color: #333; }
table { width: 100%; border-collapse: collapse; margin: 1.2mm 0; }
td { padding: 0.5mm 0; }
td.r { text-align: right; }
.line { border-top: 0.3mm dashed #000; margin: 1.2mm 0; }
.totals td { font-weight: 700; }
.foot { text-align: center; margin-top: 1.8mm; font-size: 8pt; }
.pos { color: #16a34a; font-weight: 700; }
.neg { color: #dc2626; font-weight: 700; }
`;

  const body = `<h1>Cash Drawer Summary</h1>
<div class="shop">${esc(s.shop_name || '')}</div>
<div class="line"></div>
<table>
  <tr><td>Cashier</td><td class="r">${esc(data.cashier)}</td></tr>
  <tr><td>Opened</td><td class="r">${esc(data.opened_at)}</td></tr>
  <tr><td>Closed</td><td class="r">${esc(data.closed_at)}</td></tr>
</table>
<div class="line"></div>
<table>
  <tr><td>Opening cash</td><td class="r">${fmt(data.opening_cash)}</td></tr>
  <tr><td>Cash sales</td><td class="r">${fmt(data.cash_sales)}</td></tr>
  <tr><td>Card sales</td><td class="r">${fmt(data.card_sales)}</td></tr>
  <tr><td>Udhaar sales</td><td class="r">${fmt(data.udhaar_sales)}</td></tr>
  ${data.other_payments > 0 ? `<tr><td>Other payments</td><td class="r">${fmt(data.other_payments)}</td></tr>` : ''}
  ${data.cash_refunds > 0 ? `<tr><td>Cash refunds</td><td class="r">-${fmt(data.cash_refunds)}</td></tr>` : ''}
  ${data.cash_in > 0 ? `<tr><td>Cash in</td><td class="r">+${fmt(data.cash_in)}</td></tr>` : ''}
  ${data.cash_out > 0 ? `<tr><td>Cash out</td><td class="r">-${fmt(data.cash_out)}</td></tr>` : ''}
</table>
<div class="line"></div>
<table class="totals">
  <tr><td>Expected cash</td><td class="r">${fmt(data.expected_cash)}</td></tr>
  <tr><td>Actual cash</td><td class="r">${fmt(data.actual_cash)}</td></tr>
  <tr><td>Variance</td><td class="r ${data.variance >= 0 ? 'pos' : 'neg'}">${data.variance >= 0 ? '+' : ''}${fmt(data.variance)}</td></tr>
</table>
${data.notes ? `<div class="line"></div><div>${esc(data.notes)}</div>` : ''}
<div class="foot">${esc(s.receipt_footer_text || 'Thank you!')}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cash drawer summary</title><style>${css}</style></head><body>${body}</body></html>`;
}

export async function printDrawerSummary(
  data: Parameters<typeof buildDrawerSummaryHtml>[0]
): Promise<PrintResult> {
  return printDocument({
    html: buildDrawerSummaryHtml(data),
    paper: resolveReceiptPaper(),
    printerKey: 'receipt',
    jobName: 'Cash drawer summary',
  });
}

// ═══════════════════════════════════════════════════════════════════
//  CALIBRATION + SETTINGS HELPERS
// ═══════════════════════════════════════════════════════════════════

export async function printTestSheet(paper?: PaperKind): Promise<PrintResult> {
  const chosen: PaperKind = paper ?? resolveReceiptPaper();
  return printCalibration(chosen, buildCalibrationHtml);
}

export { AUTO_PRINTER, LABEL_SPECS, PAPER_SPECS, invalidatePrinterCache };

// Label Studio phase 4 entry points live in their own module so this load-bearing
// print facade stays untouched; they are re-exported for ipc.ts which imports
// everything print-related from here.
export {
  printBarcodeBatchWithOptions,
  exportLabelBatchToPDF,
  exportLabelBatchToPNG,
  printCalibrationLabel,
  type LabelRunOptions,
} from './labelStudioPrinting';

// Phase 5: X/Z reports
export {
  printReport,
  previewReport,
} from './xzReports';
