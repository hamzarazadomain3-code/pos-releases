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
  type BillAmendKind,
  type BillAmendPaymentRow,
  type BillAmendRecord,
  type BillAmendSplit,
  type BillAmendState,
} from '../../shared/billAmend';

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
  const amendments = listAmendments(saleId);
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
