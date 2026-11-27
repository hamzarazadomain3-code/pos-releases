/**
 * THE expiry rule — one rule, one place (Phase 1, item 1.5).
 *
 * Before Phase 1 the same question ("is this stock expired?') was answered in
 * four different places with three different answers:
 *
 *   - `sales.ts`      : `expiry_date.slice(0,10) < today`  → same-day is OK
 *   - `Billing.tsx`   : `new Date(dateStr) < today`        → same-day is OK
 *   - `cartMath.ts`   : `new Date(dateStr) < today`        → same-day is OK
 *   - `reports.ts`    : `days_until_expiry <= 0`           → same-day is EXPIRED
 *
 * So the till happily sold a product that the very same screen called
 * "EXPIRED". This module is the ONLY place that answers it.
 *
 * THE RULE: a date is expired when it is BEFORE today. A date that falls on
 * today is still sellable (the shop sells through the expiry date); it becomes
 * expired at midnight. `null` / empty / unparsable = NOT expired (never block a
 * sale on a value we do not understand).
 */

/** Normalise a stored date value to `YYYY-MM-DD`; null when there is no date. */
export function expiryDateKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  // The app stores ISO dates (`YYYY-MM-DD`), sometimes with a time part.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1].padStart(4, '0')}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  // `DD/MM/YYYY` is accepted ONLY when it cannot be `MM/DD/YYYY` (the first
  // part is above 12). The app's own date field always emits ISO, but a
  // spreadsheet import can carry the shop's display format. An ambiguous
  // `03/05/2026` is rejected on purpose: guessing would silently expire (or
  // un-expire) real stock.
  const dmy = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})$/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    if (a > 12 && b <= 31) {
      return `${dmy[3]}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Is the stock expired on `today`? `today` is `YYYY-MM-DD`. */
export function isExpiredOn(
  expiryDate: string | null | undefined,
  today: string
): boolean {
  const key = expiryDateKey(expiryDate);
  if (!key) return false;
  return key < today;
}

/**
 * The days from `today` until the expiry date.
 * Negative = already expired, 0 = expires today, null = no expiry date.
 */
export function daysUntilExpiry(
  expiryDate: string | null | undefined,
  today: string
): number | null {
  const key = expiryDateKey(expiryDate);
  if (!key) return null;
  const a = Date.parse(`${key}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * The severity bucket the reports/alerts use. It is derived from the SAME rule
 * as `isExpiredOn`, so "EXPIRED" in a report means exactly what "expired" means
 * at the till.
 */
export type ExpiryBucket = 'expired' | 'today' | 'soon' | 'ok' | 'none';

export function expiryBucket(
  expiryDate: string | null | undefined,
  today: string,
  soonDays = 30
): ExpiryBucket {
  const days = daysUntilExpiry(expiryDate, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= soonDays) return 'soon';
  return 'ok';
}
