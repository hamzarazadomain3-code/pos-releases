/**
 * Renderer-side mirror of the main process's label token resolver.
 *
 * The preview and the printed label must substitute `{placeholders}` the same
 * way, so the logic here (weight ±, price source, date format tokens, hiding the
 * Mfg/Exp line when a product has no expiry) matches
 * `src/main/services/labelStudioPrinting.ts` deliberately. Keep the two in sync.
 */
import type { Product } from '@shared/types';
import { formatMoney } from '@utils/currency';
import type { LabelRunOptions, LabelTemplateOptions, ProductOverride } from './types';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Format a date with a token pattern. Accepts ISO `yyyy-mm-dd` (what the DB
 * stores) or anything `Date` can parse; unparseable input is returned unchanged.
 * Tokens: yyyy, yy, mm, m, dd, d, M (short month name). Default `dd/mm/yyyy`.
 */
export function formatDateToken(value: string | null | undefined, pattern?: string): string {
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

/** The expiry that will actually print: the run override wins over the product. */
export function effectiveExpiry(p: Product, run?: LabelRunOptions): string {
  if (run?.expOverride != null && String(run.expOverride).trim()) return String(run.expOverride).trim();
  return String(p.expiry_date || '').trim();
}

/** Price the `{price}` element prints, honouring the per-run price source. */
export function priceValue(p: Product, run?: LabelRunOptions): number {
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
 * recognises. Mirrors the same rule in `src/main/services/labelStudioPrinting.ts`.
 */
const SCALE_PLU_RE = /^1\d{4}$/;
export function isLooseProduct(p: { is_loose?: number | boolean | null; barcode?: string | null }): boolean {
  return !!p.is_loose || SCALE_PLU_RE.test(String(p.barcode || '').trim());
}

/** The weight text for `{weight}` (with a `±` for loose items) and `{approx}`. */
export function weightParts(
  p: Product,
  run?: LabelRunOptions,
  options?: LabelTemplateOptions
): { weight: string; approx: string } {
  const over = run?.weight != null ? String(run.weight).trim() : '';
  const value = over || String(p.net_weight || '').trim();
  const showApprox = options?.showApprox !== false;
  const approx = showApprox && isLooseProduct(p) ? '\u00b1' : '';
  return { weight: value ? `${approx}${value}` : '', approx: value ? approx : '' };
}

/** Replace `{placeholder}` / `{placeholder:arg}`; unknown names are left intact. */
export function replaceTokens(input: string, map: Record<string, (arg?: string) => string>): string {
  return String(input || '').replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\}/g, (whole, name: string, arg?: string) => {
    const fn = map[name];
    return fn ? fn(arg) : whole;
  });
}

export interface ResolveCtx {
  shopName: string;
  qty: number;
  override?: ProductOverride;
  options?: LabelTemplateOptions;
  run?: LabelRunOptions;
}

/** The bare number (no currency prefix) — drives `{price_plain}`. */
function pricePlain(p: Product, run?: LabelRunOptions, override?: ProductOverride): string {
  const text = formatMoney(override?.price ?? priceValue(p, run));
  return text.replace(/^[^\d-]*/, '');
}

/** Substitute every `{placeholder}` in an element's content for the preview. */
export function resolveLabelContent(content: string, p: Product, ctx: ResolveCtx): string {
  const { weight, approx } = weightParts(p, ctx.run, ctx.options);
  const expRaw = ctx.override?.expiry || effectiveExpiry(p, ctx.run);
  const mfgRaw = (ctx.run?.mfgDate && String(ctx.run.mfgDate).trim()) || p.mfg_date || '';
  const hideDates = ctx.options?.hideDatesWhenNoExpiry !== false && !String(expRaw || '').trim();
  return replaceTokens(content, {
    name: () => ctx.override?.name || p.name || '',
    price: () => formatMoney(ctx.override?.price ?? priceValue(p, ctx.run)),
    price_plain: () => pricePlain(p, ctx.run, ctx.override),
    sku: () => p.sku || '',
    barcode: () => p.barcode || p.sku || String(p.id),
    expiry: (arg) => (hideDates && !arg ? '' : formatDateToken(expRaw, arg || 'dd/mm/yyyy')),
    mfg: (arg) => formatDateToken(mfgRaw, arg || 'dd/mm/yyyy'),
    date: (arg) => formatDateToken(new Date().toISOString().slice(0, 10), arg || 'dd/mm/yyyy'),
    batch: () => p.batch_no || '',
    weight: () => weight,
    approx: () => approx,
    shop: () => ctx.shopName,
    category: () => p.category_name || '',
    image: () => (p as { image?: string | null }).image || '',
    qty: () => String(ctx.override?.qty ?? ctx.qty ?? 1),
    unit: () => (p as { unit_symbol?: string | null; unit_name?: string | null }).unit_symbol || (p as { unit_name?: string | null }).unit_name || '',
  });
}
