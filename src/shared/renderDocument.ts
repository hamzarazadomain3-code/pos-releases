/**
 * Single Renderer for All Document Types (Phase 1)
 *
 * This is the ONE source of truth for rendering any document type.
 * It replaces: buildDesignedReceiptAsync, renderAppliedReceipt, buildInvoiceHtml,
 * buildReceiptHtml, previewDesign, and all udhaar/label printers.
 *
 * Text Resolution Order (strict):
 * 1. Template block override (if key EXISTS on block, even empty string) → use it
 * 2. Branch override (if exists on block.branchOverrides[branchId]) → use it
 * 3. Shop Profile (from settings) → use it
 * 4. Empty string → skip block entirely (and its blank line)
 *
 * NEVER use `||` for user-editable text; use `hasOwnProperty` / `!== undefined`.
 * Empty string = skip block and its blank line.
 */

import {
  applyTokens,
  blockStyleCss,
  BLOCK_LABELS,
  DEFAULT_META_LABELS,
  DEFAULT_TABLE_COLUMN_LABELS,
  type Block,
  type BlockType,
  type DocumentDesign,
  type DocumentPaper,
  type DocumentType,
  type GlobalOptions,
  type TableColumnKey,
  type TableOptions,
} from './receiptDesign';

// ============================================================================
// Types
// ============================================================================

/** Shop profile from settings */
export interface ShopProfile {
  name: string;
  address: string;
  phone: string;
  whatsapp: string;
  taxNo: string;
  ntn: string;
  strn: string;
  logo: string;
  logoGrayscale: boolean;
  logoMaxHeightPx: number;
  receiptHeaderLines: string;
  receiptTermsText: string;
  receiptSoftwareBy: string;
  receiptShowSoftwareCredit: boolean;
  receiptShowItemsSummary: boolean;
  receiptShowPaymentMethod: boolean;
  showTaxOnReceipt: boolean;
  currency: string;
  loyaltyEnabled: boolean;
  pointsPerRupee: number;
  fbrInvoiceUrl: string;
  /** Per-branch overrides keyed by branch id */
  branchOverrides?: Record<string, Partial<ShopProfile>>;
}

/** Sale data for rendering */
export interface SaleData {
  invoice_no: string;
  created_at: string;
  customer_name: string;
  customer_phone?: string;
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
  payments: Array<{ mode: string; amount: number; reference?: string }>;
  returned_amount: number;
  branch: string;
  /** For credit slip / udhaar */
  prev_balance?: number;
  new_balance?: number;
  loyalty_points?: number;
}

/** Render context passed to all block renderers */
export interface RenderContext {
  sale: SaleData;
  shop: ShopProfile;
  design: DocumentDesign;
  paper: DocumentPaper;
  documentType: DocumentType;
  branchId?: string | number | null;
  assets: Record<string, string>;
  duplicate: boolean;
  money: (n: number) => string;
  currency: string;
  narrow: boolean;
  sheet: boolean;
  paperWidthMm: number;
  paperHeightMm: number;
  contentMm: number;
  dateFormat: string;
  metaLabels: Record<string, string>;
  columnLabels: Record<string, string>;
  tokens: Record<string, string>;
  urduFontFamily: string;
}

// ============================================================================
// Text Resolution - THE CORE LOGIC
// ============================================================================

/**
 * Get the effective text for a block following the resolution order:
 * 1. Template block override (if key EXISTS on block, even empty string)
 * 2. Branch override (if exists on block.branchOverrides[branchId])
 * 3. Shop Profile value
 * 4. Empty string (skip block)
 *
 * @param ctx Render context
 * @param blk The block being rendered
 * @param shopKey The key in shop profile to fall back to
 * @returns The resolved text, or undefined if should skip
 */
function resolveBlockText(
  ctx: RenderContext,
  blk: Block,
  shopKey: keyof ShopProfile
): string | undefined {
  // 1. Template block override - use hasOwnProperty to detect EXPLICIT set (even empty string)
  if (Object.prototype.hasOwnProperty.call(blk, 'text') && blk.text !== undefined) {
    // If explicitly set to empty string, skip the block
    if (blk.text === '') return undefined;
    return applyTokens(blk.text, ctx.tokens);
  }

  // 2. Branch override
  if (ctx.branchId && blk.branchOverrides && Object.prototype.hasOwnProperty.call(blk.branchOverrides, String(ctx.branchId))) {
    const branchText = blk.branchOverrides[String(ctx.branchId)];
    if (branchText === '') return undefined;
    return applyTokens(branchText, ctx.tokens);
  }

  // 3. Shop Profile
  const shopValue = ctx.shop[shopKey];
  if (shopValue !== undefined && shopValue !== '') {
    return applyTokens(String(shopValue), ctx.tokens);
  }

  // 4. Empty - skip block
  return undefined;
}

/**
 * Get the effective text for a block with a custom shop key (for blocks like header_note)
 * that don't have a direct 1:1 mapping to shop profile.
 */
function resolveCustomText(
  ctx: RenderContext,
  blk: Block,
  fallback: string
): string | undefined {
  // 1. Template block override
  if (Object.prototype.hasOwnProperty.call(blk, 'text') && blk.text !== undefined) {
    if (blk.text === '') return undefined;
    return applyTokens(blk.text, ctx.tokens);
  }

  // 2. Branch override
  if (ctx.branchId && blk.branchOverrides && Object.prototype.hasOwnProperty.call(blk.branchOverrides, String(ctx.branchId))) {
    const branchText = blk.branchOverrides[String(ctx.branchId)];
    if (branchText === '') return undefined;
    return applyTokens(branchText, ctx.tokens);
  }

  // 3. Fallback (from settings)
  if (fallback !== '') {
    return applyTokens(fallback, ctx.tokens);
  }

  return undefined;
}

// ============================================================================
// Token Map
// ============================================================================

function buildTokens(ctx: RenderContext): Record<string, string> {
  const { sale, shop, design, documentType } = ctx;
  const { date, time } = fmtDate(sale.created_at, design.global.dateFormat || 'dd/mm/yyyy');
  const balance = Math.max(0, sale.total_amount - sale.paid);
  const prevBalance = (sale.prev_balance ?? 0);
  const newBalance = (sale.new_balance ?? 0);
  const savings = (sale.discount_amount || 0) + (sale.items?.reduce((s, it) => s + (it.discount || 0), 0) || 0);
  const loyaltyEnabled = shop.loyaltyEnabled;
  const pointsPerRupee = shop.pointsPerRupee;
  const loyaltyPoints = loyaltyEnabled ? Math.floor(sale.total_amount * pointsPerRupee) : 0;

  return {
    shop: shop.name,
    address: shop.address,
    phone: shop.phone,
    whatsapp: shop.whatsapp,
    tax_no: shop.taxNo,
    ntn: shop.ntn,
    strn: shop.strn,
    customer: sale.customer_name || 'Walk-in',
    cashier: sale.cashier,
    invoice: sale.invoice_no,
    date,
    time,
    total: moneyWithSymbol(ctx, sale.total_amount),
    paid: moneyWithSymbol(ctx, sale.paid),
    balance: moneyWithSymbol(ctx, balance),
    branch: sale.branch,
    prev_balance: moneyWithSymbol(ctx, prevBalance),
    new_balance: moneyWithSymbol(ctx, newBalance),
    loyalty_points: String(loyaltyPoints),
    savings: moneyWithSymbol(ctx, savings),
    custom1: '',
    custom2: '',
    custom3: '',
  };
}

function moneyWithSymbol(ctx: RenderContext, n: number): string {
  const body = ctx.money(n);
  return ctx.design.global.currencyPosition === 'after'
    ? `${body} ${ctx.currency}`
    : `${ctx.currency} ${body}`;
}

// ============================================================================
// Date Formatting
// ============================================================================

function fmtDate(iso: string, format: string): { date: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const date =
    format === 'MM/DD/YYYY' ? `${mm}/${dd}/${yyyy}` :
    format === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` :
    `${dd}/${mm}/${yyyy}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  return { date, time };
}

// ============================================================================
// Escape HTML
// ============================================================================

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

// ============================================================================
// Block Renderers
// ============================================================================

function renderLogo(ctx: RenderContext, blk: Block): string {
  const src = blk.src || ctx.shop.logo;
  if (!src) return '';
  return `<img class="logo" src="${esc(src)}" alt="" onerror="this.style.display='none'" />`;
}

function renderShopName(ctx: RenderContext): string {
  return `<h1 class="shop-name">${esc(ctx.shop.name)}</h1>`;
}

function renderAddress(ctx: RenderContext, blk: Block): string {
  const text = resolveBlockText(ctx, blk, 'address');
  return text ? `<div class="shop-line">${esc(text)}</div>` : '';
}

function renderPhoneWhatsApp(ctx: RenderContext, blk: Block): string {
  const phone = resolveBlockText(ctx, blk, 'phone');
  const whatsapp = resolveBlockText(ctx, blk, 'whatsapp');

  // If both phone and whatsapp are explicitly set on block, combine them
  const hasPhoneOverride = Object.prototype.hasOwnProperty.call(blk, 'text') && blk.text !== undefined && blk.text.includes('phone');
  const hasWaOverride = Object.prototype.hasOwnProperty.call(blk, 'text') && blk.text !== undefined && blk.text.includes('whatsapp');

  // Actually, phone_whatsapp block can have both - check individual parts
  // For now, use the resolved values
  const parts: string[] = [];
  if (phone) parts.push(phone);
  if (whatsapp) parts.push(`WhatsApp: ${whatsapp}`);
  return parts.length ? `<div class="shop-line">${parts.map((p) => esc(p)).join(' &middot; ')}</div>` : '';
}

function renderTaxNo(ctx: RenderContext, blk: Block): string {
  const ntn = resolveBlockText(ctx, blk, 'ntn');
  const strn = resolveBlockText(ctx, blk, 'strn');
  const parts: string[] = [];
  if (ntn) parts.push(`NTN: ${ntn}`);
  if (strn) parts.push(`STRN: ${strn}`);
  return parts.length ? `<div class="shop-line">${esc(parts.join('  |  '))}</div>` : '';
}

function renderHeaderNote(ctx: RenderContext, blk: Block): string {
  const text = resolveCustomText(ctx, blk, ctx.shop.receiptHeaderLines);
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines.map((l) => `<div class="hdr-line">${esc(l)}</div>`).join('') : '';
}

function renderMeta(ctx: RenderContext): string {
  const { sale, design, metaLabels } = ctx;
  const { date, time } = fmtDate(sale.created_at, ctx.dateFormat);
  const left =
    `<div class="mrow"><span class="mlbl">${metaLabels.customerLabel}</span> ${esc(sale.customer_name || 'Walk-in')}</div>` +
    `<div class="mrow"><span class="mlbl">${metaLabels.cashierLabel}</span> ${esc(sale.cashier)}</div>`;
  const right = `<div class="inv-no">${esc(sale.invoice_no)}</div><div class="mrow meta-dt">${esc(date)} ${esc(time)}</div>`;
  return `<table class="meta"><tr><td class="meta-left">${left}</td><td class="meta-right">${right}</td></tr></table>`;
}

function renderItemsTable(ctx: RenderContext): string {
  const { sale, design } = ctx;
  const cols = design.table.columns.filter((c) => c.enabled).map((c) => c.key);
  if (!cols.includes('name')) return '';

  const anyDisc = sale.items.some((it) => it.discount > 0);
  const active = cols.filter((c) => c !== 'disc' || (anyDisc && !ctx.narrow));

  const head: Record<TableColumnKey, string> = {
    no: ctx.columnLabels.no || DEFAULT_TABLE_COLUMN_LABELS.no,
    name: ctx.columnLabels.name || DEFAULT_TABLE_COLUMN_LABELS.name,
    unit: ctx.columnLabels.unit || DEFAULT_TABLE_COLUMN_LABELS.unit,
    qty: ctx.columnLabels.qty || DEFAULT_TABLE_COLUMN_LABELS.qty,
    rate: ctx.columnLabels.rate || DEFAULT_TABLE_COLUMN_LABELS.rate,
    disc: ctx.columnLabels.disc || DEFAULT_TABLE_COLUMN_LABELS.disc,
    tax: ctx.columnLabels.tax || DEFAULT_TABLE_COLUMN_LABELS.tax,
    amt: ctx.columnLabels.amt || DEFAULT_TABLE_COLUMN_LABELS.amt,
  };

  // Group columns are all except 'name' (which spans multiple columns)
  // The 'no' column is separate, so group = active excluding 'name'
  const group = active.filter((c) => c !== 'name');

  const colgroup = active
    .map((c) => {
      const cfg = design.table.columns.find((x) => x.key === c);
      const w = cfg?.width ? ` width="${esc(cfg.width.replace('%', ''))}%"` : '';
      return `<col class="c-${c}"${w}>`;
    })
    .join('');

  const headRow = design.table.showHeader
    ? `<thead><tr>${active.map((c) => `<th class="${c === 'name' ? '' : 'r'}">${head[c]}</th>`).join('')}</tr></thead>`
    : '';

  const cellsFor = (it: SaleData['items'][number]): string =>
    active
      .filter((c) => c !== 'name')
      .map((c) => {
        if (c === 'no') return `<td class="r no"></td>`; // Empty cell for serial number in vals row
        if (c === 'unit') return `<td class="r unit-c">${esc(it.unit_name || '')}</td>`;
        if (c === 'qty') {
          const q = it.unit_name && it.display_qty != null ? it.display_qty : it.qty;
          return `<td class="r qty">${esc(String(q))}</td>`;
        }
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

  const summary = ctx.shop.receiptShowItemsSummary === false
    ? ''
    : `<div class="items-summary">Items: ${count}, Qty: ${Number.isInteger(qty) ? qty : qty.toFixed(3)}</div>`;

  return `<table class="items">${colgroup ? `<colgroup>${colgroup}</colgroup>` : ''}${headRow}<tbody>${rows}</tbody></table>${summary}`;
}

function numCls(t: string): string {
  return t.length > 7 ? ' lg' : '';
}

function renderTotals(ctx: RenderContext): string {
  const { sale, design, metaLabels } = ctx;
  const rows: string[] = [`<tr><td>${metaLabels.subtotal}</td><td class="r">${ctx.money(sale.subtotal)}</td></tr>`];

  const disc = Number(sale.discount_amount || 0);
  if (design.table.columns.some((c) => c.key === 'disc' && c.enabled) && disc !== 0) {
    rows.push(`<tr><td>${metaLabels.discount}</td><td class="r">${disc > 0 ? '-' + ctx.money(disc) : ctx.money(disc)}</td></tr>`);
  }
  if (ctx.shop.showTaxOnReceipt !== false && sale.tax_amount > 0) {
    rows.push(`<tr><td>${metaLabels.tax}</td><td class="r">${ctx.money(sale.tax_amount)}</td></tr>`);
  }
  if (sale.service_charge > 0) rows.push(`<tr><td>${metaLabels.serviceCharge}</td><td class="r">${ctx.money(sale.service_charge)}</td></tr>`);
  if (sale.freight > 0) rows.push(`<tr><td>${metaLabels.freight}</td><td class="r">${ctx.money(sale.freight)}</td></tr>`);
  rows.push(`<tr class="net"><td>${metaLabels.netTotal}</td><td class="r${numCls(moneyWithSymbol(ctx, sale.total_amount))}">${moneyWithSymbol(ctx, sale.total_amount)}</td></tr>`);
  return `<table class="totals">${rows.join('')}</table>`;
}

function renderPayment(ctx: RenderContext): string {
  const { sale, design, metaLabels } = ctx;
  const paid = sale.paid;
  const change = Math.max(0, paid - sale.total_amount);
  const balance = Math.max(0, sale.total_amount - paid);
  const rows: string[] = [];

  if (paid !== 0) rows.push(`<tr><td class="pm">${metaLabels.paid}</td><td class="r">${ctx.money(paid)}</td></tr>`);
  if (change > 0) rows.push(`<tr><td class="pm">${metaLabels.change}</td><td class="r">${ctx.money(change)}</td></tr>`);
  if (balance > 0) rows.push(`<tr><td class="pm">${metaLabels.balance}</td><td class="r">${ctx.money(balance)}</td></tr>`);
  if (sale.returned_amount > 0) rows.push(`<tr><td class="pm">${metaLabels.return}</td><td class="r">${ctx.money(sale.returned_amount)}</td></tr>`);
  if (ctx.shop.receiptShowPaymentMethod !== false) {
    for (const p of sale.payments) {
      rows.push(`<tr><td class="pm">${esc(String(p.mode).toUpperCase())}</td><td class="r">${ctx.money(p.amount)}</td></tr>`);
    }
  }
  return rows.length ? `<table class="pay">${rows.join('')}</table>` : '';
}

function renderQr(ctx: RenderContext, blk: Block): string {
  return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="" />` : '';
}

function renderFooterNote1(ctx: RenderContext, blk: Block): string {
  const text = resolveBlockText(ctx, blk, 'receiptTermsText');
  if (!text) return '';
  return `<div class="foot-note">${esc(text).replace(/\n/g, '<br />')}</div>`;
}

function renderFooterNote2(ctx: RenderContext, blk: Block): string {
  const text = resolveBlockText(ctx, blk, 'receiptSoftwareBy'); // fallback to software by
  if (!text) return '';
  return `<div class="foot-msg">${esc(text)}</div>`;
}

function renderSoftwareCredit(ctx: RenderContext, blk: Block): string {
  if (ctx.shop.receiptShowSoftwareCredit === false) return '';
  const text = resolveBlockText(ctx, blk, 'receiptSoftwareBy');
  if (!text) return '';
  return `<div class="foot-sw">${esc(text)}</div>`;
}

function renderReturnBanner(ctx: RenderContext, blk: Block): string {
  const { sale, metaLabels } = ctx;
  if (sale.status === 'returned' || sale.total_amount < 0) {
    return `<div class="return-banner">${metaLabels.return}</div>`;
  }
  return '';
}

function renderLoyalty(ctx: RenderContext, blk: Block): string {
  const { sale, shop, tokens } = ctx;
  if (!shop.loyaltyEnabled) return '';
  const pointsPerRupee = shop.pointsPerRupee;
  const points = Math.floor(sale.total_amount * pointsPerRupee);
  if (points === 0) return '';
  const text = applyTokens(blk.text || '', tokens);
  return text ? `<div class="blk-loyalty">${esc(text)}</div>` : '';
}

function renderSavings(ctx: RenderContext, blk: Block): string {
  const { sale, tokens } = ctx;
  const savings = (sale.discount_amount || 0) + (sale.items?.reduce((s, it) => s + (it.discount || 0), 0) || 0);
  if (savings <= 0) return '';
  const text = applyTokens(blk.text || '', tokens);
  return text ? `<div class="blk-savings">${esc(text)}</div>` : '';
}

function renderReturnPolicy(ctx: RenderContext, blk: Block): string {
  const { tokens } = ctx;
  const text = applyTokens(blk.text || '', tokens);
  if (!text) return '';
  return `<div class="blk-return-policy">${esc(text).replace(/\n/g, '<br />')}</div>`;
}

function renderThankYou(ctx: RenderContext, blk: Block): string {
  const { tokens } = ctx;
  const text = applyTokens(blk.text || '', tokens);
  return text ? `<div class="blk-thank-you">${esc(text)}</div>` : '';
}

function renderFbrQr(ctx: RenderContext, blk: Block): string {
  if (!ctx.sheet) return '';
  return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="FBR e-Invoice QR" />` : '';
}

function renderBanner(ctx: RenderContext, blk: Block): string {
  const { tokens } = ctx;
  const text = applyTokens(blk.text || '', tokens);
  return text ? `<div class="banner">${esc(text)}</div>` : '';
}

function renderText(ctx: RenderContext, blk: Block): string {
  const { tokens } = ctx;
  return blk.text
    ? `<div class="blk-text">${esc(applyTokens(blk.text, tokens)).replace(/\n/g, '<br />')}</div>`
    : '';
}

function renderTwoCol(ctx: RenderContext, blk: Block): string {
  const { tokens } = ctx;
  return `<table class="two-col"><tr><td>${esc(applyTokens(blk.label || '', tokens))}</td><td class="r">${esc(
    applyTokens(blk.value || '', tokens)
  )}</td></tr></table>`;
}

function renderDivider(ctx: RenderContext, blk: Block): string {
  const v = blk.variant || 'solid';
  if (v === 'blank') return `<div class="spacer" style="height:1.5mm"></div>`;
  if (v === 'double') return `<div class="div-double"></div>`;
  if (v === 'dashed') return `<div class="line"></div>`;
  return `<div class="div-solid"></div>`;
}

function renderImage(ctx: RenderContext, blk: Block): string {
  return blk.src ? `<img class="blk-image" src="${esc(blk.src)}" alt="" onerror="this.style.display='none'" />` : '';
}

function renderBarcode(ctx: RenderContext, blk: Block): string {
  return ctx.assets[blk.id] ? `<img class="blk-image" src="${ctx.assets[blk.id]}" alt="" />` : '';
}

function renderSpacer(ctx: RenderContext, blk: Block): string {
  return `<div class="spacer" style="height:${Number(blk.heightMm ?? 3)}mm"></div>`;
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Renders a single block based on its type.
 * Returns empty string if block should be skipped (no content).
 */
function renderBlock(ctx: RenderContext, blk: Block): string {
  if (!blk.enabled) return '';

  let inner = '';

  switch (blk.type) {
    case 'logo':
      inner = renderLogo(ctx, blk);
      break;
    case 'shop_name':
      inner = renderShopName(ctx);
      break;
    case 'address':
      inner = renderAddress(ctx, blk);
      break;
    case 'phone_whatsapp':
      inner = renderPhoneWhatsApp(ctx, blk);
      break;
    case 'tax_no':
      inner = renderTaxNo(ctx, blk);
      break;
    case 'header_note':
      inner = renderHeaderNote(ctx, blk);
      break;
    case 'meta':
      inner = renderMeta(ctx);
      break;
    case 'items_table':
      inner = renderItemsTable(ctx);
      break;
    case 'totals':
      inner = renderTotals(ctx);
      break;
    case 'payment':
      inner = renderPayment(ctx);
      break;
    case 'qr':
      inner = renderQr(ctx, blk);
      break;
    case 'footer_note_1':
      inner = renderFooterNote1(ctx, blk);
      break;
    case 'footer_note_2':
      inner = renderFooterNote2(ctx, blk);
      break;
    case 'software_credit':
      inner = renderSoftwareCredit(ctx, blk);
      break;
    case 'return_banner':
      inner = renderReturnBanner(ctx, blk);
      break;
    case 'loyalty':
      inner = renderLoyalty(ctx, blk);
      break;
    case 'savings':
      inner = renderSavings(ctx, blk);
      break;
    case 'return_policy':
      inner = renderReturnPolicy(ctx, blk);
      break;
    case 'thank_you':
      inner = renderThankYou(ctx, blk);
      break;
    case 'fbr_qr':
      inner = renderFbrQr(ctx, blk);
      break;
    case 'banner':
      inner = renderBanner(ctx, blk);
      break;
    case 'text':
      inner = renderText(ctx, blk);
      break;
    case 'two_col':
      inner = renderTwoCol(ctx, blk);
      break;
    case 'divider':
      inner = renderDivider(ctx, blk);
      break;
    case 'image':
      inner = renderImage(ctx, blk);
      break;
    case 'barcode':
      inner = renderBarcode(ctx, blk);
      break;
    case 'spacer':
      inner = renderSpacer(ctx, blk);
      break;
    default:
      return '';
  }

  if (!inner) return '';

  const css = blockStyleCss(blk.style);
  return `<div class="blk"${css ? ` style="${css}"` : ''}>${inner}</div>`;
}

/**
 * Build CSS for the document
 */
function buildCss(ctx: RenderContext): string {
  const base = Number(ctx.design.global.baseFontSizePx || 13);
  const sz = (n: number) => (ctx.narrow ? n - 2 : n);
  const body = sz(base);
  const margin = ctx.design.global.marginMm ?? (ctx.sheet ? 8 : 4);
  const pageRule = ctx.sheet
    ? `@page { size: ${ctx.paperWidthMm}mm ${ctx.paperHeightMm}mm; margin: ${margin}mm; }`
    : `@page { size: ${ctx.paperWidthMm}mm auto; margin: 0; }`;
  const bodyRule = ctx.sheet
    ? `width: ${ctx.contentMm}mm; margin: 0 auto; padding: 0;`
    : `width: ${ctx.contentMm}mm; margin: 0 auto; padding: 1mm ${margin}mm 1.5mm;`;

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
.logo { max-width: 60mm; max-height: ${ctx.shop.logoMaxHeightPx || 64}px; display: block; margin: 0 auto 1mm; object-fit: contain;${ctx.shop.logoGrayscale !== false ? ' filter: grayscale(100%) contrast(140%); image-rendering: pixelated;' : ''} }
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
[dir="rtl"] { font-family: ${esc(ctx.urduFontFamily || '')}, Arial, sans-serif; direction: rtl; }
`;
}

/**
 * Main entry point: renders a document to HTML string.
 * This is the ONE renderer used by ALL outputs (preview, print, designer, etc.)
 *
 * @param docType - Document type (receipt, invoice, etc.)
 * @param sale - Sale data
 * @param design - Document design (template)
 * @param shop - Shop profile from settings
 * @param options - Additional options (paper, branchId, assets, duplicate)
 */
export function renderDocument(
  docType: DocumentType,
  sale: SaleData,
  design: DocumentDesign,
  shop: ShopProfile,
  options: {
    paper?: DocumentPaper;
    branchId?: string | number | null;
    assets?: Record<string, string>;
    duplicate?: boolean;
  } = {}
): string {
  const paper = options.paper || (design.paper as DocumentPaper);
  const sheet = paper === 'a4' || paper === 'a5';
  const narrow = paper === 'thermal58';
  const spec = { thermal80: 80, thermal58: 58, a4: 210, a5: 148 } as Record<DocumentPaper, number>;
  const widthMm = design.global.paperWidthMm && !sheet ? design.global.paperWidthMm : spec[paper];
  const heightMm = paper === 'a4' ? 297 : paper === 'a5' ? 210 : 0;
  const margin = design.global.marginMm ?? (sheet ? 8 : 4);
  const contentMm = sheet ? widthMm - 2 * margin : paper === 'thermal58' ? 48 : 72;

  // Build context
  const dateFormat = design.global.dateFormat || 'dd/mm/yyyy';
  const metaLabels: Record<string, string> = {
    customerLabel: design.global.metaLabels?.customerLabel ?? DEFAULT_META_LABELS.customerLabel,
    cashierLabel: design.global.metaLabels?.cashierLabel ?? DEFAULT_META_LABELS.cashierLabel,
    dateLabel: design.global.metaLabels?.dateLabel ?? DEFAULT_META_LABELS.dateLabel,
    timeLabel: design.global.metaLabels?.timeLabel ?? DEFAULT_META_LABELS.timeLabel,
    invoiceLabel: design.global.metaLabels?.invoiceLabel ?? DEFAULT_META_LABELS.invoiceLabel,
    subtotal: design.global.metaLabels?.subtotal ?? DEFAULT_META_LABELS.subtotal,
    discount: design.global.metaLabels?.discount ?? DEFAULT_META_LABELS.discount,
    tax: design.global.metaLabels?.tax ?? DEFAULT_META_LABELS.tax,
    serviceCharge: design.global.metaLabels?.serviceCharge ?? DEFAULT_META_LABELS.serviceCharge,
    freight: design.global.metaLabels?.freight ?? DEFAULT_META_LABELS.freight,
    netTotal: design.global.metaLabels?.netTotal ?? DEFAULT_META_LABELS.netTotal,
    paid: design.global.metaLabels?.paid ?? DEFAULT_META_LABELS.paid,
    change: design.global.metaLabels?.change ?? DEFAULT_META_LABELS.change,
    balance: design.global.metaLabels?.balance ?? DEFAULT_META_LABELS.balance,
    return: design.global.metaLabels?.return ?? DEFAULT_META_LABELS.return,
  };
  const columnLabels: Record<string, string> = {
    no: design.global.columnLabels?.no ?? DEFAULT_TABLE_COLUMN_LABELS.no,
    name: design.global.columnLabels?.name ?? DEFAULT_TABLE_COLUMN_LABELS.name,
    unit: design.global.columnLabels?.unit ?? DEFAULT_TABLE_COLUMN_LABELS.unit,
    qty: design.global.columnLabels?.qty ?? DEFAULT_TABLE_COLUMN_LABELS.qty,
    rate: design.global.columnLabels?.rate ?? DEFAULT_TABLE_COLUMN_LABELS.rate,
    disc: design.global.columnLabels?.disc ?? DEFAULT_TABLE_COLUMN_LABELS.disc,
    tax: design.global.columnLabels?.tax ?? DEFAULT_TABLE_COLUMN_LABELS.tax,
    amt: design.global.columnLabels?.amt ?? DEFAULT_TABLE_COLUMN_LABELS.amt,
  };

  const ctx: RenderContext = {
    sale,
    shop,
    design,
    paper,
    documentType: docType,
    branchId: options.branchId,
    assets: options.assets || {},
    duplicate: options.duplicate || false,
    money: makePlainMoney(design.global),
    currency: design.global.currencySymbol || shop.currency || 'Rs',
    narrow,
    sheet,
    paperWidthMm: widthMm,
    paperHeightMm: heightMm,
    contentMm,
    dateFormat,
    metaLabels,
    columnLabels,
    tokens: buildTokens({} as RenderContext), // Will be rebuilt below
    urduFontFamily: design.global.urduFontFamily || '',
  };

  // Rebuild tokens with proper context
  ctx.tokens = buildTokens(ctx);

  const body = ctx.design.sections
    .filter((b) => b.enabled)
    .map((blk) => renderBlock(ctx, blk))
    .filter(Boolean)
    .join('\n');

  // Reprint stamp always sits at the very top
  const stamp = ctx.duplicate ? '<div class="blk"><div class="duplicate-banner">DUPLICATE COPY</div></div>\n' : '';

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${docType}</title><style>${buildCss(ctx)}</style></head>
<body>${stamp}${body}</body></html>`;
}

/** Money formatter without currency symbol (for table cells) */
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