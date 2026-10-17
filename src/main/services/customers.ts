/**
 * Customer profile service (Phase 3).
 *
 * The legacy three-field helpers still live in `sales.ts` (`listCustomers`,
 * `createCustomer`, `setCreditLimit`, …) because Billing's inline quick-add uses
 * them. This module is the richer, tabbed-form path: a full profile read, a
 * create/update that writes the Phase-3 columns in one transaction, duplicate
 * detection for the "open existing" prompt, and a deactivate/reactivate/delete
 * lifecycle where a customer **with history is never hard-deleted**.
 */
import { getDb } from '../db';
import { logActivity } from './activity';
import type { Customer, CustomerInput, CustomerDuplicates } from '../../shared/types';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

function pick(v: unknown, allowed: readonly string[], fallback: string): string {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : fallback;
}

function dateOnly(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Text columns written straight through (trimmed, '' → NULL). */
const TEXT_COLS = [
  'urdu_name', 'customer_type', 'business_name', 'contact_person', 'photo', 'status',
  'customer_code', 'group_name', 'tags', 'phone_alt', 'whatsapp', 'email', 'city', 'area',
  'maps_link', 'message_language', 'cnic', 'ntn', 'drug_licence', 'guarantor',
  'guarantor_phone', 'price_level', 'credit_action', 'opening_balance_as_of', 'notes',
  'birthday', 'anniversary', 'reminder_freq',
] as const;

/** Numeric columns written straight through (sanitised, never NaN). */
const NUM_COLS = ['credit_limit', 'credit_days', 'default_discount_pct', 'max_single_bill'] as const;

const CUSTOMER_TYPES = ['retail', 'wholesale', 'medical', 'other'] as const;
const PRICE_LEVELS = ['retail', 'wholesale'] as const;
const LANGUAGES = ['en', 'ur'] as const;
const REMINDERS = ['none', 'weekly', 'monthly'] as const;
const CREDIT_ACTIONS = ['allow', 'warn', 'block'] as const;

export function getCustomer(id: number): Customer | null {
  const row = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id) as unknown as Customer | undefined;
  return row ?? null;
}

/** Customers that already use this phone (and/or this name). Used to warn. */
export function findCustomerDuplicates(opts: {
  phone?: string | null;
  name?: string;
  excludeId?: number | null;
}): CustomerDuplicates {
  const db = getDb();
  const phone = (opts.phone || '').trim();
  const name = (opts.name || '').trim();
  const excludeId = opts.excludeId ?? -1;
  const phoneRows = phone
    ? (db.prepare('SELECT * FROM customers WHERE phone = ? AND id != ?').all(phone, excludeId) as unknown as Customer[])
    : [];
  const nameRows = name
    ? (db.prepare('SELECT * FROM customers WHERE lower(name) = lower(?) AND id != ?').all(name, excludeId) as unknown as Customer[])
    : [];
  return { phone: phoneRows, name: nameRows };
}

interface NormalisedProfile {
  name: string;
  phone: string | null;
  address: string | null;
  openingBalance: number;
  openingAsOf: string | null;
  blockOnExceed: number;
  text: Record<string, string | null>;
  numeric: Record<string, number>;
}

function normalise(input: CustomerInput): NormalisedProfile | { error: string } {
  const name = (input.name || '').trim();
  if (!name) return { error: 'Name is required' };

  const creditAction = pick(input.credit_action, CREDIT_ACTIONS, 'warn');
  const text: Record<string, string | null> = {
    urdu_name: str(input.urdu_name),
    customer_type: pick(input.customer_type, CUSTOMER_TYPES, 'retail'),
    business_name: str(input.business_name),
    contact_person: str(input.contact_person),
    photo: str(input.photo),
    status: pick(input.status, ['active', 'inactive'], 'active'),
    customer_code: str(input.customer_code),
    group_name: str(input.group_name),
    tags: str(input.tags),
    phone_alt: str(input.phone_alt),
    whatsapp: str(input.whatsapp),
    email: str(input.email),
    city: str(input.city),
    area: str(input.area),
    maps_link: str(input.maps_link),
    message_language: pick(input.message_language, LANGUAGES, 'en'),
    cnic: str(input.cnic),
    ntn: str(input.ntn),
    drug_licence: str(input.drug_licence),
    guarantor: str(input.guarantor),
    guarantor_phone: str(input.guarantor_phone),
    price_level: pick(input.price_level, PRICE_LEVELS, 'retail'),
    credit_action: creditAction,
    opening_balance_as_of: dateOnly(input.opening_balance_as_of),
    notes: str(input.notes),
    birthday: str(input.birthday),
    anniversary: str(input.anniversary),
    reminder_freq: pick(input.reminder_freq, REMINDERS, 'none'),
  };
  const numeric: Record<string, number> = {
    credit_limit: Math.max(0, round2(num(input.credit_limit, 0))),
    credit_days: Math.max(0, Math.floor(num(input.credit_days, 0))),
    default_discount_pct: clamp(round2(num(input.default_discount_pct, 0)), 0, 100),
    max_single_bill: Math.max(0, round2(num(input.max_single_bill, 0))),
  };
  return {
    name,
    phone: str(input.phone),
    address: str(input.address),
    openingBalance: round2(num(input.opening_balance, 0)),
    openingAsOf: dateOnly(input.opening_balance_as_of),
    // `block_on_exceed` is what the billing credit check reads; keep it in step.
    blockOnExceed: creditAction === 'block' ? 1 : 0,
    text,
    numeric,
  };
}

/**
 * Create (no `id`) or update (with `id`) a customer profile.
 *
 * One transaction: the customer row, the derived `block_on_exceed` flag, and the
 * opening-balance `customer_transactions` row all commit together. Editing the
 * opening balance adjusts it by the *difference*, so the running balance that
 * sales and payments have built up is never clobbered.
 */
export function saveCustomer(
  input: CustomerInput,
  id?: number | null
): { ok: boolean; message?: string; customer?: Customer } {
  const db = getDb();
  const norm = normalise(input);
  if ('error' in norm) return { ok: false, message: norm.error };

  if (id == null) {
    db.exec('BEGIN');
    try {
      const cols = ['name', 'phone', 'address', 'balance', 'block_on_exceed', ...TEXT_COLS, ...NUM_COLS];
      const vals: (string | number | null)[] = [
        norm.name,
        norm.phone,
        norm.address,
        norm.openingBalance,
        norm.blockOnExceed,
        ...TEXT_COLS.map((c) => norm.text[c] ?? null),
        ...NUM_COLS.map((c) => norm.numeric[c] ?? 0),
      ];
      const info = db
        .prepare(`INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...vals);
      const newId = Number(info.lastInsertRowid);
      if (norm.openingBalance !== 0) {
        db.prepare(
          `INSERT INTO customer_transactions (customer_id, amount, type, created_at)
           VALUES (?, ?, 'opening_balance', COALESCE(?, CURRENT_TIMESTAMP))`
        ).run(newId, norm.openingBalance, norm.openingAsOf);
      }
      db.exec('COMMIT');
      logActivity('customer_created', 'customer', newId, `opening_balance=${norm.openingBalance}`);
      return { ok: true, customer: getCustomer(newId) ?? undefined };
    } catch (e) {
      db.exec('ROLLBACK');
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  const existing = getCustomer(id);
  if (!existing) return { ok: false, message: 'Customer not found' };

  db.exec('BEGIN');
  try {
    const setCols = ['name', 'phone', 'address', 'block_on_exceed', ...TEXT_COLS, ...NUM_COLS];
    const setVals: (string | number | null)[] = [
      norm.name,
      norm.phone,
      norm.address,
      norm.blockOnExceed,
      ...TEXT_COLS.map((c) => norm.text[c] ?? null),
      ...NUM_COLS.map((c) => norm.numeric[c] ?? 0),
    ];
    db.prepare(`UPDATE customers SET ${setCols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...setVals,
      id
    );

    // Opening balance lives in `customer_transactions` (type 'opening_balance').
    // Adjust by the delta so the rest of the running balance is untouched.
    const oldTx = db
      .prepare("SELECT id, amount FROM customer_transactions WHERE customer_id = ? AND type = 'opening_balance' ORDER BY id LIMIT 1")
      .get(id) as { id: number; amount: number } | undefined;
    const oldAmount = oldTx ? num(oldTx.amount) : 0;
    if (norm.openingBalance !== oldAmount) {
      const delta = norm.openingBalance - oldAmount;
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(delta, id);
      if (norm.openingBalance === 0 && oldTx) {
        db.prepare('DELETE FROM customer_transactions WHERE id = ?').run(oldTx.id);
      } else if (oldTx) {
        db.prepare('UPDATE customer_transactions SET amount = ?, created_at = COALESCE(?, created_at) WHERE id = ?').run(
          norm.openingBalance,
          norm.openingAsOf,
          oldTx.id
        );
      } else {
        db.prepare(
          `INSERT INTO customer_transactions (customer_id, amount, type, created_at)
           VALUES (?, ?, 'opening_balance', COALESCE(?, CURRENT_TIMESTAMP))`
        ).run(id, norm.openingBalance, norm.openingAsOf);
      }
    } else if (oldTx && norm.openingAsOf) {
      db.prepare('UPDATE customer_transactions SET created_at = ? WHERE id = ?').run(norm.openingAsOf, oldTx.id);
    }

    db.exec('COMMIT');
    logActivity('customer_updated', 'customer', id, `name=${norm.name}`);
    return { ok: true, customer: getCustomer(id) ?? undefined };
  } catch (e) {
    db.exec('ROLLBACK');
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function setCustomerStatus(id: number, status: 'active' | 'inactive'): Customer {
  const db = getDb();
  db.prepare('UPDATE customers SET status = ? WHERE id = ?').run(status, id);
  logActivity(status === 'inactive' ? 'customer_deactivated' : 'customer_reactivated', 'customer', id, null);
  return getCustomer(id) as Customer;
}

/**
 * Hard delete — only for a customer with a clean slate. Anyone with a ledger
 * entry or a sale must be deactivated instead (their history is the shop's books).
 */
export function deleteCustomer(id: number): { ok: boolean; message?: string } {
  const db = getDb();
  const c = getCustomer(id);
  if (!c) return { ok: false, message: 'Customer not found' };
  const tx = (db.prepare('SELECT COUNT(*) AS n FROM customer_transactions WHERE customer_id = ?').get(id) as { n: number }).n;
  const sales = (db.prepare('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?').get(id) as { n: number }).n;
  if (tx > 0 || sales > 0) {
    return { ok: false, message: 'This customer has transactions or sales — deactivate them instead of deleting.' };
  }
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  logActivity('customer_deleted', 'customer', id, `name=${c.name}`);
  return { ok: true };
}

/**
 * Owner-only: fold one customer (the duplicate) into another.
 *
 * Every `customer_id` reference in the database — ledger rows, sales, udhaar
 * items/entries — is re-pointed at the target in a single transaction, then the
 * target's running balance is **re-derived** from its (now larger) ledger rather
 * than carried across, and the source row is deleted. Discovering the tables
 * that hold a `customer_id` means a future table cannot be silently skipped.
 */
export function mergeCustomers(
  sourceId: number,
  targetId: number
): { ok: boolean; message?: string; merged?: number } {
  const db = getDb();
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return { ok: false, message: 'Invalid customer id' };
  }
  if (sourceId === targetId) return { ok: false, message: 'Pick two different customers' };
  const source = getCustomer(sourceId);
  const target = getCustomer(targetId);
  if (!source) return { ok: false, message: 'The customer to merge was not found' };
  if (!target) return { ok: false, message: 'The target customer was not found' };

  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).filter((t) => !t.name.startsWith('sqlite_'));
  const movable: string[] = [];
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
    if (cols.some((c) => c.name === 'customer_id')) movable.push(t.name);
  }

  let moved = 0;
  try {
    db.exec('BEGIN');
    for (const table of movable) {
      const res = db
        .prepare(`UPDATE "${table}" SET customer_id = ? WHERE customer_id = ?`)
        .run(targetId, sourceId);
      moved += Number(res.changes ?? 0);
    }
    const balance = (
      db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS bal FROM customer_transactions WHERE customer_id = ?')
        .get(targetId) as { bal: number }
    ).bal;
    db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(round2(num(balance)), targetId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(sourceId);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* nothing to roll back */
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  logActivity('customer_merged', 'customer', targetId, `from=${sourceId} name=${source.name} moved=${moved}`);
  return { ok: true, merged: moved };
}
