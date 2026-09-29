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
import { buildLabelBatchHtml, type LabelProduct } from './labelTemplates';
import { getProduct } from './inventory';
import {
  printDocument,
  previewDocument,
  printCalibration,
  registerPrintProtocol,
  PAPER_SPECS,
  LABEL_SPECS,
  AUTO_PRINTER,
  getConfiguredPaper,
  getConfiguredPrinter,
  getLabelLayout,
  invalidatePrinterCache,
  type LabelSize,
  type PaperKind,
  type PrintResult,
  type PrintJob,
} from './printService';

export { buildReceiptHtml, buildInvoiceHtml, getAvailableTemplates, registerPrintProtocol };
export type { PrintResult, ReceiptTemplate, LabelSize, PaperKind };

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

export function buildReceiptJob(saleId: number, template?: ReceiptTemplate): PrintJob {
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
    html: buildReceiptHtml(saleId, fitted),
    paper,
    printerKey: 'receipt',
    jobName: 'Receipt',
    warnings,
  };
}

export async function printSale(saleId: number, template?: ReceiptTemplate): Promise<PrintResult> {
  return printDocument(buildReceiptJob(saleId, template));
}

export async function previewReceipt(saleId: number, template?: ReceiptTemplate): Promise<PrintResult> {
  return previewDocument(buildReceiptJob(saleId, template), {
    title: 'Receipt preview',
    printButtonLabel: 'Print receipt',
  });
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
