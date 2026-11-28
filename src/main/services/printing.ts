/**
 * Print facade.
 *
 * Every entry point here delegates to `printService`, which is the only module
 * that touches `webContents.print()`. Previously this file contained its own
 * hidden-window/`webContents.print()` implementation that never passed
 * `pageSize` or `margins`, which is why receipts printed as a narrow strip on
 * whatever paper the printer happened to be loaded with.
 */
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
import type { PrintSaleOptions, PrintPreviewLabels } from '../../shared/types';
import { buildLabelBatchHtml, type LabelProduct } from './labelTemplates';
import { getProduct } from './inventory';
import { getAdminSetting } from './admin';
import { amendmentStamp } from './billAmendments';
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
  getLabelLayout,
  getReceiptCopies,
  getCashDrawerKickEnabled,
  openCashDrawer,
  invalidatePrinterCache,
  type LabelSize,
  type PaperKind,
  type PrintResult,
  type PrintJob,
} from './printService';

export { buildReceiptHtml, buildInvoiceHtml, getAvailableTemplates, registerPrintProtocol };
export type { PrintResult, ReceiptTemplate, LabelSize, PaperKind, PrintSaleOptions, PrintPreviewLabels };
// Phase 4, item 3 — the cash drawer pulse moved into `printService`, so the
// whole "after a successful print" behaviour lives in ONE module. It is
// re-exported here because the IPC layer imports it from this file.
export { openCashDrawer };

/** Is the "DUPLICATE COPY" stamp enabled? Default ON; only an explicit 'false' hides it. */
function duplicateLabelEnabled(): boolean {
  try {
    return getAdminSetting('receipt_duplicate_label') !== 'false';
  } catch {
    return true;
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

export function buildReceiptJob(
  saleId: number,
  template?: ReceiptTemplate,
  duplicate = false,
  amendmentLabel?: string | null
): PrintJob {
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
    html: buildReceiptHtml(saleId, fitted, { duplicate, amendmentLabel: amendmentLabel ?? null }),
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
  // A bill that has been amended says so on the paper, with the number of
  // amendments. "Print amended version" forces the marker even when the shop
  // has no amendments yet (the button is only offered on an amended bill).
  const amendmentLabel = opts.amendedVersion ? amendmentStamp(saleId) ?? 'AMENDED' : amendmentStamp(saleId);
  if (isReceiptDesignEnabled()) {
    const paper = resolveReceiptPaper();
    try {
      const html = await renderAppliedReceipt(saleId, paper, duplicate, amendmentLabel);
      if (html) {
        return { html, paper, printerKey: 'receipt', jobName: 'Receipt', warnings: [] };
      }
    } catch (e) {
      log(`receipt design render failed, falling back to the shipped layout: ${e instanceof Error ? e.message : e}`);
    }
  }
  return buildReceiptJob(saleId, template, duplicate, amendmentLabel);
}

export async function printSale(
  saleId: number,
  template?: ReceiptTemplate,
  opts: PrintSaleOptions = {}
): Promise<PrintResult> {
  const job = await buildReceiptJobAsync(saleId, template, opts);
  const copies = opts.copies ?? getReceiptCopies();
  if (Number.isFinite(copies) && copies > 1) job.copies = Math.min(10, Math.floor(copies));
  // Phase 4, item 3 — the job carries WHAT it is, and the print pipeline
  // decides what happens afterwards (one rule for every print path):
  //   - the sale is remembered as "the last printed sale";
  //   - the cash drawer pulses for a FRESH receipt, never for a reprint.
  job.saleId = saleId;
  job.duplicate = !!opts.duplicate;
  if (opts.kickDrawer !== undefined) job.kickDrawer = !!opts.kickDrawer;
  return printDocument(job);
}

export async function previewReceipt(
  saleId: number,
  template?: ReceiptTemplate,
  opts: PrintSaleOptions = {}
): Promise<PrintResult> {
  const job = await buildReceiptJobAsync(saleId, template, opts);
  // Phase 4, item 3 — the preview's Print button must behave like the direct
  // print, so the job carries the sale id (and whether it is a reprint).
  job.saleId = saleId;
  job.duplicate = !!opts.duplicate;
  return previewDocument(job, {
    // Title is spec'd to read EXACTLY "Receipt preview".
    title: 'Receipt preview',
    printButtonLabel: opts.labels?.print || 'Print receipt',
    // Phase 4, item 5 — the toolbar's strings in the shop's language.
    labels: opts.labels,
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
  copies = 1,
  draft = false
): Promise<PrintResult> {
  const design = normalizeReceiptDesign(designInput);
  const sample = buildSampleSale(getPrintSettings(), 'sale');
  let html = await buildDesignedReceiptAsync(sample, paper, design);
  if (draft) html = withDraftBanner(html);
  const job: PrintJob = {
    html,
    paper,
    printerKey: 'receipt',
    jobName: 'Receipt test print',
  };
  if (Number.isFinite(copies) && copies > 1) job.copies = Math.min(10, Math.floor(copies));
  return printDocument(job);
}

/**
 * Mark an unsaved designer layout in preview / test print only. The banner is
 * injected after `<body>` so it can never reach a real customer receipt (real
 * prints never pass `draft`).
 */
export function withDraftBanner(html: string): string {
  const banner =
    '<div style="border:1px dashed #b45309;color:#b45309;font:700 11px Arial,sans-serif;' +
    'text-align:center;padding:1mm;margin:0 0 1mm;letter-spacing:0.5px">DRAFT — UNSAVED LAYOUT</div>';
  return html.includes('<body>') ? html.replace('<body>', `<body>${banner}`) : banner + html;
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

export async function previewInvoice(saleId: number, opts: PrintSaleOptions = {}): Promise<PrintResult> {
  return previewDocument(buildInvoiceJob(saleId), {
    title: 'Invoice preview',
    printButtonLabel: opts.labels?.print || 'Print invoice',
    // Phase 4, item 5 — the toolbar's strings in the shop's language.
    labels: opts.labels,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  BARCODE LABELS
// ═══════════════════════════════════════════════════════════════════

/**
 * The label stock the shop configured.
 *
 * Phase 4, item 4.10 — the shop can pick ANY stock size the engine knows
 * (38x28, 40x30, 50x25, 58x40, 60x40, ...). The old resolver only accepted
 * three of them, so everything else silently printed on a 38x25 page - the
 * physical stock and the printed page did not match. Exported so the
 * permanent suite can pin the rule.
 */
export function resolveLabelSize(): LabelSize {
  const configured = getConfiguredPaper('label');
  if (configured && configured in LABEL_SPECS) return configured as LabelSize;
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
  copies = 1,
  labels?: PrintPreviewLabels
): Promise<PrintResult> {
  return previewDocument(await buildLabelJob(productIds, size, copies), {
    title: 'Barcode label preview',
    // Phase 4, item 4.16 — the label preview's toolbar follows the shop's
    // language too (it used to be English-only).
    printButtonLabel: labels?.print || 'Print labels',
    labels,
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

// The cash-drawer pulse now lives in `printService` (Phase 4, item 3), so the
// whole "after a successful print" behaviour is in ONE module. It is re-exported
// above for the callers that import it from this file.

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

/**
 * The paper a calibration sheet is printed on.
 *
 * Phase 4, item 4.9 — 'receipt' is NOT a paper key (the paper keys are
 * thermal58 / thermal80 / a4 / a5). It used to go straight into PAPER_SPECS
 * and the "Print Test Page (Receipt)" button died before it printed
 * anything. Treat it as "the receipt paper this shop uses".
 */
export function resolveCalibrationPaper(paper?: PaperKind | string): PaperKind {
  if (!paper || paper === 'receipt') return resolveReceiptPaper();
  if (paper === 'thermal58' || paper === 'thermal80' || paper === 'a4' || paper === 'a5') {
    return paper as PaperKind;
  }
  // An unknown key must not reach PAPER_SPECS - that is what crashed the
  // button. Fall back to the receipt paper and let the caller report it.
  return resolveReceiptPaper();
}

export async function printTestSheet(paper?: PaperKind): Promise<PrintResult> {
  const chosen: PaperKind = resolveCalibrationPaper(paper);
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
