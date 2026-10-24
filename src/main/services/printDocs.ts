/**
 * Shared print-document helpers.
 *
 * This is the single home for HTML escaping, merged print settings, money
 * formatting and barcode rasterisation. It also owns the CANONICAL A4 invoice
 * document, so "Preview Invoice" / "Print Invoice" and the "A4 Invoice" receipt
 * style can never drift apart again (they were two unrelated implementations).
 *
 * Geometry rule for every document produced here:
 *   - Page/paper/box CSS lengths are in `mm` / `pt`, never `px`. `px` is
 *     DPI-dependent, which is why the same receipt came out tiny on one client's
 *     thermal printer and oversized on another. `mm` is physically fixed across
 *     all DPI settings.
 *   - The one exception is FONT SIZES in the thermal receipt template
 *     (receiptTemplates.ts): the design spec fixes them in `px` and the render
 *     pipeline is a fixed 96dpi CSS space, so they are as deterministic as pt.
 *   - The body is exactly the PRINTABLE width (`spec.contentMm`) and is centred
 *     on the roll with `margin:0 auto`. That is 48mm on a 58mm roll (the print
 *     head of an Epson-class 57.5mm printer) and 72mm on an 80mm roll. Sizing
 *     the body any wider than the head makes the printer slice the right-hand
 *     columns off.
 */
import { getSale } from './sales';
import { getUser } from './auth';
import { getAllSettings } from './settings';
import { getReceiptSettings } from './reports';
import { getAllAdminSettings } from './admin';
import { formatLocalString } from '../utils/timezone';
import bwipjs from 'bwip-js';
import {
  renderDocument,
  type SaleData,
  type ShopProfile,
  type DocumentDesign,
  defaultDocumentDesign,
  DEFAULT_META_LABELS,
  DEFAULT_TABLE_COLUMN_LABELS,
  type DocumentPaper,
} from '../../shared/receiptDesign';
import type { SaleItem, Payment } from '../../shared/types';

type SaleWithItems = Awaited<ReturnType<typeof getSale>>;

export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
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
    // Thermal receipt redesign (migration 050): editable header lines, terms,
    // "software by" tradename and the items-table "#" column.
    if (admin.receipt_header_lines !== undefined) base.receipt_header_lines = admin.receipt_header_lines;
    if (admin.receipt_terms_text !== undefined) base.receipt_terms_text = admin.receipt_terms_text;
    if (admin.receipt_software_by !== undefined) base.receipt_software_by = admin.receipt_software_by;
    if (admin.receipt_show_serial_number !== undefined) base.receipt_show_serial_number = admin.receipt_show_serial_number;
    // Receipt layout phase 1 (migration 054): logo sizing/grayscale, removable
    // software credit and the "Items: N, Qty: N" summary line.
    if (admin.receipt_logo_max_height_px !== undefined) base.receipt_logo_max_height_px = admin.receipt_logo_max_height_px;
    if (admin.receipt_logo_grayscale !== undefined) base.receipt_logo_grayscale = admin.receipt_logo_grayscale;
    if (admin.receipt_show_software_credit !== undefined) base.receipt_show_software_credit = admin.receipt_show_software_credit;
    if (admin.receipt_show_items_summary !== undefined) base.receipt_show_items_summary = admin.receipt_show_items_summary;
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

/** Convert print settings to ShopProfile for the new renderer. */
function toShopProfile(s: Record<string, string>): ShopProfile {
  return {
    name: s.shop_name || '',
    address: s.shop_address || '',
    phone: s.shop_phone || '',
    whatsapp: s.shop_whatsapp || '',
    taxNo: s.tax_no || '',
    ntn: s.shop_ntn || '',
    strn: s.shop_strn || '',
    logo: s.shop_logo || '',
    logoGrayscale: s.receipt_logo_grayscale !== 'false',
    logoMaxHeightPx: Number(s.receipt_logo_max_height_px || 64),
    receiptHeaderLines: s.receipt_header_lines || '',
    receiptTermsText: s.receipt_terms_text || '',
    receiptSoftwareBy: s.receipt_software_by || '',
    receiptShowSoftwareCredit: s.receipt_show_software_credit !== 'false',
    receiptShowItemsSummary: s.receipt_show_items_summary !== 'false',
    receiptShowPaymentMethod: s.show_payment_method !== 'false',
    showTaxOnReceipt: s.show_tax_on_receipt !== 'false',
    currency: s.currency || 'Rs',
    loyaltyEnabled: s.loyalty_enabled === 'true',
    pointsPerRupee: Number(s.points_per_rupee || 0),
    fbrInvoiceUrl: s.fbr_invoice_url || '',
  };
}

/** Convert DB sale to SaleData for the new renderer. */
function toSaleData(sale: SaleWithItems | null): SaleData {
  if (!sale) {
    return {
      invoice_no: '',
      created_at: new Date().toISOString(),
      customer_name: 'Walk-in Customer',
      customer_phone: undefined,
      cashier: '',
      status: 'completed',
      items: [],
      subtotal: 0,
      discount_amount: 0,
      tax_amount: 0,
      service_charge: 0,
      freight: 0,
      total_amount: 0,
      paid: 0,
      payments: [],
      returned_amount: 0,
      branch: '',
    };
  }
  const items = (sale.items || []).map((it) => ({
    product_name: it.product_name || `#${it.product_id || ''}`,
    unit_name: it.unit_name || undefined,
    qty: Number(it.qty || 0),
    display_qty: it.display_qty ?? undefined,
    unit_price: Number(it.unit_price || 0),
    discount: Number(it.discount || 0),
    tax_rate: it.tax_rate ?? undefined,
    line_total: Number(it.line_total || 0),
    promo_name: it.promo_name || undefined,
  }));

  const payments = (sale.payments || []).map((p) => ({
    mode: String(p.mode || '').toUpperCase(),
    amount: Number(p.amount || 0),
    reference: p.reference ?? undefined,
  }));

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    invoice_no: sale.invoice_no || '',
    created_at: sale.created_at || new Date().toISOString(),
    customer_name: sale.customer_name || 'Walk-in Customer',
    customer_phone: sale.customer_phone || undefined,
    cashier: '', // Will be filled by caller
    status: sale.status || 'completed',
    items,
    subtotal: Number(sale.subtotal || 0),
    discount_amount: Number(sale.discount_amount || 0),
    tax_amount: Number(sale.tax_amount || 0),
    service_charge: Number(sale.service_charge || 0),
    freight: Number(sale.freight || 0),
    total_amount: Number(sale.total_amount || 0),
    paid,
    payments,
    returned_amount: Number(sale.returned_amount || 0),
    branch: '',
  };
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
//  CANONICAL A4 INVOICE (now uses shared renderer)
// ═══════════════════════════════════════════════════════════════════

export function buildInvoiceHtml(saleId: number, paper: 'a4' | 'a5' = 'a4'): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const cashier = getUser(sale.user_id ?? 0);

  // Convert to new renderer types
  const saleData = toSaleData(sale);
  saleData.cashier = cashier?.username ?? '';

  const shop = toShopProfile(getPrintSettings());

  // Use default invoice design
  const design = defaultDocumentDesign('invoice', paper === 'a5' ? 'a5' : 'a4');

  // Render using the new shared renderer
  return renderDocument('invoice', saleData, design, shop, { paper: paper as DocumentPaper });
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