import { getSale } from './sales';
import { getAllSettings } from './settings';
import { getReceiptSettings } from './reports';
import { getAllAdminSettings } from './admin';
import { getUser } from './auth';
import { formatLocalString } from '../utils/timezone';

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
    if (admin.receipt_width) base.receipt_width = admin.receipt_width;
    if (admin.receipt_font_size) base.receipt_font_size = admin.receipt_font_size;
    if (admin.receipt_header_text) base.receipt_header_text = admin.receipt_header_text;
    if (admin.receipt_footer_text) base.receipt_footer_text = admin.receipt_footer_text;
    if (admin.show_tax_on_receipt !== undefined) base.show_tax_on_receipt = admin.show_tax_on_receipt;
    if (admin.show_discount_breakdown !== undefined) base.show_discount_breakdown = admin.show_discount_breakdown;
    if (admin.show_payment_method !== undefined) base.show_payment_method = admin.show_payment_method;
    if (admin.show_cashier_name !== undefined) base.show_cashier_name = admin.show_cashier_name;
    if (admin.currency_symbol) base.currency = admin.currency_symbol;
    if (admin.receipt_template) base.receipt_template = admin.receipt_template;
    return base;
  } catch {
    return getAllSettings();
  }
}

export type ReceiptTemplate = 'thermal' | 'standard' | 'a4';

export function getAvailableTemplates(): Array<{ id: ReceiptTemplate; name: string; description: string; width: string }> {
  return [
    { id: 'thermal', name: 'Thermal (58mm)', description: 'Compact thermal receipt for 58mm printers', width: '220px' },
    { id: 'standard', name: 'Standard (80mm)', description: 'Standard receipt for 80mm thermal printers', width: '300px' },
    { id: 'a4', name: 'A4 Invoice', description: 'Full-page A4 invoice with professional layout', width: '794px' },
  ];
}

interface TemplateOpts {
  showTax: boolean;
  showDiscount: boolean;
  showPaymentMethod: boolean;
  showCashierName: boolean;
  headerText: string;
  footerText: string;
  currency: string;
}

export function buildReceiptHtml(saleId: number, template?: ReceiptTemplate): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const tmpl = template || s.receipt_template || 'standard';

  const currency = s.currency || 'Rs';
  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cashier = getUser(sale.user_id ?? 0);
  const showTax = s.show_tax_on_receipt !== 'false';
  const showDiscount = s.show_discount_breakdown !== 'false';
  const showPaymentMethod = s.show_payment_method !== 'false';
  const showCashierName = s.show_cashier_name !== 'false';
  const headerText = s.receipt_header_text || '';
  const footerText = s.receipt_footer_text || s.receipt_footer || '';

  const opts: TemplateOpts = { showTax, showDiscount, showPaymentMethod, showCashierName, headerText, footerText, currency };

  if (tmpl === 'thermal') return buildThermal(sale, s, fmt, cashier, opts);
  if (tmpl === 'a4') return buildA4(sale, s, fmt, cashier, opts);
  return buildStandard(sale, s, fmt, cashier, opts);
}

function buildThermal(sale: any, s: any, fmt: Function, cashier: any, opts: TemplateOpts): string {
  const rows = sale.items.map((it: any) => {
    const qty = it.display_qty || it.qty;
    const unitPrice = it.display_qty > 0 ? it.line_total / it.display_qty : it.unit_price;
    return `<tr><td>${esc(it.product_name)}</td><td class="r">${qty}x${fmt(unitPrice)}</td><td class="r">${fmt(it.line_total)}</td></tr>`;
  }).join('');

  const paymentRows = sale.payments.map((p: any) => `<tr><td>${esc(p.mode)}</td><td class="r">${fmt(p.amount)}</td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'Courier New',monospace;width:220px;margin:0 auto;font-size:10px;color:#000;padding:4px}
h1{font-size:12px;text-align:center;margin:0 0 2px}
.center{text-align:center}
table{width:100%;border-collapse:collapse;margin:4px 0}
td{padding:1px 0;font-size:10px}
td.r{text-align:right}
.line{border-top:1px dashed #000;margin:4px 0}
.footer{text-align:center;margin-top:6px;font-size:9px}
</style></head><body>
${opts.headerText ? `<div class="center">${esc(opts.headerText)}</div>` : ''}
${s.shop_logo ? `<img src="${esc(s.shop_logo)}" style="max-width:100%;height:auto;margin-bottom:2px"/>` : ''}
<h1>${esc(s.shop_name)}</h1>
<div class="center" style="font-size:9px">${esc(s.shop_address)}${s.shop_phone ? '<br>'+esc(s.shop_phone) : ''}</div>
<div class="line"></div>
<div style="font-size:9px">Inv: ${esc(sale.invoice_no)} | ${sale.created_at ? formatLocalString(sale.created_at) : ''}</div>
${sale.customer_name ? `<div style="font-size:9px">To: ${esc(sale.customer_name)}</div>` : ''}
${opts.showCashierName ? `<div style="font-size:9px">By: ${esc(cashier?.username ?? '')}</div>` : ''}
<div class="line"></div>
<table>${rows}</table>
<div class="line"></div>
<table>
<tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
${opts.showDiscount && sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
${opts.showTax && sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
<tr><td><b>TOTAL</b></td><td class="r"><b>${fmt(sale.total_amount)}</b></td></tr>
${opts.showPaymentMethod ? paymentRows : ''}
</table>
<div class="line"></div>
<div class="footer">${esc(opts.footerText)}</div>
</body></html>`;
}

function buildStandard(sale: any, s: any, fmt: Function, cashier: any, opts: TemplateOpts): string {
  const rows = sale.items.map((it: any) => {
    const qty = it.display_qty || it.qty;
    const unitName = it.unit_name;
    const useUnit = !!unitName && it.display_qty != null;
    const qtyLabel = useUnit ? `${it.display_qty} ${unitName}` : String(it.qty);
    const priceLabel = useUnit && it.display_qty > 0 ? fmt(it.line_total / it.display_qty) : fmt(it.unit_price);
    return `<tr><td class="item-name">${esc(it.product_name || `#${it.product_id}`)}</td><td class="r qty">${esc(qtyLabel)}</td><td class="r price">${priceLabel}</td><td class="r total">${fmt(it.line_total)}</td></tr>`;
  }).join('');

  const paymentRows = sale.payments.map((p: any) => `<tr><td>${esc(p.mode)}</td><td class="r">${fmt(p.amount)}</td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;width:300px;margin:0 auto;font-size:12px;color:#000}
h1{font-size:16px;text-align:center;margin:0 0 2px}
.center{text-align:center}
.addr{font-size:11px;color:#444}
table{width:100%;border-collapse:collapse;margin:6px 0}
td{padding:2px 0;vertical-align:top}
td.r{text-align:right}
.line{border-top:1px dashed #000;margin:6px 0}
.footer{text-align:center;margin-top:8px;font-size:11px}
.qty{color:#444}
</style></head><body>
${opts.headerText ? `<div class="center" style="margin-bottom:4px">${esc(opts.headerText)}</div>` : ''}
${s.shop_logo ? `<img src="${esc(s.shop_logo)}" style="max-width:100%;height:auto;margin-bottom:4px"/>` : ''}
<h1>${esc(s.shop_name)}</h1>
<div class="center addr">${esc(s.shop_address)}${s.shop_phone ? '<br>'+esc(s.shop_phone) : ''}</div>
<div class="line"></div>
<table><tr><td>Invoice</td><td class="r">${esc(sale.invoice_no)}</td></tr>
<tr><td>Date</td><td class="r">${sale.created_at ? formatLocalString(sale.created_at) : ''}</td></tr>
${sale.customer_name ? `<tr><td>Customer</td><td class="r">${esc(sale.customer_name)}</td></tr>` : ''}
${opts.showCashierName ? `<tr><td>Cashier</td><td class="r">${esc(cashier?.username ?? '')}</td></tr>` : ''}
</table>
<div class="line"></div>
<table>${rows}</table>
<div class="line"></div>
<table>
<tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
${opts.showDiscount && sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
${opts.showTax && sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
${sale.service_charge > 0 ? `<tr><td>Service Charge</td><td class="r">${fmt(sale.service_charge)}</td></tr>` : ''}
${sale.freight > 0 ? `<tr><td>Freight</td><td class="r">${fmt(sale.freight)}</td></tr>` : ''}
<tr><td><b>TOTAL</b></td><td class="r"><b>${fmt(sale.total_amount)}</b></td></tr>
${opts.showPaymentMethod ? paymentRows : ''}
</table>
<div class="line"></div>
<div class="footer">${esc(opts.footerText)}</div>
</body></html>`;
}

function buildA4(sale: any, s: any, fmt: Function, cashier: any, opts: TemplateOpts): string {
  const rows = sale.items.map((it: any, i: number) => {
    const qty = it.display_qty || it.qty;
    const unitPrice = it.display_qty > 0 ? it.line_total / it.display_qty : it.unit_price;
    return `<tr><td>${i+1}</td><td>${esc(it.product_name)}</td><td class="r">${qty}</td><td class="r">${fmt(unitPrice)}</td><td class="r">${fmt(it.line_total)}</td></tr>`;
  }).join('');

  const paymentRows = sale.payments.map((p: any) => `<tr><td>${esc(p.mode)}</td><td class="r">${fmt(p.amount)}</td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:20mm}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1e293b;margin:0;padding:20px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:20px}
.header-left h1{margin:0;font-size:24px;color:#4f46e5}
.header-left p{margin:4px 0;color:#64748b;font-size:13px}
.header-right{text-align:right}
.header-right h2{margin:0;font-size:20px;color:#1e293b}
.header-right p{margin:4px 0;color:#64748b;font-size:13px}
.section{margin-bottom:20px}
.section-title{font-size:14px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:8px 12px;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;border-bottom:2px solid #e2e8f0}
td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
td.r{text-align:right;font-variant-numeric:tabular-nums}
.summary-table{width:300px;margin-left:auto}
.summary-table td{padding:6px 12px}
.summary-total{font-size:16px;font-weight:700;border-top:2px solid #4f46e5;color:#4f46e5}
.footer{margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;font-size:11px}
</style></head><body>
<div class="header">
<div class="header-left">
${s.shop_logo ? `<img src="${esc(s.shop_logo)}" style="max-height:60px;margin-bottom:8px"/>` : ''}
<h1>${esc(s.shop_name)}</h1>
<p>${esc(s.shop_address)}</p>
<p>${esc(s.shop_phone || '')}</p>
</div>
<div class="header-right">
<h2>INVOICE</h2>
<p><b>${esc(sale.invoice_no)}</b></p>
<p>${sale.created_at ? formatLocalString(sale.created_at) : ''}</p>
${sale.customer_name ? `<p>Bill To: <b>${esc(sale.customer_name)}</b></p>` : ''}
${opts.showCashierName ? `<p>Cashier: ${esc(cashier?.username ?? '')}</p>` : ''}
</div>
</div>
<div class="section">
<div class="section-title">Items</div>
<table>
<thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<div class="section">
<table class="summary-table">
<tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
${opts.showDiscount && sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
${opts.showTax && sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
${sale.service_charge > 0 ? `<tr><td>Service Charge</td><td class="r">${fmt(sale.service_charge)}</td></tr>` : ''}
${sale.freight > 0 ? `<tr><td>Freight/Delivery</td><td class="r">${fmt(sale.freight)}</td></tr>` : ''}
<tr class="summary-total"><td><b>TOTAL</b></td><td class="r"><b>${fmt(sale.total_amount)}</b></td></tr>
${opts.showPaymentMethod ? paymentRows : ''}
</table>
</div>
<div class="footer">${esc(opts.footerText)}</div>
</body></html>`;
}
