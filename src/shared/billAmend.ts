/**
 * Bill amendment — the PURE half.
 *
 * Nothing here opens a database or touches the network: every function is a
 * calculation over the numbers a bill already carries, so the money rules can
 * be pinned by a test without a shop.
 *
 * The vocabulary:
 *   - a bill's **paid rows** are the `payments` rows (cash / card / bank …),
 *   - the bill's **credit** (udhaar) part is what was NOT paid:
 *     `credit = max(0, total - paid)`.
 *
 * An amendment states the FULL new split (cash + card + bank + credit), and
 * that split must add up to the bill total — the owner may move money between
 * the drawer, the card machine and the customer's ledger, but never create or
 * destroy any.
 */

/** The four buckets an amendment may move money between. */
export type BillAmendPaymentMode = 'cash' | 'card' | 'bank' | 'credit';

export const BILL_AMEND_PAYMENT_MODES: BillAmendPaymentMode[] = ['cash', 'card', 'bank', 'credit'];

/** One payment row of a bill (the `payments` table shape). */
export interface BillAmendPaymentRow {
  mode: string;
  amount: number;
}

/** A whole split: what was paid in cash/card/bank and what is on credit. */
export interface BillAmendSplit {
  cash: number;
  card: number;
  bank: number;
  credit: number;
}

/** The state of a bill that an amendment reads and writes. */
export interface BillAmendState {
  invoiceNo: string;
  total: number;
  customerId: number | null;
  customerName: string | null;
  notes: string | null;
  /** The paid rows (never a credit row — credit is the remainder). */
  payments: BillAmendPaymentRow[];
  /** The udhaar part of the bill. */
  credit: number;
}

/** One amendment row, as it is stored. */
export interface BillAmendRecord {
  id: number;
  saleId: number;
  userId: number | null;
  reason: string;
  kind: string;
  before: BillAmendState | null;
  after: BillAmendState | null;
  cashEffect: number;
  creditEffect: number;
  shiftId: number | null;
  createdAt: string;
}

/** Round to 2 decimals the way every money value in this app is stored. */
export function amendRound2(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A safe non-negative money value (never NaN, never negative). */
export function amendMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, amendRound2(n));
}

/** An empty split. */
export function emptySplit(): BillAmendSplit {
  return { cash: 0, card: 0, bank: 0, credit: 0 };
}

/** Coerce anything into a clean split (no NaN, no negatives). */
export function normalizeSplit(input: Partial<BillAmendSplit> | null | undefined): BillAmendSplit {
  return {
    cash: amendMoney(input?.cash),
    card: amendMoney(input?.card),
    bank: amendMoney(input?.bank),
    credit: amendMoney(input?.credit),
  };
}

/** The sum of a split. */
export function splitTotal(split: Partial<BillAmendSplit> | null | undefined): number {
  const s = normalizeSplit(split);
  return amendRound2(s.cash + s.card + s.bank + s.credit);
}

/** The paid part of a split (everything that is not credit). */
export function splitPaid(split: Partial<BillAmendSplit> | null | undefined): number {
  const s = normalizeSplit(split);
  return amendRound2(s.cash + s.card + s.bank);
}

/**
 * The split as payment ROWS (cash / card / bank). Zero rows are dropped so a
 * split never carries a meaningless "0.00 cash" line.
 */
export function splitToRows(split: Partial<BillAmendSplit> | null | undefined): BillAmendPaymentRow[] {
  const s = normalizeSplit(split);
  const rows: BillAmendPaymentRow[] = [];
  if (s.cash > 0) rows.push({ mode: 'cash', amount: s.cash });
  if (s.card > 0) rows.push({ mode: 'card', amount: s.card });
  if (s.bank > 0) rows.push({ mode: 'bank', amount: s.bank });
  return rows;
}

/** The FULL split (paid rows + the credit) as rows, zeros dropped. */
export function splitToFullRows(split: Partial<BillAmendSplit> | null | undefined): BillAmendPaymentRow[] {
  const s = normalizeSplit(split);
  const rows = splitToRows(s);
  if (s.credit > 0) rows.push({ mode: 'credit', amount: s.credit });
  return rows;
}

/**
 * The paid rows of a bill become a split. The credit is NOT read from the
 * rows — it is the remainder of the bill total.
 */
export function rowsToSplit(
  rows: BillAmendPaymentRow[] | null | undefined,
  total: number
): BillAmendSplit {
  let cash = 0;
  let card = 0;
  let bank = 0;
  let paid = 0;
  for (const row of rows ?? []) {
    const amount = amendMoney(row?.amount);
    if (amount <= 0) continue;
    const mode = String(row?.mode ?? '').trim().toLowerCase();
    if (mode === 'credit' || mode === 'udhaar') continue; // credit is the remainder
    paid = amendRound2(paid + amount);
    if (mode === 'cash') cash = amendRound2(cash + amount);
    else if (mode === 'card') card = amendRound2(card + amount);
    else if (mode === 'bank') bank = amendRound2(bank + amount);
  }
  const billTotal = amendMoney(total);
  return { cash, card, bank, credit: amendMoney(billTotal - paid) };
}

/** The split of a bill, from its paid rows and its total. */
export function billSplit(total: number, rows: BillAmendPaymentRow[] | null | undefined): BillAmendSplit {
  return rowsToSplit(rows, total);
}

/**
 * The payment split a bill must add up to.
 *
 * `null` means the split is fine; a string is the message the owner sees.
 */
export function validatePaymentSplit(
  total: number,
  split: Partial<BillAmendSplit> | null | undefined
): string | null {
  const billTotal = amendMoney(total);
  const s = normalizeSplit(split);
  const sum = splitTotal(s);
  if (Math.abs(sum - billTotal) > 0.009) {
    return `The payment split must add up to the bill total (${billTotal.toFixed(2)}) — it adds up to ${sum.toFixed(2)}`;
  }
  return null;
}

/** What one payment amendment does to the money. */
export interface PaymentAmendmentEffect {
  /** The change of the customer's outstanding balance (positive = they owe more). */
  creditEffect: number;
  /** The change of the drawer's cash (positive = more cash in the drawer). */
  cashEffect: number;
  /** The change of the card total. */
  cardEffect: number;
  /** The change of the bank total. */
  bankEffect: number;
  /** The change of the bill total (always 0 for a payment amendment). */
  totalDelta: number;
  /** The split before and after, so the UI can show "before -> after". */
  before: BillAmendSplit;
  after: BillAmendSplit;
}

/**
 * The money a payment-split amendment moves.
 *
 * The bill total never changes, so the four effects always add up to zero:
 * whatever leaves the drawer arrives on the customer's ledger (or on the card).
 */
export function calculatePaymentAmendment(
  before: Partial<BillAmendSplit> | null | undefined,
  after: Partial<BillAmendSplit> | null | undefined
): PaymentAmendmentEffect {
  const b = normalizeSplit(before);
  const a = normalizeSplit(after);
  return {
    creditEffect: amendRound2(a.credit - b.credit),
    cashEffect: amendRound2(a.cash - b.cash),
    cardEffect: amendRound2(a.card - b.card),
    bankEffect: amendRound2(a.bank - b.bank),
    totalDelta: amendRound2(splitTotal(a) - splitTotal(b)),
    before: b,
    after: a,
  };
}

/** What a customer move does to the two ledgers. */
export interface CustomerMoveEffect {
  /** The old customer's ledger changes by this (negative = they owe less). */
  oldCustomerDelta: number;
  /** The new customer's ledger changes by this (positive = they owe more). */
  newCustomerDelta: number;
}

/**
 * Moving a bill from one customer to another.
 *
 * The credit part of THIS bill leaves the old customer's ledger and arrives on
 * the new one. When the customer does not change, the ledger only follows the
 * change of the credit amount.
 */
export function calculateCustomerMove(
  beforeCustomerId: number | null,
  afterCustomerId: number | null,
  beforeCredit: number,
  afterCredit: number
): CustomerMoveEffect {
  const oldCredit = amendMoney(beforeCredit);
  const newCredit = amendMoney(afterCredit);
  if (beforeCustomerId === afterCustomerId) {
    const delta = amendRound2(newCredit - oldCredit);
    return { oldCustomerDelta: delta, newCustomerDelta: 0 };
  }
  return {
    oldCustomerDelta: beforeCustomerId === null ? 0 : amendRound2(-oldCredit),
    newCustomerDelta: afterCustomerId === null ? 0 : amendRound2(newCredit),
  };
}

/**
 * The CURRENT state of a bill: the original state with every amendment
 * applied in order.
 *
 * The last amendment's `after` wins — an amendment is always computed from
 * the state the bill was in when it was made.
 */
export function effectiveBillState(
  original: BillAmendState,
  amendments: BillAmendRecord[] | null | undefined
): BillAmendState {
  const chain = [...(amendments ?? [])].sort((a, b) => a.id - b.id);
  let state: BillAmendState = {
    invoiceNo: original.invoiceNo,
    total: amendMoney(original.total),
    customerId: original.customerId ?? null,
    customerName: original.customerName ?? null,
    notes: original.notes ?? null,
    payments: (original.payments ?? []).map((p) => ({ mode: p.mode, amount: amendMoney(p.amount) })),
    credit: amendMoney(original.credit),
  };
  for (const amendment of chain) {
    if (!amendment.after) continue;
    state = {
      invoiceNo: amendment.after.invoiceNo || state.invoiceNo,
      total: amendMoney(amendment.after.total ?? state.total),
      customerId: amendment.after.customerId ?? null,
      customerName: amendment.after.customerName ?? null,
      notes: amendment.after.notes ?? null,
      payments: (amendment.after.payments ?? []).map((p) => ({ mode: p.mode, amount: amendMoney(p.amount) })),
      credit: amendMoney(amendment.after.credit ?? state.credit),
    };
  }
  return state;
}

/** How many days ago the bill was sold (0 = today). */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const ms = now.getTime() - then.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** The result of the "how far back may a bill be amended" rule. */
export interface AmendmentWindow {
  allowed: boolean;
  daysBack: number;
  message: string | null;
}

/**
 * Whether a bill may still be amended.
 *
 * `maxDaysBack` of 0 means unlimited (the shipped default). A bill that is
 * older than the window is refused with a message the owner can read.
 */
export function amendmentWindow(
  createdAt: string | null | undefined,
  maxDaysBack: number,
  now: Date = new Date()
): AmendmentWindow {
  const limit = Math.max(0, Math.floor(Number(maxDaysBack) || 0));
  const age = daysSince(createdAt, now);
  if (limit === 0) return { allowed: true, daysBack: age, message: null };
  if (age <= limit) return { allowed: true, daysBack: age, message: null };
  return {
    allowed: false,
    daysBack: age,
    message: `This bill is ${age} days old — only bills from the last ${limit} day(s) can be amended`,
  };
}

/** The kinds of amendment the service knows. */
export const BILL_AMEND_KINDS = ['customer', 'payments', 'notes', 'items'] as const;
export type BillAmendKind = (typeof BILL_AMEND_KINDS)[number];

/** A short "before -> after" summary for the timeline and the audit log. */
export function summarizeAmendment(
  before: BillAmendState | null,
  after: BillAmendState | null
): string {
  if (!before || !after) return '';
  const parts: string[] = [];
  if ((before.customerId ?? null) !== (after.customerId ?? null)) {
    parts.push(`customer: ${before.customerName ?? 'Walk-in'} -> ${after.customerName ?? 'Walk-in'}`);
  }
  const b = billSplit(before.total, before.payments);
  const a = billSplit(after.total, after.payments);
  if (splitTotal(b) !== splitTotal(a) || b.credit !== a.credit) {
    parts.push(
      `split: cash ${b.cash.toFixed(2)}/udhaar ${b.credit.toFixed(2)} -> cash ${a.cash.toFixed(2)}/udhaar ${a.credit.toFixed(2)}`
    );
  }
  if ((before.notes ?? '') !== (after.notes ?? '')) parts.push('notes changed');
  if (amendMoney(before.total) !== amendMoney(after.total)) {
    parts.push(`total: ${amendMoney(before.total).toFixed(2)} -> ${amendMoney(after.total).toFixed(2)}`);
  }
  return parts.join(' | ');
}
