/**
 * Credit-period resolution shared by every "is this udhaar overdue?" path.
 *
 * A customer can carry their own `credit_days`. When that is 0 (the column's
 * default) the shop-wide default applies — seeded at 30 days by migration 067.
 * Set the shop default to 0 to disable overdue tracking entirely.
 *
 * Keep this pure and dependency-free: it is imported by the main process and
 * mirrored by any renderer badge that needs the same answer.
 */
export const DEFAULT_CREDIT_DAYS = 30;

export function resolveCreditDays(
  customerCreditDays: number | string | null | undefined,
  shopDefaultCreditDays: number | string | null | undefined
): number {
  const own = Number(customerCreditDays);
  if (Number.isFinite(own) && own > 0) return Math.max(0, Math.floor(own));

  const shopRaw = shopDefaultCreditDays;
  const shop =
    shopRaw === null || shopRaw === undefined || shopRaw === '' ? NaN : Number(shopRaw);
  if (Number.isFinite(shop) && shop >= 0) return Math.max(0, Math.floor(shop));

  return DEFAULT_CREDIT_DAYS;
}
