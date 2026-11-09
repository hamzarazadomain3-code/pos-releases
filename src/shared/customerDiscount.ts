/**
 * Customer default-discount resolution (pure).
 *
 * Rules:
 *  - Selecting a customer with a discount sets it and marks it autoApplied.
 *  - Changing to Cash/no customer clears ONLY an autoApplied discount, never
 *    one the cashier typed.
 *  - A typed discount is not overwritten when the customer changes.
 */
export interface CustomerDiscountLike {
  default_discount_pct?: number | string | null;
}

export interface ApplyCustomerDiscountInput {
  /** The customer being selected (null/undefined = walk-in / cash). */
  customer: CustomerDiscountLike | null | undefined;
  /** The discount currently in the bill-discount field. */
  currentDiscount: string;
  /** Whether the current discount was auto-applied (not typed by the cashier). */
  autoApplied: boolean;
}

export interface ApplyCustomerDiscountResult {
  /** The new bill-discount value (empty string = cleared). */
  discount: string;
  /** The new discount type. */
  type: 'percent' | 'amount';
  /** Whether the new discount was auto-applied. */
  autoApplied: boolean;
}

/**
 * Pure function that decides what happens to the bill discount when the
 * customer changes.  Returns the new state.
 */
export function applyCustomerDiscount(
  input: ApplyCustomerDiscountInput
): ApplyCustomerDiscountResult {
  const { customer, currentDiscount, autoApplied } = input;

  // No customer selected (walk-in / cash): clear only auto-applied discounts.
  if (!customer) {
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  // Customer selected: check if they have a default discount.
  const raw = customer.default_discount_pct;
  if (raw === null || raw === undefined || raw === '') {
    // No default discount: clear only auto-applied discounts.
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct <= 0) {
    // Invalid/zero discount: clear only auto-applied discounts.
    if (autoApplied) {
      return { discount: '', type: 'percent', autoApplied: false };
    }
    return { discount: currentDiscount, type: 'percent', autoApplied: false };
  }

  // Customer has a valid default discount.
  // Apply it only if the current discount was auto-applied (not typed by cashier)
  // or if there's no current discount.
  if (autoApplied || currentDiscount === '') {
    return { discount: String(raw).trim(), type: 'percent', autoApplied: true };
  }
  // Don't overwrite a typed discount.
  return { discount: currentDiscount, type: 'percent', autoApplied: false };
}

/**
 * Legacy helper kept for backward compat (used by Billing's useEffect).
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