/**
 * Amending a bill's ITEMS — the PURE half.
 *
 * Changing the item, the quantity or the price of a FINISHED bill is the one
 * amendment that touches the stock, the FIFO batches AND the money. The rules
 * live here so they can be pinned by a test without a shop:
 *
 *   - the bill's money is recomputed with the EXACT maths `createSale` uses
 *     (`computeLines` / `computeTotals`), so an amended bill and a fresh bill
 *     of the same items agree to the cent,
 *   - the stock delta is the difference between what the bill sold and what it
 *     sells now — a removed line comes back, an added line goes out,
 *   - the paid rows of the bill NEVER change; the difference is the udhaar
 *     (on the customer's ledger) or the cash (in the drawer), and never both.
 *
 * Nothing here opens a database — the main process does the I/O.
 */
import { amendMoney, amendRound2, type BillAmendItemLine, type BillAmendSplit } from './billAmend';

/** The money of one line, with the app's exact rounding. */
export interface LineMoney {
  /** price × qty − the line discount (never negative). */
  taxable: number;
  /** The tax on the taxable amount. */
  tax: number;
  /** taxable + tax. */
  total: number;
}

/**
 * The money of one line.
 *
 * This is `computeLines()` from `sales.ts`, copied exactly — the amended bill
 * must add up the same way a fresh one does.
 */
export function lineMoney(line: BillAmendItemLine): LineMoney {
  const qty = Number(line.qty) || 0;
  const price = Number(line.unitPrice) || 0;
  const discount = Number(line.lineDiscount) || 0;
  const rate = Number(line.taxRate) || 0;
  const taxable = Math.max(0, price * qty - discount);
  const tax = (taxable * rate) / 100;
  return { taxable, tax, total: taxable + tax };
}

/** The bill-level numbers an items amendment has to recompute. */
export interface SaleTotals {
  /** The sum of the line amounts INCLUDING tax (what `computeTotals` calls the subtotal). */
  gross: number;
  /** The sum of the line amounts EXCLUDING tax (what `sales.subtotal` stores). */
  subtotal: number;
  taxAmount: number;
  /** The line discounts + the bill discount. */
  discountAmount: number;
  billDiscountAmount: number;
  /** The bill total before the service charge and the freight. */
  total: number;
  /** The bill total the customer pays (what `sales.total_amount` stores). */
  finalTotal: number;
}

/** The bill-level settings an items amendment has to keep. */
export interface SaleTotalsOptions {
  billDiscount?: number;
  discountType?: 'amount' | 'percent';
  serviceCharge?: number;
  serviceChargeType?: 'amount' | 'percent';
  freight?: number;
}

/**
 * The bill's money for a set of lines.
 *
 * This mirrors `computeTotals()` + the totals `createSale` writes, including
 * the service charge and the freight.
 */
export function recomputeSaleTotals(
  lines: BillAmendItemLine[] | null | undefined,
  options: SaleTotalsOptions = {}
): SaleTotals {
  const computed = (lines ?? []).map(lineMoney);
  const gross = computed.reduce((s, l) => s + l.total, 0);
  const subtotal = computed.reduce((s, l) => s + l.taxable, 0);
  const taxAmount = computed.reduce((s, l) => s + l.tax, 0);
  const lineDiscounts = (lines ?? []).reduce((s, l) => s + (Number(l.lineDiscount) || 0), 0);

  const billDiscount = Number(options.billDiscount) || 0;
  const discountType = options.discountType === 'percent' ? 'percent' : 'amount';
  const billDiscountAmount =
    discountType === 'percent'
      ? (gross * billDiscount) / 100
      : Math.min(billDiscount, gross);

  const total = Math.max(0, gross - billDiscountAmount);

  const serviceCharge = Number(options.serviceCharge) || 0;
  const serviceChargeType = options.serviceChargeType === 'percent' ? 'percent' : 'amount';
  const serviceChargeAmount =
    serviceChargeType === 'percent' ? (total * serviceCharge) / 100 : serviceCharge;
  const freight = Number(options.freight) || 0;

  return {
    gross,
    subtotal,
    taxAmount,
    discountAmount: lineDiscounts + billDiscountAmount,
    billDiscountAmount,
    total,
    finalTotal: total + serviceChargeAmount + freight,
  };
}

/**
 * Split an amount over a set of weights so the parts add up EXACTLY.
 *
 * The rounding drift is put on the biggest weight, so the sum of the parts is
 * the amount to the cent.
 */
export function distributeAmount(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(Number(w)) && Number(w) > 0 ? Number(w) : 0));
  const sum = clean.reduce((s, w) => s + w, 0);
  const amount = amendRound2(total);
  if (sum <= 0) {
    const out = new Array(n).fill(0);
    out[0] = amount;
    return out;
  }
  const parts = clean.map((w) => amendRound2((amount * w) / sum));
  let biggest = 0;
  for (let i = 1; i < n; i++) if (clean[i] > clean[biggest]) biggest = i;
  const drift = amendRound2(amount - parts.reduce((s, v) => s + v, 0));
  if (drift !== 0) parts[biggest] = amendRound2(parts[biggest] + drift);
  return parts;
}

/** What happens to one product's stock when the bill's items change. */
export interface ItemStockDelta {
  productId: number;
  name: string;
  /**
   * The change of the STOCK: positive = the units come back to the shelf,
   * negative = they go out of it.
   */
  delta: number;
  oldQty: number;
  newQty: number;
  /** The price changed (the stock is untouched, only the money moves). */
  priceChanged: boolean;
}

/**
 * The stock delta of an items amendment.
 *
 * A line that only changes its PRICE moves no stock at all — the goods left
 * the shop exactly as they did.
 */
export function planItemStockDeltas(
  before: BillAmendItemLine[] | null | undefined,
  after: BillAmendItemLine[] | null | undefined
): ItemStockDelta[] {
  const oldMap = new Map<number, BillAmendItemLine>();
  for (const l of before ?? []) oldMap.set(l.productId, l);
  const newMap = new Map<number, BillAmendItemLine>();
  for (const l of after ?? []) newMap.set(l.productId, l);

  const productIds = new Set<number>([...oldMap.keys(), ...newMap.keys()]);
  const out: ItemStockDelta[] = [];
  for (const productId of productIds) {
    const oldLine = oldMap.get(productId);
    const newLine = newMap.get(productId);
    const oldQty = oldLine ? Number(oldLine.qty) || 0 : 0;
    const newQty = newLine ? Number(newLine.qty) || 0 : 0;
    const oldPrice = oldLine ? amendRound2(oldLine.unitPrice) : 0;
    const newPrice = newLine ? amendRound2(newLine.unitPrice) : 0;
    out.push({
      productId,
      name: newLine?.name ?? oldLine?.name ?? `#${productId}`,
      // Positive = the units come BACK to the shelf.
      delta: amendRound2(oldQty - newQty),
      oldQty,
      newQty,
      priceChanged: oldPrice !== newPrice,
    });
  }
  return out.sort((a, b) => a.productId - b.productId);
}

/** Why a set of lines cannot be saved (null = they are fine). */
export function validateItemLines(lines: BillAmendItemLine[] | null | undefined): string | null {
  const list = lines ?? [];
  if (list.length === 0) return 'A bill must have at least one item';
  const seen = new Set<number>();
  for (const line of list) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.unitPrice) || 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      return `The quantity of "${line.name || 'an item'}" must be more than zero`;
    }
    if (!Number.isFinite(price) || price < 0) {
      return `The price of "${line.name || 'an item'}" cannot be negative`;
    }
    if (seen.has(line.productId)) {
      return `"${line.name || 'an item'}" is on the bill twice — merge the two lines`;
    }
    seen.add(line.productId);
  }
  return null;
}

/** What an items amendment does to the money. */
export interface ItemsSplitPlan {
  before: BillAmendSplit;
  after: BillAmendSplit;
  /** The change of the customer's outstanding balance (positive = they owe more). */
  creditEffect: number;
  /** The change of the drawer's cash (positive = more cash in the drawer). */
  cashEffect: number;
  /** The message when the amendment cannot be done (null = it can). */
  problem: string | null;
}

/**
 * The split after an items amendment.
 *
 * The PAID rows of the bill never change — the money that physically changed
 * hands when the bill was made is what it is. What the new total does is:
 *
 *   - it goes ABOVE what was paid: the extra is udhaar (the customer owes it)
 *     when the bill has a customer; without a customer the extra has to be
 *     paid in cash, so the drawer takes it,
 *   - it goes BELOW what was paid: the customer paid too much, so the drawer
 *     gives the difference back (in cash — a card/bank refund is not the
 *     drawer's to make),
 *   - the customer's ledger follows the udhaar part, and only that.
 */
export function planItemsSplit(
  beforeTotal: number,
  afterTotal: number,
  currentSplit: Partial<BillAmendSplit> | null | undefined,
  hasCustomer: boolean
): ItemsSplitPlan {
  const before: BillAmendSplit = {
    cash: amendMoney(currentSplit?.cash),
    card: amendMoney(currentSplit?.card),
    bank: amendMoney(currentSplit?.bank),
    credit: amendMoney(currentSplit?.credit),
  };
  const paid = amendRound2(before.cash + before.card + before.bank);
  const newTotal = amendMoney(afterTotal);

  if (newTotal >= paid) {
    const extra = amendRound2(newTotal - paid);
    if (hasCustomer) {
      // The extra lands on the customer's ledger.
      const after: BillAmendSplit = { cash: before.cash, card: before.card, bank: before.bank, credit: extra };
      return {
        before,
        after,
        creditEffect: amendRound2(after.credit - before.credit),
        cashEffect: 0,
        problem: null,
      };
    }
    // No customer: the extra has to be paid now, so the drawer takes it.
    const after: BillAmendSplit = {
      cash: amendRound2(before.cash + extra),
      card: before.card,
      bank: before.bank,
      credit: 0,
    };
    return {
      before,
      after,
      creditEffect: amendRound2(0 - before.credit),
      cashEffect: extra,
      problem: null,
    };
  }

  // The bill is now worth less than what was paid — the drawer gives the
  // difference back.
  const refund = amendRound2(paid - newTotal);
  if (refund > before.cash) {
    return {
      before,
      after: before,
      creditEffect: 0,
      cashEffect: 0,
      problem: `The refund of ${refund.toFixed(2)} is more than the ${before.cash.toFixed(
        2
      )} cash this bill took — refund the card/bank part by hand`,
    };
  }
  const after: BillAmendSplit = {
    cash: amendRound2(before.cash - refund),
    card: before.card,
    bank: before.bank,
    credit: 0,
  };
  return {
    before,
    after,
    creditEffect: amendRound2(0 - before.credit),
    cashEffect: amendRound2(-refund),
    problem: null,
  };
}

/** A short "before -> after" summary of an items amendment. */
export function summarizeItemChanges(
  before: BillAmendItemLine[] | null | undefined,
  after: BillAmendItemLine[] | null | undefined
): string {
  const deltas = planItemStockDeltas(before, after);
  const parts: string[] = [];
  for (const d of deltas) {
    if (d.delta !== 0) {
      parts.push(`${d.name}: qty ${d.oldQty} -> ${d.newQty}`);
    } else if (d.priceChanged) {
      const oldLine = (before ?? []).find((l) => l.productId === d.productId);
      const newLine = (after ?? []).find((l) => l.productId === d.productId);
      parts.push(
        `${d.name}: price ${amendRound2(oldLine?.unitPrice ?? 0).toFixed(2)} -> ${amendRound2(
          newLine?.unitPrice ?? 0
        ).toFixed(2)}`
      );
    }
  }
  return parts.join(' | ');
}
