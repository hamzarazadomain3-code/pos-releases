/**
 * Customer default-discount resolution (pure).
 *
 * Supports both percent and fixed-rupee discounts.
 */
export interface CustomerDiscountLike {
  default_discount_pct?: number | string | null;
  discount_type?: 'percent' | 'fixed' | null;
  discount_min_bill?: number | string | null;
}

export interface ApplyCustomerDiscountInput {
  customer: CustomerDiscountLike | null | undefined;
  currentDiscount: string;
  autoApplied: boolean;
  billAmount?: number;
}

export interface ApplyCustomerDiscountResult {
  discount: string;
  type: 'percent' | 'amount';
  autoApplied: boolean;
}

export function applyCustomerDiscount(
  input: ApplyCustomerDiscountInput
): ApplyCustomerDiscountResult {
  const { customer, currentDiscount, autoApplied, billAmount } = input;

  // No customer selected (walk-in / cash): clear only auto-applied discounts.
  if (!customer) {
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  const discountType = customer.discount_type === 'fixed' ? 'fixed' : 'percent';
  const raw = customer.default_discount_pct;
  const minBill = Number(customer.discount_min_bill ?? 0);

  if (raw === null || raw === undefined || raw === '') {
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  // Check min bill
  if (minBill > 0 && (billAmount ?? 0) < minBill) {
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  // Apply discount only if auto-applied or no current discount
  if (autoApplied || currentDiscount === '') {
    if (discountType === 'fixed') {
      return { discount: String(value), type: 'amount', autoApplied: true };
    }
    return { discount: String(value), type: 'percent', autoApplied: true };
  }
  return { discount: currentDiscount, type: 'percent', autoApplied: false };
}

/**
 * Compute customer discount amount.
 */
export interface ComputeCustomerDiscountInput {
  type: 'percent' | 'fixed';
  value: number;
  minBill: number;
  billAmount: number;
  maxDiscountPercent: number;
  hasPermission: boolean;
}

export interface ComputeCustomerDiscountResult {
  amount: number;
  percentEquivalent: number;
  clamped: boolean;
  reason: string;
}

export function computeCustomerDiscount(
  input: ComputeCustomerDiscountInput
): ComputeCustomerDiscountResult {
  const { type, value, minBill, billAmount, maxDiscountPercent, hasPermission } = input;

  // Below min bill
  if (minBill > 0 && billAmount < minBill) {
    return { amount: 0, percentEquivalent: 0, clamped: false, reason: 'below_min_bill' };
  }

  let amount = 0;
  if (type === 'percent') {
    amount = (billAmount * value) / 100;
  } else {
    amount = Math.min(value, billAmount);
  }

  // Never negative or NaN
  if (!Number.isFinite(amount) || amount < 0) {
    amount = 0;
  }

  // Clamp to max discount percent unless permission
  const maxAmount = (billAmount * maxDiscountPercent) / 100;
  let clamped = false;
  if (!hasPermission && amount > maxAmount && maxDiscountPercent > 0) {
    amount = maxAmount;
    clamped = true;
  }

  const percentEquivalent = billAmount > 0 ? (amount / billAmount) * 100 : 0;

  return { amount, percentEquivalent, clamped, reason: clamped ? 'clamped' : 'ok' };
}

/**
 * Legacy helper kept for backward compat.
 */
export interface CustomerDiscountLike {
  default_discount_pct?: number | string | null;
}

export interface DefaultBillDiscount {
  value: string;
  type: 'percent';
}

export function defaultBillDiscount(
  customer: CustomerDiscountLike | null | undefined
): DefaultBillDiscount | null {
  const raw = customer?.default_discount_pct;
  if (raw === null || raw === undefined || raw === '') return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return { value: String(raw).trim(), type: 'percent' };
}