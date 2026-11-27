/**
 * THE unit conversion rule — one rule, one place (Phase 1, item 1.13).
 *
 * The stock is always kept in BASE units (the piece, the kilogram, the gram).
 * A pack ("a box of 12") is only ever a multiplier on the way in and out:
 *
 *   baseQty      = packQty × quantity_in_base_units
 *   costPerBase  = packUnitCost ÷ quantity_in_base_units
 *
 * Before Phase 1 the conversion lived in `purchaseCalc.ts` (rounded to FOUR
 * decimals) while the stock itself is rounded to THREE (`inventory.roundStock`),
 * so a batch quantity and `products.stock_qty` could drift apart by 0.0001 and
 * the FIFO report could show a different number from the screen. Both now go
 * through this module.
 */

/** The stock precision of the whole app: three decimals (0.001 kg = 1 gram). */
export const QTY_DECIMALS = 3;

/** Round a quantity to the app's stock precision. */
export function roundQty(qty: number | null | undefined, decimals = QTY_DECIMALS): number {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/**
 * The multiplier of a selling unit. A missing, zero or broken factor means
 * "1 base unit" — never zero (a zero factor would silently destroy stock).
 */
export function unitsInBase(units: number | null | undefined): number {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

/** The stock quantity a pack quantity represents, in base units. */
export function baseQty(qty: number, units: number | null | undefined): number {
  return roundQty(Number(qty) * unitsInBase(units));
}

/** The cost of ONE base unit, from the cost of one selling unit. */
export function costPerBaseUnit(unitCost: number, units: number | null | undefined): number {
  const c = Number(unitCost);
  const safeCost = Number.isFinite(c) ? c : 0;
  const u = unitsInBase(units);
  const out = u > 0 ? safeCost / u : safeCost;
  return Math.round(out * 10000) / 10000;
}

/** The price of ONE base unit, from the price of one selling unit. */
export function priceInBase(price: number, units: number | null | undefined): number {
  const p = Number(price);
  const safePrice = Number.isFinite(p) ? p : 0;
  const u = unitsInBase(units);
  const out = u > 0 ? safePrice / u : safePrice;
  return Math.round(out * 10000) / 10000;
}

/** A selling-unit quantity expressed in base units. */
export function qtyInBase(qty: number, units: number | null | undefined): number {
  return baseQty(qty, units);
}

/** A base-unit quantity expressed in the selling unit. */
export function qtyInSellingUnit(qty: number, units: number | null | undefined): number {
  const u = unitsInBase(units);
  return roundQty(Number(qty) / u);
}
