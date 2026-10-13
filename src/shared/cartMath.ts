import type { Product, ProductUnit, ResolvedPromotion } from './types';

/**
 * Pure cart maths shared by the Billing screen and its tests.
 *
 * Hold/Resume round-trips a cart through the database as JSON, so EVERY field
 * the cart renders (name, prices, units, stock) must be serialized, and every
 * numeric must be coerced back to a finite number on the way in. Before this
 * module existed, `doHold()` persisted only a subset of the line (no `name`,
 * `retail_price`, `wholesale_price`, `cost_price`) and `resume()` restored it
 * verbatim — so the cart rendered an empty price box and NaN totals.
 */

export interface CartLine {
  product_id: number;
  name: string;
  qty: number;
  price: number;
  retail_price: number;
  wholesale_price: number | null;
  cost_price: number;
  line_discount: number;
  tax_rate: number;
  expired: boolean;
  shelf_location: string | null;
  stock_qty: number;
  units: ProductUnit[];
  selected_unit_level: number;
  box_qty?: number;
  // BayLan Label Scale integration
  scale_plu?: string;
  scale_price?: number;
  scale_weight_g?: number;
  scale_weight_kg?: number;
  // Optional unit display fields (for multi-unit products)
  unit_name?: string | null;
  display_qty?: number | null;
  // Enhancement: Item notes
  note?: string;
  // Enhancement: Pinned/favorite
  isPinned?: boolean;
}

/** Coerce anything to a finite number: a single guard so no field can yield NaN. */
export function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isExpiredDate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00').getTime() < today.getTime();
}

export function lineTotals(
  items: CartLine[],
  billDiscount: number,
  discountType: 'amount' | 'percent',
  promos: Record<number, ResolvedPromotion>
) {
  let subtotal = 0;
  let tax = 0;
  let promoSavings = 0;
  for (const it of items) {
    const promo = promos[it.product_id];
    const qty = safeNum(it.qty);
    const basePrice = safeNum(it.price);
    const unit = promo ? safeNum(promo.effective_price, basePrice) : basePrice;
    const taxable = unit * qty - safeNum(it.line_discount);
    subtotal += taxable;
    tax += (taxable * safeNum(it.tax_rate)) / 100;
    if (promo) promoSavings += (basePrice - unit) * qty;
  }
  const gross = safeNum(subtotal) + safeNum(tax);
  const discount = discountType === 'percent'
    ? (gross * safeNum(billDiscount)) / 100
    : Math.min(safeNum(billDiscount), gross);
  const total = Math.max(0, gross - discount);
  return { subtotal: gross, tax, discount, total, promoSavings };
}

/** Payload persisted for one held line — the FULL cart line, nothing dropped. */
export function serializeCartLine(line: CartLine): CartLine {
  return {
    product_id: safeNum(line.product_id),
    name: line.name,
    qty: safeNum(line.qty, 1),
    price: safeNum(line.price),
    retail_price: safeNum(line.retail_price),
    wholesale_price: line.wholesale_price == null ? null : safeNum(line.wholesale_price),
    cost_price: safeNum(line.cost_price),
    line_discount: safeNum(line.line_discount),
    tax_rate: safeNum(line.tax_rate),
    expired: !!line.expired,
    shelf_location: line.shelf_location ?? null,
    stock_qty: safeNum(line.stock_qty),
    units: Array.isArray(line.units) ? line.units : [],
    selected_unit_level: safeNum(line.selected_unit_level),
    box_qty: line.box_qty,
    scale_plu: line.scale_plu,
    scale_price: line.scale_price == null ? undefined : safeNum(line.scale_price),
    scale_weight_g: line.scale_weight_g == null ? undefined : safeNum(line.scale_weight_g),
    scale_weight_kg: line.scale_weight_kg == null ? undefined : safeNum(line.scale_weight_kg),
    unit_name: line.unit_name ?? null,
    display_qty: line.display_qty ?? null,
    note: line.note,
    isPinned: line.isPinned,
  };
}

/**
 * Rebuild a cart line on resume.
 *
 * Prefer the saved values (the actual held state, including any manual price
 * edit); fall back to the CURRENT product data for anything the held payload is
 * missing (bills held before the full line was saved). Name / unit list / stock
 * are refreshed from the product so the row always renders correctly, and every
 * numeric passes through `safeNum`.
 */
export function rehydrateCartLine(
  saved: Partial<CartLine> | null | undefined,
  product?: Product | null,
  priceMode: 'retail' | 'wholesale' = 'retail',
): CartLine {
  const s = saved ?? {};
  const productUnits = Array.isArray(product?.units) ? product.units : [];
  const savedUnits = Array.isArray(s.units) ? s.units : [];
  const units: ProductUnit[] = productUnits.length ? productUnits : savedUnits;

  const retailPrice = s.retail_price != null ? safeNum(s.retail_price) : safeNum(product?.sale_price);
  const wholesaleRaw = s.wholesale_price !== undefined ? s.wholesale_price : product?.wholesale_price;
  const wholesalePrice = wholesaleRaw == null ? null : safeNum(wholesaleRaw);
  const fallbackPrice =
    priceMode === 'wholesale' && wholesalePrice != null ? wholesalePrice : retailPrice;

  return {
    product_id: safeNum(s.product_id ?? product?.id),
    name: s.name ?? product?.name ?? '(unknown product)',
    qty: safeNum(s.qty, 1) || 1,
    price: s.price != null ? safeNum(s.price) : fallbackPrice,
    retail_price: retailPrice,
    wholesale_price: wholesalePrice,
    cost_price: s.cost_price != null ? safeNum(s.cost_price) : safeNum(product?.cost_price),
    line_discount: safeNum(s.line_discount),
    tax_rate: s.tax_rate != null ? safeNum(s.tax_rate) : safeNum(product?.tax_rate),
    expired: s.expired ?? isExpiredDate(product?.expiry_date ?? null),
    shelf_location: s.shelf_location ?? product?.shelf_location ?? null,
    stock_qty: s.stock_qty != null ? safeNum(s.stock_qty) : safeNum(product?.stock_qty),
    units,
    selected_unit_level: safeNum(s.selected_unit_level),
    box_qty: s.box_qty,
    scale_plu: s.scale_plu,
    scale_price: s.scale_price == null ? undefined : safeNum(s.scale_price),
    scale_weight_g: s.scale_weight_g == null ? undefined : safeNum(s.scale_weight_g),
    scale_weight_kg: s.scale_weight_kg == null ? undefined : safeNum(s.scale_weight_kg),
    unit_name: s.unit_name ?? product?.unit_name ?? null,
    display_qty: s.display_qty ?? null,
    note: s.note,
    isPinned: s.isPinned,
  };
}

/**
 * Rehydrate every line of a held bill. Old bills missing fields resume through
 * the same path — `product_id` is enough to look the product back up.
 */
export function rehydrateCartLines(
  savedItems: unknown,
  products: Product[],
  priceMode: 'retail' | 'wholesale' = 'retail',
): CartLine[] {
  const list = Array.isArray(savedItems) ? (savedItems as Partial<CartLine>[]) : [];
  const byId = new Map<number, Product>();
  for (const p of products) byId.set(p.id, p);
  return list.map((s) => rehydrateCartLine(s, byId.get(safeNum(s?.product_id)) ?? null, priceMode));
}
