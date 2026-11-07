/**
 * Pure dashboard arithmetic.
 *
 * These three numbers were previously computed inline from the wrong sources
 * (`Total Payable` and `Total Receivable` both summed customer balances, and
 * `Sale Return` summed every sale instead of only returns). Keeping the maths
 * here makes the correction testable without booting Electron.
 */
export interface BalanceRow {
  balance?: unknown;
}

export interface SaleRow {
  status?: unknown;
  total_amount?: unknown;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Amount the shop owes suppliers (only positive balances are outstanding). */
export function sumPayables(rows: BalanceRow[]): number {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + Math.max(0, num(row?.balance)),
    0
  );
}

/** Amount customers owe the shop. */
export function sumReceivables(rows: BalanceRow[]): number {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + Math.max(0, num(row?.balance)),
    0
  );
}

/**
 * Refunds are stored as their own negative sale (`status = 'returned'`) and are
 * excluded from `sales.list()` by default. When they are included, sum their
 * absolute value — never the absolute value of ordinary revenue.
 */
export function sumSaleReturns(rows: SaleRow[]): number {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.status === 'returned' || num(row?.total_amount) < 0)
    .reduce((sum, row) => sum + Math.abs(num(row?.total_amount)), 0);
}

/** Cash collected today from completed sales (payments recorded as cash). */
export function sumCashCollected(rows: SaleRow[]): number {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + num(row?.total_amount),
    0
  );
}
