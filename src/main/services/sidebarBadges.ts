/**
 * THE sidebar badges — one service, one query set, refreshed at most once a
 * minute.
 *
 * The numbers come from the same tables the Dashboard and the Alerts already
 * read, so the badge and the page can never tell different stories:
 *   - inventory : the products at or below their low-stock level (the same
 *                 rule as the alert service; test products never count);
 *   - shifts    : a dot while a shift is open;
 *   - udhaar    : the customers whose oldest unpaid charge is past its due
 *                 date (payments settle the oldest debt first — the same FIFO
 *                 rule the Udhaar ledger uses);
 *   - audits    : the audits still in progress;
 *   - promotions: the active promotions that end within the next week.
 */

import { getDb } from '../db';
import { todayLocal } from '../utils/timezone';
import { buildBadges, BADGE_REFRESH_MS, type SidebarBadge, type SidebarBadgeInput } from '../../shared/sidebarBadges';
import { resolveCreditDays } from '../../shared/creditDays';
import { currentShift } from './shifts';
import { getSetting } from './settings';

/** A promotion that ends within this many days counts as "ending soon". */
export const PROMOTION_SOON_DAYS = 7;

const EPSILON = 0.005;

let cachedAt = 0;
let cachedInputs: SidebarBadgeInput[] = [];

/** Forget the cached numbers (the tests use it; a shop never needs it). */
export function resetSidebarBadgeCache(): void {
  cachedAt = 0;
  cachedInputs = [];
}

/** The shop-wide credit period — the fallback for a customer without one. */
function shopDefaultCreditDays(): number {
  const raw = getSetting('default_credit_days');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** How many products are at or below their low-stock level. */
function lowStockCount(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM products
       WHERE active = 1 AND COALESCE(is_test, 0) = 0
         AND stock_qty <= COALESCE(min_stock_level, low_stock_threshold, 0)
         AND COALESCE(min_stock_level, low_stock_threshold, 0) > 0`
    )
    .get() as { n: number } | undefined;
  const n = Number(row?.n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The customers whose oldest unpaid charge is overdue. */
function overdueCustomersCount(): number {
  const db = getDb();
  const today = todayLocal();
  const shopDays = shopDefaultCreditDays();
  if (shopDays <= 0 && !hasOwnCreditDays()) return 0;

  const customers = db
    .prepare('SELECT id, credit_days, balance FROM customers WHERE balance > 0')
    .all() as unknown as Array<{ id: number; credit_days: number | null; balance: number }>;

  let overdue = 0;
  for (const customer of customers) {
    const days = resolveCreditDays(customer.credit_days, shopDays);
    if (days <= 0) continue; // no credit period -> nothing can be overdue
    const unpaid = oldestUnpaidCharge(customer.id);
    if (!unpaid) continue;
    const due = addDays(unpaid, days);
    if (due < today) overdue++;
  }
  return overdue;
}

/** Does any customer carry a credit period of their own? */
function hasOwnCreditDays(): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM customers WHERE balance > 0 AND COALESCE(credit_days, 0) > 0')
    .get() as { n: number } | undefined;
  return Number(row?.n ?? 0) > 0;
}

/**
 * The date of the oldest charge that is still unpaid.
 *
 * Payments settle the oldest debt first (the same FIFO rule as the Udhaar
 * ledger), so the first charge whose running total passes everything that was
 * paid is the oldest one still owing money.
 */
function oldestUnpaidCharge(customerId: number): string | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, amount, created_at FROM customer_transactions
       WHERE customer_id = ? ORDER BY id`
    )
    .all(customerId) as unknown as Array<{ id: number; amount: number; created_at: string | null }>;

  let paid = 0;
  let debit = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (amount < 0) {
      paid += -amount;
      continue;
    }
    if (amount <= 0) continue;
    debit += amount;
    if (debit > paid + EPSILON) {
      const date = String(row.created_at ?? '').slice(0, 10);
      return date.length === 10 ? date : null;
    }
  }
  return null;
}

/** `date` plus `days` days, as YYYY-MM-DD. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + Math.floor(days));
  return d.toISOString().slice(0, 10);
}

/** The audits that are still in progress. */
function auditsInProgressCount(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM audits WHERE status = 'in_progress'")
    .get() as { n: number } | undefined;
  const n = Number(row?.n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The active promotions that end within the next week. */
function promotionsEndingSoonCount(): number {
  const db = getDb();
  const today = todayLocal();
  const until = addDays(today, PROMOTION_SOON_DAYS);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM promotions
       WHERE active = 1 AND end_date IS NOT NULL AND TRIM(end_date) <> ''
         AND date(end_date) >= date(?) AND date(end_date) <= date(?)`
    )
    .get(today, until) as { n: number } | undefined;
  const n = Number(row?.n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Collect the numbers (the queries run at most once a minute). */
function collectBadgeInputs(): SidebarBadgeInput[] {
  let shiftOpen = false;
  try {
    shiftOpen = currentShift() !== null;
  } catch {
    shiftOpen = false;
  }

  return [
    { id: 'inventory', kind: 'count', count: lowStockCount() },
    { id: 'shifts', kind: 'dot', count: shiftOpen ? 1 : 0 },
    { id: 'udhaar', kind: 'count', count: overdueCustomersCount() },
    { id: 'audits', kind: 'count', count: auditsInProgressCount() },
    { id: 'promotions', kind: 'count', count: promotionsEndingSoonCount() },
  ];
}

/**
 * The badges for a role.
 *
 * The numbers are collected at most once a minute (`BADGE_REFRESH_MS`); the
 * role filter is applied every time, so the same numbers can be shown to
 * different roles without asking the database again.
 */
export function getSidebarBadges(
  role: string | null | undefined,
  force = false
): SidebarBadge[] {
  const now = Date.now();
  if (force || !cachedAt || now - cachedAt >= BADGE_REFRESH_MS) {
    try {
      cachedInputs = collectBadgeInputs();
      cachedAt = now;
    } catch {
      // A broken query must never take the sidebar down — show nothing.
      cachedInputs = [];
      cachedAt = now;
    }
  }
  return buildBadges(role, cachedInputs);
}
