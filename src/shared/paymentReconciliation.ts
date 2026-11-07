/**
 * Pure payment reconciliation helper.
 * No database or Electron dependencies - can be used in tests and shared code.
 */

export interface PaymentRow {
  mode: string;
  amount: number;
}

export interface SaleRow {
  id: number;
  net_total: number;
  payments: PaymentRow[];
}

export interface ReconciliationResult {
  breakdown: Map<string, number>;
  remainder: number;
}

/**
 * Pure payment reconciliation helper.
 * For each completed sale:
 *   net = total_amount - returned_amount
 *   tendered = sum(payments)
 *   given = max(0, tendered - net)  // change given + cash refunds against this sale
 *   Allocate given to cash first, then other modes by descending tendered amount.
 *   collected_per_mode = tendered_mode - allocated_given
 * Returns { breakdown: Map<mode, collected>, remainder: total_sales - sum(collected) }
 * remainder >= 0 always; if > 0.005, it's a real unpaid amount (credit not recorded as payment).
 */
export function reconcilePayments(sales: SaleRow[]): ReconciliationResult {
  const collectedByMode = new Map<string, number>();
  let totalCollected = 0;
  let totalSales = 0;

  for (const sale of sales) {
    totalSales += sale.net_total;
    const tenderedByMode = new Map<string, number>();
    let tendered = 0;
    for (const p of sale.payments) {
      tendered += p.amount;
      tenderedByMode.set(p.mode, (tenderedByMode.get(p.mode) || 0) + p.amount);
    }
    const given = Math.max(0, tendered - sale.net_total);

    // Allocate given: cash first, then other modes by descending amount
    const modesByAmount = Array.from(tenderedByMode.entries()).sort((a, b) => {
      const cashFirst = a[0] === 'Cash' ? -1 : (b[0] === 'Cash' ? 1 : 0);
      return cashFirst || b[1] - a[1];
    });

    let remainingGiven = given;
    for (const [mode, amt] of modesByAmount) {
      const alloc = Math.min(amt, remainingGiven);
      const collected = amt - alloc;
      collectedByMode.set(mode, (collectedByMode.get(mode) || 0) + collected);
      totalCollected += collected;
      remainingGiven -= alloc;
      if (remainingGiven < 0) break;
    }
  }

  const remainder = totalSales - totalCollected;
  return { breakdown: collectedByMode, remainder };
}