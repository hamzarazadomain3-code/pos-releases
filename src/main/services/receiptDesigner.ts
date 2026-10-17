/**
 * Receipt Designer — main-process renderer (Phase 2).
 *
 * Renders a thermal receipt FROM a `ReceiptDesign` (see shared/receiptDesign.ts)
 * instead of the fixed `buildRoll` layout. The designer's live preview and the
 * printed receipt both call `buildDesignedReceiptAsync`, so what the owner sees
 * in the designer is byte-for-byte what the printer gets.
 *
 * The design path is OPT-IN: `buildReceiptHtml` keeps using the shipped
 * `buildRoll` until `receipt_design_enabled` is true, so an existing install's
 * receipts never change out from under it. `defaultReceiptDesign()` reproduces
 * the shipped section order, so the first apply is a no-op visually.
 */
import { getAdminSetting, setAdminSetting } from './admin';
import { getPrintSettings, toDataUrl } from './printDocs';
import { getSale } from './sales';
import { getUser } from './auth';
import {
  applyTokens,
  BLOCK_LABELS,
  blockStyleCss,
  defaultReceiptDesign,
  findTemplate,
  normalizeLibrary,
  normalizeReceiptDesign,
  RECEIPT_PAPERS,
  resolveLibraryDefault,
  templateDesign,
  type GlobalOptions,
  type ReceiptBlock,
  type ReceiptDesign,
  type ReceiptLibrary,
  type ReceiptPaper,
  type TableColumnKey,
} from '../../shared/receiptDesign';

export const RECEIPT_DESIGN_KEY = 'receipt_design_json';
export const RECEIPT_DESIGN_ENABLED_KEY = 'receipt_design_enabled';
export const RECEIPT_LIBRARY_KEY = 'receipt_design_library_json';

export function getReceiptDesign(): ReceiptDesign {
  const raw = getAdminSetting(RECEIPT_DESIGN_KEY);
  if (!raw) return defaultReceiptDesign('thermal80');
  try {
    return normalizeReceiptDesign(JSON.parse(raw));
  } catch {
    return defaultReceiptDesign('thermal80');
  }
}

export function isReceiptDesignEnabled(): boolean {
  return getAdminSetting(RECEIPT_DESIGN_ENABLED_KEY) === 'true';
}

/** The whole template library. Absent ⇒ built-ins with no defaults set. */
export function getReceiptLibrary(): ReceiptLibrary {
  const raw = getAdminSetting(RECEIPT_LIBRARY_KEY);
  if (!raw) return normalizeLibrary(null);
  try {
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    return normalizeLibrary(null);
  }
}

/** Persist the library (owner-gated via setAdminSetting). Normalises first. */
export function saveReceiptLibrary(lib: unknown): ReceiptLibrary {
  const clean = normalizeLibrary(lib);
  setAdminSetting(RECEIPT_LIBRARY_KEY, JSON.stringify(clean));
  return clean;
}

/**
 * The design that should drive printing for `paper`: the branch default, else the
 * global default, else the Phase-2 applied design (`receipt_design_json`). The
 * fallback keeps every install that never opened the designer byte-identical.
 */
export function resolveAppliedDesign(paper: ReceiptPaper, branchId?: string | number | null): ReceiptDesign {
  const lib = getReceiptLibrary();
  const id = resolveLibraryDefault(lib, paper, branchId);
  const t = findTemplate(lib, id);
  if (t) return templateDesign(t, paper);
  return getReceiptDesign();
}

/** Sample sale used by the designer preview, covering the VERIFY scenario. */
export interface SampleSale {
  invoice_no: string;
  created_at: string;
  customer_name: string;
  customer_id?: number;
  customer_balance?: number;
  cashier: string;
  status: string;
  items: Array<{
    product_name: string;
    unit_name?: string;
    qty: number;
    display_qty?: number;
    unit_price: number;
    discount: number;
    tax_rate?: number;
    line_total: number;
    promo_name?: string;
  }>;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  service_charge: number;
  freight: number;
  total_amount: number;
  paid: number;
  payments: Array<{ mode: string; amount: number }>;
  returned_amount: number;
  branch: string;
}

export type SampleKind = 'sale' | 'return';

export function buildSampleSale(
  settings: Record<string, string> = getPrintSettings(),
  kind: SampleKind = 'sale'
): SampleSale {
  const items = [
    {
      product_name: 'Al-Bagdad Special Bakery Rusk Family Pack (large loaf)',
      unit_name: 'Piece',
      qty: 2,
      unit_price: 250,
      discount: 0,
      tax_rate: 0,
      line_total: 500,
    },
    {
      product_name: 'Sugar',
      unit_name: 'Kilogram',
      qty: 1,
      display_qty: 0.57,
      unit_price: 190,
      discount: 0,
      tax_rate: 0,
      line_total: 108.3,
    },
    {
      product_name: 'Biscuits',
      unit_name: 'Piece',
      qty: 3,
      unit_price: 120,
      discount: 40,
      tax_rate: 0,
      line_total: 320,
    },
  ];
  const subtotal = items.reduce((s, it) => s + it.line_total + it.discount, 0);
  const discount_amount = items.reduce((s, it) => s + it.discount, 0);
  const total_amount = subtotal - discount_amount;
  const base: SampleSale = {
    invoice_no: 'INV-20261015-0042',
    created_at: '2026-10-15T21:14:00Z',
    customer_name: 'Walk-in',
    customer_id: 1,
    customer_balance: 1500,
    cashier: 'admin',
    status: 'completed',
    items,
    subtotal,
    discount_amount,
    tax_amount: 0,
    service_charge: 0,
    freight: 0,
    total_amount,
    paid: total_amount,
    payments: [{ mode: 'Cash', amount: total_amount }],
    returned_amount: 0,
    branch: settings.shop_name || 'Main Branch',
  };
  if (kind === 'return') {
    // A cart return is recorded as its own NEGATIVE sale (status 'returned').
    return {
      ...base,
      invoice_no: 'RET-20261015-0007',
      status: 'returned',
      items: base.items.map((it) => ({ ...it, line_total: -it.line_total, discount: -it.discount })),
      subtotal: -base.subtotal,
      discount_amount: -base.discount_amount,
      total_amount: -base.total_amount,
      paid: -base.paid,
      payments: base.payments.map((p) => ({ ...p, amount: -p.amount })),
      returned_amount: 0,
    };
  }
  return base;
}

// ── rendering context ─────────────────────────────────────────────────────────

interface BuildCtx {
  sale: SampleSale;
  s: Record<string, string>;
  money: (n: number) => string;
  currency: string;
  paper: ReceiptPaper;
  narrow: boolean;
  sheet: boolean;
  design: ReceiptDesign;
  paperWidthMm: number;
  paperHeightMm: number;
  contentMm: number;
  /** data URLs for QR / barcode blocks, keyed by block id. */
  assets: Record<string, string>;
  /** Reprint of an already-issued sale → "DUPLICATE COPY" stamp (Phase 4). */
  duplicate: boolean;
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string, format: string): { date: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const date =
    format === 'MM/DD/YYYY' ? `${mm}/${dd}/${yyyy}` : format === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` : `${dd}/${mm}/${yyyy}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  return { date, time };
}

/**
 * Money WITHOUT the currency symbol — the item table cannot afford "Rs " five
 * times over and the totals block prints the currency once (on NET TOTAL). This
 * mirrors the shipped `buildRoll`'s `plain()` so the designed receipt and the
 * shipped layout agree to the character. Honours the designer's `decimals` /
 * `thousandSeparator` options.
 */
function makePlainMoney(g: GlobalOptions): (n: number) => string {
  const decimalsRaw = Number(g.decimals);
  const decimals = Number.isFinite(decimalsRaw) ? Math.max(0, Math.min(4, Math.trunc(decimalsRaw))) : 2;
  const thousand = g.thousandSeparator !== false;
  return (n: number) => {
    const v = Number(n || 0);
    if (!thousand) return v.toFixed(decimals);
    return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
}

function money2(ctx: BuildCtx, n: number, withSymbol = false): string {
  const body = ctx.money(n);
  if (!withSymbol) return body;
  return ctx.design.global.currencyPosition === 'after' ? `${body} ${ctx.currency}` : `${ctx.currency} ${body}`;
}

/** Long money strings drop one font step so they never widen the row. */
function numCls(t: string): string {
  return t.length > 7 ? ' lg' : '';
}

function qtyText(it: SampleSale['items'][number]): string {
  const useUnit = !!it.unit_name && it.display_qty != null;
  const q = useUnit ? it.display_qty! : it.qty;
  return String(q);
}

function tokenMap(ctx: BuildCtx): Record<string, string> {
  const { date, time } = fmtDate(ctx.sale.created_at, ctx.design.global.dateFormat || 'dd/mm/yyyy');
  const balance = Math.max(0, ctx.sale.total_amount - ctx.sale.paid);
  // Previous balance = current customer balance - this sale's unpaid amount
  const prevBalance = ctx.sale.customer_name && ctx.sale.customer_id
    ? (ctx.sale.customer_balance || 0) - balance
    : 0;
  // New balance = current customer balance
  const newBalance = ctx.sale.customer_balance || 0;
  // Savings = line discounts + bill discount
  const savings = (ctx.sale.discount_amount || 0) + (ctx.sale.items?.reduce((s, it) => s + (it.discount || 0), 0) || 0);
  // Loyalty points: if loyalty enabled, points = total * points_per_rupee
  const loyaltyEnabled = ctx.s.loyalty_enabled === 'true';
  const pointsPerRupee = Number(ctx.s.points_per_rupee || 0);
  const loyaltyPoints = loyaltyEnabled ? Math.floor(ctx.sale.total_amount * pointsPerRupee) : 0;

  return {
    shop: ctx.s.shop_name || '',
    address: ctx.s.shop_address || '',
    phone: ctx.s.shop_phone || '',
    whatsapp: ctx.s.shop_whatsapp || '',
    customer: ctx.sale.customer_name || 'Walk-in',
    cashier: ctx.sale.cashier || '',
    invoice: ctx.sale.invoice_no,
    date,
    time,
    total: money2(ctx, ctx.sale.total_amount, true),
    paid: money2(ctx, ctx.sale.paid, true),
    balance: money2(ctx, balance, true),
    branch: ctx.sale.branch || '',
    prev_balance: money2(ctx, prevBalance, true),
    new_balance: money2(ctx, newBalance, true),
    loyalty_points: String(loyaltyPoints),
    savings: money2(ctx, savings, true),
    custom1: '',
    custom2: '',
    custom3: '',
  };
}

function visibleCols(ctx: BuildCtx): TableColumnKey[] {
  return ctx.design.table.columns.filter((c) => c.enabled).map((c) => c.key);
}

function buildItemsTable(ctx: BuildCtx): string {
  const { sale, design } = ctx;
  const cols = visibleCols(ctx);
  if (!cols.includes('name')) return '';
  const anyDisc = sale.items.some((it) => it.discount > 0);
  // 58mm physically drops the DISC column (merged into the totals block): a
  // narrow roll cannot carry a second money column without clipping.
  const active = cols.filter((c) => c !== 'disc' || (anyDisc && !ctx.narrow));
  const head: Record<TableColumnKey, string> = {
    no: '#',
    name: ctx.narrow ? 'ITEM' : 'PARTICULARS',
    unit: 'UNIT',
    qty: 'QTY',
    rate: 'RATE',
    disc: 'DISC',
    tax: 'TAX',
    amt: 'AMOUNT',
  };
  const group = active.filter((c) => c !== 'name' && c !== 'no');
  const colgroup = active
    .map((c) => {
      const cfg = design.table.columns.find((x) => x.key === c);
      const w = cfg?.width ? ` style="width:${esc(cfg.width)}"` : '';
      return `<col class="c-${c}"${w}>`;
    })
    .join('');
  const headRow = design.table.showHeader
    ? `<thead><tr>${active.map((c) => `<th class="${c === 'name' ? '' : 'r'}">${head[c]}</th>`).join('')}</tr></thead>`
    : '';
  const cellsFor = (it: SampleSale['items'][number]): string =>
    active
      .filter((c) => c !== 'no' && c !== 'name')
      .map((c) => {
        if (c === 'unit') return `<td class="r unit-c">${esc(it.unit_name || '')}</td>`;
        if (c === 'qty') return `<td class="r qty">${esc(qtyText(it))}</td>`;
        if (c === 'rate') {
          const t = ctx.money(it.unit_price);
          return `<td class="r rate${numCls(t)}">${t}</td>`;
        }
        if (c === 'disc') {
          const t = ctx.money(it.discount);
          return `<td class="r disc${numCls(t)}">${it.discount ? t : ''}</td>`;
        }
        if (c === 'tax') return `<td class="r tax">${it.tax_rate ? `${it.tax_rate}%` : ''}</td>`;
        const t = ctx.money(it.line_total);
        return `<td class="r amt${numCls(t)}">${t}</td>`;
      })
      .join('');
  const rows = sale.items
    .map((it, i) => {
      const unitUnder =
        it.unit_name && it.unit_name.toLowerCase() !== 'piece' ? `<div class="unit">${esc(it.unit_name)}</div>` : '';
      const noCell = active.includes('no') ? `<td class="r no">${i + 1}</td>` : '';
      const nameCell = `<td class="name" colspan="${group.length}">${esc(it.product_name)}${unitUnder}</td>`;
      return `<tr class="item-row">${noCell}${nameCell}</tr><tr class="item-vals">${cellsFor(it)}</tr>`;
    })
    .join('');
  const count = sale.items.length;
  const qty = sale.items.reduce(
    (sum, it) => sum + (it.display_qty != null && it.unit_name ? it.display_qty : it.qty),
    0
  );
  const summary =
    ctx.s.receipt_show_items_summary === 'false'
      ? ''
      : `<div class="items-summary">Items: ${count}, Qty: ${Number.isInteger(qty) ? qty : qty.toFixed(3)}</div>`;
  return `<table class="items">${colgroup ? `<colgroup>${colgroup}</colgroup>` : ''}${headRow}<tbody>${rows}</tbody></table>${summary}`;
}

function buildTotals(ctx: BuildCtx): string {
  const { sale, design } = ctx;
  const rows: string[] = [`<tr><td>SUB TOTAL</td><td class="r">${ctx.money(sale.subtotal)}</td></tr>`];
  const disc = Number(sale.discount_amount || 0);
  if (design.table.columns.some((c) => c.key === 'disc' && c.enabled) && disc !== 0) {
    // A normal sale shows a leading "-"; a return (negative discount) carries its
    // own sign from the formatter.
    rows.push(`<tr><td>DISCOUNT</td><td class="r">${disc > 0 ? '-' + ctx.money(disc) : ctx.money(disc)}</td></tr>`);
  }
  if (ctx.s.show_tax_on_receipt !== 'false' && sale.tax_amount > 0) {
    rows.push(`<tr><td>TAX</td><td class="r">${ctx.money(sale.tax_amount)}</td></tr>`);
  }
  if (sale.service_charge > 0) rows.push(`<tr><td>SERVICE CHARGE</td><td class="r">${ctx.money(sale.service_charge)}</td></tr>`);
  if (sale.freight > 0) rows.push(`<tr><td>FREIGHT</td><td class="r">${ctx.money(sale.freight)}</td></tr>`);
  rows.push(`<tr class="net"><td>NET TOTAL</td><td class="r${numCls(money2(ctx, sale.total_amount, true))}">${money2(ctx, sale.total_amount, true)}</td></tr>`);
  return `<table class="totals">${rows.join('')}</table>`;
}

function buildPayment(ctx: BuildCtx): string {
  const { sale } = ctx;
  const paid = sale.paid;
  const change = Math.max(0, paid - sale.total_amount);
  const balance = Math.max(0, sale.total_amount - paid);
  const rows: string[] = [];
  if (paid !== 0) rows.push(`<tr><td class="pm">PAID</td><td class="r">${ctx.money(paid)}</td></tr>`);
  if (change > 0) rows.push(`<tr><td class="pm">CHANGE</td><td class="r">${ctx.money(change)}</td></tr>`);
  if (balance > 0) rows.push(`<tr><td class="pm">UDHAAR/BALANCE</td><td class="r">${ctx.money(balance)}</td></tr>`);
  if (sale.returned_amount > 0) rows.push(`<tr><td class="pm">RETURN</td><td class="r">${ctx.money(sale.returned_amount)}</td></tr>`);
  if (ctx.s.show_payment_method !== 'false') {
    for (const p of sale.payments) {
      rows.push(`<tr><td class="pm">${esc(String(p.mode).toUpperCase())}</td><td class="r">${ctx.money(p.amount)}</td></tr>`);
    }
  }
  return rows.length ? `<table class="pay">${rows.join('')}</table>` : '';
}

function blockHtml(ctx: BuildCtx, blk: ReceiptBlock): string {
  const { sale, s, design } = ctx;
  const tokens = tokenMap(ctx);
  switch (blk.type) {
    case 'logo': {
      const src = blk.src || s.shop_logo;
      return src ? `<img class="logo" src="${esc(src)}" alt="" onerror="this.style.display='none'" />` : '';
    }
    case 'shop_name':
      return `<h1 class="shop-name">${esc(s.shop_name)}</h1>`;
    case 'address':
      return s.shop_address ? `<div class="shop-line">${esc(s.shop_address)}</div>` : '';
    case 'phone_whatsapp': {
      const parts = [s.shop_phone, s.shop_whatsapp ? `WhatsApp: ${s.shop_whatsapp}` : ''].filter(
        (x) => x && String(x).trim()
      );
      return parts.length ? `<div class="shop-line">${parts.map((p) => esc(String(p))).join(' &middot; ')}</div>` : '';
    }
    case 'tax_no': {
      const parts: string[] = [];
      if (s.shop_ntn) parts.push(`NTN: ${s.shop_ntn}`);
      if (s.shop_strn) parts.push(`STRN: ${s.shop_strn}`);
      return parts.length ? `<div class="shop-line">${esc(parts.join('  |  '))}</div>` : '';
    }
    case 'header_note': {
      const lines = blk.text
        ? [applyTokens(blk.text, tokens)]
        : String(s.receipt_header_lines || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
      return lines.length ? lines.map((l) => `<div class="hdr-line">${esc(l)}</div>`).join('') : '';
    }
    case 'meta': {
      const { date, time } = fmtDate(sale.created_at, design.global.dateFormat || 'dd/mm/yyyy');
      const left =
        `<div class="mrow"><span class="mlbl">CUSTOMER</span> ${esc(sale.customer_name || 'Walk-in')}</div>` +
        `<div class="mrow"><span class="mlbl">CASHIER</span> ${esc(sale.cashier)}</div>`;
      const right = `<div class="inv-no">${esc(sale.invoice_no)}</div><div class="mrow meta-dt">${esc(date)} ${esc(time)}</div>`;
      return `<table class="meta"><tr><td class="meta-left">${left}</td><td class="meta-right">${right}</td></tr></table>`;
    }
    case 'items_table':
      return buildItemsTable(ctx);
    case 'totals':
      return buildTotals(ctx);
    case 'payment':
      return buildPayment(ctx);
    case 'qr':
      return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="" />` : '';
    case 'footer_note_1': {
      const text = blk.text || s.receipt_terms_text || '';
      return text ? `<div class="foot-note">${esc(applyTokens(text, tokens)).replace(/\n/g, '<br />')}</div>` : '';
    }
    case 'footer_note_2': {
      const text = blk.text || s.receipt_footer_text || 'Come again soon!';
      return text ? `<div class="foot-msg">${esc(applyTokens(text, tokens))}</div>` : '';
    }
    case 'software_credit': {
      const by = s.receipt_software_by || 'Rokar POS';
      return s.receipt_show_software_credit === 'false'
        ? ''
        : `<div class="foot-sw">---- SOFTWARE BY ----<br />${esc(by)}</div>`;
    }
    case 'return_banner':
      // Auto banner: mirrors the shipped layout — only a returned / negative sale.
      return sale.status === 'returned' || sale.total_amount < 0
        ? `<div class="return-banner">RETURN / REFUND</div>`
        : '';
    // Phase 5: Loyalty points block
    case 'loyalty': {
      const loyaltyEnabled = s.loyalty_enabled === 'true';
      if (!loyaltyEnabled) return '';
      const pointsPerRupee = Number(s.points_per_rupee || 0);
      const points = Math.floor(sale.total_amount * pointsPerRupee);
      if (points === 0) return '';
      const text = applyTokens(blk.text || 'Loyalty points earned: {loyalty_points}', tokens);
      return `<div class="blk-loyalty">${esc(text)}</div>`;
    }
    // Phase 5: Savings block
    case 'savings': {
      const savings = (sale.discount_amount || 0) + (sale.items?.reduce((s, it) => s + (it.discount || 0), 0) || 0);
      if (savings <= 0) return '';
      const text = applyTokens(blk.text || 'You saved {savings}', tokens);
      return `<div class="blk-savings">${esc(text)}</div>`;
    }
    // Phase 5: Return policy block
    case 'return_policy': {
      const text = applyTokens(blk.text || s.receipt_return_policy || '', tokens);
      if (!text) return '';
      return `<div class="blk-return-policy">${esc(text).replace(/\n/g, '<br />')}</div>`;
    }
    // Phase 5: Thank you block (auto per language)
    case 'thank_you': {
      const lang = s.receipt_language || 'en';
      const defaultThanks = lang === 'ur' ? 'شکریہ' : 'Thank you for your visit!';
      const text = applyTokens(blk.text || s.receipt_thank_you || defaultThanks, tokens);
      return `<div class="blk-thank-you">${esc(text)}</div>`;
    }
    // Phase 5: FBR e-Invoice QR
    case 'fbr_qr': {
      // Only render on A4/A5 invoices
      if (ctx.sheet) {
        const fbrUrl = s.fbr_invoice_url || `https://efbr.gov.pk/invoice/${sale.invoice_no}`;
        return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="FBR e-Invoice QR" />` : '';
      }
      return '';
    }
    case 'banner': {
      const text = applyTokens(blk.text || '', tokens);
      return text ? `<div class="banner">${esc(text)}</div>` : '';
    }
    case 'text':
      return blk.text
        ? `<div class="blk-text">${esc(applyTokens(blk.text, tokens)).replace(/\n/g, '<br />')}</div>`
        : '';
    case 'two_col':
      return `<table class="two-col"><tr><td>${esc(applyTokens(blk.label || '', tokens))}</td><td class="r">${esc(
        applyTokens(blk.value || '', tokens)
      )}</td></tr></table>`;
    case 'divider': {
      const v = blk.variant || 'solid';
      if (v === 'blank') return `<div class="spacer" style="height:1.5mm"></div>`;
      if (v === 'double') return `<div class="div-double"></div>`;
      if (v === 'dashed') return `<div class="line"></div>`;
      return `<div class="div-solid"></div>`;
    }
    case 'image':
      return blk.src ? `<img class="blk-image" src="${esc(blk.src)}" alt="" onerror="this.style.display='none'" />` : '';
    case 'barcode':
      return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="" />` : '';
    case 'spacer':
      return `<div class="spacer" style="height:${Number(blk.heightMm ?? 3)}mm"></div>`;
    default:
      return '';
  }
}

function buildCss(ctx: BuildCtx): string {
  const base = Number(ctx.design.global.baseFontSizePx || 13);
  const sz = (n: number) => (ctx.narrow ? n - 2 : n);
  const body = sz(base);
  const pageRule = ctx.sheet
    ? `@page { size: ${ctx.paperWidthMm}mm ${ctx.paperHeightMm}mm; margin: ${ctx.design.global.marginMm ?? 8}mm; }`
    : `@page { size: ${ctx.paperWidthMm}mm auto; margin: 0; }`;
  const bodyRule = ctx.sheet
    ? `width: ${ctx.contentMm}mm; margin: 0 auto; padding: 0;`
    : `width: ${ctx.contentMm}mm; margin: 0 auto; padding: 1mm ${ctx.design.global.marginMm ?? 4}mm 1.5mm;`;
  return `
${pageRule}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body {
  ${bodyRule}
  font-family: Arial, Tahoma, 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', sans-serif;
  color: #000; line-height: 1.3;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  -webkit-text-stroke: ${ctx.sheet ? '0' : '0.15pt'} #000;
}
.logo { max-width: 60mm; max-height: ${ctx.s.receipt_logo_max_height_px || 64}px; display: block; margin: 0 auto 1mm; object-fit: contain;${
    ctx.s.receipt_logo_grayscale !== 'false' ? ' filter: grayscale(100%) contrast(140%); image-rendering: pixelated;' : ''
  } }
.shop-name { font-size: ${sz(22)}px; font-weight: 800; text-align: center; line-height: 1.15; margin: 0 0 0.6mm; overflow-wrap: anywhere; }
.shop-line { text-align: center; font-size: ${sz(14)}px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.hdr-line { text-align: center; font-size: ${sz(14)}px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; margin-top: 0.3mm; }
.banner, .return-banner { text-align: center; font-size: ${sz(16)}px; font-weight: 900; letter-spacing: 0.4px; border: 0.4mm solid #000; padding: 0.6mm 0; margin: 1mm 0 0.4mm; text-transform: uppercase; }
.duplicate-banner { text-align: center; font-size: ${sz(14)}px; font-weight: 900; letter-spacing: 1px; border: 0.4mm dashed #000; padding: 0.6mm 0; margin: 0.4mm 0; }
.line { border-top: 0.3mm dashed #000; margin: 1mm 0; }
.div-solid { border-top: 0.4mm solid #000; margin: 1mm 0; }
.div-double { border-top: 0.3mm solid #000; border-bottom: 0.3mm solid #000; height: 0.7mm; margin: 1mm 0; }
table.meta { width: 100%; table-layout: fixed; border-collapse: collapse; }
table.meta td { vertical-align: top; padding: 0; }
td.meta-left { width: 42%; padding-right: 2mm; }
td.meta-right { width: 58%; text-align: right; }
.mrow { font-size: ${body}px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.mrow .mlbl { font-weight: 800; }
.inv-no { font-size: ${body}px; font-weight: 800; white-space: nowrap; text-align: right; }
.meta-dt { white-space: nowrap; font-size: ${ctx.narrow ? sz(11) : body}px; }
.items-summary { font-size: ${body}px; font-weight: 700; text-align: right; margin-top: 0.5mm; }
table.items { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0.8mm 0; font-variant-numeric: tabular-nums; }
table.items thead th { font-size: ${sz(12)}px; font-weight: 800; text-align: left; text-transform: uppercase; padding: 0.4mm 0.3mm; border-top: 0.4mm solid #000; border-bottom: 0.3mm solid #000; }
table.items th.r, table.items td.r { text-align: right; }
table.items td { font-size: ${Number(ctx.design.table.fontSizePx || base)}px; font-weight: ${ctx.design.table.boldItemNames ? 700 : 400}; vertical-align: top; padding: 0.4mm 0.3mm; line-height: 1.3; }
td.name { overflow-wrap: anywhere; word-break: break-word; }
td.qty, td.rate, td.disc, td.tax, td.amt, td.unit-c { white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.item-vals td { padding-top: 0; }
tr.item-row td { padding-bottom: 0; }
td.amt, td.no { font-weight: 800; }
td.lg { font-size: ${sz(10)}px; }
.unit { font-size: ${sz(10)}px; font-weight: 700; }
${ctx.design.table.rowSeparators ? 'tr.item-vals td { border-bottom: 0.2mm dashed #000; }' : ''}
table.pay { width: 100%; border-collapse: collapse; margin-top: 0.8mm; }
table.totals { width: 100%; border-collapse: collapse; }
table.pay td { font-size: ${body}px; font-weight: 700; padding: 0.25mm 0; }
table.pay td.r { text-align: right; white-space: nowrap; font-weight: 800; padding-left: 2mm; }
table.totals td { font-size: ${body}px; font-weight: 700; padding: 0.3mm 0; }
table.totals td.r { text-align: right; white-space: nowrap; font-weight: 800; padding-left: 2mm; }
table.totals tr.net td { font-size: ${sz(17)}px; font-weight: 900; border-top: 0.5mm solid #000; padding-top: 0.6mm; }
table.totals tr.net td.lg { font-size: ${sz(14)}px; }
.two-col { width: 100%; border-collapse: collapse; font-size: ${body}px; font-weight: 700; }
.two-col td.r { text-align: right; white-space: nowrap; padding-left: 2mm; }
.blk-text, .foot-note { font-size: ${sz(11)}px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; text-align: center; }
.foot-msg { font-size: ${sz(13)}px; font-weight: 800; text-align: center; }
.foot-sw { font-size: ${sz(11)}px; font-weight: 700; text-align: center; line-height: 1.3; margin-top: 0.8mm; }
// Phase 5 new blocks
.blk-loyalty { font-size: ${sz(13)}px; font-weight: 800; text-align: center; color: #000; margin: 1mm 0; padding: 0.8mm 0; border-top: 0.3mm dashed #000; border-bottom: 0.3mm dashed #000; }
.blk-savings { font-size: ${sz(13)}px; font-weight: 800; text-align: center; color: #006600; margin: 1mm 0; }
.blk-return-policy { font-size: ${sz(11)}px; font-weight: 700; text-align: center; line-height: 1.4; margin: 1mm 0; padding: 0.5mm 0; border-top: 0.3mm dashed #000; }
.blk-thank-you { font-size: ${sz(14)}px; font-weight: 800; text-align: center; margin: 1mm 0; padding: 1mm 0; border-top: 0.4mm solid #000; }
.blk-image { max-width: 100%; max-height: 30mm; display: block; margin: 0 auto; object-fit: contain; }
.spacer { display: block; }
[dir="rtl"] { font-family: ${esc(ctx.design.global.urduFontFamily || '')}, Arial, sans-serif; direction: rtl; }
`;
}

function renderDocument(ctx: BuildCtx): string {
  const body = ctx.design.sections
    .filter((b) => b.enabled)
    .map((blk) => {
      const inner = blockHtml(ctx, blk);
      if (!inner) return '';
      const css = blockStyleCss(blk.style);
      return `<div class="blk"${css ? ` style="${css}"` : ''}>${inner}</div>`;
    })
    .filter(Boolean)
    .join('\n');
  // Reprint stamp always sits at the very top, independent of the design's own
  // sections (a reprint must be unmistakable even on a stripped-down design).
  const stamp = ctx.duplicate ? '<div class="blk"><div class="duplicate-banner">DUPLICATE COPY</div></div>\n' : '';
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Receipt</title><style>${buildCss(ctx)}</style></head>
<body>${stamp}${body}</body></html>`;
}

function makeCtx(
  sale: SampleSale,
  paper: ReceiptPaper,
  design: ReceiptDesign,
  assets: Record<string, string>,
  duplicate = false
): BuildCtx {
  const s = getPrintSettings();
  const currency = design.global.currencySymbol || s.currency || 'Rs';
  const spec = RECEIPT_PAPERS.find((p) => p.value === paper) || RECEIPT_PAPERS[0];
  const sheet = paper === 'a4' || paper === 'a5';
  const margin = design.global.marginMm ?? (sheet ? 8 : 4);
  const widthMm = design.global.paperWidthMm && !sheet ? design.global.paperWidthMm : spec.widthMm;
  const heightMm = paper === 'a4' ? 297 : paper === 'a5' ? 210 : 0;
  return {
    sale,
    s,
    money: makePlainMoney(design.global),
    currency,
    paper,
    narrow: paper === 'thermal58',
    sheet,
    design,
    paperWidthMm: widthMm,
    paperHeightMm: heightMm,
    contentMm: sheet ? widthMm - 2 * margin : paper === 'thermal58' ? 48 : 72,
    assets,
    duplicate,
  };
}

/** Resolve QR / barcode data URLs, then render the document. */
export async function buildDesignedReceiptAsync(
  sale: SampleSale,
  paper: ReceiptPaper,
  designInput?: ReceiptDesign,
  duplicate = false
): Promise<string> {
  const design = designInput ? normalizeReceiptDesign(designInput) : getReceiptDesign();
  const assets: Record<string, string> = {};
  for (const blk of design.sections) {
    if (!blk.enabled) continue;
    try {
      if (blk.type === 'qr') {
        assets[blk.id] = await toDataUrl({ bcid: 'qrcode', text: sale.invoice_no, scale: 3, parsefnc: false });
      } else if (blk.type === 'barcode') {
        assets[blk.id] = await toDataUrl({
          bcid: 'code128',
          text: blk.value || sale.invoice_no,
          height: 10,
          includetext: true,
          scale: 2,
        });
      }
    } catch {
      assets[blk.id] = '';
    }
  }
  return renderDocument(makeCtx(sale, paper, design, assets, duplicate));
}

/** Synchronous render (no QR/barcode assets) — used by tests and callers that
 *  only need the layout. */
export function buildDesignedReceipt(sale: SampleSale, paper: ReceiptPaper, designInput?: ReceiptDesign): string {
  const design = designInput ? normalizeReceiptDesign(designInput) : getReceiptDesign();
  return renderDocument(makeCtx(sale, paper, design, {}));
}

/** Map a real DB sale onto the SampleSale shape the renderer consumes. */
export function saleToSampleSale(
  sale: {
    invoice_no?: string;
    created_at?: string;
    customer_name?: string | null;
    status?: string;
    subtotal?: number | null;
    discount_amount?: number | null;
    tax_amount?: number | null;
    service_charge?: number | null;
    freight?: number | null;
    total_amount?: number | null;
    returned_amount?: number | null;
    items: Array<{
      product_name?: string | null;
      unit_name?: string | null;
      qty?: number | null;
      display_qty?: number | null;
      unit_price?: number | null;
      discount?: number | null;
      line_total?: number | null;
      promo_name?: string | null;
    }>;
    payments?: Array<{ mode?: string; amount?: number }>;
  },
  cashierName: string
): SampleSale {
  const items = (sale.items || []).map((it) => {
    const useUnit = !!it.unit_name && it.display_qty != null;
    const qty = Number(it.qty || 0);
    const unitPrice =
      useUnit && (it.display_qty ?? 0) > 0
        ? Number(it.line_total || 0) / Number(it.display_qty || 1)
        : Number(it.unit_price || 0);
    return {
      product_name: it.product_name || '',
      unit_name: it.unit_name || undefined,
      qty,
      display_qty: it.display_qty ?? undefined,
      unit_price: unitPrice,
      discount: Number(it.discount || 0),
      line_total: Number(it.line_total || 0),
      promo_name: it.promo_name || undefined,
    };
  });
  const payments = (sale.payments || []).map((p) => ({
    mode: String(p.mode || '').toUpperCase(),
    amount: Number(p.amount || 0),
  }));
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    invoice_no: sale.invoice_no || '',
    created_at: sale.created_at || new Date().toISOString(),
    customer_name: sale.customer_name || 'Walk-in',
    cashier: cashierName,
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

/**
 * Render a REAL saved sale from the applied design. Returns null when there is
 * no sale, so callers can fall back to the shipped layout.
 */
export async function renderReceiptForSale(
  saleId: number,
  paper: ReceiptPaper,
  designInput?: ReceiptDesign,
  duplicate = false
): Promise<string | null> {
  const sale = getSale(saleId);
  if (!sale) return null;
  const cashierName = getUser(sale.user_id ?? 0)?.username ?? '';
  const sample = saleToSampleSale(sale, cashierName);
  return buildDesignedReceiptAsync(sample, paper, designInput ?? getReceiptDesign(), duplicate);
}

/**
 * Render a REAL sale using the RESOLVED design (branch default → global default
 * → the Phase-2 applied design). This is what the print path uses, so a template
 * the owner marks as default actually reaches the printer.
 */
export async function renderAppliedReceipt(saleId: number, paper: ReceiptPaper, duplicate = false): Promise<string | null> {
  const sale = getSale(saleId);
  if (!sale) return null;
  const branchId = (sale as { branch_id?: number | null }).branch_id ?? null;
  const design = resolveAppliedDesign(paper, branchId);
  const cashierName = getUser(sale.user_id ?? 0)?.username ?? '';
  return buildDesignedReceiptAsync(saleToSampleSale(sale, cashierName), paper, design, duplicate);
}

export { BLOCK_LABELS };
