/**
 * Shared print-document helpers.
 *
 * This is the single home for HTML escaping, merged print settings, money
 * formatting and barcode rasterisation. It also owns the CANONICAL A4 invoice
 * document, so "Preview Invoice" / "Print Invoice" and the "A4 Invoice" receipt
 * style can never drift apart again (they were two unrelated implementations).
 *
 * Geometry rule for every document produced here:
 *   - CSS lengths are in `mm` / `pt`, never `px`. `px` is DPI-dependent, which
 *     is why the same receipt came out tiny on one client's thermal printer and
 *     oversized on another. `mm` is physically fixed across all DPI settings.
 *   - The body is always NARROWER than the physical page. Thermal printers
 *     reserve ~2mm (58mm roll) / ~3mm (80mm roll) of unprintable hardware
 *     margin, so content sized to the full paper width gets sliced into strips.
 */
import { getSale } from './sales';
import { getUser } from './auth';
import { getAllSettings } from './settings';
import { getReceiptSettings } from './reports';
import { getAllAdminSettings } from './admin';
import { formatLocalString } from '../utils/timezone';
import bwipjs from 'bwip-js';

export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Merge order: shop settings -> legacy receipt settings -> admin panel settings.
 * Admin wins because that is the panel the user actually configures.
 */
export function getPrintSettings(): Record<string, string> {
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

export function printCurrency(): string {
  return getPrintSettings().currency || 'Rs';
}

export function makeMoney(currency: string): (n: number) => string {
  return (n: number) =>
    `${currency} ${Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
}

export function todayLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

export function fmtExpiryDate(expiry?: string | null): string {
  if (!expiry) return '';
  const parts = expiry.slice(0, 10).split('-');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return expiry;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Rasterise a barcode to an inline PNG data URL. Resolves '' on failure. */
export function toDataUrl(options: { bcid: string; text: string; [k: string]: unknown }): Promise<string> {
  return new Promise((resolve) => {
    try {
      bwipjs.toBuffer(options, (err: string | Error | null, buffer?: Buffer) => {
        if (err || !buffer) resolve('');
        else resolve('data:image/png;base64,' + buffer.toString('base64'));
      });
    } catch {
      resolve('');
    }
  });
}

/** EAN-13 needs 13 digits AND a valid modulo-10 check digit. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

/**
 * Pick a symbology that can actually encode the given text.
 *
 * The old label template hard-coded `ean13`, which throws for every SKU that
 * is not a checksum-valid 13-digit EAN — the barcode silently vanished and only
 * a text placeholder printed. CODE128 accepts any printable ASCII, so it is
 * the correct fallback.
 */
export function symbologyFor(text: string): 'ean13' | 'code128' {
  return isValidEan13(text) ? 'ean13' : 'code128';
}

// ═══════════════════════════════════════════════════════════════════
//  CANONICAL A4 INVOICE
// ═══════════════════════════════════════════════════════════════════

const A4_CONTENT_MM = 190; // 210mm paper - 2 x 10mm margin
const A4_PAD_MM = 10;

/**
 * Invoice page geometry. A5 is laid out natively (its own mm widths, smaller
 * type, no discount column) rather than by scaling a 210mm page down, which
 * Chromium would clip at the page edge.
 */
const INVOICE_GEOMETRY = {
  a4: { widthMm: 210, heightMm: 297, padMm: 10, compact: false },
  a5: { widthMm: 148, heightMm: 210, padMm: 7, compact: true },
} as const;

export type InvoicePaper = keyof typeof INVOICE_GEOMETRY;

/** Shared document shell. Page rule is re-stamped by printService for the real paper. */
export function htmlDocument(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function invoiceCss(paper: InvoicePaper): string {
  const g = INVOICE_GEOMETRY[paper];
  return `
@page { size: ${g.widthMm}mm ${g.heightMm}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  width: ${g.widthMm}mm; min-height: ${g.heightMm}mm; padding: ${g.padMm}mm;
  font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #0f172a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; border-bottom: 2.5pt solid #4f46e5; padding-bottom: 6mm; }
.doc-head .co img { max-height: 18mm; max-width: 55mm; display: block; margin-bottom: 2mm; }
.doc-head .co h1 { margin: 0; font-size: 17pt; color: #4f46e5; letter-spacing: -0.2pt; }
.doc-head .co p { margin: 1.2mm 0 0; font-size: 9pt; color: #64748b; line-height: 1.4; }
.doc-head .meta { text-align: right; white-space: nowrap; }
.doc-head .meta .title { font-size: 20pt; font-weight: 700; color: #4f46e5; letter-spacing: 1.5pt; margin: 0; }
.doc-head .meta .no { font-size: 12pt; font-weight: 700; margin: 2mm 0 0; }
.doc-head .meta .line { font-size: 9pt; color: #64748b; margin-top: 1mm; }
.parties { display: flex; gap: 8mm; margin: 6mm 0; }
.party { flex: 1; border: 0.6pt solid #e2e8f0; border-radius: 1.5mm; padding: 3.5mm 4mm; }
.party h3 { margin: 0 0 2mm; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #4f46e5; }
.party .row { display: flex; justify-content: space-between; font-size: 9pt; padding: 0.7mm 0; }
.party .row span:first-child { color: #64748b; }
.party .big { font-size: 10.5pt; font-weight: 700; }
table.items { width: 100%; border-collapse: collapse; }
/* Repeat the column headings on every page and never split a line item across
   a page break - a tall wrapped product name used to break mid-row. */
table.items thead { display: table-header-group; }
table.items tr { page-break-inside: avoid; break-inside: avoid; }
table.items thead th {
  text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4pt;
  color: #475569; background: #f1f5f9; border-bottom: 1pt solid #cbd5e1;
  padding: 2.4mm 2mm; white-space: nowrap;
}
table.items td { padding: 2.2mm 2mm; border-bottom: 0.5pt solid #e2e8f0; vertical-align: top; }
table.items tr.promo td { border-bottom: 0.5pt solid #e2e8f0; padding-top: 0; font-size: 8pt; color: #16a34a; }
td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
td.name { font-weight: 600; }
.summary-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10mm; margin-top: 6mm; }
.terms { flex: 1; font-size: 8.5pt; color: #475569; line-height: 1.5; }
.totals { width: 85mm; border-collapse: collapse; }
.totals td { padding: 1.8mm 2mm; font-size: 9.5pt; }
.totals td.r { text-align: right; font-variant-numeric: tabular-nums; }
.totals tr.grand td { border-top: 1.5pt solid #4f46e5; font-size: 12.5pt; font-weight: 700; color: #4f46e5; padding-top: 2.5mm; }
.totals tr.pay td { font-size: 8.5pt; color: #475569; }
.signs { display: flex; justify-content: space-between; gap: 20mm; margin-top: 16mm; }
.signs div { flex: 1; border-top: 0.6pt solid #94a3b8; padding-top: 2mm; font-size: 8.5pt; color: #475569; text-align: center; }
.doc-foot { margin-top: 8mm; border-top: 0.5pt solid #e2e8f0; padding-top: 3mm; text-align: center; font-size: 8pt; color: #64748b; }
${g.compact ? `
/* A5: everything sized for a 148mm page instead of a clipped 210mm one. */
body { font-size: 7.6pt; }
.doc-head { gap: 6mm; padding-bottom: 3mm; }
.doc-head .co img { max-height: 12mm; max-width: 34mm; }
.doc-head .co h1 { font-size: 12pt; }
.doc-head .co p { font-size: 7pt; }
.doc-head .meta .title { font-size: 14pt; }
.doc-head .meta .no { font-size: 9pt; }
.doc-head .meta .line { font-size: 7pt; }
.parties { gap: 4mm; margin: 3.5mm 0; }
.party { padding: 2mm 2.5mm; }
.party .row { font-size: 7.4pt; padding: 0.4mm 0; }
.party .big { font-size: 8.5pt; }
table.items thead th { font-size: 6.6pt; padding: 1.4mm 1mm; letter-spacing: 0.2pt; }
table.items td { padding: 1.4mm 1mm; font-size: 7.4pt; }
th.col-disc, td.col-disc { display: none; }
.summary-row { gap: 4mm; margin-top: 3.5mm; }
.terms { font-size: 6.8pt; line-height: 1.4; }
.totals { width: 62mm; }
.totals td { padding: 1.1mm 1.2mm; font-size: 7.6pt; }
.totals tr.grand td { font-size: 10pt; padding-top: 1.6mm; }
.totals tr.pay { font-size: 6.8pt; }
.signs { gap: 8mm; margin-top: 9mm; }
.signs div { font-size: 6.8pt; padding-top: 1.5mm; }
.doc-foot { margin-top: 5mm; font-size: 6.8pt; }
` : ''}
`;
}

export function buildInvoiceHtml(saleId: number, paper: InvoicePaper = 'a4'): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const currency = s.currency || 'Rs';
  const fmt = makeMoney(currency);
  const cashier = getUser(sale.user_id ?? 0);
  const showCashier = s.show_cashier_name !== 'false';

  const rows = sale.items
    .map((it, i) => {
      const unitName = it.unit_name;
      const useUnit = !!unitName && it.display_qty != null;
      const qtyLabel = useUnit ? `${it.display_qty} ${esc(unitName)}` : String(it.qty);
      const priceLabel = useUnit && (it.display_qty ?? 0) > 0 ? fmt(it.line_total / (it.display_qty ?? 1)) : fmt(it.unit_price);
      return `<tr>
  <td class="r">${i + 1}</td>
  <td class="name">${esc(it.product_name || `#${it.product_id}`)}</td>
  <td class="r">${esc(qtyLabel)}</td>
  <td class="r">${priceLabel}</td>
  <td class="r col-disc">${it.discount ? fmt(it.discount) : ''}</td>
  <td class="r">${it.tax_rate ? `${it.tax_rate}%` : ''}</td>
  <td class="r">${fmt(it.line_total)}</td>
</tr>${
        it.promo_name
          ? `<tr class="promo"><td></td><td colspan="6">Promotion applied: ${esc(it.promo_name)}</td></tr>`
          : ''
      }`;
    })
    .join('');

  const paymentRows = sale.payments
    .map(
      (p) =>
        `<tr class="pay"><td>Paid by ${esc(p.mode)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${fmt(p.amount)}</td></tr>`
    )
    .join('');

  // NOTE: this is the ONE canonical A4 document. "Preview Invoice", "Print
  // Invoice" and the "A4 Invoice" receipt style all render this exact markup.
  // It is synchronous (smsService.ts embeds it in an email body) so it contains
  // no rasterised barcode — a barcode on a full-page invoice adds nothing and
  // an earlier version of this file printed the printer's own name on the page.
  const footer = s.receipt_footer_text || s.receipt_footer || '';

  const body = `<div class="doc-head">
  <div class="co">
    ${s.shop_logo ? `<img src="${esc(s.shop_logo)}" alt="" />` : ''}
    <h1>${esc(s.shop_name)}</h1>
    <p>${esc(s.shop_address) || ''}${s.shop_phone ? `<br />${esc(s.shop_phone)}` : ''}</p>
  </div>
  <div class="meta">
    <p class="title">INVOICE</p>
    <p class="no">${esc(sale.invoice_no)}</p>
    <p class="line">${sale.created_at ? formatLocalString(sale.created_at) : ''}</p>
    ${showCashier ? `<p class="line">Cashier: ${esc(cashier?.username ?? '—')}</p>` : ''}
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Bill To</h3>
    <div class="big">${esc(sale.customer_name || 'Walk-in Customer')}</div>
    ${sale.customer_phone ? `<div class="row"><span>Phone</span><span>${esc(sale.customer_phone)}</span></div>` : ''}
    <div class="row"><span>Payment</span><span>${esc(sale.payments.map((p) => p.mode).join(', ') || '—')}</span></div>
    <div class="row"><span>Status</span><span>${esc(sale.status || 'completed')}</span></div>
  </div>
  <div class="party">
    <h3>Summary</h3>
    <div class="row"><span>Line items</span><span>${sale.items.length}</span></div>
    <div class="row"><span>Invoice date</span><span>${sale.created_at ? formatLocalString(sale.created_at) : ''}</span></div>
    <div class="row"><span>Invoice no.</span><span>${esc(sale.invoice_no)}</span></div>
  </div>
</div>

<table class="items">
  <thead>
    <tr>
      <th class="r" style="width:8mm">#</th>
      <th>Item</th>
      <th class="r" style="width:22mm">Qty</th>
      <th class="r" style="width:26mm">Rate</th>
      <th class="r col-disc" style="width:22mm">Disc.</th>
      <th class="r" style="width:16mm">Tax</th>
      <th class="r" style="width:30mm">Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="summary-row">
  <div class="terms">
    <b>Terms &amp; conditions</b><br />
    Goods once sold are not returnable or exchangeable. Please check your items before leaving the counter.
    Claims must be made within 7 days with this invoice. Thank you for your business.
  </div>
  <table class="totals">
    <tr><td>Subtotal</td><td class="r">${fmt(sale.subtotal)}</td></tr>
    ${sale.discount_amount > 0 ? `<tr><td>Discount</td><td class="r">-${fmt(sale.discount_amount)}</td></tr>` : ''}
    ${sale.tax_amount > 0 ? `<tr><td>Tax</td><td class="r">${fmt(sale.tax_amount)}</td></tr>` : ''}
    ${sale.service_charge && sale.service_charge > 0 ? `<tr><td>Service charge</td><td class="r">${fmt(sale.service_charge)}</td></tr>` : ''}
    ${sale.freight && sale.freight > 0 ? `<tr><td>Freight / delivery</td><td class="r">${fmt(sale.freight)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">${fmt(sale.total_amount)}</td></tr>
    ${paymentRows}
  </table>
</div>

<div class="signs">
  <div>Customer signature</div>
  <div>Cashier signature</div>
</div>

<div class="doc-foot">${esc(footer)}</div>`;

  return htmlDocument(`Invoice ${sale.invoice_no}`, invoiceCss(paper), body);
}

// ═══════════════════════════════════════════════════════════════════
//  CALIBRATION SHEET
// ═══════════════════════════════════════════════════════════════════

/**
 * A self-diagnosing test page. Field clients did not know whether their roll was
 * 58mm or 80mm, so this sheet is deliberately sized to the FULL nominal paper
 * width: if the right-hand edge is missing from the output, the roll is
 * narrower than selected, and the printed message says so.
 */
export function buildCalibrationHtml(paperWidthMm: number, printerLabel: string): string {
  const ticks: string[] = [];
  for (let mm = 0; mm <= paperWidthMm; mm += 1) {
    const major = mm % 10 === 0;
    ticks.push(
      `<div class="tick${major ? ' major' : ''}" style="left:${mm}mm"><span>${major ? mm : ''}</span></div>`
    );
  }

  const css = `
@page { size: ${paperWidthMm}mm ${Math.max(120, paperWidthMm * 2.2)}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${paperWidthMm}mm; padding: 2mm; font-family: 'Segoe UI', Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; }
h1 { font-size: 8pt; margin: 0 0 1.5mm; }
.bar { background: #000; height: 8mm; width: 100%; margin: 1.5mm 0 3mm; }
.ruler { position: relative; height: 12mm; border-bottom: 0.4mm solid #000; margin-bottom: 4mm; }
.ruler .tick { position: absolute; bottom: 0; width: 0; border-left: 0.2mm solid #666; height: 2mm; }
.ruler .tick.major { border-left: 0.4mm solid #000; height: 5mm; }
.ruler .tick span { position: absolute; top: 5mm; left: 0; font-size: 5pt; transform: translateX(-1mm); }
.sizes div { margin-bottom: 1.5mm; }
.note { border: 0.4mm solid #000; padding: 2mm; font-size: 6.5pt; line-height: 1.5; margin-top: 3mm; }
.printer { font-size: 6pt; color: #444; margin-top: 2mm; word-break: break-all; }
`;

  const body = `<h1>PRINT CALIBRATION &mdash; ${paperWidthMm}mm page</h1>
<div class="bar"></div>
<div class="ruler">${ticks.join('')}</div>
<div class="sizes">
  <div style="font-size:6pt">6pt — smallest usable text</div>
  <div style="font-size:8pt">8pt — receipt body size</div>
  <div style="font-size:10pt">10pt — receipt heading</div>
  <div style="font-size:14pt;font-weight:700">14pt — total amount</div>
</div>
<div class="note">
  <b>How to read this sheet</b><br />
  1. The numbers along the ruler mark millimetres from the left edge.<br />
  2. If the ruler's right-hand numbers are <b>cut off</b>, your roll is
     <b>${paperWidthMm === 80 ? '58' : paperWidthMm === 58 ? '80' : 'a different size than'}</b>mm, not ${paperWidthMm}mm.<br />
     Change <b>Receipt Paper</b> in Settings &rarr; Printer to match the roll you actually loaded.<br />
  3. The black bar checks print density: patchy or striped means a dirty or worn print head.<br />
  4. If nothing printed at all, the printer name in Settings is wrong or the printer is offline.
</div>
<div class="printer">Printed on: ${esc(printerLabel)} &middot; ${todayLabel()}</div>`;

  return htmlDocument('Print calibration', css, body);
}
