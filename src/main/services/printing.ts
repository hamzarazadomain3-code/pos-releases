import { BrowserWindow } from 'electron';
import bwipjs from 'bwip-js';
import { getSale } from './sales';
import { getAllSettings } from './settings';
import { getReceiptSettings } from './reports';
import { getAllAdminSettings } from './admin';
import { getProduct } from './inventory';
import { getUser } from './auth';
import { formatLocalString } from '../utils/timezone';
import { buildReceiptHtml as buildReceiptFromTemplate, type ReceiptTemplate } from './receiptTemplates';

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPrintSettings(): Record<string, string> {
  try {
    const base = { ...getAllSettings(), ...getReceiptSettings() };
    const admin = getAllAdminSettings();
    // Override with admin receipt settings
    if (admin.receipt_width) base.receipt_width = admin.receipt_width;
    if (admin.receipt_font_size) base.receipt_font_size = admin.receipt_font_size;
    if (admin.receipt_header_text) base.receipt_header_text = admin.receipt_header_text;
    if (admin.receipt_footer_text) base.receipt_footer_text = admin.receipt_footer_text;
    if (admin.show_tax_on_receipt !== undefined) base.show_tax_on_receipt = admin.show_tax_on_receipt;
    if (admin.show_discount_breakdown !== undefined) base.show_discount_breakdown = admin.show_discount_breakdown;
    if (admin.show_payment_method !== undefined) base.show_payment_method = admin.show_payment_method;
    if (admin.show_cashier_name !== undefined) base.show_cashier_name = admin.show_cashier_name;
    if (admin.currency_symbol) base.currency = admin.currency_symbol;
    return base;
  } catch {
    return getAllSettings();
  }
}

function printHtml(html: string): void {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  win.webContents.setBackgroundThrottling(false);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.webContents.once('did-finish-load', () => {
    win.webContents.print(
      { silent: false, printBackground: true },
      () => win.destroy()
    );
  });
  win.webContents.on('did-fail-load', () => win.destroy());
}

export function buildReceiptHtml(saleId: number, template?: ReceiptTemplate): string {
  return buildReceiptFromTemplate(saleId, template);
}

export function previewHtml(html: string): void {
  const win = new BrowserWindow({
    show: true,
    width: 400,
    height: 600,
    webPreferences: { sandbox: true },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

export function buildReceiptText(saleId: number): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function previewReceipt(saleId: number, template?: ReceiptTemplate): void {
  previewHtml(buildReceiptHtml(saleId, template));
}

export function printSale(saleId: number, template?: ReceiptTemplate): void {
  printHtml(buildReceiptHtml(saleId, template));
}

export function buildInvoiceHtml(saleId: number): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cashier = getUser(sale.user_id ?? 0);
  const rows = sale.items
    .map((it) => {
      const displayQty = it.display_qty;
      const unitName = it.unit_name;
      const useUnit = !!unitName && displayQty != null;
      const qtyLabel = useUnit ? `${displayQty} ${unitName}` : String(it.qty);
      const priceLabel =
        useUnit && displayQty > 0 ? fmt(it.line_total / displayQty) : fmt(it.unit_price);
      return `
<tr>
  <td class="item-name">${esc(it.product_name || `#${it.product_id}`)}</td>
  <td class="r qty">${esc(qtyLabel)}</td>
  <td class="r price">${priceLabel}</td>
  <td class="r discount">${it.discount ? fmt(it.discount) : ''}</td>
  <td class="r tax">${it.tax_rate ? `${it.tax_rate}%` : ''}</td>
  <td class="r total">${fmt(it.line_total)}</td>
</tr>
${it.promo_name ? `<tr><td colspan="6" class="promo">Promo: ${esc(it.promo_name)}</td></tr>` : ''}`;
    })
    .join('');

  const paymentRows = sale.payments
    .map((p) => `<tr><td>${esc(p.mode)}</td><td class="r">${fmt(p.amount)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; width: 21cm; margin: 0 auto; font-size: 12px; color: #000; }
  h1 { font-size: 20px; margin: 0 0 4px; text-align: center; }
  .center { text-align: center; }
  .addr { font-size: 13px; color: #444; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { padding: 4px 2px; border-bottom: 1px solid #ddd; }
  td.r { text-align: right; }
  .meta td { font-size: 13px; }
  .totals td { font-weight: 600; }
  .line { border-top: 2px solid #000; margin: 12px 0; }
  .footer { text-align: center; margin-top: 12px; font-size: 13px; }
  .promo { color: #16a34a; font-size: 12px; display: block; }
  .signature { margin-top: 30px; font-size: 13px; }
</style>
</head>
<body>
  ${s.shop_logo ? `<img src="${esc(s.shop_logo)}" style="max-width:100%;height:auto;margin-bottom:8px;"/>` : ''}
  <h1>${esc(s.shop_name)}</h1>
  <div class="center addr">${esc(s.shop_address)}${s.shop_phone ? '<br>' + esc(s.shop_phone) : ''}</div>
  <div class="line"></div>
  <table class="meta">
    <tr><td>Invoice</td><td class="r">${esc(sale.invoice_no)}</td></tr>
    <tr><td>Date</td><td class="r">${sale.created_at ? formatLocalString(sale.created_at) : ''}</td></tr>
    ${sale.customer_name ? `<tr><td>Customer</td><td class="r">${esc(sale.customer_name)}</td></tr>` : ''}
    <tr><td>Cashier</td><td class="r">${esc(cashier?.username ?? '')}</td></tr>
  </table>
  <div class="line"></div>
  <table>
    <tr>
      <th class="item-name">Item</th>
      <th class="r qty">Qty</th>
      <th class="r price">Price</th>
      <th class="r discount">Discount</th>
      <th class="r tax">Tax</th>
      <th class="r">Total</th>
    </tr>
    ${rows}
  </table>
  <div class="line"></div>
  <table class="totals">
    <tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
    ${sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
    ${sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
    ${sale.service_charge && sale.service_charge > 0 ? `<tr><td>Service Charge</td><td class="r">${fmt(sale.service_charge)}</td></tr>` : ''}
    ${sale.freight && sale.freight > 0 ? `<tr><td>Freight/Delivery</td><td class="r">${fmt(sale.freight)}</td></tr>` : ''}
    <tr><td>TOTAL</td><td class="r">${fmt(sale.total_amount)}</td></tr>
    ${paymentRows ? `<tr><td colspan="2" style="font-size:0"> </td></tr>` + paymentRows : ''}
  </table>
  <div class="signature">
    <div>Cashier Signature: ______________________</div>
    <div>Customer Signature: ______________________</div>
  </div>
  <div class="footer">${esc(s.receipt_footer)}</div>
</body>
</html>`;
}

export function previewInvoice(saleId: number): void {
  previewHtml(buildInvoiceHtml(saleId));
}

export function printInvoice(saleId: number): void {
  printHtml(buildInvoiceHtml(saleId));
}


function toDataUrl(options: { bcid: string; text: string; [k: string]: unknown }): Promise<string> {
  return new Promise((resolve) => {
    bwipjs.toBuffer(options, (err: string | Error | null, buffer?: Buffer) => {
      if (err || !buffer) {
        resolve('');
      } else {
        resolve('data:image/png;base64,' + buffer.toString('base64'));
      }
    });
  });
}

export async function buildLabelHtml(productId: number, copies = 1): Promise<string> {
  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const price = `${currency} ${product.sale_price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  let barcode = '';
  if (product.barcode) {
    barcode = await toDataUrl({
      bcid: 'ean13',
      text: product.barcode,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    });
  }

  const labels = Array.from({ length: Math.max(1, copies) })
    .map(
      () => `
      <div class="label">
        <div class="name">${esc(product.name)}</div>
        <div class="price">${esc(price)}</div>
        ${barcode ? `<img src="${barcode}" alt="barcode" />` : `<div class="nobc">${esc(product.sku ?? product.barcode ?? '')}</div>`}
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; }
  .label { width: 250px; border: 1px dashed #999; padding: 8px 10px; margin: 4px; display: inline-block; text-align: center; page-break-inside: avoid; }
  .name { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
  .price { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  img { max-width: 100%; height: auto; }
  .nobc { font-size: 10px; color: #444; }
</style>
</head>
<body>
${labels}
</body>
</html>`;
}

export async function printLabel(productId: number, copies = 1): Promise<boolean> {
  printHtml(await buildLabelHtml(productId, copies));
  return true;
}

export async function buildBarcodeLabelHtml(productId: number, copies = 1): Promise<string> {
  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');

  let barcode = '';
  if (product.barcode) {
    barcode = await toDataUrl({
      bcid: 'ean13',
      text: product.barcode,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    });
  }

  const labels = Array.from({ length: Math.max(1, copies) })
    .map(
      () => `
      <div class="label">
        ${barcode ? `<img src="${barcode}" alt="barcode" />` : `<div class="nobc">${esc(product.sku ?? product.barcode ?? 'no barcode')}</div>`}
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; }
  .label { width: 250px; border: 1px dashed #999; padding: 6px 10px; margin: 4px; display: inline-block; text-align: center; page-break-inside: avoid; }
  img { max-width: 100%; height: auto; }
  .nobc { font-size: 10px; color: #444; }
</style>
</head>
<body>
${labels}
</body>
</html>`;
}

export async function printBarcodeLabel(productId: number, copies = 1): Promise<boolean> {
  printHtml(await buildBarcodeLabelHtml(productId, copies));
  return true;
}

export async function openCashDrawer(): Promise<{ ok: boolean; message: string }> {
  const { execFile } = await import('node:child_process');
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
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
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true }, (err, stdout) => {
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
        resolve({ ok: false, message: out.includes('ERROR:') ? out.replace('ERROR: ', '') : String(err?.message ?? 'Unknown printer error') });
        return;
      }
      if (out.includes('KICK_SENT')) {
        resolve({ ok: true, message: 'Cash drawer pulse sent.' });
        return;
      }
      resolve({ ok: false, message: 'Cash drawer command failed — no response from printer.' });
    });
  });
}

export function buildDrawerSummaryHtml(data: {
  opening_cash: number; closing_cash: number; cash_sales: number;
  card_sales: number; udhaar_sales: number; other_payments: number;
  cash_refunds: number; cash_in: number; cash_out: number;
  expected_cash: number; actual_cash: number; variance: number;
  opened_at: string; closed_at: string; cashier: string;
  notes?: string;
}): string {
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const receiptWidth = s.receipt_width === '58mm' ? '220px' : '300px';
  const fontSize = s.receipt_font_size === 'small' ? '10px' : s.receipt_font_size === 'large' ? '14px' : '12px';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; width: ${receiptWidth}; margin: 0 auto; font-size: ${fontSize}; color: #000; }
  h1 { font-size: 14px; margin: 0 0 4px; text-align: center; }
  .center { text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  td { padding: 2px 0; }
  td.r { text-align: right; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .totals td { font-weight: 600; }
  .footer { text-align: center; margin-top: 8px; font-size: 10px; }
  .variance-pos { color: #16a34a; font-weight: 600; }
  .variance-neg { color: #dc2626; font-weight: 600; }
</style></head>
<body>
  <h1>Cash Drawer Summary</h1>
  <div class="center muted">${esc(s.shop_name || '')}</div>
  <div class="line"></div>
  <table>
    <tr><td>Cashier</td><td class="r">${esc(data.cashier)}</td></tr>
    <tr><td>Opened</td><td class="r">${data.opened_at}</td></tr>
    <tr><td>Closed</td><td class="r">${data.closed_at}</td></tr>
  </table>
  <div class="line"></div>
  <table>
    <tr><td>Opening Cash</td><td class="r">${fmt(data.opening_cash)}</td></tr>
    <tr><td>Cash Sales</td><td class="r">${fmt(data.cash_sales)}</td></tr>
    <tr><td>Card Sales</td><td class="r">${fmt(data.card_sales)}</td></tr>
    <tr><td>Udhaar Sales</td><td class="r">${fmt(data.udhaar_sales)}</td></tr>
    ${data.other_payments > 0 ? `<tr><td>Other Payments</td><td class="r">${fmt(data.other_payments)}</td></tr>` : ''}
    ${data.cash_refunds > 0 ? `<tr><td>Cash Refunds</td><td class="r">-${fmt(data.cash_refunds)}</td></tr>` : ''}
    ${data.cash_in > 0 ? `<tr><td>Cash In</td><td class="r">+${fmt(data.cash_in)}</td></tr>` : ''}
    ${data.cash_out > 0 ? `<tr><td>Cash Out</td><td class="r">-${fmt(data.cash_out)}</td></tr>` : ''}
  </table>
  <div class="line"></div>
  <table class="totals">
    <tr><td>Expected Cash</td><td class="r">${fmt(data.expected_cash)}</td></tr>
    <tr><td>Actual Cash</td><td class="r">${fmt(data.actual_cash)}</td></tr>
    <tr><td>Variance</td><td class="r ${data.variance >= 0 ? 'variance-pos' : 'variance-neg'}">${data.variance >= 0 ? '+' : ''}${fmt(data.variance)}</td></tr>
  </table>
  ${data.notes ? `<div class="line"></div><div class="center muted">${esc(data.notes)}</div>` : ''}
  <div class="footer">${esc(s.receipt_footer_text || 'Thank you!')}</div>
</body></html>`;
}

export function printDrawerSummary(data: Parameters<typeof buildDrawerSummaryHtml>[0]): void {
  printHtml(buildDrawerSummaryHtml(data));
}