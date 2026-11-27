/**
 * Amending a FINISHED bill.
 *
 * A finished bill is never silently overwritten. Every amendment is a new row
 * in `sale_amendments` that carries the FULL previous state (`before_json`),
 * the new state (`after_json`), the money it moved (`cash_effect`,
 * `credit_effect`), who did it and WHY.
 *
 * The permissions live HERE, not in the UI: a cashier can never amend, a
 * manager can only amend when `amend_allow_manager` is on AND they re-enter
 * their own PIN, and the owner can always amend. Every amendment needs a
 * reason.
 *
 * The money rules (all of them in `src/shared/billAmend.ts`):
 *   - the bill total NEVER changes in a customer / payment / notes amendment,
 *   - the change of the udhaar part is the customer's ledger,
 *   - the change of the cash part is a cash adjustment on the CURRENT OPEN
 *     shift — a closed shift is never touched,
 *   - everything happens in ONE transaction: on any error nothing changes.
 */
import { getDb } from '../db';
import { can, currentUser, getSessionUserId, verifyForUser } from './auth';
import { getAdminSetting } from './admin';
import { logActivity } from './activity';
import { currentShift } from './shifts';
import { recordSaleEvent } from './salesHistory';
import { stripCostFields } from '../../shared/historyPrivacy';
import {
  deductStockFIFO,
  getProduct,
  recordFIFOAllocations,
  recordMovement,
  roundStock,
} from './inventory';
import { getSetting } from './settings';
import {
  amendMoney,
  amendRound2,
  amendmentWindow,
  billSplit,
  calculateCustomerMove,
  calculatePaymentAmendment,
  effectiveBillState,
  emptySplit,
  normalizeSplit,
  splitTotal,
  splitToFullRows,
  splitToRows,
  summarizeAmendment,
  validatePaymentSplit,
  type BillAmendItemLine,
  type BillAmendKind,
  type BillAmendPaymentRow,
  type BillAmendRecord,
  type BillAmendSplit,
  type BillAmendState,
} from '../../shared/billAmend';
import {
  distributeAmount,
  lineMoney,
  planItemStockDeltas,
  planItemsSplit,
  recomputeSaleTotals,
  summarizeItemChanges,
  validateItemLines,
} from '../../shared/billAmendItems';
import { isExpiredOn } from '../../shared/expiry';
import { todayIso } from '../../shared/calendarGrid';
import { batchStockState } from './inventory';

/** The amendment kinds the service writes. */
export type AmendmentKind = BillAmendKind;

export interface AmendmentActor {
  id: number;
  role: 'owner' | 'manager' | 'cashier';
  username: string;
}

export interface AmendCustomerInput {
  saleId: number;
  /** The customer the bill moves to; `null` means walk-in. */
  customerId: number | null;
  reason: string;
  /** The manager's PIN (or password) re-entered for the change. */
  managerPin?: string;
  /** Only the owner may go over a customer's credit limit. */
  overrideCreditLimit?: boolean;
}

export interface AmendPaymentsInput {
  saleId: number;
  /** The FULL new split: cash + card + bank + credit must equal the total. */
  split: Partial<BillAmendSplit>;
  reason: string;
  managerPin?: string;
}

export interface AmendNotesInput {
  saleId: number;
  notes: string | null;
  reason: string;
  managerPin?: string;
}

/** One line of the new bill the owner wants. */
export interface AmendItemLineInput {
  productId: number;
  qty: number;
  unitPrice: number;
}

export interface AmendItemsInput {
  saleId: number;
  /** The FULL new set of lines of the bill. */
  lines: AmendItemLineInput[];
  reason: string;
  managerPin?: string;
  /** Only the owner may go over the customer's credit limit. */
  overrideCreditLimit?: boolean;
  /** Only the owner may set a price below the cost price. */
  priceFloorOverride?: boolean;
}

export interface AmendmentResult {
  ok: true;
  amendment: BillAmendRecord;
  /** The bill's state after the amendment. */
  state: BillAmendState;
  /** The money the amendment moved. */
  cashEffect: number;
  creditEffect: number;
}

/** One amendment row as the UI and the test see it. */
export interface AmendmentRow {
  id: number;
  saleId: number;
  userId: number | null;
  username: string | null;
  reason: string;
  kind: string;
  before: unknown;
  after: unknown;
  cashEffect: number;
  creditEffect: number;
  shiftId: number | null;
  createdAt: string;
}

/** The whole amend screen's state. */
export interface BillAmendView {
  saleId: number;
  invoiceNo: string;
  total: number;
  createdAt: string;
  status: string;
  customerId: number | null;
  customerName: string | null;
  notes: string | null;
  payments: BillAmendPaymentRow[];
  credit: number;
  split: BillAmendSplit;
  /** The lines of the bill — the Items tab edits these. */
  items: BillAmendItemLine[];
  /**
   * The bill-level numbers the total is made of, so the Items tab can show
   * the NEW total before the amendment is saved (and not guess at it).
   */
  billDiscount: number;
  discountType: 'amount' | 'percent';
  serviceCharge: number;
  serviceChargeType: 'amount' | 'percent';
  freight: number;
  /** Whether this bill may have its items changed at all. */
  itemsAllowed: boolean;
  /** Why the items cannot be changed (the message the owner reads). */
  itemsBlockedReason: string | null;
  amendedCount: number;
  lastAmendedAt: string | null;
  amendments: AmendmentRow[];
  /** Whether the signed-in user may amend at all. */
  allowed: boolean;
  /** Why not (the message the owner reads). */
  blockedReason: string | null;
  /** The days-back window that applies to this bill. */
  maxDaysBack: number;
  daysBack: number;
  /** Whether a manager may amend in this shop. */
  allowManager: boolean;
}

function actor(): AmendmentActor | null {
  const user = currentUser();
  if (!user) return null;
  return {
    id: user.id,
    role: user.role === 'owner' || user.role === 'manager' ? user.role : 'cashier',
    username: user.username,
  };
}

/** `amend_allow_manager` (1 = a manager may amend, the shipped default). */
export function amendAllowManager(): boolean {
  return getAdminSetting('amend_allow_manager') !== '0';
}

/** `amend_max_days_back` (0 = unlimited, the shipped default). */
export function amendMaxDaysBack(): number {
  const n = Number(getAdminSetting('amend_max_days_back') ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The SERVER-side gate.
 *
 * The UI hides the button, but this is what actually decides — a cashier is
 * refused, a manager needs the setting on and their own PIN re-entered, and
 * the owner always may.
 */
export function assertCanAmend(managerPin?: string | null): AmendmentActor {
  const who = actor();
  if (!who) throw new Error('Sign in again.');
  if (who.role === 'cashier') {
    throw new Error('Only the owner or a manager can amend a bill');
  }
  if (who.role === 'owner') return who;
  if (!amendAllowManager()) {
    throw new Error('Managers cannot amend bills in this shop — ask the owner');
  }
  const pin = String(managerPin ?? '').trim();
  if (!pin) {
    throw new Error('Enter your PIN again to amend a bill');
  }
  if (!verifyForUser(who.id, pin)) {
    throw new Error('That PIN is not correct');
  }
  return who;
}

/** The bill's state BEFORE any amendment (the original rows). */
function originalState(saleId: number): BillAmendState | null {
  const db = getDb();
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`
    )
    .get(saleId) as
    | {
        id: number;
        invoice_no: string;
        customer_id: number | null;
        customer_name: string | null;
        notes: string | null;
        total_amount: number;
        created_at: string;
        status: string;
      }
    | undefined;
  if (!sale) return null;
  const rows = db
    .prepare('SELECT mode, amount FROM payments WHERE sale_id = ? ORDER BY id')
    .all(saleId) as unknown as BillAmendPaymentRow[];
  const total = amendMoney(sale.total_amount);
  return {
    invoiceNo: sale.invoice_no,
    total,
    customerId: sale.customer_id ?? null,
    customerName: sale.customer_name ?? null,
    notes: sale.notes ?? null,
    payments: rows.map((r) => ({ mode: r.mode, amount: amendMoney(r.amount) })),
    credit: billSplit(total, rows).credit,
  };
}

/** Every amendment of a bill, oldest first. */
export function listAmendments(saleId: number): AmendmentRow[] {
  const db = getDb();
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db
      .prepare(
        `SELECT a.*, u.username FROM sale_amendments a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.sale_id = ? ORDER BY a.id`
      )
      .all(saleId) as unknown as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    id: Number(r.id),
    saleId: Number(r.sale_id),
    userId: r.user_id == null ? null : Number(r.user_id),
    username: (r.username as string | null) ?? null,
    reason: String(r.reason ?? ''),
    kind: String(r.kind ?? ''),
    before: safeJson(r.before_json),
    after: safeJson(r.after_json),
    cashEffect: amendRound2(r.cash_effect),
    creditEffect: amendRound2(r.credit_effect),
    shiftId: r.shift_id == null ? null : Number(r.shift_id),
    createdAt: String(r.created_at ?? ''),
  }));
}

function safeJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The amendments as the pure chain the calculators understand. */
export function amendmentChain(saleId: number): BillAmendRecord[] {
  return listAmendments(saleId).map((row) => ({
    id: row.id,
    saleId: row.saleId,
    userId: row.userId,
    reason: row.reason,
    kind: row.kind,
    before: (row.before as BillAmendState | null) ?? null,
    after: (row.after as BillAmendState | null) ?? null,
    cashEffect: row.cashEffect,
    creditEffect: row.creditEffect,
    shiftId: row.shiftId,
    createdAt: row.createdAt,
  }));
}

/** The bill's CURRENT state (the original plus every amendment). */
export function currentBillState(saleId: number): BillAmendState | null {
  const original = originalState(saleId);
  if (!original) return null;
  return effectiveBillState(original, amendmentChain(saleId));
}

/** The whole amend screen's state. */
export function getBillAmendView(saleId: number): BillAmendView | null {
  const original = originalState(saleId);
  if (!original) return null;
  const state = effectiveBillState(original, amendmentChain(saleId));
  const db = getDb();
  const saleRow = db
    .prepare('SELECT status, created_at, amended_count, last_amended_at FROM sales WHERE id = ?')
    .get(saleId) as
    | { status: string; created_at: string; amended_count: number | null; last_amended_at: string | null }
    | undefined;
  const who = actor();
  let allowed = false;
  let blockedReason: string | null = null;
  if (!who) {
    blockedReason = 'Sign in again.';
  } else if (who.role === 'cashier') {
    blockedReason = 'Only the owner or a manager can amend a bill';
  } else if (who.role === 'manager' && !amendAllowManager()) {
    blockedReason = 'Managers cannot amend bills in this shop — ask the owner';
  } else if (String(saleRow?.status ?? 'completed') !== 'completed') {
    blockedReason = `Only a completed bill can be amended (this one is ${saleRow?.status})`;
  } else {
    const window = amendmentWindow(saleRow?.created_at, amendMaxDaysBack());
    if (!window.allowed) blockedReason = window.message;
    else allowed = true;
  }
  const items = billItemLines(saleId);
  const itemsBlocked = itemsBlockedReason(saleId);
  const amendments = listAmendments(saleId);
  const billRow = db
    .prepare(
      'SELECT bill_discount, discount_type, service_charge, service_charge_type, freight FROM sales WHERE id = ?'
    )
    .get(saleId) as
    | {
        bill_discount: number | null;
        discount_type: string | null;
        service_charge: number | null;
        service_charge_type: string | null;
        freight: number | null;
      }
    | undefined;
  return {
    saleId,
    invoiceNo: state.invoiceNo,
    total: state.total,
    createdAt: String(saleRow?.created_at ?? ''),
    status: String(saleRow?.status ?? 'completed'),
    customerId: state.customerId,
    customerName: state.customerName,
    notes: state.notes,
    payments: state.payments,
    credit: state.credit,
    split: billSplit(state.total, state.payments),
    items,
    billDiscount: Number(billRow?.bill_discount ?? 0),
    discountType: billRow?.discount_type === 'percent' ? 'percent' : 'amount',
    serviceCharge: Number(billRow?.service_charge ?? 0),
    serviceChargeType: billRow?.service_charge_type === 'percent' ? 'percent' : 'amount',
    freight: Number(billRow?.freight ?? 0),
    itemsAllowed: allowed && itemsBlocked === null,
    itemsBlockedReason: itemsBlocked,
    amendedCount: Number(saleRow?.amended_count ?? amendments.length),
    lastAmendedAt: saleRow?.last_amended_at ?? null,
    // A cashier never sees cost or profit in an amendment view.
    amendments: stripCostFields(amendments) as AmendmentRow[],
    allowed,
    blockedReason,
    maxDaysBack: amendMaxDaysBack(),
    daysBack: amendmentWindow(saleRow?.created_at, amendMaxDaysBack()).daysBack,
    allowManager: amendAllowManager(),
  };
}

/** The customer row the amend screen needs. */
function customerRow(customerId: number | null): { id: number; name: string; balance: number; credit_limit: number | null } | null {
  if (customerId == null) return null;
  const row = getDb()
    .prepare('SELECT id, name, balance, credit_limit FROM customers WHERE id = ?')
    .get(customerId) as
    | { id: number; name: string; balance: number; credit_limit: number | null }
    | undefined;
  return row ?? null;
}

/** One `sale_items` row — the per-batch rows a line is made of. */
interface SaleItemRow {
  id: number;
  product_id: number;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
  batch_id: number | null;
  returned_qty: number;
  promo_id: number | null;
  promo_name: string | null;
  box_qty: number | null;
  unit_name: string | null;
  display_qty: number | null;
}

/** The `sale_items` rows of a bill, oldest first. */
function saleItemRows(saleId: number): SaleItemRow[] {
  return getDb()
    .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id')
    .all(saleId) as unknown as SaleItemRow[];
}

/**
 * The bill's lines, one per product.
 *
 * A line can be several `sale_items` rows (one per FIFO batch), so the rows
 * are merged: the qty and the discount are added up, the price and the tax
 * rate are the ones of the first row (they are the same on every row).
 */
export function billItemLines(saleId: number): BillAmendItemLine[] {
  const db = getDb();
  const rows = saleItemRows(saleId);
  const byProduct = new Map<number, BillAmendItemLine>();
  for (const r of rows) {
    const name =
      (db.prepare('SELECT name FROM products WHERE id = ?').get(r.product_id) as
        | { name: string }
        | undefined)?.name ?? `#${r.product_id}`;
    const line = byProduct.get(r.product_id);
    if (!line) {
      byProduct.set(r.product_id, {
        productId: r.product_id,
        name,
        qty: Number(r.qty) || 0,
        unitPrice: Number(r.unit_price) || 0,
        lineDiscount: amendRound2(Number(r.discount) || 0),
        taxRate: Number(r.tax_rate) || 0,
      });
    } else {
      line.qty = roundStock(line.qty + (Number(r.qty) || 0));
      line.lineDiscount = amendRound2(line.lineDiscount + (Number(r.discount) || 0));
    }
  }
  return [...byProduct.values()];
}

/**
 * Why the items of a bill may not be changed (null = they may).
 *
 * A refunded bill is left alone: the refund is its own record (a negative
 * sale) and its `returned_qty` is read against these very rows, so moving
 * them under the refund would quietly rewrite the money the customer already
 * got back.
 */
function itemsBlockedReason(saleId: number): string | null {
  const db = getDb();
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM returns WHERE sale_id = ?')
      .get(saleId) as { c: number } | undefined;
    if (Number(row?.c ?? 0) > 0) {
      return 'This bill has a return — the refund is its own record. Amend its payments or notes instead.';
    }
    const sale = db.prepare('SELECT returned_amount FROM sales WHERE id = ?').get(saleId) as
      | { returned_amount: number | null }
      | undefined;
    if (Number(sale?.returned_amount ?? 0) > 0) {
      return 'This bill has a return — the refund is its own record. Amend its payments or notes instead.';
    }
  } catch {
    /* the table may not exist yet — do not block the amendment over it */
  }
  return null;
}

/**
 * Write one amendment: the row, the sale's counters, the timeline event and
 * the audit log entry. The caller owns the transaction.
 */
function writeAmendment(
  db: ReturnType<typeof getDb>,
  input: {
    saleId: number;
    who: AmendmentActor;
    reason: string;
    kind: AmendmentKind;
    before: BillAmendState;
    after: BillAmendState;
    cashEffect: number;
    creditEffect: number;
    shiftId: number | null;
    createdAt: string;
  }
): AmendmentResult {
  const info = db
    .prepare(
      `INSERT INTO sale_amendments
        (sale_id, user_id, reason, kind, before_json, after_json, cash_effect, credit_effect, shift_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.saleId,
      input.who.id,
      input.reason,
      input.kind,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      amendRound2(input.cashEffect),
      amendRound2(input.creditEffect),
      input.shiftId ?? null,
      input.createdAt
    );
  const id = Number(info.lastInsertRowid);

  db.prepare(
    "UPDATE sales SET amended_count = COALESCE(amended_count, 0) + 1, last_amended_at = ? WHERE id = ?"
  ).run(input.createdAt, input.saleId);

  recordSaleEvent({
    event_type: 'amend',
    sale_id: input.saleId,
    invoice_no: input.before.invoiceNo,
    user_id: input.who.id,
    amount: amendRound2(input.after.total - input.before.total),
    reason: input.reason,
    snapshot: stripCostFields({
      state: 'amended',
      kind: input.kind,
      original_invoice: input.before.invoiceNo,
      amendment_id: id,
      customer_id: input.after.customerId,
      customer_name: input.after.customerName,
      total: input.after.total,
      cash_effect: amendRound2(input.cashEffect),
      credit_effect: amendRound2(input.creditEffect),
      summary: summarizeAmendment(input.before, input.after),
      before: input.before,
      after: input.after,
    }),
    created_at: input.createdAt,
  });

  const amendment: BillAmendRecord = {
    id,
    saleId: input.saleId,
    userId: input.who.id,
    reason: input.reason,
    kind: input.kind,
    before: input.before,
    after: input.after,
    cashEffect: amendRound2(input.cashEffect),
    creditEffect: amendRound2(input.creditEffect),
    shiftId: input.shiftId,
    createdAt: input.createdAt,
  };
  return {
    ok: true,
    amendment,
    state: input.after,
    cashEffect: amendment.cashEffect,
    creditEffect: amendment.creditEffect,
  };
}

/** The reason is never optional. */
function requireReason(reason: unknown): string {
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('A reason is required to amend a bill');
  return text;
}

/** The bill must exist and still be a completed sale. */
function requireCompletedSale(saleId: number): void {
  const db = getDb();
  const row = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error('Sale not found');
  if (row.status !== 'completed') {
    throw new Error(`Only a completed bill can be amended (this one is ${row.status})`);
  }
}

/** The window rule ("max days back an amendment is allowed"). */
function requireWithinWindow(saleId: number): void {
  const db = getDb();
  const row = db.prepare('SELECT created_at FROM sales WHERE id = ?').get(saleId) as
    | { created_at: string }
    | undefined;
  const window = amendmentWindow(row?.created_at, amendMaxDaysBack());
  if (!window.allowed) throw new Error(window.message ?? 'This bill can no longer be amended');
}

/**
 * A) Move the bill to another customer.
 *
 * The udhaar part of THIS bill leaves the old customer's ledger and arrives on
 * the new one. A walk-in bill is only allowed when the bill has no credit part.
 */
export function amendCustomer(input: AmendCustomerInput): AmendmentResult {
  const who = assertCanAmend(input.managerPin);
  const reason = requireReason(input.reason);
  const saleId = Number(input.saleId);
  requireCompletedSale(saleId);
  requireWithinWindow(saleId);

  const db = getDb();
  const before = currentBillState(saleId);
  if (!before) throw new Error('Sale not found');
  const newCustomerId = input.customerId == null ? null : Number(input.customerId);
  if (newCustomerId === before.customerId) {
    throw new Error('This bill already belongs to that customer');
  }
  const target = customerRow(newCustomerId);
  if (newCustomerId != null && !target) throw new Error('Customer not found');
  if (newCustomerId == null && before.credit > 0) {
    throw new Error('This bill has udhaar on it — it cannot become a walk-in bill');
  }
  if (target) {
    const limit = Number(target.credit_limit ?? 0);
    if (limit > 0 && target.balance + before.credit > limit) {
      const over = target.balance + before.credit - limit;
      if (!input.overrideCreditLimit) {
        throw new Error(
          `Credit limit exceeded — ${target.name} would owe ${(target.balance + before.credit).toFixed(2)} (limit ${limit.toFixed(2)})`
        );
      }
      if (who.role !== 'owner') {
        throw new Error('Only the owner may go over a credit limit');
      }
      // The reason already says why — keep the over-limit amount in the audit.
      void over;
    }
  }

  const move = calculateCustomerMove(before.customerId, newCustomerId, before.credit, before.credit);
  const after: BillAmendState = {
    ...before,
    customerId: newCustomerId,
    customerName: target ? target.name : null,
  };

  db.exec('BEGIN');
  try {
    if (move.oldCustomerDelta !== 0 && before.customerId != null) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(
        move.oldCustomerDelta,
        before.customerId
      );
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(before.customerId, saleId, move.oldCustomerDelta, 'amend', new Date().toISOString());
    }
    if (move.newCustomerDelta !== 0 && newCustomerId != null) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(
        move.newCustomerDelta,
        newCustomerId
      );
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(newCustomerId, saleId, move.newCustomerDelta, 'amend', new Date().toISOString());
    }
    db.prepare('UPDATE sales SET customer_id = ? WHERE id = ?').run(newCustomerId, saleId);

    const result = writeAmendment(db, {
      saleId,
      who,
      reason,
      kind: 'customer',
      before,
      after,
      cashEffect: 0,
      creditEffect: move.oldCustomerDelta + move.newCustomerDelta,
      shiftId: null,
      createdAt: new Date().toISOString(),
    });
    db.exec('COMMIT');
    logActivity(
      'sale_amended',
      'sale',
      saleId,
      `kind=customer | invoice=${before.invoiceNo} | ${before.customerName ?? 'Walk-in'} -> ${
        target ? target.name : 'Walk-in'
      } | reason=${reason}`
    );
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * B) Change the payment split / the udhaar amount.
 *
 * The new split must add up to the bill total. The change of the udhaar part
 * is the customer's ledger; the change of the cash part is a cash adjustment
 * on the CURRENT OPEN shift (a closed shift is never touched).
 */
export function amendPayments(input: AmendPaymentsInput): AmendmentResult {
  const who = assertCanAmend(input.managerPin);
  const reason = requireReason(input.reason);
  const saleId = Number(input.saleId);
  requireCompletedSale(saleId);
  requireWithinWindow(saleId);

  const before = currentBillState(saleId);
  if (!before) throw new Error('Sale not found');
  const next = normalizeSplit(input.split);
  const problem = validatePaymentSplit(before.total, next);
  if (problem) throw new Error(problem);
  const beforeSplit = billSplit(before.total, before.payments);
  const effect = calculatePaymentAmendment(beforeSplit, next);
  if (
    effect.cashEffect === 0 &&
    effect.cardEffect === 0 &&
    effect.bankEffect === 0 &&
    effect.creditEffect === 0
  ) {
    throw new Error('Nothing to change — the payment split is the same');
  }
  // A bill with udhaar must belong to a customer.
  if (next.credit > 0 && !before.customerId) {
    throw new Error('Udhaar needs a customer — set the customer first');
  }
  const customer = customerRow(before.customerId);
  if (customer && next.credit > before.credit) {
    const limit = Number(customer.credit_limit ?? 0);
    if (limit > 0 && customer.balance + (next.credit - before.credit) > limit) {
      throw new Error(
        `Credit limit exceeded — ${customer.name} would owe ${(customer.balance + next.credit - before.credit).toFixed(2)} (limit ${limit.toFixed(2)})`
      );
    }
  }

  // The cash adjustment needs an OPEN shift — a closed shift is never mutated.
  let shiftId: number | null = null;
  if (effect.cashEffect !== 0) {
    const shift = currentShift();
    if (!shift) {
      throw new Error('Open a shift before changing the cash of a bill — a closed shift is never changed');
    }
    shiftId = shift.id;
  }

  const after: BillAmendState = {
    ...before,
    payments: splitToRows(next),
    credit: next.credit,
  };

  const db = getDb();
  db.exec('BEGIN');
  try {
    if (effect.creditEffect !== 0 && before.customerId != null) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(
        effect.creditEffect,
        before.customerId
      );
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(before.customerId, saleId, effect.creditEffect, 'amend', new Date().toISOString());
    }
    const result = writeAmendment(db, {
      saleId,
      who,
      reason,
      kind: 'payments',
      before,
      after,
      cashEffect: effect.cashEffect,
      creditEffect: effect.creditEffect,
      shiftId,
      createdAt: new Date().toISOString(),
    });
    db.exec('COMMIT');
    logActivity(
      'sale_amended',
      'sale',
      saleId,
      `kind=payments | invoice=${before.invoiceNo} | cash ${effect.cashEffect >= 0 ? '+' : ''}${effect.cashEffect.toFixed(
        2
      )} | udhaar ${effect.creditEffect >= 0 ? '+' : ''}${effect.creditEffect.toFixed(2)} | reason=${reason}`
    );
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * C) Edit the notes / the invoice-level text.
 *
 * No money moves, so no shift is needed.
 */
export function amendNotes(input: AmendNotesInput): AmendmentResult {
  const who = assertCanAmend(input.managerPin);
  const reason = requireReason(input.reason);
  const saleId = Number(input.saleId);
  requireCompletedSale(saleId);
  requireWithinWindow(saleId);

  const before = currentBillState(saleId);
  if (!before) throw new Error('Sale not found');
  const notes = input.notes == null ? null : String(input.notes).trim() || null;
  if ((before.notes ?? null) === notes) throw new Error('Nothing to change — the notes are the same');
  const after: BillAmendState = { ...before, notes };

  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE sales SET notes = ? WHERE id = ?').run(notes, saleId);
    const result = writeAmendment(db, {
      saleId,
      who,
      reason,
      kind: 'notes',
      before,
      after,
      cashEffect: 0,
      creditEffect: 0,
      shiftId: null,
      createdAt: new Date().toISOString(),
    });
    db.exec('COMMIT');
    logActivity('sale_amended', 'sale', saleId, `kind=notes | invoice=${before.invoiceNo} | reason=${reason}`);
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Give `take` units of a sale line back to the shelf.
 *
 * The units go back to the FIFO batch they were taken from, and the
 * allocation rows are shortened so the batch's available quantity grows with
 * them. Units that were sold while the stock was already negative have no
 * batch — they come back to the product only.
 */
function restoreLineStock(
  db: ReturnType<typeof getDb>,
  saleId: number,
  row: SaleItemRow,
  take: number
): void {
  const allocations = db
    .prepare(
      'SELECT id, product_batch_id, allocated_qty FROM fifo_allocations WHERE sale_item_id = ? ORDER BY id DESC'
    )
    .all(row.id) as unknown as { id: number; product_batch_id: number; allocated_qty: number }[];
  let remaining = roundStock(take);
  for (const alloc of allocations) {
    if (remaining <= 0) break;
    const back = Math.min(remaining, Number(alloc.allocated_qty) || 0);
    if (back <= 0) continue;
    recordMovement(row.product_id, back, 'Sale Amend', 'sale_amend', saleId, alloc.product_batch_id);
    const left = roundStock((Number(alloc.allocated_qty) || 0) - back);
    if (left <= 0) db.prepare('DELETE FROM fifo_allocations WHERE id = ?').run(alloc.id);
    else db.prepare('UPDATE fifo_allocations SET allocated_qty = ? WHERE id = ?').run(left, alloc.id);
    remaining = roundStock(remaining - back);
  }
  if (remaining > 0) {
    // These units were sold when the stock was already negative — there is no
    // batch to give them back to.
    recordMovement(row.product_id, remaining, 'Sale Amend', 'sale_amend', saleId, null);
  }
}

/**
 * Take `qty` more units of a product out of the stock (FIFO, oldest batch
 * first) and return the allocations, so the caller can write the matching
 * `fifo_allocations` rows.
 */
function takeMoreStock(
  db: ReturnType<typeof getDb>,
  saleId: number,
  productId: number,
  qty: number,
  allowNegative: boolean,
  today: string
): { batchId: number; qty: number }[] {
  // Phase 1, item 1.6 — an expired batch is never taken (the same rule the
  // till uses). A product with a mix of fresh and expired batches sells the
  // fresh ones; a product with only expired ones is refused by the gate
  // above.
  const allocations = deductStockFIFO(productId, qty, allowNegative, { today, skipExpired: true });
  let taken = 0;
  for (const alloc of allocations) {
    recordMovement(productId, -alloc.qty, 'Sale Amend', 'sale_amend', saleId, alloc.batchId);
    taken = roundStock(taken + alloc.qty);
  }
  const shortfall = roundStock(qty - taken);
  if (shortfall > 0) {
    // The stock was not there — the product goes negative, as it may.
    recordMovement(productId, -shortfall, 'Sale Amend', 'sale_amend', saleId, null);
  }
  return allocations;
}

/**
 * F) Change the items of a finished bill (the item, the quantity, the price).
 *
 * This is the one amendment that moves STOCK:
 *   - a line that loses units gives them back to the shelf AND to the FIFO
 *     batch they came from (the newest allocation first),
 *   - a line that gains units takes them from the oldest batch first,
 *   - a line that only changes its PRICE moves no stock at all.
 *
 * The money follows the bill's own rules: the paid rows never change, the
 * udhaar part follows the customer's ledger, and the cash part follows the
 * open shift. The bill's totals are recomputed with the exact maths a fresh
 * sale of the same items uses, so the amended bill and a fresh bill agree.
 */
export function amendItems(input: AmendItemsInput): AmendmentResult {
  const who = assertCanAmend(input.managerPin);
  const reason = requireReason(input.reason);
  const saleId = Number(input.saleId);
  requireCompletedSale(saleId);
  requireWithinWindow(saleId);

  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as
    | Record<string, unknown>
    | undefined;
  if (!sale) throw new Error('Sale not found');

  const blocked = itemsBlockedReason(saleId);
  if (blocked) throw new Error(blocked);

  const beforeLines = billItemLines(saleId);
  if (beforeLines.length === 0) throw new Error('This bill has no items to amend');

  // ── the new lines ─────────────────────────────────────────────────────────
  const oldByProduct = new Map(beforeLines.map((l) => [l.productId, l]));
  const afterLines: BillAmendItemLine[] = [];
  for (const raw of input.lines ?? []) {
    const productId = Number(raw.productId);
    if (!Number.isFinite(productId) || productId <= 0) throw new Error('A line has no product');
    const product = getProduct(productId);
    if (!product) throw new Error(`Product ${productId} not found`);
    const existing = oldByProduct.get(productId);
    afterLines.push({
      productId,
      name: product.name ?? existing?.name ?? `#${productId}`,
      qty: roundStock(Number(raw.qty) || 0),
      unitPrice: amendRound2(Number(raw.unitPrice) || 0),
      // The line's discount and tax rate are the bill's own — an amendment
      // changes WHAT was sold, not the discount that was given.
      lineDiscount: existing?.lineDiscount ?? 0,
      taxRate: existing?.taxRate ?? Number(product.tax_rate ?? 0),
    });
  }
  const lineProblem = validateItemLines(afterLines);
  if (lineProblem) throw new Error(lineProblem);

  // ── the price floor (the same rule a fresh sale obeys) ────────────────────
  if (getSetting('price_floor_enabled') !== '0' && !input.priceFloorOverride) {
    const belowCost: string[] = [];
    for (const line of afterLines) {
      const product = getProduct(line.productId);
      const cost = Number(product?.cost_price ?? 0);
      if (cost > 0 && line.unitPrice < cost) belowCost.push(product?.name ?? `#${line.productId}`);
    }
    if (belowCost.length > 0) {
      throw new Error(`Below cost items: ${belowCost.join(', ')}`);
    }
  }

  // ── the totals ────────────────────────────────────────────────────────────
  const totalsOptions = {
    billDiscount: Number(sale.bill_discount ?? 0),
    discountType: sale.discount_type === 'percent' ? ('percent' as const) : ('amount' as const),
    serviceCharge: Number(sale.service_charge ?? 0),
    serviceChargeType:
      sale.service_charge_type === 'percent' ? ('percent' as const) : ('amount' as const),
    freight: Number(sale.freight ?? 0),
  };
  const beforeTotals = recomputeSaleTotals(beforeLines, totalsOptions);
  const storedTotal = amendRound2(sale.total_amount);
  if (Math.abs(beforeTotals.finalTotal - storedTotal) > 0.011) {
    // The bill's stored total does not match its items — refuse rather than
    // quietly changing the bill's money.
    throw new Error(
      `This bill's stored total (${storedTotal.toFixed(2)}) does not match its items (${beforeTotals.finalTotal.toFixed(
        2
      )}) — amend its payments or notes instead.`
    );
  }
  const afterTotals = recomputeSaleTotals(afterLines, totalsOptions);

  const stockPlan = planItemStockDeltas(beforeLines, afterLines);
  const changes = summarizeItemChanges(beforeLines, afterLines);
  if (!changes) throw new Error('Nothing to change — the items are the same');

  // ── the stock rules (the same ones a fresh sale obeys) ───────────────────
  const allowNegativeStock = getSetting('allow_negative_stock') ?? 'warn';
  // A MANAGER may amend bills but may not break the "no negative stock"
  // policy — only the owner may. (A fresh sale lets any manager override it,
  // but an amendment rewrites a record that is already on the books.)
  const mayOverrideNegativeBlock = who.role === 'owner';
  const maxNegative = parseFloat(getSetting('max_negative_qty') ?? '0') || 0;
  // Phase 1, item 1.6 — an amendment that ADDS stock obeys the expiry rule
  // too. It used to have no expiry check at all, so a bill could be amended
  // to include expired stock that the till itself would have refused.
  const businessToday = todayIso();
  for (const delta of stockPlan) {
    if (delta.delta >= 0) continue; // the stock comes back (or stays) — never a problem
    const product = getProduct(delta.productId);
    if (!product) throw new Error(`Product ${delta.productId} not found`);
    const available = Number(product.stock_qty ?? 0);
    const needed = Math.abs(delta.delta);
    if (available < needed && allowNegativeStock === 'no' && !mayOverrideNegativeBlock) {
      throw new Error(`Insufficient stock: ${product.name} (${available} available)`);
    }
    if (maxNegative > 0 && available - needed < -maxNegative) {
      throw new Error(
        `Cannot sell ${product.name}: would exceed max negative qty of ${maxNegative} (would be ${
          available - needed
        })`
      );
    }
    if (isExpiredOn(product.expiry_date, businessToday)) {
      throw new Error(`Expired items: ${product.name}`);
    }
    const batchState = batchStockState(delta.productId, businessToday);
    if (batchState.hasBatches && batchState.freshQty < needed && batchState.expiredQty > 0) {
      throw new Error(`Expired items: ${product.name}`);
    }
  }
  const allowNegative = allowNegativeStock !== 'no' || mayOverrideNegativeBlock;

  // ── the money ─────────────────────────────────────────────────────────────
  const before = currentBillState(saleId);
  if (!before) throw new Error('Sale not found');
  const currentSplit = billSplit(before.total, before.payments);
  const hasCustomer = before.customerId != null;
  const splitPlan = planItemsSplit(before.total, afterTotals.finalTotal, currentSplit, hasCustomer);
  if (splitPlan.problem) throw new Error(splitPlan.problem);

  if (splitPlan.creditEffect > 0 && hasCustomer) {
    const customer = customerRow(before.customerId);
    const limit = Number(customer?.credit_limit ?? 0);
    if (limit > 0 && customer && customer.balance + splitPlan.creditEffect > limit) {
      if (!input.overrideCreditLimit) {
        throw new Error(
          `Credit limit exceeded — ${customer.name} would owe ${(customer.balance + splitPlan.creditEffect).toFixed(
            2
          )} (limit ${limit.toFixed(2)})`
        );
      }
      if (who.role !== 'owner') throw new Error('Only the owner may go over a credit limit');
    }
  }

  let shiftId: number | null = null;
  if (splitPlan.cashEffect !== 0) {
    const shift = currentShift();
    if (!shift) {
      throw new Error('Open a shift before changing the cash of a bill — a closed shift is never changed');
    }
    shiftId = shift.id;
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN');
  try {
    // ── 1. the stock and the rows ───────────────────────────────────────────
    const rows = saleItemRows(saleId);
    const rowsByProduct = new Map<number, SaleItemRow[]>();
    for (const r of rows) {
      const list = rowsByProduct.get(r.product_id) ?? [];
      list.push(r);
      rowsByProduct.set(r.product_id, list);
    }
    const afterByProduct = new Map(afterLines.map((l) => [l.productId, l]));

    for (const delta of stockPlan) {
      const line = afterByProduct.get(delta.productId);
      const newQty = line ? line.qty : 0;
      const oldQty = delta.oldQty;
      const lineRows = rowsByProduct.get(delta.productId) ?? [];

      if (newQty < oldQty) {
        // The units come back — from the newest allocation first.
        let remaining = roundStock(oldQty - newQty);
        for (let i = lineRows.length - 1; i >= 0 && remaining > 0; i--) {
          const row = lineRows[i];
          const take = Math.min(remaining, Number(row.qty) || 0);
          if (take <= 0) continue;
          restoreLineStock(db, saleId, row, take);
          const left = roundStock((Number(row.qty) || 0) - take);
          row.qty = left;
          db.prepare('UPDATE sale_items SET qty = ? WHERE id = ?').run(left, row.id);
          remaining = roundStock(remaining - take);
        }
      } else if (newQty > oldQty) {
        // The extra units go out — from the oldest batch first.
        const extra = roundStock(newQty - oldQty);
        const allocations = takeMoreStock(db, saleId, delta.productId, extra, allowNegative, businessToday);
        const template = lineRows[0];
        const ins = db.prepare(
          `INSERT INTO sale_items
            (sale_id, product_id, qty, unit_price, discount, tax_rate, line_total, promo_id, promo_name, batch_id, box_qty, unit_name, display_qty)
           VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?)`
        );
        let left = extra;
        const parts = allocations.map((a) => ({ qty: a.qty, batchId: a.batchId as number | null }));
        const allocated = parts.reduce((s, p) => s + p.qty, 0);
        if (roundStock(extra - allocated) > 0) parts.push({ qty: roundStock(extra - allocated), batchId: null });
        if (parts.length === 0) parts.push({ qty: extra, batchId: null });
        for (const part of parts) {
          if (part.qty <= 0) continue;
          const res = ins.run(
            saleId,
            delta.productId,
            part.qty,
            line?.unitPrice ?? 0,
            line?.taxRate ?? 0,
            template?.promo_id ?? null,
            template?.promo_name ?? null,
            part.batchId,
            template?.box_qty ?? null,
            template?.unit_name ?? null,
            null
          );
          const newRowId = Number(res.lastInsertRowid);
          if (part.batchId != null) {
            recordFIFOAllocations(newRowId, delta.productId, [{ batchId: part.batchId, qty: part.qty }]);
          }
          left = roundStock(left - part.qty);
        }
        void left;
      }
    }

    // The rows of a REMOVED line go away (their allocations were already
    // shortened when the units came back), and so does a row that was
    // emptied by a smaller quantity.
    for (const delta of stockPlan) {
      if (delta.newQty > 0) continue;
      for (const row of rowsByProduct.get(delta.productId) ?? []) {
        db.prepare('DELETE FROM fifo_allocations WHERE sale_item_id = ?').run(row.id);
        db.prepare('DELETE FROM sale_items WHERE id = ?').run(row.id);
      }
    }
    for (const row of saleItemRows(saleId)) {
      if ((Number(row.qty) || 0) > 0) continue;
      db.prepare('DELETE FROM fifo_allocations WHERE sale_item_id = ?').run(row.id);
      db.prepare('DELETE FROM sale_items WHERE id = ?').run(row.id);
    }

    // ── 2. the rows' money ──────────────────────────────────────────────────
    const finalRows = saleItemRows(saleId);
    const finalByProduct = new Map<number, SaleItemRow[]>();
    for (const r of finalRows) {
      const list = finalByProduct.get(r.product_id) ?? [];
      list.push(r);
      finalByProduct.set(r.product_id, list);
    }
    for (const line of afterLines) {
      const lineRows = finalByProduct.get(line.productId) ?? [];
      if (lineRows.length === 0) continue;
      const weights = lineRows.map((r) => Number(r.qty) || 0);
      const money = lineMoney(line);
      const lineTotals = distributeAmount(amendRound2(money.total), weights);
      const lineDiscounts = distributeAmount(amendRound2(line.lineDiscount), weights);
      lineRows.forEach((row, i) => {
        db.prepare(
          'UPDATE sale_items SET unit_price = ?, discount = ?, tax_rate = ?, line_total = ? WHERE id = ?'
        ).run(line.unitPrice, lineDiscounts[i], line.taxRate, lineTotals[i], row.id);
      });
    }

    // ── 3. the bill's totals ────────────────────────────────────────────────
    const priceChanged = stockPlan.some((d) => d.priceChanged);
    const priceOverridden = Number(sale.price_overridden ?? 0) === 1 || priceChanged;
    db.prepare(
      'UPDATE sales SET subtotal = ?, tax_amount = ?, discount_amount = ?, total_amount = ?, price_overridden = ? WHERE id = ?'
    ).run(
      afterTotals.subtotal,
      afterTotals.taxAmount,
      afterTotals.discountAmount,
      afterTotals.finalTotal,
      priceOverridden ? 1 : 0,
      saleId
    );

    // ── 4. the customer's ledger ────────────────────────────────────────────
    if (splitPlan.creditEffect !== 0 && before.customerId != null) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(
        splitPlan.creditEffect,
        before.customerId
      );
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(before.customerId, saleId, splitPlan.creditEffect, 'amend', nowIso);
    }

    // ── 5. the amendment row, the timeline event and the audit log ──────────
    const after: BillAmendState = {
      ...before,
      total: amendRound2(afterTotals.finalTotal),
      payments: splitToRows(splitPlan.after),
      credit: splitPlan.after.credit,
      items: afterLines.map((l) => ({ ...l })),
    };
    const result = writeAmendment(db, {
      saleId,
      who,
      reason,
      kind: 'items',
      before: { ...before, items: beforeLines.map((l) => ({ ...l })) },
      after,
      cashEffect: splitPlan.cashEffect,
      creditEffect: splitPlan.creditEffect,
      shiftId,
      createdAt: nowIso,
    });
    db.exec('COMMIT');
    logActivity(
      'sale_amended',
      'sale',
      saleId,
      `kind=items | invoice=${before.invoiceNo} | ${changes} | cash ${splitPlan.cashEffect.toFixed(
        2
      )} | udhaar ${splitPlan.creditEffect.toFixed(2)} | reason=${reason}`
    );
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * The cash an amendment moved INTO a shift.
 *
 * `shiftTotals` adds this to the expected cash, so the drawer, the shift
 * summary and the reports all agree with the amendments.
 */
export function shiftAmendmentCashEffect(shiftId: number): number {
  const db = getDb();
  try {
    const row = db
      .prepare('SELECT COALESCE(SUM(cash_effect), 0) AS t FROM sale_amendments WHERE shift_id = ?')
      .get(shiftId) as { t: number };
    return amendRound2(row?.t ?? 0);
  } catch {
    return 0;
  }
}

/** The label the printed document carries when a bill has been amended. */
export function amendmentStamp(saleId: number): string | null {
  const count = listAmendments(saleId).length;
  if (count <= 0) return null;
  return count === 1 ? 'AMENDED (1 amendment)' : `AMENDED (${count} amendments)`;
}

export { emptySplit, splitTotal, splitToFullRows };
