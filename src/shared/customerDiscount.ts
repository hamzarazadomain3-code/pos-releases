/**
 * Customer default-discount resolution (pure).
 *
 * The till applies a customer's saved `default_discount_pct` only when the
 * cashier SELECTS that customer — never on every render — otherwise a manually
 * edited bill discount gets silently overwritten the moment the cart changes.
 * Keeping the parsing here makes that rule testable without a browser.
 */
export interface CustomerDiscountLike {
  default_discount_pct?: number | string | null;
}

export interface DefaultBillDiscount {
  /** Ready for the discount text field (e.g. `"10"`). */
  value: string;
  /** The customer default is always a percentage, never a flat amount. */
  type: 'percent';
}

/**
 * `null` means "leave the bill discount alone". A customer with no discount
 * (missing / 0 / negative / NaN) must not reset a discount the cashier typed.
 */
export function defaultBillDiscount(
  customer: CustomerDiscountLike | null | undefined
): DefaultBillDiscount | null {
  const raw = customer?.default_discount_pct;
  if (raw === null || raw === undefined || raw === '') return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return { value: String(raw).trim(), type: 'percent' };
}
