/**
 * The customer search combobox — PURE filter + row description.
 *
 * The Billing header's customer field becomes a searchable combobox (F6).
 * This module owns the filtering (name, phone or customer code, case
 * insensitive, Urdu names included) and the text each row shows, so the
 * behaviour can be tested without a DOM.
 */

export interface CustomerSearchItem {
  id: number;
  name: string;
  /** Urdu / shop name — also searched. */
  urdu_name?: string | null;
  phone?: string | null;
  customer_code?: string | null;
  balance?: number;
  credit_limit?: number;
  /** 'percent' | 'fixed' */
  discount_type?: string | null;
  /** The discount VALUE (percent 0-100, or rupees when fixed). */
  default_discount_pct?: number | null;
}

export interface CustomerSearchRow {
  customer: CustomerSearchItem;
  /** "due 120" / "no due" */
  balanceLabel: string;
  /** "5%" / "Rs 50 off" / "" */
  discountLabel: string;
  /** True when the customer is over their credit limit. */
  overLimit: boolean;
  /** The text searched against. */
  searchText: string;
}

/** Normalise a string for a case-insensitive comparison (Urdu safe). */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does the customer match the query? Name, phone or customer code. */
export function customerMatches(customer: CustomerSearchItem, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = [
    customer.name,
    customer.urdu_name,
    customer.phone,
    customer.customer_code,
  ]
    .map(normalizeSearchText)
    .join(' ');
  // Phone: digits only, so "0300" finds "0300-1234567".
  const digits = String(customer.phone ?? '').replace(/\D/g, '');
  const queryDigits = String(q).replace(/\D/g, '');
  if (queryDigits.length >= 3 && digits.includes(queryDigits)) return true;
  return haystack.includes(q);
}

/** "5%" for a percent discount, "Rs 50 off" for a fixed one, "" for none. */
export function customerDiscountLabel(
  customer: CustomerSearchItem,
  currencySymbol = 'Rs'
): string {
  const raw = customer.default_discount_pct;
  if (raw === null || raw === undefined || String(raw).trim() === '') return '';
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value * 100) / 100;
  if (customer.discount_type === 'fixed') return `${currencySymbol} ${rounded} off`;
  return `${rounded}%`;
}

/** "due 120" / "no due". */
export function customerBalanceLabel(customer: CustomerSearchItem): string {
  const balance = Number(customer.balance ?? 0);
  if (!Number.isFinite(balance) || balance <= 0) return 'no due';
  return `due ${Math.round(balance * 100) / 100}`;
}

/** True when the customer is over their credit limit. */
export function isOverCreditLimit(customer: CustomerSearchItem): boolean {
  const limit = Number(customer.credit_limit ?? 0);
  const balance = Number(customer.balance ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return balance > limit;
}

/** Build the row shown in the combobox. */
export function toCustomerSearchRow(
  customer: CustomerSearchItem,
  currencySymbol = 'Rs'
): CustomerSearchRow {
  return {
    customer,
    balanceLabel: customerBalanceLabel(customer),
    discountLabel: customerDiscountLabel(customer, currencySymbol),
    overLimit: isOverCreditLimit(customer),
    searchText: normalizeSearchText(
      [customer.name, customer.urdu_name, customer.phone, customer.customer_code].join(' ')
    ),
  };
}

/**
 * Filter the customers for the combobox. The list is capped so a shop with
 * thousands of customers still opens instantly; the walk-in row is added by
 * the caller.
 */
export function filterCustomers(
  customers: CustomerSearchItem[],
  query: string,
  limit = 50,
  currencySymbol = 'Rs'
): CustomerSearchRow[] {
  const q = normalizeSearchText(query);
  const rows: CustomerSearchRow[] = [];
  for (const c of customers) {
    if (!customerMatches(c, q)) continue;
    rows.push(toCustomerSearchRow(c, currencySymbol));
    if (rows.length >= limit) break;
  }
  return rows;
}
