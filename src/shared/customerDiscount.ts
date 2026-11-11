/**
 * Customer discount model — pure, dependency-free.
 *
 * The rules this file owns (both processes import it, and the test suite
 * pins every one of them):
 *
 *  - A customer may have a **percent** discount (0-100) or a **fixed rupees**
 *    discount. `default_discount_pct` stores the VALUE either way, so the
 *    column keeps its name and old rows stay valid.
 *  - `discount_min_bill` only applies the discount when the bill reaches that
 *    amount (0 = always).
 *  - A fixed discount is applied **once per bill** and never exceeds the bill.
 *  - Stacking order is fixed and documented (see `applyDiscountStack`):
 *    price-level price → promotions → manual line discounts → customer
 *    discount on the REMAINING amount. The same amount is never discounted
 *    twice.
 *  - Guards: `max_discount_percent` and the price floor (cost). Both clamp
 *    instead of silently selling below cost, and both can be overridden by the
 *    manager-PIN path (`hasPermission`).
 *  - A fixed discount is split across the lines **in proportion**, so cost
 *    checks and profit stay right, and the split sums EXACTLY to the amount.
 */
import { safeNum } from './cartMath';

export type CustomerDiscountType = 'percent' | 'fixed';

export interface CustomerDiscountLike {
  default_discount_pct?: number | string | null;
  discount_type?: CustomerDiscountType | null;
  discount_min_bill?: number | string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Amount computation
// ───────────────────────────────────────────────────────────────────────────

export interface ComputeCustomerDiscountInput {
  type: CustomerDiscountType;
  value: number;
  minBill: number;
  billAmount: number;
  /** 0 = no cap. */
  maxDiscountPercent: number;
  /** True when the manager-PIN / permission rule is satisfied. */
  hasPermission: boolean;
  /** Total cost of the bill — the discount may not push the bill below it. */
  costTotal?: number;
}

export interface ComputeCustomerDiscountResult {
  amount: number;
  percentEquivalent: number;
  clamped: boolean;
  /** 'ok' | 'below_min_bill' | 'clamped_max_percent' | 'clamped_cost' | 'zero' */
  reason: string;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * How much a customer discount is worth on a bill of `billAmount`.
 *
 * Never returns a negative or NaN amount.
 */
export function computeCustomerDiscount(
  input: ComputeCustomerDiscountInput
): ComputeCustomerDiscountResult {
  const type: CustomerDiscountType = input.type === 'fixed' ? 'fixed' : 'percent';
  const value = Number(input.value);
  const billAmount = safeNum(input.billAmount);
  const minBill = safeNum(input.minBill);

  if (!Number.isFinite(value) || value <= 0) {
    return { amount: 0, percentEquivalent: 0, clamped: false, reason: 'zero' };
  }
  if (billAmount <= 0) {
    return { amount: 0, percentEquivalent: 0, clamped: false, reason: 'zero' };
  }
  // The discount only kicks in once the bill reaches the minimum.
  if (minBill > 0 && billAmount < minBill) {
    return { amount: 0, percentEquivalent: 0, clamped: false, reason: 'below_min_bill' };
  }

  // percent = bill * value / 100; fixed = min(value, bill) — applied ONCE.
  let amount = type === 'percent' ? (billAmount * value) / 100 : Math.min(value, billAmount);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;

  let clamped = false;
  let reason = 'ok';

  // Guard 1 — max discount percent (0 = no cap).
  const maxPercent = safeNum(input.maxDiscountPercent);
  if (!input.hasPermission && maxPercent > 0) {
    const maxAmount = (billAmount * maxPercent) / 100;
    if (amount > maxAmount) {
      amount = maxAmount;
      clamped = true;
      reason = 'clamped_max_percent';
    }
  }

  // Guard 2 — price floor: the bill may not drop below what the goods cost.
  const costTotal = safeNum(input.costTotal);
  if (!input.hasPermission && costTotal > 0) {
    const maxByCost = billAmount - costTotal;
    if (amount > maxByCost) {
      amount = Math.max(0, maxByCost);
      clamped = true;
      reason = 'clamped_cost';
    }
  }

  amount = round2(amount);
  const percentEquivalent = billAmount > 0 ? round2((amount / billAmount) * 100) : 0;
  return { amount, percentEquivalent, clamped, reason };
}

// ───────────────────────────────────────────────────────────────────────────
// Proportional split (a fixed discount across the lines)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Split `amount` across `weights` in proportion, so the parts sum EXACTLY to
 * `amount` (no lost or invented paisa). The remainder is handed out by the
 * largest-remainder method, so the split is stable and deterministic.
 */
export function splitDiscountAcrossLines(amount: number, weights: number[]): number[] {
  const totalCents = Math.round(round2(amount) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const safeWeights = weights.map((w) => Math.max(0, safeNum(w)));
  const weightSum = safeWeights.reduce((s, w) => s + w, 0);

  const parts: number[] = new Array(safeWeights.length).fill(0);
  if (weightSum <= 0) {
    // Nothing to weigh by — put everything on the first line.
    parts[0] = totalCents;
  } else {
    const remainders: Array<{ index: number; frac: number }> = [];
    let assigned = 0;
    safeWeights.forEach((w, i) => {
      const exact = (totalCents * w) / weightSum;
      const floor = Math.floor(exact);
      parts[i] = floor;
      assigned += floor;
      remainders.push({ index: i, frac: exact - floor });
    });
    let left = totalCents - assigned;
    remainders.sort((a, b) => b.frac - a.frac || a.index - b.index);
    let k = 0;
    while (left > 0 && remainders.length > 0) {
      parts[remainders[k % remainders.length].index] += 1;
      left -= 1;
      k += 1;
    }
  }
  return parts.map((cents) => round2(cents / 100));
}

// ───────────────────────────────────────────────────────────────────────────
// The one stacking function
// ───────────────────────────────────────────────────────────────────────────

export interface StackLineInput {
  product_id: number;
  qty: number;
  /** Price AFTER the price level (retail / wholesale) was chosen. */
  price: number;
  /** Promotional effective price when a promotion applies (else null). */
  promo_price?: number | null;
  /** Manual line discount (absolute amount for the whole line). */
  manual_discount?: number;
  /** Unit cost — used by the price-floor guard. */
  cost_price?: number;
}

export interface StackCustomerDiscount {
  type: CustomerDiscountType;
  value: number;
  min_bill?: number;
}

export interface StackInput {
  lines: StackLineInput[];
  customer?: StackCustomerDiscount | null;
  /** 0 = no cap. */
  maxDiscountPercent?: number;
  /** Manager PIN / permission satisfied — the guards do not clamp. */
  hasPermission?: boolean;
}

export interface StackLineResult {
  product_id: number;
  qty: number;
  base_price: number;
  promo_discount: number;
  manual_discount: number;
  customer_discount: number;
  /** Amount still owed for this line (before tax). */
  net_amount: number;
  cost_amount: number;
}

export interface StackResult {
  lines: StackLineResult[];
  /** After promotions, before manual/customer discounts. */
  subtotal_after_promo: number;
  promo_discount_total: number;
  manual_discount_total: number;
  customer_discount_total: number;
  total_discount: number;
  /** What the customer actually pays for the goods (before tax). */
  net_total: number;
  clamped: boolean;
  reason: string;
  customer_applied: boolean;
}

/**
 * THE stacking function.
 *
 * Order (never the same amount twice):
 *   1. price-level price (already resolved into `line.price`)
 *   2. promotions           → reduce the line
 *   3. manual line discount → reduce the line
 *   4. customer discount    → applied on the REMAINING amount of the bill
 *
 * The customer discount is then split across the lines in proportion so the
 * per-line numbers (and therefore cost/profit checks) stay right, and the
 * split sums exactly to the discount.
 */
export function applyDiscountStack(input: StackInput): StackResult {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const results: StackLineResult[] = [];
  const remainingWeights: number[] = [];

  let subtotalAfterPromo = 0;
  let promoDiscountTotal = 0;
  let manualDiscountTotal = 0;
  let costTotal = 0;

  for (const line of lines) {
    const qty = safeNum(line.qty);
    const basePrice = safeNum(line.price);
    const promoPrice = line.promo_price == null ? null : safeNum(line.promo_price);
    const promoUnit = promoPrice != null && promoPrice < basePrice ? promoPrice : basePrice;
    const gross = basePrice * qty;
    const promoDiscount = round2((basePrice - promoUnit) * qty);

    const afterPromo = promoUnit * qty;
    const manual = Math.min(Math.max(0, safeNum(line.manual_discount)), afterPromo);
    const remaining = round2(afterPromo - manual);

    const costAmount = round2(safeNum(line.cost_price) * qty);

    subtotalAfterPromo = round2(subtotalAfterPromo + afterPromo);
    promoDiscountTotal = round2(promoDiscountTotal + promoDiscount);
    manualDiscountTotal = round2(manualDiscountTotal + manual);
    costTotal = round2(costTotal + costAmount);

    results.push({
      product_id: safeNum(line.product_id),
      qty,
      base_price: basePrice,
      promo_discount: promoDiscount,
      manual_discount: manual,
      customer_discount: 0,
      net_amount: remaining,
      cost_amount: costAmount,
    });
    remainingWeights.push(remaining);
  }

  const remainingTotal = round2(results.reduce((s, l) => s + l.net_amount, 0));

  let customerDiscountTotal = 0;
  let clamped = false;
  let reason = 'ok';
  let customerApplied = false;

  const cust = input.customer;
  if (cust && remainingTotal > 0) {
    const computed = computeCustomerDiscount({
      type: cust.type,
      value: cust.value,
      minBill: safeNum(cust.min_bill),
      billAmount: remainingTotal,
      maxDiscountPercent: safeNum(input.maxDiscountPercent),
      hasPermission: !!input.hasPermission,
      costTotal,
    });
    customerDiscountTotal = computed.amount;
    clamped = computed.clamped;
    reason = computed.reason;
    customerApplied = customerDiscountTotal > 0;

    if (customerDiscountTotal > 0) {
      const parts = splitDiscountAcrossLines(customerDiscountTotal, remainingWeights);
      for (let i = 0; i < results.length; i++) {
        results[i].customer_discount = parts[i];
        results[i].net_amount = round2(results[i].net_amount - parts[i]);
      }
    }
  }

  const netTotal = round2(results.reduce((s, l) => s + l.net_amount, 0));

  return {
    lines: results,
    subtotal_after_promo: subtotalAfterPromo,
    promo_discount_total: promoDiscountTotal,
    manual_discount_total: manualDiscountTotal,
    customer_discount_total: customerDiscountTotal,
    total_discount: round2(promoDiscountTotal + manualDiscountTotal + customerDiscountTotal),
    net_total: netTotal,
    clamped,
    reason,
    customer_applied: customerApplied,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Applying / clearing the discount on the bill
// ───────────────────────────────────────────────────────────────────────────

export interface ApplyCustomerDiscountInput {
  /** The customer being selected (null/undefined = walk-in / cash). */
  customer: CustomerDiscountLike | null | undefined;
  /** The discount currently in the bill-discount field. */
  currentDiscount: string;
  /** Whether the current discount was auto-applied (not typed by the cashier). */
  autoApplied: boolean;
  /** Current bill amount — needed for the fixed/min-bill rules. */
  billAmount?: number;
}

export interface ApplyCustomerDiscountResult {
  /** The new bill-discount value (empty string = cleared). */
  discount: string;
  /** The new discount type. */
  type: 'percent' | 'amount';
  /** Whether the new discount was auto-applied. */
  autoApplied: boolean;
  /** Where the discount came from (saved on the sale). */
  source: 'customer_percent' | 'customer_fixed' | 'manual' | 'none';
  /**
   * True when the customer's minimum bill has not been reached yet: the
   * discount is NOT applied, but it stays auto-applied so it kicks in as soon
   * as the bill grows (the UI shows "Add Rs X more ...").
   */
  pending: boolean;
}

/**
 * Decide what happens to the bill discount when the customer changes.
 *
 *  - Selecting a customer with a discount sets it and marks it auto-applied.
 *  - Changing to Cash/no customer clears ONLY an auto-applied discount, never
 *    one the cashier typed.
 *  - A typed discount is not overwritten when the customer changes.
 *  - A fixed discount whose minimum bill is not reached yet is left PENDING
 *    (not applied, still auto) so it applies as soon as the bill is big enough.
 */
export function applyCustomerDiscount(
  input: ApplyCustomerDiscountInput
): ApplyCustomerDiscountResult {
  const { customer, currentDiscount, autoApplied, billAmount } = input;

  const keepTyped = (): ApplyCustomerDiscountResult => ({
    discount: currentDiscount,
    type: 'percent',
    autoApplied: false,
    source: 'manual',
    pending: false,
  });
  const clearAuto = (): ApplyCustomerDiscountResult => ({
    discount: '',
    type: 'percent',
    autoApplied: false,
    source: 'none',
    pending: false,
  });

  // No customer selected (walk-in / cash): clear only auto-applied discounts.
  if (!customer) {
    return autoApplied ? clearAuto() : keepTyped();
  }

  const type: CustomerDiscountType = customer.discount_type === 'fixed' ? 'fixed' : 'percent';
  const raw = customer.default_discount_pct;
  const minBill = safeNum(customer.discount_min_bill);

  if (raw === null || raw === undefined || raw === '') {
    return autoApplied ? clearAuto() : keepTyped();
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return autoApplied ? clearAuto() : keepTyped();
  }

  const source = type === 'fixed' ? 'customer_fixed' : 'customer_percent';

  // Apply the discount only if it was auto-applied before, or the field is empty.
  if (!(autoApplied || currentDiscount === '')) {
    // Don't overwrite a typed discount.
    return keepTyped();
  }

  // The discount only kicks in once the bill reaches the customer's minimum.
  if (minBill > 0 && billAmount != null && safeNum(billAmount) < minBill) {
    return { discount: '', type: type === 'fixed' ? 'amount' : 'percent', autoApplied: true, source, pending: true };
  }

  return {
    discount: String(raw).trim(),
    type: type === 'fixed' ? 'amount' : 'percent',
    autoApplied: true,
    source,
    pending: false,
  };
}

/**
 * "Add Rs X more to get the Rs Y discount" — the hint shown while a fixed
 * customer discount waits for the bill to reach the customer's minimum.
 * Returns an empty string when the discount already applies (or there is no
 * minimum).
 */
export function minBillHint(minBill: number, billAmount: number): string {
  const min = safeNum(minBill);
  const bill = safeNum(billAmount);
  if (min <= 0 || bill >= min) return '';
  const missing = round2(min - bill);
  if (missing <= 0) return '';
  return `Add Rs ${missing} more to get the Rs ${round2(min)} discount`;
}

/**
 * The badge text for the applied customer discount:
 * "Customer discount 5% applied" / "Customer discount Rs 50 applied".
 */
export function customerDiscountBadge(
  type: CustomerDiscountType,
  value: number,
  currencySymbol = 'Rs'
): string {
  const v = safeNum(value);
  if (v <= 0) return '';
  if (type === 'fixed') return `Customer discount ${currencySymbol} ${round2(v)} applied`;
  return `Customer discount ${round2(v)}% applied`;
}

/**
 * How a sale records where its bill discount came from.
 */
export type DiscountSource = 'customer_percent' | 'customer_fixed' | 'manual' | 'promotion';

export function discountSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'customer_percent':
      return 'Customer discount %';
    case 'customer_fixed':
      return 'Customer discount Rs';
    case 'manual':
      return 'Manual discount';
    case 'promotion':
      return 'Promotion';
    default:
      return 'Discount';
  }
}

/**
 * The customer list's Discount column: "5%" for a percent discount,
 * "Rs 50 off" for a fixed one, and "—" when the customer has no discount.
 */
export function formatCustomerDiscount(
  customer: CustomerDiscountLike | null | undefined,
  currencySymbol = 'Rs'
): string {
  if (!customer) return '—';
  const raw = customer.default_discount_pct;
  if (raw === null || raw === undefined || raw === '') return '—';
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const rounded = Math.round(value * 100) / 100;
  if (customer.discount_type === 'fixed') return `${currencySymbol} ${rounded} off`;
  return `${rounded}%`;
}

/** True when the customer has a usable saved discount. */
export function hasCustomerDiscount(
  customer: CustomerDiscountLike | null | undefined
): boolean {
  return formatCustomerDiscount(customer) !== '—';
}

/**
 * The customer discount recorded on a sale event, if any.
 */
export function describeDiscountSource(
  source: unknown,
  amount?: unknown,
  currencySymbol = 'Rs'
): string {
  const src = String(source ?? '');
  if (src !== 'customer_percent' && src !== 'customer_fixed') return '';
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const label = src === 'customer_fixed' ? `Customer discount ${currencySymbol}` : 'Customer discount %';
  return `${label}: -${currencySymbol} ${Math.round(value * 100) / 100}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Refunds — the price actually paid, proportionally
// ───────────────────────────────────────────────────────────────────────────

export interface RefundShareInput {
  /** The list price of ONE unit. */
  unitPrice: number;
  /** How many units are being returned. */
  qty: number;
  /** The sale's gross (subtotal + tax) BEFORE the bill-level discount. */
  grossTotal: number;
  /** The money taken off at bill level (customer + manual). */
  billDiscountAmount: number;
}

/**
 * What a return is worth: the price the customer ACTUALLY paid for those
 * units, i.e. the list price minus this line's proportional share of the
 * bill-level discount. A bill with a Rs 50 customer discount on a Rs 1000
 * gross refunds Rs 95 per Rs 100 of list price.
 */
export function computeRefundShare(input: RefundShareInput): number {
  const unitPrice = safeNum(input.unitPrice);
  const qty = safeNum(input.qty);
  const grossTotal = safeNum(input.grossTotal);
  const discount = Math.max(0, safeNum(input.billDiscountAmount));
  const listAmount = unitPrice * qty;
  if (listAmount <= 0) return 0;
  if (grossTotal <= 0 || discount <= 0) return round2(listAmount);
  const ratio = Math.min(1, Math.max(0, 1 - discount / grossTotal));
  return round2(listAmount * ratio);
}
