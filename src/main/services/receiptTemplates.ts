/**
 * Receipt documents (thermal roll layouts).
 *
 * Geometry contract — see printService.ts for the full rationale:
 *  - The body is EXACTLY the printable width (`contentMm`: 48mm on a 58mm roll,
 *    72mm on an 80mm roll) and is centred on the roll with `margin:0 auto`, so
 *    the receipt uses the full head width without crossing into the printer's
 *    unprintable hardware margin. Sizing the body to the full PAPER width is
 *    what made clients' receipts arrive sliced into strips.
 *  - 4mm of side padding inside that body (box-sizing: border-box) guarantees
 *    content never reaches the printable edge — nothing gets sliced on the
 *    right like the competitor layout.
 *  - All page/paper/LENGTH geometry is mm/pt, never px, so output is identical
 *    across printer DPI. Font sizes are expressed in px per the design spec
 *    (the render pipeline is a fixed 96dpi CSS space, so px font sizes are as
 *    deterministic as pt here).
 *  - The A4 receipt style is not implemented here — it delegates to the single
 *    canonical A4 invoice so "Preview Invoice", "Print Invoice" and the "A4
 *    Invoice" receipt style can never produce different documents.
 */
import { getSale } from './sales';
import { getUser } from './auth';
import { formatReceiptDateTime } from '../utils/timezone';
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
  /** Also drives the DISC column visibility (Settings → Billing). */
  showDiscount: boolean;
  showPaymentMethod: boolean;
  showCashierName: boolean;
  showSerial: boolean;
  headerLines: string[];
  termsText: string;
  footerMessage: string;
  softwareBy: string;
  /** Logo max height in px (thermal logos were pinned at ~45px before). */
  logoMaxHeightPx: number;
  /** Greyscale + high contrast so the logo survives a 1-bit thermal head. */
  logoGrayscale: boolean;
  /** Show the "---- SOFTWARE BY ----" block at all. */
  showSoftwareCredit: boolean;
  /** Show the "Items: N, Qty: N" line under the items table. */
  showItemsSummary: boolean;
  /**
   * Stamp "DUPLICATE COPY" at the top. Set only for a REPRINT of an
   * already-issued sale (Phase 4); the immediate post-sale print leaves it off
   * so the original receipt is never mislabelled.
   */
  duplicate: boolean;
}

/** `receipt_header_lines` is a JSON array (one header line per row). */
function parseHeaderLines(raw: string): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
  } catch {
    /* fall through to newline-separated parsing */
  }
  return String(raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function resolveOpts(): TemplateOpts {
  const s = getPrintSettings();
  const legacyFooter = s.receipt_footer || '';
  return {
    showTax: s.show_tax_on_receipt !== 'false',
    showDiscount: s.show_discount_breakdown !== 'false',
    showPaymentMethod: s.show_payment_method !== 'false',
    showCashierName: s.show_cashier_name !== 'false',
    showSerial: s.receipt_show_serial_number !== 'false',
    headerLines: parseHeaderLines(s.receipt_header_lines || ''),
    termsText: s.receipt_terms_text || (legacyFooter && !s.receipt_footer_text ? legacyFooter : ''),
    footerMessage: s.receipt_footer_text || 'Come again soon!',
    softwareBy: s.receipt_software_by || 'Rokar POS',
    logoMaxHeightPx: Math.max(16, Number(s.receipt_logo_max_height_px) || 64),
    logoGrayscale: s.receipt_logo_grayscale !== 'false',
    showSoftwareCredit: s.receipt_show_software_credit !== 'false',
    showItemsSummary: s.receipt_show_items_summary !== 'false',
    duplicate: false,
  };
}

export function buildReceiptHtml(
  saleId: number,
  template?: ReceiptTemplate,
  extra?: { duplicate?: boolean }
): string {
  const sale = getSale(saleId);
  if (!sale) throw new Error('Sale not found');
  const s = getPrintSettings();
  const tmpl: ReceiptTemplate = template || ((s.receipt_template as ReceiptTemplate) || 'standard');
  const currency = s.currency || 'Rs';
  const fmt = makeMoney(currency);
  const cashier = getUser(sale.user_id ?? 0);
  const opts = resolveOpts();
  // Reprint stamp — see TemplateOpts.duplicate. Default off ⇒ byte-identical.
  opts.duplicate = extra?.duplicate === true;

  // The "a4" receipt template IS the canonical invoice — one builder, no copy.
  if (tmpl === 'a4') {
    return buildInvoiceHtml(saleId, getConfiguredPaper('invoice') === 'a5' ? 'a5' : 'a4');
  }
  return buildRoll(sale, s, fmt, cashier, opts, tmpl === 'thermal' ? 'thermal58' : 'thermal80');
}

/**
 * Invoice number that must fit on ONE line. The full `INV-YYYYMMDD-NNNN` is
 * kept when it fits; beyond that it degrades to the short `INV-MMDD-NNNN`
 * form rather than ever wrapping mid-token.
 */
function invoiceLabel(no: string): { text: string; short: boolean } {
  const m = no.match(/^([A-Za-z]+)-(\d{8})-(\d+)$/);
  if (m && m[2].length === 8 && m[3]) {
    const short = `${m[1]}-${m[2].slice(4)}-${m[3]}`;
    if (short.length < no.length) return { text: short, short: true };
  }
  if (no.length > 14) {
    return { text: `INV-${no.replace(/[^0-9]/g, '').slice(-8)}`, short: true };
  }
  return { text: no, short: false };
}

/** Column widths (% of the printable content box) per paper + visibility. */
function columnSet(
  narrow: boolean,
  showSerial: boolean,
  showDisc: boolean
): Array<{ key: string; width: string }> {
  const order = narrow ? ['no', 'name', 'qty', 'rate', 'amt'] : ['no', 'name', 'qty', 'rate', 'disc', 'amt'];
  const widths: Record<string, string> = narrow
    ? showSerial
      ? { no: '7%', name: '40%', qty: '14%', rate: '17%', amt: '22%' }
      : { name: '47%', qty: '14%', rate: '17%', amt: '22%' }
    : showSerial && showDisc
      ? { no: '6%', name: '36%', qty: '12%', rate: '18%', disc: '10%', amt: '18%' }
      : showSerial && !showDisc
        ? { no: '6%', name: '42%', qty: '13%', rate: '18%', amt: '21%' }
        : !showSerial && showDisc
          ? { name: '42%', qty: '12%', rate: '18%', disc: '10%', amt: '18%' }
          : { name: '45%', qty: '13%', rate: '18%', amt: '24%' };
  return order.filter((k) => widths[k] !== undefined).map((k) => ({ key: k, width: widths[k] }));
}

/**
 * Thermal roll receipt.
 *
 * Layout (top → bottom):
 *   1. Centred header: shop name 22px/800, then address / phone / WhatsApp
 *      each on its own 14px line, then optional custom header lines.
 *   2. Meta: compact 2-column block — CUSTOMER / CASHIER / DATE on the left,
 *      the invoice number (single line, nowrap) on the right.
 *   3. Items table (`table-layout: fixed`, explicit <colgroup> widths):
 *      # | PARTICULARS | QTY | RATE | DISC | AMOUNT. Decimal quantities and a
 *      unit label under the name (when it isn't "Piece") are supported.
 *   4. Totals: the payments block (CASH / RETURN / CHANGE / UDHAAR-BALANCE),
 *      then the SUB TOTAL / DISCOUNT / NET TOTAL block — full-width rows with
 *      right-aligned values on both rolls. Side-by-side columns measured past
 *      the printable width on 80mm, so they stack; NET TOTAL is one line,
 *      nowrap, 17px/900 with a solid top border.
 *   5. Footer: terms text, the footer message ("Come again soon!"), then
 *      "---- SOFTWARE BY ----" / tradename.
 *
 * Geometry: the body is exactly the PRINTABLE width (`spec.contentMm`) with
 * 4mm side padding, centred on the paper. No rotation anywhere.
 *
 * 58mm note: same structure, fonts −2px, no DISC column (merged into totals),
 * and the two totals blocks stack because 48mm cannot hold them side by side.
 */
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

  // `receipt_font_size` (Settings -> Billing) tunes every size at runtime.
  const delta = s.receipt_font_size === 'small' ? -2 : s.receipt_font_size === 'large' ? 2 : 0;
  const fz = (base: number) => Math.max(6, base + delta);
  // 58mm spec: the whole scale drops by 2px.
  const sz = (base: number) => (narrow ? Math.max(6, base - 2 + delta) : fz(base));

  const shopPt = sz(22);
  const addrPt = sz(14);
  const bodyPt = sz(13);
  const headPt = sz(12);
  const netPt = sz(17);
  const unitPt = sz(10);
  const footPt = sz(11);

  /** Money without the currency prefix — the table cannot afford "Rs " five
   *  times over. The currency is printed in the totals block. */
  const plain = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Long money auto-shrinks a step so a big number stays on one line. */
  const numCls = (t: string) => (t.length > 7 ? ' lg' : '');

  const paid = sale.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const change = Math.max(0, paid - sale.total_amount);
  const balance = Math.max(0, sale.total_amount - paid);

  // The DISC column is shown only when at least one line actually carries a
  // discount (the owner asked for it to disappear on an all-full-price bill),
  // AND the "show discount breakdown" setting is on.
  const anyLineDiscount = sale.items.some((it) => Number(it.discount || 0) > 0);
  const showDiscCol = opts.showDiscount && anyLineDiscount;

  const cols = columnSet(narrow, opts.showSerial, showDiscCol);
  const hasNo = cols.some((c) => c.key === 'no');
  const colTags = cols.map((c) => `<col class="c-${c.key}" style="width:${c.width}">`).join('');
  const HEAD: Record<string, string> = {
    no: '#',
    name: narrow ? 'ITEM' : 'PARTICULARS',
    qty: 'QTY',
    rate: 'RATE',
    disc: 'DISC',
    amt: 'AMOUNT',
  };
  const headCells = cols.map((c) => `<th class="${c.key === 'no' || c.key !== 'name' ? 'r' : ''}">${HEAD[c.key]}</th>`).join('');

  // Each item prints as TWO rows so a long name can use the full width without
  // ever colliding with the money columns:
  //   row 1  # | <name + optional unit, colspan across the value columns>
  //   row 2    | <qty, rate, (disc), amount aligned under their own headers>
  const rows = sale.items
    .map((it, i) => {
      const useUnit = !!it.unit_name && it.display_qty != null;
      const qtyLabel = useUnit ? String(it.display_qty) : String(it.qty);
      const unitPrice =
        useUnit && (it.display_qty ?? 0) > 0 ? it.line_total / (it.display_qty ?? 1) : it.unit_price;
      const name = esc(it.product_name || `#${it.product_id}`);
      const promo = it.promo_name ? `<div class="promo">Promo: ${esc(it.promo_name)}</div>` : '';
      const unitBlock =
        useUnit && it.unit_name && it.unit_name.trim().toLowerCase() !== 'piece'
          ? `<div class="unit">${esc(it.unit_name)}</div>`
          : '';
      const rate = plain(unitPrice);
      const disc = it.discount ? plain(it.discount) : '';
      const amt = plain(it.line_total);
      const nameCell = `<td class="name" colspan="${cols.length - (hasNo ? 1 : 0)}">${name}${promo}${unitBlock}</td>`;
      const valCells = cols
        .map((c) => {
          if (c.key === 'qty') return `<td class="r qty">${esc(qtyLabel)}</td>`;
          if (c.key === 'rate') return `<td class="r rate${numCls(rate)}">${rate}</td>`;
          if (c.key === 'disc') return `<td class="r disc${numCls(disc)}">${disc}</td>`;
          if (c.key === 'amt') return `<td class="r amt${numCls(amt)}">${amt}</td>`;
          return `<td class="void"></td>`;
        })
        .join('');
      const noCell = hasNo ? `<td class="r no">${i + 1}</td>` : '';
      return `<tr class="item-row">${noCell}${nameCell}</tr><tr class="item-vals">${valCells}</tr>`;
    })
    .join('');

  const itemCount = sale.items.length;
  // Sum the DISPLAYED quantity (grams/ml for loose items), so the summary agrees
  // with the QTY column instead of reporting "1" for a 1000 g line.
  const totalQty = sale.items.reduce((sum, it) => {
    const useUnit = !!it.unit_name && it.display_qty != null;
    return sum + Number((useUnit ? it.display_qty : it.qty) || 0);
  }, 0);
  const qtyText = Number.isInteger(totalQty)
    ? String(totalQty)
    : totalQty.toLocaleString(undefined, { maximumFractionDigits: 3 });

  // Meta: left column = CUSTOMER / CASHIER; right column = invoice number with
  // the Date + Time on ONE line beneath it (the old layout let "9:14 PM" wrap).
  const metaLeft = [
    `<div class="mrow"><span class="mlbl">CUSTOMER</span> ${esc(sale.customer_name || 'Walk-in')}</div>`,
    opts.showCashierName
      ? `<div class="mrow"><span class="mlbl">CASHIER</span> ${esc(cashier?.username ?? '—')}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const inv = invoiceLabel(sale.invoice_no);
  const metaRight = `<div class="inv-no${inv.short ? ' short' : ''}">${esc(inv.text)}</div>
    <div class="mrow meta-dt">${sale.created_at ? esc(formatReceiptDateTime(sale.created_at)) : ''}</div>`;

  const paymentRows = opts.showPaymentMethod
    ? sale.payments
        .map((p) => `<tr><td class="pm">${esc(p.mode.toUpperCase())}</td><td class="r">${plain(p.amount)}</td></tr>`)
        .join('')
    : '';
  const returnRow =
    sale.returned_amount && sale.returned_amount > 0
      ? `<tr><td class="pm">RETURN</td><td class="r">${plain(sale.returned_amount)}</td></tr>`
      : '';
  const changeRow =
    change > 0 ? `<tr><td class="pm">CHANGE</td><td class="r">${plain(change)}</td></tr>` : '';
  const balanceRow =
    balance > 0
      ? `<tr><td class="pm">UDHAAR/BALANCE</td><td class="r">${plain(balance)}</td></tr>`
      : '';
  // Aggregate "PAID" (all tenders) sits above the per-method breakdown.
  const paidRow = paid > 0 ? `<tr><td class="pm">PAID</td><td class="r">${plain(paid)}</td></tr>` : '';

  const netText = fmt(sale.total_amount);
  const net = `<tr class="net"><td>NET TOTAL</td><td class="r${numCls(netText)}">${netText}</td></tr>`;
  const totalsBody = `<tr><td>SUB TOTAL</td><td class="r">${plain(sale.subtotal)}</td></tr>
    ${opts.showDiscount && sale.discount_amount > 0 ? `<tr><td>DISCOUNT</td><td class="r">-${plain(sale.discount_amount)}</td></tr>` : ''}
    ${opts.showTax && sale.tax_amount > 0 ? `<tr><td>TAX</td><td class="r">${plain(sale.tax_amount)}</td></tr>` : ''}
    ${sale.service_charge && sale.service_charge > 0 ? `<tr><td>SERVICE CHARGE</td><td class="r">${plain(sale.service_charge)}</td></tr>` : ''}
    ${sale.freight && sale.freight > 0 ? `<tr><td>FREIGHT</td><td class="r">${plain(sale.freight)}</td></tr>` : ''}
    ${net}`;

  // Order matches the spec: Net Total (largest) first, then PAID, then
  // Change/Balance, then the per-tender breakdown (Cash/Card/Credit).
  const payRows = `${paidRow}${changeRow}${balanceRow}${returnRow}${paymentRows}`;
  const payBlock = payRows ? `<table class="pay">${payRows}</table>` : '';
  const totalsBlock = `<table class="totals">${totalsBody}</table>`;
  // Totals first (Sub Total … Net Total), then the payments block — full-width
  // rows with right-aligned values on BOTH rolls. Side-by-side columns were
  // measured to overflow the printable width (the 80mm layout audit once found
  // the totals table sticking +11..+18px past the right edge when a wide payment
  // mode met a long NET TOTAL), so they stack; this is exactly what keeps every
  // row on ONE line — the requirement this template was rebuilt around.
  const totwrap = `<div class="totwrap">${totalsBlock}${payBlock}</div>`;

  const shopLines = [
    s.shop_address,
    s.shop_phone,
    s.shop_whatsapp ? `WhatsApp: ${s.shop_whatsapp}` : '',
  ]
    .filter((x) => x && String(x).trim())
    .map((x) => esc(String(x)))
    .join('<br />');

  const headerLinesHtml = opts.headerLines.map((l) => `<div class="hdr-line">${esc(l)}</div>`).join('');
  const termsHtml = opts.termsText
    ? `<div class="terms">${esc(opts.termsText).replace(/\n/g, '<br />')}</div>`
    : '';

  // Urdu-capable fallbacks are appended so an Urdu shop name / terms line still
  // shapes on a machine that lacks the primary Latin face.
  const fontStack = `Arial, Tahoma, 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', sans-serif`;

  const css = `
@page { size: ${spec.widthMm}mm auto; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body {
  /* Exactly the printable head width, centred on the roll. 4mm side padding
     (box-sizing: border-box) keeps every element inside the printable area. */
  width: ${spec.contentMm}mm; margin: 0 auto; padding: 1mm 4mm 1.5mm;
  font-family: ${fontStack};
  color: #000; line-height: 1.3;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  -webkit-text-stroke: 0.15pt #000;
}
.logo { max-width: 60mm; max-height: ${opts.logoMaxHeightPx}px; display: block; margin: 0 auto 1mm; object-fit: contain;${opts.logoGrayscale ? ' filter: grayscale(100%) contrast(140%); image-rendering: pixelated;' : ''} }
.shop-name { font-size: ${shopPt}px; font-weight: 800; text-align: center; line-height: 1.15; margin: 0 0 0.6mm; overflow-wrap: anywhere; }
.shop-lines { text-align: center; font-size: ${addrPt}px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.return-banner { text-align: center; font-size: ${sz(16)}px; font-weight: 900; letter-spacing: 0.4px; border: 0.4mm solid #000; padding: 0.6mm 0; margin: 1mm 0 0.4mm; }
.duplicate-banner { text-align: center; font-size: ${sz(14)}px; font-weight: 900; letter-spacing: 1px; border: 0.4mm dashed #000; padding: 0.6mm 0; margin: 0.4mm 0; }
.hdr-line { text-align: center; font-size: ${addrPt}px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; margin-top: 0.3mm; }
.line { border-top: 0.3mm dashed #000; margin: 1mm 0; }
/* meta: label:value left, invoice number (one line) right */
table.meta { width: 100%; table-layout: fixed; border-collapse: collapse; }
table.meta td { vertical-align: top; padding: 0; }
td.meta-left { width: 42%; padding-right: 2mm; }
td.meta-right { width: 58%; text-align: right; }
.mrow { font-size: ${bodyPt}px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.mrow .mlbl { font-weight: 800; }
.inv-no { font-size: ${bodyPt}px; font-weight: 800; white-space: nowrap; text-align: right; }
.inv-no.short { font-size: ${sz(12)}px; }
/* Date + time on ONE line (never "9:14 / PM") — shrinks a step on 58mm. */
.meta-dt { white-space: nowrap; font-size: ${narrow ? sz(11) : bodyPt}px; }
.items-summary { font-size: ${bodyPt}px; font-weight: 700; text-align: right; margin-top: 0.5mm; }
/* items table — fixed layout + explicit column widths, never merged */
table.items { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0.8mm 0; }
table.items thead th { font-size: ${headPt}px; font-weight: 800; text-align: left; text-transform: uppercase; padding: 0.4mm 0.3mm; border-top: 0.4mm solid #000; border-bottom: 0.3mm solid #000; }
table.items th.r, table.items td.r { text-align: right; }
table.items td { font-size: ${bodyPt}px; font-weight: 700; vertical-align: top; padding: 0.4mm 0.3mm; line-height: 1.3; }
table.items { font-variant-numeric: tabular-nums; }
td.name { overflow-wrap: anywhere; word-break: break-word; }
td.qty, td.rate, td.disc, td.amt { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* Item = two rows: a full-width name row, then the value row aligned under the
   headers. Kill the extra vertical padding between them so it reads as one item. */
tr.item-vals td { padding-top: 0; }
tr.item-row td { padding-bottom: 0; }
td.void { padding: 0; }
td.amt, td.no { font-weight: 800; }
td.lg { font-size: ${sz(10)}px; }
.unit { font-size: ${unitPt}px; font-weight: 700; }
.promo { font-size: ${unitPt}px; font-weight: 700; }
/* totals: full-width rows, right-aligned values, on both rolls (stacked).
   Side-by-side columns cannot fit 64mm of content once a payment mode like
   EASYPAYSA meets a long NET TOTAL, so this is the layout-merge-free way to
   guarantee nothing escapes the right edge. */
.totwrap { width: 100%; }
table.pay { width: 100%; border-collapse: collapse; margin-top: 0.8mm; }
table.totals { width: 100%; border-collapse: collapse; }
table.pay td { font-size: ${bodyPt}px; font-weight: 700; padding: 0.25mm 0; }
table.pay td.r { text-align: right; white-space: nowrap; font-weight: 800; padding-left: 2mm; }
table.totals td { font-size: ${bodyPt}px; font-weight: 700; padding: 0.3mm 0; }
table.totals td.r { text-align: right; white-space: nowrap; font-weight: 800; padding-left: 2mm; }
table.totals tr.net td { font-size: ${netPt}px; font-weight: 900; border-top: 0.5mm solid #000; padding-top: 0.6mm; }
table.totals tr.net td.lg { font-size: ${sz(14)}px; }
/* footer */
.foot { text-align: center; margin-top: 1.2mm; }
.foot .terms { font-size: ${footPt}px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; word-wrap: break-word; margin-bottom: 0.8mm; }
.foot .msg { font-size: ${sz(13)}px; font-weight: 800; }
.foot .sw { font-size: ${footPt}px; font-weight: 700; margin-top: 0.8mm; line-height: 1.3; }
`;

  const body = `${s.shop_logo ? `<img class="logo" src="${esc(s.shop_logo)}" alt="" onerror="this.style.display='none'" />` : ''}
<h1 class="shop-name">${esc(s.shop_name)}</h1>
${shopLines ? `<div class="shop-lines">${shopLines}</div>` : ''}
${headerLinesHtml}
${sale.status === 'returned' ? '<div class="return-banner">RETURN / REFUND</div>' : ''}
${opts.duplicate ? '<div class="duplicate-banner">DUPLICATE COPY</div>' : ''}
<div class="line"></div>
<table class="meta">
  <tr>
    <td class="meta-left">${metaLeft}</td>
    <td class="meta-right">${metaRight}</td>
  </tr>
</table>
<div class="line"></div>
<table class="items">
  <colgroup>${colTags}</colgroup>
  <thead><tr>${headCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>
${opts.showItemsSummary ? `<div class="items-summary">Items: ${itemCount}, Qty: ${esc(qtyText)}</div>` : ''}
<div class="line"></div>
${totwrap}
<div class="line"></div>
<div class="foot">
  ${termsHtml}
  <div class="msg">${esc(opts.footerMessage)}</div>
  ${opts.showSoftwareCredit && opts.softwareBy ? `<div class="sw">---- SOFTWARE BY ----<br />${esc(opts.softwareBy)}</div>` : ''}
</div>`;

  return htmlDocument(`Receipt ${sale.invoice_no}`, css, body);
}

export { buildInvoiceHtml };