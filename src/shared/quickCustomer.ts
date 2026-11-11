/**
 * The quick "New Customer" dialog — PURE validation + duplicate check.
 *
 * The Billing header can open a small form (Name, Phone, and a collapsed
 * "More details") that creates a customer through the EXISTING customer
 * service. This module owns the rules so they can be tested without a DOM:
 *
 *  - the name is required;
 *  - the phone, when given, must be a Pakistani mobile (03XXXXXXXXX);
 *  - a duplicate phone or name produces a WARNING (not an error) with the
 *    existing customer so the cashier can use it instead;
 *  - every number is guarded (never NaN, never negative where it cannot be).
 */

export interface QuickCustomerDraft {
  name: string;
  phone: string;
  whatsapp?: string;
  customer_type?: string;
  discount_type?: 'percent' | 'fixed';
  discount_value?: string;
  discount_min_bill?: string;
  price_level?: 'retail' | 'wholesale';
  credit_limit?: string;
  credit_days?: string;
  opening_balance?: string;
  notes?: string;
}

export interface QuickCustomerExisting {
  id: number;
  name: string;
  phone?: string | null;
  customer_code?: string | null;
}

export interface QuickCustomerValidation {
  ok: boolean;
  /** The first blocking problem (empty when ok). */
  error: string | null;
  /** Field-level messages, keyed by field name. */
  fieldErrors: Record<string, string>;
  /** A duplicate phone/name — a WARNING, the save still goes through. */
  duplicate: {
    kind: 'phone' | 'name';
    customer: QuickCustomerExisting;
    message: string;
  } | null;
  /** The cleaned values ready for the service. */
  cleaned: {
    name: string;
    phone: string | null;
    whatsapp: string | null;
    customer_type: string;
    discount_type: 'percent' | 'fixed';
    discount_value: number;
    discount_min_bill: number;
    price_level: 'retail' | 'wholesale';
    credit_limit: number;
    credit_days: number;
    opening_balance: number;
    notes: string | null;
  };
}

export const PK_MOBILE_REGEX = /^03\d{9}$/;
export const CUSTOMER_TYPES = ['retail', 'wholesale', 'shop', 'medical', 'other'] as const;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Strip everything but digits (and a leading +). */
export function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/[^\d+]/g, '');
}

/** Turn a typed phone into the canonical 03XXXXXXXXX form, when possible. */
export function canonicalPhone(value: unknown): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12) digits = '0' + digits.slice(2);
  if (digits.length === 10 && digits.startsWith('3')) digits = '0' + digits;
  return digits;
}

/** Is this a valid Pakistani mobile number? */
export function isValidPkPhone(value: unknown): boolean {
  return PK_MOBILE_REGEX.test(canonicalPhone(value));
}

/**
 * Validate the quick-customer draft.
 *
 * `existing` is the shop's customer list (already loaded by the page); a
 * matching phone or name produces a WARNING with a "Use existing customer"
 * hint.
 */
export function validateQuickCustomer(
  draft: QuickCustomerDraft,
  existing: QuickCustomerExisting[] = []
): QuickCustomerValidation {
  const fieldErrors: Record<string, string> = {};
  const name = String(draft.name ?? '').trim();
  const phoneRaw = String(draft.phone ?? '').trim();
  const phone = canonicalPhone(phoneRaw);
  const whatsapp = draft.whatsapp ? canonicalPhone(draft.whatsapp) : '';

  if (!name) fieldErrors.name = 'Name is required.';

  if (phoneRaw && !PK_MOBILE_REGEX.test(phone)) {
    fieldErrors.phone = 'Phone must be 03XXXXXXXXX.';
  }
  if (draft.whatsapp && !PK_MOBILE_REGEX.test(canonicalPhone(draft.whatsapp))) {
    fieldErrors.whatsapp = 'WhatsApp must be 03XXXXXXXXX.';
  }

  const discountType = draft.discount_type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = num(draft.discount_value, 0);
  if (discountValue < 0) fieldErrors.discount_value = 'Discount cannot be negative.';
  if (discountType === 'percent' && discountValue > 100) {
    fieldErrors.discount_value = 'A percent discount must be between 0 and 100.';
  }
  const minBill = num(draft.discount_min_bill, 0);
  if (minBill < 0) fieldErrors.discount_min_bill = 'The minimum bill cannot be negative.';

  const creditLimit = num(draft.credit_limit, 0);
  if (creditLimit < 0) fieldErrors.credit_limit = 'The credit limit cannot be negative.';
  const creditDays = num(draft.credit_days, 0);
  if (creditDays < 0) fieldErrors.credit_days = 'The credit days cannot be negative.';
  // A positive opening balance means the customer owes the shop.
  const openingBalance = num(draft.opening_balance, 0);

  const customerType = CUSTOMER_TYPES.includes(draft.customer_type as any)
    ? String(draft.customer_type)
    : 'retail';
  const priceLevel = draft.price_level === 'wholesale' ? 'wholesale' : 'retail';

  // Duplicate detection — a WARNING, never a hard error.
  let duplicate: QuickCustomerValidation['duplicate'] = null;
  if (phone) {
    const hit = existing.find((c) => canonicalPhone(c.phone) === phone);
    if (hit) {
      duplicate = {
        kind: 'phone',
        customer: hit,
        message: `Phone already belongs to ${hit.name}. Use the existing customer?`,
      };
    }
  }
  if (!duplicate && name) {
    const lower = name.toLowerCase();
    const hit = existing.find((c) => String(c.name ?? '').trim().toLowerCase() === lower);
    if (hit) {
      duplicate = {
        kind: 'name',
        customer: hit,
        message: `A customer named ${hit.name} already exists. Use the existing customer?`,
      };
    }
  }

  const error = Object.keys(fieldErrors).length > 0 ? Object.values(fieldErrors)[0] : null;

  return {
    ok: error === null,
    error,
    fieldErrors,
    duplicate,
    cleaned: {
      name,
      phone: phone || null,
      whatsapp: whatsapp || null,
      customer_type: customerType,
      discount_type: discountType,
      discount_value: discountValue,
      discount_min_bill: minBill,
      price_level: priceLevel,
      credit_limit: creditLimit,
      credit_days: creditDays,
      opening_balance: openingBalance,
      notes: String(draft.notes ?? '').trim() || null,
    },
  };
}
