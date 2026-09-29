/**
 * Receipt documents (thermal roll layouts).
 *
 * Geometry contract — see printService.ts for the full rationale:
 *  - The template is always narrower than the paper: `contentMm` is the
 *    PRINTABLE width (paper minus the printer's hardware margin). Sizing the
 *    body to the full paper width is what made clients' receipts arrive sliced
 *    into strips.
 *  - All lengths are mm/pt, never px, so output is identical across printer DPI.
 *  - The A4 receipt style is not implemented here — it delegates to the single
 *    canonical A4 invoice so "Preview Invoice", "Print Invoice" and the "A4
 *    Invoice" receipt style can never produce different documents.
 */
import { getSale } from './sales';
import { getUser } from './auth';
import { formatLocalString } from '../utils/timezone';
import type { Sale, SaleItem, Payment } from '../../shared/types';
import { esc, getPrintSettings, makeMoney, buildInvoiceHtml, htmlDocument } from './printDocs';
import { PAPER_SPECS, getConfiguredPaper, type PaperKind } from './printService';

export type ReceiptTemplate = 'thermal' | 'standard' | 'a4';

export interface ReceiptTemplateInfo {
  id: ReceiptTemplate;
  name: string;
  description: string;
  /** Physical paper this style is designed for. */
  paper: PaperKind;
  /** Printable content width in mm. */
  contentMm: number;
}

export function getAvailableTemplates(): ReceiptTemplateInfo[] {
  return [
    {
      id: 'thermal',
      name: 'Thermal (58mm)',
      description: 'Compact thermal receipt for 58mm printers',
      paper: 'thermal58',
      contentMm: PAPER_SPECS.thermal58.contentMm,
    },
    {
      id: 'standard',
      name: 'Standard (80mm)',
      description: 'Standard receipt for 80mm thermal printers',
      paper: 'thermal80',
      contentMm: PAPER_SPECS.thermal80.contentMm,
    },
    {
      id: 'a4',
      name: 'A4 Invoice',
      description: 'Full-page A4 invoice with professional layout',
      paper: 'a4',
      contentMm: PAPER_SPECS.a4.contentMm,
    },
  ];
}

export function paperForTemplate(t: ReceiptTemplate): PaperKind {
  const found = getAvailableTemplates().find((x) => x.id === t);
  return found ? found.paper : 'thermal80';
}

/**
 * Clamp a template to the paper actually loaded in the printer.
 *
 * A receipt cannot be wider than the media. Asking for the 80mm template on a
 * 58mm roll is exactly the bug field clients reported: Chromium slices the
 * content into horizontal strips. The narrow template is substituted instead,
 * and the caller is told so it can surface a warning.
 */
export function fitTemplateToPaper(
  template: ReceiptTemplate,
  paper: PaperKind
): { template: ReceiptTemplate; adjusted: boolean } {
  if (paper === 'a4') {
    return template === 'a4' ? { template, adjusted: false } : { template: 'a4', adjusted: true };
  }
  // Roll media: the 58mm layout fits an 80mm roll too (just narrower), but the
  // 80mm layout does NOT fit a 58mm roll.
  if (paper === 'thermal58' && template === 'standard') {
    return { template: 'thermal', adjusted: true };
  }
  if (paper === 'thermal80' && template === 'a4') {
    return { template: 'standard', adjusted: true };
  }
  return { template, adjusted: false };
}

interface TemplateOpts {
  showTax: boolean;
  showDiscount: boolean;
  showPaymentMethod: boolean;
  showCashierName: boolean;
  headerText: string;
  footerText: string;
}

function resolveOpts(): TemplateOpts {
  const s = getPrintSettings();
  return {
    showTax: s.show_tax_on_receipt !== 'false',
    showDiscount: s.show_discount_breakdown !== 'false',
    showPaymentMethod: s.show_payment_method !== 'false',
    showCashierName: s.show_cashier_name !== 'false',
    headerText: s.receipt_header_text || '',
    footerText: s.receipt_footer_text || s.receipt_footer || '',
  };
}

export function buildReceiptHtml(saleId: number, template?: ReceiptTemplate): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const tmpl: ReceiptTemplate = template || ((s.receipt_template as ReceiptTemplate) || 'standard');
  const currency = s.currency || 'Rs';
  const fmt = makeMoney(currency);
  const cashier = getUser(sale.user_id ?? 0);
  const opts = resolveOpts();

  // The "a4" receipt template IS the canonical invoice — one builder, no copy.
  if (tmpl === 'a4') {
    return buildInvoiceHtml(saleId, getConfiguredPaper('invoice') === 'a5' ? 'a5' : 'a4');
  }
  return buildRoll(sale, s, fmt, cashier, opts, tmpl === 'thermal' ? 'thermal58' : 'thermal80');
}


function buildRoll(
  sale: Sale & { items: SaleItem[]; payments: Payment[] },
  s: Record<string, string>,
  fmt: (n: number) => string,
  cashier: { username?: string } | null,
  opts: TemplateOpts,
  paper: 'thermal58' | 'thermal80'
): string {
  const spec = PAPER_SPECS[paper];
  const narrow = paper === 'thermal58';
  const basePt = narrow ? 9 : 8.5;

  const rows = sale.items
    .map((it) => {
      const useUnit = !!it.unit_name && it.display_qty != null;
      const qtyLabel = useUnit ? `${it.display_qty} ${it.unit_name}` : String(it.qty);
      const priceLabel = useUnit && (it.display_qty ?? 0) > 0 ? fmt(it.line_total / (it.display_qty ?? 1)) : fmt(it.unit_price);
      const promo = it.promo_name ? `<div class="promo">Promo: ${esc(it.promo_name)}</div>` : '';
      // 58mm only has 52mm of printable width. Four columns cannot hold a
      // product name, a unit label like "1000 Gram" and two money columns
      // without the table growing past the page and the printer slicing the
      // right-hand side off, so narrow receipts stack each item on two lines.
      if (narrow) {
        return `<tr><td class="stack" colspan="4">
  <div class="s1"><span class="nm">${esc(it.product_name || `#${it.product_id}`)}${promo}</span><span class="tt">${fmt(
    it.line_total
  )}</span></div>
  <div class="s2"><span class="qt">${esc(qtyLabel)} &times; ${priceLabel}</span></div>
</td></tr>`;
      }
      return `<tr>
  <td class="name">${esc(it.product_name || `#${it.product_id}`)}${promo}</td>
  <td class="r qty">${esc(qtyLabel)}</td>
  <td class="r price">${priceLabel}</td>
  <td class="r total">${fmt(it.line_total)}</td>
</tr>`;
    })
    .join('');

  const paymentRows = sale.payments
    .map((p) => `<tr><td>${esc(p.mode)}</td><td class="r">${fmt(p.amount)}</td></tr>`)
    .join('');

  const css = `
@page { size: ${spec.widthMm}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  width: ${spec.contentMm}mm; padding: 1.2mm ${(spec.widthMm - spec.contentMm) / 2}mm;
  font-family: ${narrow ? "'Consolas', 'Courier New', monospace" : "'Segoe UI', Arial, sans-serif"};
  font-size: ${basePt}pt; color: #000; -webkit-print-color-adjust: exact;
}
h1 { font-size: ${narrow ? '12pt' : '13pt'}; text-align: center; margin: 0 0 0.8mm; }
.shop { text-align: center; font-size: ${(basePt - 1.2).toFixed(1)}pt; color: #333; line-height: 1.35; }
.hdr { text-align: center; font-size: ${(basePt - 1.5).toFixed(1)}pt; margin-bottom: 1mm; }
.logo { max-width: 100%; max-height: 12mm; display: block; margin: 0 auto 1mm; }
table { width: 100%; border-collapse: collapse; margin: 1.2mm 0; }
td { padding: 0.5mm 0; font-size: ${basePt}pt; vertical-align: top; line-height: 1.25; }
td.r { text-align: right; white-space: nowrap; }
td.name { padding-right: 1.5mm; word-break: break-word; }
td.qty { color: #333; padding: 0.5mm 1.5mm; }
td.total { font-weight: 700; }
/* Narrow (58mm) stacked item row: name + line total, then qty x unit price. */
td.stack { padding: 0.7mm 0; }
.s1 { display: flex; align-items: flex-start; gap: 1.5mm; }
.s1 .nm { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.s1 .tt { flex: 0 0 auto; white-space: nowrap; font-weight: 700; }
.s2 { color: #333; font-size: ${(basePt - 0.6).toFixed(1)}pt; word-break: break-word; }
.meta td { font-size: ${(basePt - 0.6).toFixed(1)}pt; }
.line { border-top: 0.3mm dashed #000; margin: 1.2mm 0; }
.totals td { font-weight: 600; }
.totals tr.grand td { font-size: ${basePt + 1.5}pt; font-weight: 700; }
.promo { font-size: ${(basePt - 1.5).toFixed(1)}pt; color: #16a34a; }
.foot { text-align: center; margin-top: 1.8mm; font-size: ${(basePt - 1.2).toFixed(1)}pt; line-height: 1.4; }
`;

  const body = `${opts.headerText ? `<div class="hdr">${esc(opts.headerText)}</div>` : ''}
${s.shop_logo ? `<img class="logo" src="${esc(s.shop_logo)}" alt="" />` : ''}
<h1>${esc(s.shop_name)}</h1>
<div class="shop">${esc(s.shop_address) || ''}${s.shop_phone ? `<br />${esc(s.shop_phone)}` : ''}</div>
<div class="line"></div>
<table class="meta">
  <tr><td>Invoice</td><td class="r">${esc(sale.invoice_no)}</td></tr>
  <tr><td>Date</td><td class="r">${sale.created_at ? formatLocalString(sale.created_at) : ''}</td></tr>
  ${sale.customer_name ? `<tr><td>Customer</td><td class="r">${esc(sale.customer_name)}</td></tr>` : ''}
  ${opts.showCashierName ? `<tr><td>Cashier</td><td class="r">${esc(cashier?.username ?? '—')}</td></tr>` : ''}
</table>
<div class="line"></div>
<table>${rows}</table>
<div class="line"></div>
<table class="totals">
  <tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
  ${opts.showDiscount && sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
  ${opts.showTax && sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
  ${sale.service_charge && sale.service_charge > 0 ? `<tr><td>Service charge</td><td class="r">${fmt(sale.service_charge)}</td></tr>` : ''}
  ${sale.freight && sale.freight > 0 ? `<tr><td>Freight</td><td class="r">${fmt(sale.freight)}</td></tr>` : ''}
  <tr class="grand"><td>TOTAL</td><td class="r">${fmt(sale.total_amount)}</td></tr>
  ${opts.showPaymentMethod ? paymentRows : ''}
</table>
<div class="line"></div>
<div class="foot">${esc(opts.footerText)}</div>`;

  return htmlDocument(`Receipt ${sale.invoice_no}`, css, body);
}

export { buildInvoiceHtml };
