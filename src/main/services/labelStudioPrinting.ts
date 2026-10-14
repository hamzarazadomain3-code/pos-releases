/**
 * Label Studio printing — the main-process half of Phase 4.
 *
 * The renderer's Label Studio lets the owner build a per-element label
 * template (text/barcode/QR/line/rect … with mm coordinates). That template is
 * serialized over IPC as a plain object, so this module re-implements the
 * *layout* of a template in HTML rather than trying to ship renderer JS into
 * the print window. The static parts (geometry, barcode rasterisation) reuse
 * the same `printService` / `bwip-js` pipeline as the stock labels, so a
 * custom template prints through exactly the same measured page geometry the
 * rest of the app uses.
 *
 * All lengths are in mm/pt so the label is physically identical regardless of
 * the printer's DPI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  esc,
  getPrintSettings,
  toDataUrl,
  symbologyFor,
  isValidEan13,
  todayLabel,
  fmtExpiryDate,
  printCurrency,
} from './printDocs';
import { getProduct } from './inventory';
import {
  LABEL_SPECS,
  registerLabelSpec,
  getBarcodeDpi,
  printDocument,
  printJobToPdf,
  printJobToPng,
  type LabelLayout,
  type LabelSpec,
  type PrintJob,
  type PrintResult,
} from './printService';
import type { LabelProduct } from './labelTemplates';

// ── structural (mirror of the renderer's LabelStudio/types.ts) ───────────

interface StudioLabelElement {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  content?: string;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    align?: string;
    color?: string;
    fontWeight?: string;
    borderWidth?: number;
    borderColor?: string;
    borderStyle?: string;
    currency?: string;
    decimals?: number;
    unit?: string;
    dateFormat?: string;
    batchPrefix?: string;
    skuPrefix?: string;
    /** Shrink the text until it fits on one line (between minFontSize and fontSize). */
    autoShrink?: boolean;
    minFontSize?: number;
  };
  barcodeOptions?: {
    symbology?: string;
    height?: number;
    barWidth?: number;
    showText?: boolean;
    quietZone?: number;
    validateEan?: boolean;
  };
}

interface StudioLabelTemplate {
  id?: string;
  name?: string;
  size?: string | { w: number; h: number; gap: number; margins?: { t: number; r: number; b: number; l: number } };
  layout?: LabelLayout;
  rollCols?: number;
  sheetRows?: number;
  sheetCols?: number;
  /** 1-based cell the first label starts at (skip a half-used row). */
  startPos?: number;
  elements?: StudioLabelElement[];
  defaults?: { copies?: number; barcodeOnly?: boolean };
  /** Label-wide behaviour toggles (all optional, sane defaults). */
  options?: {
    autoShrinkName?: boolean;
    showApprox?: boolean;
    hideDatesWhenNoExpiry?: boolean;
    barcodeDpi?: number;
    border?: boolean;
  };
}

/** Per-print-run values chosen in the Print Run dialog. */
export interface LabelRunOptions {
  /** Overrides the product/purchase mfg date for the whole run. */
  mfgDate?: string | null;
  /** Overrides every product's expiry for the run. */
  expOverride?: string | null;
  /** Which price the {price} element prints. */
  priceSource?: 'retail' | 'wholesale' | 'custom';
  /** Price used when priceSource = 'custom'. */
  customPrice?: number | null;
  /** Overrides {weight} for the whole run. */
  weight?: string | null;
  /** 1-based column the first label starts at. */
  startCol?: number | null;
  /** Printer head resolution for barcode bar widths. */
  barcodeDpi?: number | null;
  /** Columns across the roll for this run (overrides the template). */
  rollCols?: number | null;
}

/** The fields a custom label actually substitutes into `{placeholders}`. */
interface LabelRowProduct extends LabelProduct {
  wholesale_price?: number | null;
  unit_symbol?: string | null;
  unit_name?: string | null;
  category_name?: string | null;
  net_weight?: string | null;
  is_loose?: number | null;
  mfg_date?: string | null;
  batch_no?: string | null;
  /** Product photo (data URL or path) so an image element can use `{image}`. */
  image?: string | null;
}

interface PrintOptions {
  printer?: string;
  xOffset?: number;
  yOffset?: number;
  mirror?: boolean;
  rotation?: number;
  template?: unknown;
  run?: LabelRunOptions;
}

// ── tiny helpers ─────────────────────────────────────────────────────────

function clampNum(v: unknown, lo: number, hi: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function isTemplate(v: unknown): v is StudioLabelTemplate {
  return !!v && typeof v === 'object' && Array.isArray((v as StudioLabelTemplate).elements);
}

/** Look a size key up against the shared spec table; never returns undefined. */
function specForSize(sizeKey: string): LabelSpec {
  const table = LABEL_SPECS as Record<string, LabelSpec>;
  return table[sizeKey] || table['38x25'];
}

/**
 * Resolve the physical spec for a template. Fixed stock sizes come straight
 * from `LABEL_SPECS`; an arbitrary "custom" size is registered once so the
 * shared geometry code can lay out a roll page for it.
 */
function resolveTemplateSpec(template: StudioLabelTemplate, sizeParam?: unknown): LabelSpec {
  const sizeObj = template.size && typeof template.size === 'object' ? template.size : null;
  const sizeKey =
    typeof template.size === 'string'
      ? template.size
      : typeof sizeParam === 'string' && sizeParam
        ? sizeParam
        : sizeObj
          ? `custom-${Math.round(clampNum(sizeObj.w, 10, 200))}x${Math.round(clampNum(sizeObj.h, 8, 200))}`
          : 'custom';
  const known = specForSize(sizeKey);
  if (sizeObj) {
    const w = clampNum(sizeObj.w, 10, 200);
    const h = clampNum(sizeObj.h, 8, 200);
    const gap = clampNum(sizeObj.gap, 0, 5);
    const spec: LabelSpec = {
      kind: sizeKey as LabelSpec['kind'],
      label: `Custom ${w} x ${h}mm`,
      w,
      h,
      sheetCols: Math.max(1, Math.floor((190 + gap) / (w + gap))),
      gap,
      barH: clampNum(Math.min(h - 4, w * 0.22), 4, 30),
      fontPt: clampNum(h * 0.24, 4, 16),
    };
    registerLabelSpec(spec);
    return spec;
  }
  return known;
}

/** Load products exactly like the stock label job, plus unit/image for overrides. */
function loadProducts(productIds: number[]): LabelRowProduct[] {
  const out: LabelRowProduct[] = [];
  for (const id of productIds) {
    const p = getProduct(id);
    if (!p) continue;
    out.push({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
      sale_price: p.sale_price,
      wholesale_price: p.wholesale_price ?? null,
      expiry_date: p.expiry_date ?? null,
      unit_symbol: (p as { unit_symbol?: string | null }).unit_symbol ?? null,
      unit_name: (p as { unit_name?: string | null }).unit_name ?? null,
      category_name: p.category_name ?? null,
      image: (p as { image?: string | null }).image ?? null,
      net_weight: p.net_weight ?? null,
      is_loose: p.is_loose ?? 0,
      mfg_date: p.mfg_date ?? null,
      batch_no: p.batch_no ?? null,
    });
  }
  return out;
}

/** Raster scale multiplier so a module lands on an integer number of head dots. */
function dpiScale(dpi: number | null | undefined): number {
  return Number(dpi) >= 300 ? 1.5 : 1;
}

const barCache = new Map<string, string>();

/**
 * Rasterise a linear barcode like the stock label path, honouring element options.
 *
 * `dpi` is the print head's resolution. bwip-js renders each module as `scale`
 * device pixels; at 300dpi a 203dpi `scale` yields too few pixels for the same
 * physical width, so the driver resamples and the bars come out soft. We scale
 * with the DPI and the caller displays the PNG at a fixed height with
 * `width:auto`, so the aspect ratio is preserved and the bars are never stretched.
 */
async function barcodeDataUrl(
  text: string,
  opts: StudioLabelElement['barcodeOptions'],
  dpi = 203
): Promise<string> {
  const requested = String(opts?.symbology || '').toLowerCase();
  const bcid = requested === 'ean13' && isValidEan13(text) ? 'ean13' : symbologyFor(text);
  const base = Math.round(clampNum(opts?.barWidth, 1, 4)) || 2;
  const scale = clampNum(Math.round(base * dpiScale(dpi)), 1, 8);
  const key = `${bcid}|${text}|${scale}|${opts?.quietZone ?? 1}`;
  const hit = barCache.get(key);
  if (hit !== undefined) return hit;
  const png = await toDataUrl({
    bcid,
    text,
    scale,
    height: 40,
    includetext: opts?.showText === true,
    paddingwidth: opts?.quietZone ?? 1,
    paddingheight: opts?.quietZone ?? 1,
  });
  barCache.set(key, png);
  return png;
}

const qrCache = new Map<string, string>();

async function qrDataUrl(text: string): Promise<string> {
  const hit = qrCache.get(text);
  if (hit !== undefined) return hit;
  const png = await toDataUrl({ bcid: 'qrcode', text, scale: 4, height: 40 });
  qrCache.set(text, png);
  return png;
}

/** Money just like the renderer's `formatMoney` but driven by the shop settings. */
function moneyFor(style: StudioLabelElement['style'], n: number): string {
  const currency = style?.currency || printCurrency();
  const setting = Number(getPrintSettings().decimal_places);
  let decimals = 2;
  if (typeof style?.decimals === 'number' && Number.isFinite(style.decimals)) {
    decimals = clampNum(style.decimals, 0, 4);
  } else if (Number.isFinite(setting)) {
    decimals = clampNum(setting, 0, 4);
  }
  return moneyWithDecimals(currency, n, decimals);
}

function moneyWithDecimals(currency: string, n: number, decimals: number): string {
  return `${currency} ${numberWithDecimals(n, decimals)}`;
}

/** The bare number (no currency prefix) — drives `{price_plain}`. */
function numberWithDecimals(n: number, decimals: number): string {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Decimal places for a label, from the element override then the shop setting. */
function decimalsFor(style: StudioLabelElement['style']): number {
  const setting = Number(getPrintSettings().decimal_places);
  if (typeof style?.decimals === 'number' && Number.isFinite(style.decimals)) {
    return clampNum(style.decimals, 0, 4);
  }
  return Number.isFinite(setting) ? clampNum(setting, 0, 4) : 2;
}

function plainMoney(style: StudioLabelElement['style'], n: number): string {
  return numberWithDecimals(n, decimalsFor(style));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Format a date for a label with a token pattern. Accepts an ISO `yyyy-mm-dd`
 * prefix (what the DB stores) or anything `Date` can parse. Unparseable input is
 * returned unchanged so a hand-typed value is never silently blanked.
 *
 * Tokens: yyyy, yy, mm (zero-padded month), m, dd (zero-padded day), d, M (short
 * month name). The default is `dd/mm/yyyy`.
 */
function formatDateToken(value: string | null | undefined, pattern?: string): string {
  const s = String(value || '').trim();
  if (!s) return '';
  let y: number;
  let mo: number;
  let d: number;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else {
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return s;
    y = dt.getFullYear();
    mo = dt.getMonth() + 1;
    d = dt.getDate();
  }
  return String(pattern || 'dd/mm/yyyy')
    .replace(/yyyy/g, String(y))
    .replace(/yy/g, String(y).slice(-2))
    .replace(/mm/g, pad2(mo))
    .replace(/dd/g, pad2(d))
    .replace(/M/g, MONTH_NAMES[mo - 1] || '')
    .replace(/m/g, String(mo))
    .replace(/d/g, String(d));
}

/** Price the `{price}` element prints, honouring the per-run price source. */
function priceValue(p: LabelRowProduct, run: LabelRunOptions | undefined): number {
  const src = run?.priceSource;
  if (src === 'wholesale') return Number(p.wholesale_price ?? p.sale_price ?? 0);
  if (src === 'custom' && typeof run?.customPrice === 'number' && Number.isFinite(run.customPrice)) {
    return Number(run.customPrice);
  }
  return Number(p.sale_price ?? 0);
}

/**
 * A product counts as loose if it is flagged, or if it is a scale/PLU item — its
 * barcode is exactly the 5-digit `1xxxx` PLU that `scaleBarcode.listPluMappings()`
 * recognises. A weighed item therefore gets the `±` marker even if nobody ticked
 * the box, while a plain barcode (EAN etc.) does not.
 */
const SCALE_PLU_RE = /^1\d{4}$/;
function isLoose(p: LabelRowProduct): boolean {
  return !!p.is_loose || SCALE_PLU_RE.test(String(p.barcode || '').trim());
}

/** The weight text for `{weight}` (with a `±` for loose items) and `{approx}`. */
function weightParts(
  p: LabelRowProduct,
  run: LabelRunOptions | undefined,
  options: StudioLabelTemplate['options'] | undefined
): { weight: string; approx: string } {
  const over = run?.weight != null ? String(run.weight).trim() : '';
  const value = over || String(p.net_weight || '').trim();
  const showApprox = options?.showApprox !== false;
  const approx = showApprox && isLoose(p) ? '\u00b1' : '';
  return { weight: value ? `${approx}${value}` : '', approx: value ? approx : '' };
}

/**
 * Replace `{placeholder}` / `{placeholder:arg}` tokens. Unknown names are left
 * intact (so a typo shows up on the label instead of vanishing), matching the
 * renderer preview.
 */
function replaceTokens(input: string, map: Record<string, (arg?: string) => string>): string {
  return String(input || '').replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\}/g, (whole, name: string, arg?: string) => {
    const fn = map[name];
    return fn ? fn(arg) : whole;
  });
}

interface ResolveCtx {
  shopName: string;
  unit: string;
  qty: number;
  options?: StudioLabelTemplate['options'];
  run?: LabelRunOptions;
}

/** Substitute every `{placeholder}` the renderer preview understands. */
function resolveContent(
  content: string,
  p: LabelRowProduct,
  ctx: ResolveCtx,
  style: StudioLabelElement['style']
): string {
  const { weight, approx } = weightParts(p, ctx.run, ctx.options);
  const mfgRaw = ctx.run?.mfgDate != null && String(ctx.run.mfgDate).trim() ? ctx.run.mfgDate : p.mfg_date;
  const expRaw =
    ctx.run?.expOverride != null && String(ctx.run.expOverride).trim()
      ? ctx.run.expOverride
      : p.expiry_date;
  const hideDates = ctx.options?.hideDatesWhenNoExpiry !== false && !String(expRaw || '').trim();
  return replaceTokens(content, {
    name: () => p.name || '',
    price: () => moneyFor(style, priceValue(p, ctx.run)),
    price_plain: () => plainMoney(style, priceValue(p, ctx.run)),
    sku: () => p.sku || '',
    barcode: () => p.barcode || p.sku || String(p.id),
    expiry: (arg) => (hideDates && !arg ? '' : formatDateToken(expRaw, arg || style?.dateFormat)),
    mfg: (arg) => formatDateToken(mfgRaw, arg || style?.dateFormat),
    date: (arg) => formatDateToken(new Date().toISOString().slice(0, 10), arg || style?.dateFormat),
    batch: () => p.batch_no || '',
    weight: () => weight,
    approx: () => approx,
    shop: () => ctx.shopName,
    category: () => p.category_name || '',
    qty: () => String(ctx.qty),
    unit: () => ctx.unit,
  });
}

const ALIGN_FLEX: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

/**
 * Allow only image sources that are safe in an `<img src>`: data: images,
 * http(s)/file URLs, and plain paths. Anything else (`javascript:`, `data:text/html`)
 * is rejected so a hand-edited template cannot smuggle a script payload.
 */
function safeImageSrc(src: string): string {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^data:image\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^file:\/\//i.test(s)) return s;
  if (/^[a-z]:[\\/]/i.test(s)) return s; // C:\photos\...
  if (/^[\\/]/.test(s)) return s; // /logo.png
  if (/^\.{1,2}[\\/]/.test(s)) return s; // ./assets/x.png
  if (/^[a-z0-9._-]+\.[a-z0-9]+$/i.test(s)) return s; // logo.png
  return '';
}

/** `{image}` binds to the product's own photo; an explicit URL/path wins otherwise. */
function resolveStudioImageSrc(content: string, productImage: string | null | undefined): string {
  let raw = String(content || '').trim();
  if (raw.includes('{image}')) raw = raw.split('{image}').join(productImage || '');
  else if (!raw) raw = productImage || '';
  return safeImageSrc(raw);
}

/** The expiry that will actually print: the run override wins over the product. */
function effectiveExpiry(p: LabelRowProduct, run: LabelRunOptions | undefined): string {
  if (run?.expOverride != null && String(run.expOverride).trim()) return String(run.expOverride).trim();
  return String(p.expiry_date || '').trim();
}

/** One absolutely positioned element inside a label cell. */
async function renderElement(
  el: StudioLabelElement,
  p: LabelRowProduct,
  ctx: ResolveCtx
): Promise<string> {
  if (el.visible === false) return '';
  const st = el.style || {};
  const x = clampNum(el.x, 0, 200);
  const y = clampNum(el.y, 0, 200);
  const w = clampNum(el.w, 1, 200);
  const h = clampNum(el.h, 1, 200);
  const pos = `left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;`;
  const rot = el.rotation ? `transform:rotate(${clampNum(el.rotation, 0, 360)}deg);transform-origin:center center;` : '';
  const common = [
    'position:absolute;',
    pos,
    'box-sizing:border-box;',
    'overflow:hidden;',
    'display:flex;',
    `font-family:${st.fontFamily || 'Segoe UI,Arial,sans-serif'};`,
    `font-size:${clampNum(st.fontSize, 2, 60) || 7}pt;`,
    `font-weight:${st.bold ? 700 : st.fontWeight || 'normal'};`,
    st.italic ? 'font-style:italic;' : '',
    st.color ? `color:${st.color};` : '',
    rot,
    'align-items:center;',
    `justify-content:${ALIGN_FLEX[st.align || 'center'] || 'center'};`,
    `text-align:${st.align || 'center'};`,
    'white-space:nowrap;',
    'text-overflow:ellipsis;',
  ].join('');

  const type = String(el.type || 'text');
  const text = p.barcode || p.sku || String(p.id);
  const content = String(el.content || '');

  // Date elements (or a line that interpolates `{expiry}`) are dropped when the
  // product has no expiry and the template asks for that.
  const datesHidden =
    ctx.options?.hideDatesWhenNoExpiry !== false && !effectiveExpiry(p, ctx.run);
  const isDateEl = type === 'mfg' || type === 'expiry' || type === 'date' || /\{(?:mfg|expiry|date)\b/.test(content);
  if (datesHidden && isDateEl) return '';

  const dpi = clampNum(ctx.run?.barcodeDpi, 100, 1200) || ctx.options?.barcodeDpi || getBarcodeDpi();

  if (type === 'barcode') {
    const opts = el.barcodeOptions || {};
    const png = await barcodeDataUrl(text, opts, dpi);
    if (!png) {
      return `<div data-el="${esc(el.id)}" style="${common}">${esc(text)}</div>`;
    }
    // Height is fixed and width is `auto` so the PNG's module aspect ratio (and
    // therefore the bar widths) is preserved — never stretched to the box.
    return `<div data-el="${esc(el.id)}" style="${common}"><img src="${png}" alt="" style="height:${clampNum(opts.height, 2, 60) || 8}mm;width:auto;max-width:100%;display:block;" /></div>`;
  }
  if (type === 'qr') {
    const png = await qrDataUrl(text);
    if (!png) return '';
    return `<div data-el="${esc(el.id)}" style="${common}"><img src="${png}" alt="" style="height:${h}mm;width:auto;max-width:100%;display:block;" /></div>`;
  }
  if (type === 'line') {
    return `<div data-el="${esc(el.id)}" style="${common}border-bottom:0.2mm solid #000;margin:0;border-radius:0;"></div>`;
  }
  if (type === 'rect' || type === 'border') {
    const bw = clampNum(st.borderWidth, 0.05, 5) || 0.2;
    const bc = st.borderColor || '#000';
    const bs = String(st.borderStyle || 'solid');
    return `<div data-el="${esc(el.id)}" style="${common}border:${bw}mm ${esc(bs)} ${esc(bc)};border-radius:0.5mm;background:transparent;"></div>`;
  }
  if (type === 'image') {
    // Prefer the element's own image (uploaded from the PC), else `{image}`,
    // else the product's photo. Nothing safe to show → render nothing.
    const src = resolveStudioImageSrc(el.content || '', p.image);
    if (!src) return '';
    return `<div data-el="${esc(el.id)}" style="${common}"><img src="${esc(src)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" /></div>`;
  }
  // text / custom-text / price / expiry / mfg / batch / weight / sku
  const resolved = resolveContent(content, p, ctx, st);
  const autoShrink =
    st.autoShrink === true ||
    (ctx.options?.autoShrinkName !== false && /\{name\}/.test(content));
  const shrinkAttrs = autoShrink
    ? ` data-shrink="1" data-min-pt="${clampNum(st.minFontSize, 2, 60) || 4}"`
    : '';
  return `<div data-el="${esc(el.id)}"${shrinkAttrs} style="${common}">${esc(resolved) || '&nbsp;'}</div>`;
}

// ── document builder ──────────────────────────────────────────────────────

/**
 * Build the HTML for a Label Studio template. Returns the same shape as the
 * stock `buildLabelBatchHtml` so every caller can hand it to `printService`.
 *
 * Rolls may be multi-across (2/3 labels side by side). Labels fill the grid
 * left-to-right; `startPos` skips the first N-1 cells so a half-used row can be
 * finished before a new one is begun. Name lines auto-shrink on one line.
 */
async function buildLabelBatchHtmlCustom(
  template: StudioLabelTemplate,
  products: LabelRowProduct[],
  copies: number,
  shopName: string,
  run?: LabelRunOptions
): Promise<{ html: string; count: number; cols: number; rows: number; startCol: number; size: LabelSpec }> {
  const spec = resolveTemplateSpec(template, undefined);
  const layout: LabelLayout = template.layout === 'sheet' ? 'sheet' : 'roll';
  const n = Math.max(1, Math.min(50, Math.floor(copies) || 1));
  const cells: LabelRowProduct[] = [];
  for (const p of products) for (let i = 0; i < n; i++) cells.push(p);

  const sheetCols = Math.max(1, Math.floor(template.sheetCols || spec.sheetCols));
  const rollCols = clampNum(run?.rollCols ?? template.rollCols, 1, 6) || 1;
  const cols = layout === 'sheet' ? sheetCols : rollCols;
  const startCol =
    layout === 'sheet' ? 1 : clampNum(run?.startCol ?? template.startPos, 1, cols) || 1;
  const fillers = Math.max(0, startCol - 1);
  const rows = Math.max(1, Math.ceil((fillers + cells.length) / cols));
  const gap = Number.isFinite(spec.gap) ? spec.gap : 0;

  const ctx: ResolveCtx = { shopName, unit: '', qty: 1, options: template.options, run };

  const cellHtml: string[] = [];
  for (let i = 0; i < fillers; i++) cellHtml.push('<div class="ls-fill"></div>');
  for (const p of cells) {
    const sel = products.find((x) => x.id === p.id) || p;
    ctx.unit = sel.unit_symbol || sel.unit_name || '';
    const els = await Promise.all((template.elements || []).map((el) => renderElement(el, p, ctx)));
    cellHtml.push(
      `<div class="ls-lab" style="width:${spec.w}mm;height:${spec.h}mm;${template.options?.border ? 'border:0.2mm solid #000;' : ''}">${els.join('')}</div>`
    );
  }

  // One grid drives both layouts. A roll adds a top pad of one gap so the page
  // height (`rows*(h+gap)+gap`, stamped by printService) matches the physical
  // label pitch. `justify-content:start` keeps a half-used row left-aligned.
  const css = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; }
.ls-sheet {
  display: grid;
  grid-template-columns: repeat(${cols}, ${spec.w}mm);
  grid-auto-rows: ${spec.h}mm;
  column-gap: ${gap}mm;
  row-gap: ${gap}mm;
  justify-content: start;
  ${layout === 'roll' ? `padding-top: ${gap}mm;` : ''}
}
.ls-lab { position: relative; page-break-inside: avoid; break-inside: avoid; overflow: hidden; width: ${spec.w}mm; height: ${spec.h}mm; }
.ls-fill { width: ${spec.w}mm; height: ${spec.h}mm; }
`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(template.name || 'Labels')}</title>
<style>${css}</style>
</head>
<body>
<div class="ls-sheet">${cellHtml.join('\n')}</div>
<script>${AUTOSHRINK_SCRIPT}</script>
</body>
</html>`;

  return { html, count: cells.length, cols, rows, startCol, size: spec };
}

/**
 * Client-side auto-shrink helper injected into every custom label page. It walks
 * each `[data-shrink]` element and drops the font-size (down to `data-min-pt`)
 * until the text fits on one line. The print window waits for the load event, so
 * the shrunk layout is what the driver actually rasterises.
 */
const AUTOSHRINK_SCRIPT = `(function () {
  var nodes = document.querySelectorAll('[data-shrink]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var floorPx = (parseFloat(el.getAttribute('data-min-pt')) || 4) * 1.3333;
    var size = parseFloat(getComputedStyle(el).fontSize) || 10;
    var guard = 0;
    while (el.scrollWidth > el.clientWidth + 0.5 && size > floorPx && guard < 240) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
      guard += 1;
    }
  }
})();`;

/** Assemble a PrintJob for a Label Studio template. */
async function buildCustomLabelJob(
  products: LabelRowProduct[],
  template: StudioLabelTemplate,
  copies: number,
  shopName: string,
  run?: LabelRunOptions
): Promise<PrintJob> {
  const batch = await buildLabelBatchHtmlCustom(template, products, copies, shopName, run);
  const layout: LabelLayout = template.layout === 'sheet' ? 'sheet' : 'roll';
  return {
    html: batch.html,
    paper: batch.size.kind as PrintJob['paper'],
    labelLayout: layout,
    labelRows: batch.rows,
    labelCols: batch.cols,
    labelStartPos: batch.startCol,
    printerKey: 'label',
    jobName: `${template.name || 'Labels'} x${batch.count}`,
  };
}

/**
 * Build the PrintJob for a Label Studio template without printing or exporting.
 * Public so the print smoke test can audit the exact same job the app prints.
 */
export async function buildLabelStudioJob(
  productIds: number[],
  template: unknown,
  size?: string,
  copies = 1,
  run?: LabelRunOptions
): Promise<PrintJob> {
  if (!isTemplate(template)) throw new Error('No label template supplied.');
  const products = loadProducts(productIds);
  if (products.length === 0) throw new Error('None of the selected products could be loaded.');
  const shopName = getPrintSettings().shop_name || '';
  return buildCustomLabelJob(products, template, copies, shopName, run);
}

/** Inject printer selection / offset / mirror / rotation into a job's HTML. */
function applyPrintOptions(job: PrintJob, o: PrintOptions): void {
  if (o.printer && o.printer !== 'auto') job.printerName = o.printer;
  const xo = clampNum(o.xOffset, -20, 20);
  const yo = clampNum(o.yOffset, -20, 20);
  const mirror = !!o.mirror;
  const rot = Math.round(clampNum(o.rotation, 0, 270) / 90) * 90;
  if (!xo && !yo && !mirror && !rot) return;
  const css: string[] = [];
  if (xo || yo) css.push(`body{margin-left:${xo}mm;margin-top:${yo}mm;}`);
  if (mirror || rot) {
    let t = '';
    if (mirror) t += 'scaleX(-1)';
    if (rot) t += ` rotate(${rot}deg)`;
    css.push(`body{transform:${t};transform-origin:center center;}`);
  }
  const style = `<style id="__pos-label-opts">${css.join('')}</style>`;
  job.html = /<\/head>/i.test(job.html) ? job.html.replace(/<\/head>/i, `${style}</head>`) : `${style}${job.html}`;
}

// ── public entry points (called by ipc.ts) ────────────────────────────────

/** Print the selected labels. When `options.template` is a real Label Studio
 *  template the per-element design is printed; otherwise the stock label
 *  layout is used (Inventory / Barcode Generator quick labels). */
export async function printBarcodeBatchWithOptions(
  productIds: number[],
  size?: string,
  copies = 1,
  options: PrintOptions = {}
): Promise<PrintResult> {
  try {
    let job: PrintJob;
    if (options.template && isTemplate(options.template)) {
      job = await buildLabelStudioJob(productIds, options.template, size, copies, options.run);
    } else {
      const { buildLabelJob } = await import('./printing');
      job = await buildLabelJob(productIds, size as Parameters<typeof buildLabelJob>[1], copies);
    }
    applyPrintOptions(job, options);
    return await printDocument(job);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Export a label batch to a single PDF. */
export async function exportLabelBatchToPDF(
  productIds: number[],
  template: unknown,
  size?: string,
  copies = 1,
  run?: LabelRunOptions
): Promise<{ ok: boolean; message: string; data?: Buffer }> {
  try {
    const job = await buildLabelStudioJob(productIds, template, size, copies, run);
    const { data } = await printJobToPdf(job);
    return { ok: true, message: 'PDF ready.', data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Export a label batch to a PNG image of the laid-out page. */
export async function exportLabelBatchToPNG(
  productIds: number[],
  template: unknown,
  size?: string,
  copies = 1,
  run?: LabelRunOptions
): Promise<{ ok: boolean; message: string; data?: Buffer }> {
  let file: string | undefined;
  try {
    const job = await buildLabelStudioJob(productIds, template, size, copies, run);
    file = path.join(os.tmpdir(), `rokar-label-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await printJobToPng(job, file);
    const data = fs.readFileSync(file);
    return { ok: true, message: 'PNG ready.', data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    if (file) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* scratch file already gone - fine */
      }
    }
  }
}

/**
 * The HTML for a label-sized calibration sheet (outline + mm ruler + guide
 * text). Exported so the print smoke test can audit the geometry.
 */
export function buildCalibrationLabelHtml(size?: string): string {
  const key = size && (LABEL_SPECS as Record<string, LabelSpec>)[size] ? size : '38x25';
  const spec = specForSize(key);
  const body: string[] = [];

  const ticks: string[] = [];
  const majorStep = spec.w >= 60 ? 10 : 5;
  for (let x = 0; x <= spec.w; x += 1) {
    const isMajor = x % majorStep === 0;
    const h = isMajor ? 2.6 : x % 5 === 0 ? 1.8 : 1;
    ticks.push(`<div style="position:absolute;left:${x}mm;top:0;width:0.15mm;height:${h}mm;background:#000;"></div>`);
    if (isMajor && x > 0) {
      ticks.push(`<div style="position:absolute;left:${x - 2}mm;top:2.8mm;font-size:2.4pt;">${x}</div>`);
    }
  }
  for (let y = 0; y <= spec.h; y += 1) {
    const isMajor = y % majorStep === 0;
    const hh = isMajor ? 2.6 : y % 5 === 0 ? 1.8 : 1;
    ticks.push(`<div style="position:absolute;left:0;top:${y}mm;height:0.15mm;width:${hh}mm;background:#000;"></div>`);
    if (isMajor && y > 0) {
      ticks.push(`<div style="position:absolute;left:2.8mm;top:${y - 1.4}mm;font-size:2.4pt;white-space:nowrap;">${y}</div>`);
    }
  }
  body.push(ticks.join('\n'));
  body.push(`<div style="position:absolute;left:3mm;top:3mm;font-size:${Math.min(6, spec.h * 0.22)}pt;font-weight:700;">TOP</div>`);
  body.push(`<div style="position:absolute;left:3.5mm;top:${spec.h / 2 - 2}mm;font-size:${Math.min(6, spec.h * 0.22)}pt;font-weight:700;">LEFT</div>`);
  body.push(`<div style="position:absolute;left:${spec.w - 14}mm;top:${spec.h - 6}mm;font-size:3.5pt;">${spec.w} x ${spec.h} mm</div>`);
  body.push(`<div style="position:absolute;left:${(spec.w - 8) / 2}mm;top:${(spec.h - 4) / 2}mm;width:8mm;height:4mm;border:0.2mm solid #000;display:flex;align-items:center;justify-content:center;text-align:center;font-size:2.6pt;">CENTER</div>`);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Calibration ${spec.w} x ${spec.h}</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${spec.w}mm; height: ${spec.h + 2}mm; font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; }
.cal { position: relative; width: ${spec.w}mm; height: ${spec.h}mm; border: 0.3mm solid #000; }
</style>
</head>
<body>
<div class="cal">${body.join('\n')}</div>
</body>
</html>`;
}

/** One label-sized calibration sheet — prints through the normal pipeline. */
export async function printCalibrationLabel(size?: string): Promise<PrintResult> {
  try {
    const key = size && (LABEL_SPECS as Record<string, LabelSpec>)[size] ? size : '38x25';
    return await printDocument({
      html: buildCalibrationLabelHtml(key),
      paper: key as PrintJob['paper'],
      labelLayout: 'roll',
      labelRows: 1,
      printerKey: 'label',
      jobName: 'Label calibration sheet',
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}