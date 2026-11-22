/**
 * Pure purchase-order maths — ONE source of truth for every number the
 * Purchase Order screen and the purchase service show.
 *
 * Why a pure module: the renderer (the PO modal), the main process (the
 * purchase service, the import path) and the tests must all agree to the cent.
 * A second copy of "qty × cost" is how a PO ends up with a total that does not
 * match the invoice the supplier sends.
 *
 * Rules that are NOT negotiable:
 *   - every amount is rounded to 2 decimals (money), never NaN, never Infinity;
 *   - a missing / junk / negative quantity is 0, not NaN;
 *   - the line maths is the SAME maths the legacy import already used
 *     (gross → line discount → tax on the discounted amount), so an imported
 *     invoice and a hand-made PO total identically;
 *   - the unit conversion is a SNAPSHOT: an order keeps the multiplier it was
 *     created with, so a later change to the product's pack size never
 *     rewrites the history.
 */

import type { ProductUnit } from './types';

/* ── money-safe numbers ─────────────────────────────────────────────────── */

/** A finite number, or `fallback` when the input is junk. Never NaN. */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 2 decimals — the money precision the whole app uses. */
export function round2(value: unknown): number {
  const n = safeNumber(value, 0);
  return Math.round(n * 100) / 100;
}

/** Round to 4 decimals — the precision the cost-per-unit maths needs. */
export function round4(value: unknown): number {
  const n = safeNumber(value, 0);
  return Math.round(n * 10000) / 10000;
}

/* ── units ──────────────────────────────────────────────────────────────── */

/**
 * The purchase units of a product: the pack / box / carton rows.
 *
 * The BASE unit (the piece / kg) is always available as the fallback, so a
 * product without any pack rows still has exactly one choice.
 */
export function purchaseUnits(units: ProductUnit[] | null | undefined): ProductUnit[] {
  const list = Array.isArray(units) ? units.filter((u) => u && Number(u.quantity_in_base_units) > 0) : [];
  const packs = list
    .filter((u) => !u.is_base && Number(u.quantity_in_base_units) > 1)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  const base = list.find((u) => u.is_base) ?? list[0];
  if (!base) return [];
  return [...packs, base];
}

/** How many base units one purchase unit holds. 1 when unknown. */
export function unitsInBase(units: number | null | undefined): number {
  const n = safeNumber(units, 1);
  return n > 0 ? n : 1;
}

/** The quantity in BASE units (the unit the stock is kept in). */
export function baseQty(qty: number, units: number | null | undefined): number {
  return round4(safeNumber(qty, 0) * unitsInBase(units));
}

/** The cost of ONE base unit (what the stock is really worth). */
export function costPerBaseUnit(unitCost: number, units: number | null | undefined): number {
  const c = safeNumber(unitCost, 0);
  const u = unitsInBase(units);
  return round4(u > 0 ? c / u : c);
}

/* ── one line ───────────────────────────────────────────────────────────── */

export interface PoLine {
  /** The quantity in the PURCHASE unit (what the user types: "2 box"). */
  qty: number;
  /** The cost of ONE purchase unit. */
  unit_cost: number;
  /** How many base units one purchase unit holds (1 = the base unit). */
  units_in_base?: number | null;
  /** The line discount, in percent. */
  discount_pct?: number | null;
  /** The line tax, in percent. */
  tax_pct?: number | null;
}

export interface PoLineMoney {
  qty: number;
  baseQty: number;
  /** qty × unit_cost, before any discount or tax. */
  gross: number;
  /** The line discount in money. */
  discount: number;
  /** gross − discount. */
  net: number;
  /** The line tax in money. */
  tax: number;
  /** net + tax — what the line adds to the order. */
  total: number;
  /** The unit cost of one base unit. */
  costPerBase: number;
}

/**
 * The money of one line.
 *
 * The order of the operations matters and is the legacy order:
 *   gross → line discount → tax on the DISCOUNTED amount.
 */
export function lineMoney(line: PoLine): PoLineMoney {
  const qty = safeNumber(line?.qty, 0);
  const unitCost = safeNumber(line?.unit_cost, 0);
  const units = unitsInBase(line?.units_in_base);
  const gross = round2(qty * unitCost);
  const discount = round2(gross * (safeNumber(line?.discount_pct, 0) / 100));
  const net = round2(gross - discount);
  const tax = round2(net * (safeNumber(line?.tax_pct, 0) / 100));
  return {
    qty,
    baseQty: baseQty(qty, units),
    gross,
    discount,
    net,
    tax,
    total: round2(net + tax),
    costPerBase: costPerBaseUnit(unitCost, units),
  };
}

/**
 * The total of one line — the number the legacy `purchaseLineTotal` returned.
 * Kept as its own export so the service can reuse it instead of repeating
 * the maths.
 */
export function lineTotal(line: PoLine): number {
  return lineMoney(line).total;
}

/* ── the suggested quantity ─────────────────────────────────────────────── */

export interface SuggestedQtyInput {
  /** The stock the shop has right now. */
  stock_qty?: number | null;
  /** The reorder level (products.min_stock_level). */
  min_stock_level?: number | null;
  /** The legacy threshold (products.low_stock_threshold). */
  low_stock_threshold?: number | null;
  /** How much to order when the product is low (products.reorder_qty). */
  reorder_qty?: number | null;
  /** The stock ceiling, when the shop uses one. */
  max_stock_level?: number | null;
}

/** The reorder level of a product: the new column first, the legacy one next. */
export function minStockLevel(input: SuggestedQtyInput): number {
  const modern = safeNumber(input?.min_stock_level, 0);
  if (modern > 0) return modern;
  return Math.max(0, safeNumber(input?.low_stock_threshold, 0));
}

/**
 * How much to order.
 *
 *   1. the product's own reorder qty, when it has one;
 *   2. otherwise the gap to the stock ceiling;
 *   3. otherwise the gap to the reorder level.
 *
 * 0 means "no suggestion" — the caller decides what to do with that (the PO
 * row stays empty; the low-stock list falls back to 1).
 */
export function suggestedQty(input: SuggestedQtyInput): number {
  const stock = safeNumber(input?.stock_qty, 0);
  const reorder = safeNumber(input?.reorder_qty, 0);
  if (reorder > 0) return round4(reorder);
  const max = safeNumber(input?.max_stock_level, 0);
  if (max > 0) return round4(Math.max(0, max - stock));
  const min = minStockLevel(input);
  if (min > 0) return round4(Math.max(0, min - stock));
  return 0;
}

/** True when the product is at (or under) its reorder level. */
export function isLowStock(input: SuggestedQtyInput): boolean {
  const min = minStockLevel(input);
  if (min <= 0) return false;
  return safeNumber(input?.stock_qty, 0) <= min;
}

/* ── the cost-change warning ────────────────────────────────────────────── */

export interface CostChange {
  oldCost: number;
  newCost: number;
  /** The change in percent, signed (+ = more expensive). */
  pct: number;
  /** True when the change is bigger than the threshold. */
  warn: boolean;
}

/**
 * How much the unit cost moved, and whether that is worth a warning.
 *
 * The baseline is the LAST purchase cost when there is one, else the product's
 * own `cost_price`. A baseline of 0 has no meaningful percentage — nothing is
 * warned, because every cost would look like an infinite increase.
 */
export function costChange(oldCost: number, newCost: number, thresholdPct = 10): CostChange {
  const oldC = round2(oldCost);
  const newC = round2(newCost);
  const base = Math.abs(oldC);
  const pct = base > 0 ? round2(((newC - oldC) * 100) / base) : 0;
  const limit = Math.abs(safeNumber(thresholdPct, 10));
  return { oldCost: oldC, newCost: newC, pct, warn: base > 0 && Math.abs(pct) > limit };
}

/* ── the margin ─────────────────────────────────────────────────────────── */

/**
 * The margin %, with the shop's EXISTING rule: the markup on the cost.
 *
 * This is the same maths as the reports service (`margin_pct_retail`:
 * `(sale_price - cost_price) * 100 / cost_price`), so the PO screen and the
 * Below-Cost report can never disagree.
 */
export function marginPct(salePrice: number, cost: number): number {
  const sale = safeNumber(salePrice, 0);
  const c = safeNumber(cost, 0);
  if (c <= 0) return 0;
  return round2(((sale - c) * 100) / c);
}

/** True when the sale price is under the cost — the price floor case. */
export function belowCost(salePrice: number, cost: number): boolean {
  return safeNumber(salePrice, 0) < safeNumber(cost, 0);
}

/**
 * The sale price that keeps the CURRENT margin after the cost changed.
 *
 * It is a SUGGESTION only — the caller must ask the owner before writing it.
 */
export function suggestedSalePrice(salePrice: number, oldCost: number, newCost: number): number {
  const currentMargin = marginPct(salePrice, oldCost);
  const base = safeNumber(newCost, 0);
  if (base <= 0) return round2(safeNumber(salePrice, 0));
  return round2(base * (1 + currentMargin / 100));
}

/* ── the header totals ──────────────────────────────────────────────────── */

export type DiscountType = 'amount' | 'percent';

export interface PoTotalsInput {
  lines: PoLine[];
  /** A discount on the whole order. */
  discount_type?: DiscountType | null;
  /** The discount value: an amount, or a percent when the type is `percent`. */
  discount_value?: number | null;
  /** Freight / other charges. */
  freight?: number | null;
  /** What was paid right now (cash or bank). */
  paid_amount?: number | null;
}

export interface PoTotals {
  /** The sum of the line gross amounts (before any discount or tax). */
  subtotal: number;
  /** The sum of the LINE discounts. */
  lineDiscount: number;
  /** The order-level discount, in money. */
  discount: number;
  /** The sum of the line taxes. */
  tax: number;
  freight: number;
  /** subtotal − line discounts − order discount + tax + freight. */
  grandTotal: number;
  paid: number;
  /** What is still owed. Never negative. */
  payable: number;
}

/**
 * The totals of the order.
 *
 * `grandTotal` is never below 0 and `payable` is never below 0: an overpaid
 * order shows 0 payable, never a negative number the shop would have to
 * "take back".
 */
export function computeTotals(input: PoTotalsInput): PoTotals {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  let subtotal = 0;
  let lineDiscount = 0;
  let tax = 0;
  for (const l of lines) {
    const m = lineMoney(l);
    subtotal = round2(subtotal + m.gross);
    lineDiscount = round2(lineDiscount + m.discount);
    tax = round2(tax + m.tax);
  }
  const type: DiscountType = input?.discount_type === 'percent' ? 'percent' : 'amount';
  const value = safeNumber(input?.discount_value, 0);
  const discount = type === 'percent' ? round2((subtotal * value) / 100) : round2(value);
  const freight = round2(input?.freight);
  const grandTotal = Math.max(0, round2(subtotal - lineDiscount - discount + tax + freight));
  const paid = Math.max(0, round2(input?.paid_amount));
  const payable = Math.max(0, round2(grandTotal - paid));
  return { subtotal, lineDiscount, discount, tax, freight, grandTotal, paid, payable };
}

/* ── receiving ──────────────────────────────────────────────────────────── */

/** What is still open on a line after a (partial) receipt. */
export function remainingQty(ordered: number, received: number | null | undefined): number {
  const o = safeNumber(ordered, 0);
  const r = safeNumber(received, 0);
  return Math.max(0, round4(o - r));
}

/**
 * How much of each line is still open — the numbers the Receive dialog and
 * the status chips show.
 */
export function remainingByLine(
  lines: { product_id: number; qty: number; received_qty?: number | null }[]
): { product_id: number; ordered: number; received: number; remaining: number }[] {
  return (Array.isArray(lines) ? lines : []).map((l) => {
    const ordered = safeNumber(l?.qty, 0);
    const received = safeNumber(l?.received_qty, 0);
    return { product_id: l?.product_id, ordered, received, remaining: remainingQty(ordered, received) };
  });
}

/* ── the validation ─────────────────────────────────────────────────────── */

export type PoValidationError =
  | 'no_supplier'
  | 'no_lines'
  | 'qty_not_positive'
  | 'cost_negative'
  | 'nan'
  | 'duplicate_product'
  | 'paid_exceeds_total';

export interface PoValidationInput {
  supplierId?: number | null;
  lines: { product_id: number; qty: number; unit_cost: number }[];
  totals?: PoTotals;
}

export interface PoValidation {
  ok: boolean;
  /** Every reason the order cannot be created — the UI shows ALL of them. */
  errors: PoValidationError[];
  /** A ready-to-show sentence per error. */
  messages: string[];
  /** The products that appear twice. */
  duplicateProductIds: number[];
}

const VALIDATION_MESSAGES: Record<PoValidationError, string> = {
  no_supplier: 'Select a supplier.',
  no_lines: 'Add at least one item.',
  qty_not_positive: 'Every item needs a quantity greater than 0.',
  cost_negative: 'A unit cost cannot be negative.',
  nan: 'An amount is not a valid number.',
  duplicate_product: 'The same product is in the list twice — merge the lines.',
  paid_exceeds_total: 'The paid amount is more than the order total.',
};

/**
 * Everything that stops the order from being created.
 *
 * The UI disables Create while this is not ok AND shows the reason, so the
 * owner is never left guessing why a button does nothing.
 */
export function validatePo(input: PoValidationInput): PoValidation {
  const errors: PoValidationError[] = [];
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const supplierId = safeNumber(input?.supplierId, 0);
  if (supplierId <= 0) errors.push('no_supplier');
  if (lines.length === 0) errors.push('no_lines');

  let hasNaN = false;
  let hasBadQty = false;
  let hasBadCost = false;
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const l of lines) {
    const qty = Number(l?.qty);
    const cost = Number(l?.unit_cost);
    if (!Number.isFinite(qty) || !Number.isFinite(cost)) hasNaN = true;
    else {
      if (!(qty > 0)) hasBadQty = true;
      if (cost < 0) hasBadCost = true;
    }
    const pid = safeNumber(l?.product_id, 0);
    if (pid > 0) {
      if (seen.has(pid)) dupes.add(pid);
      seen.add(pid);
    }
  }
  if (hasNaN) errors.push('nan');
  if (hasBadQty) errors.push('qty_not_positive');
  if (hasBadCost) errors.push('cost_negative');
  if (dupes.size > 0) errors.push('duplicate_product');

  const totals = input?.totals;
  if (totals && totals.paid > totals.grandTotal + 0.001) errors.push('paid_exceeds_total');

  return {
    ok: errors.length === 0,
    errors,
    messages: errors.map((e) => VALIDATION_MESSAGES[e]),
    duplicateProductIds: [...dupes],
  };
}

/** Merge two lines of the SAME product into one (the qty adds up). */
export function mergeDuplicateLines<T extends { product_id: number; qty: number; unit_cost: number }>(
  lines: T[]
): { lines: T[]; merged: number[] } {
  const merged: number[] = [];
  const out: T[] = [];
  const index = new Map<number, number>();
  for (const l of Array.isArray(lines) ? lines : []) {
    const pid = safeNumber(l?.product_id, 0);
    const at = index.get(pid);
    if (at === undefined) {
      index.set(pid, out.length);
      out.push({ ...l });
      continue;
    }
    merged.push(pid);
    const target = out[at];
    out[at] = { ...target, qty: safeNumber(target.qty, 0) + safeNumber(l.qty, 0) };
  }
  return { lines: out, merged };
}
