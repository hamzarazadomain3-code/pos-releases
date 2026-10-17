import { getDb } from '../db';
import { logActivity } from './activity';
import { checkCredit } from './creditLimits';
import { adjustStock, createProduct } from './inventory';
import type {
  Customer,
  UdhaarAccountSummary,
  UdhaarAging,
  UdhaarAgingBucket,
  UdhaarAgingRow,
  UdhaarCatalogItem,
  UdhaarEntryDetail,
  UdhaarEntryInput,
  UdhaarEntryResult,
  UdhaarItemLine,
  UdhaarItemLookup,
  UdhaarLedger,
  UdhaarLedgerRow,
} from '../../shared/types';

/**
 * Udhaar / Khata, item-aware.
 *
 * The ledger has always been money-only (`customer_transactions`), so it could
 * not answer "what did he take?". This service joins each money row to the items
 * it carries (a credit sale → its `sale_items`; a manual entry → its
 * `udhaar_items`) and computes, per entry, how much is still unpaid by
 * allocating later payments FIFO against the oldest debt first.
 *
 * Everything is derived from existing tables, so no backfill is needed and old
 * customers keep working exactly as before.
 */

const EPSILON = 0.005;

interface RawTxRow {
  id: number;
  customer_id: number;
  sale_id: number | null;
  payment_id: number | null;
  amount: number;
  type: string;
  created_at: string | null;
  running: number;
  invoice_no: string | null;
  sale_notes: string | null;
  entry_note: string | null;
  entry_reference: string | null;
  cashier_name: string | null;
  due_date: string | null;
}

interface RawSaleItemRow {
  id: number;
  transaction_id: number;
  sale_id: number;
  product_id: number;
  qty: number;
  unit_price: number;
  discount: number;
  line_total: number;
  unit_name: string | null;
  display_qty: number | null;
  product_name: string | null;
  barcode: string | null;
  invoice_no: string | null;
  created_at: string | null;
}

interface RawManualItemRow {
  id: number;
  transaction_id: number | null;
  sale_id: number | null;
  product_id: number | null;
  invoice_no: string | null;
  barcode: string | null;
  name: string;
  unit: string | null;
  qty: number;
  rate: number;
  discount: number;
  line_total: number;
  batch: string | null;
  expiry: string | null;
  direction: string;
  created_at: string | null;
}

function noteFromType(type: string): string | null {
  const parts = type.split(':');
  if (parts[0] === 'payment') {
    const rest = parts.slice(2).join(':');
    return rest || null;
  }
  if (parts[0] === 'write_off') {
    const rest = parts.slice(1).join(':');
    return rest || null;
  }
  return null;
}

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function itemLineFromSale(row: RawSaleItemRow): UdhaarItemLine {
  return {
    key: `sale:${row.id}`,
    source: 'sale',
    transaction_id: row.transaction_id,
    sale_id: row.sale_id,
    invoice_no: row.invoice_no,
    product_id: row.product_id,
    barcode: row.barcode,
    name: row.product_name || `#${row.product_id}`,
    unit: row.unit_name,
    qty: toNumber(row.qty),
    rate: toNumber(row.unit_price),
    discount: toNumber(row.discount),
    line_total: toNumber(row.line_total),
    direction: 'debit',
    created_at: row.created_at,
  };
}

function itemLineFromManual(row: RawManualItemRow): UdhaarItemLine {
  return {
    key: `manual:${row.id}`,
    source: 'manual',
    transaction_id: row.transaction_id,
    sale_id: row.sale_id,
    invoice_no: row.invoice_no,
    product_id: row.product_id,
    barcode: row.barcode,
    name: row.name,
    unit: row.unit,
    qty: toNumber(row.qty),
    rate: toNumber(row.rate),
    discount: toNumber(row.discount),
    line_total: toNumber(row.line_total),
    direction: row.direction === 'credit' ? 'credit' : 'debit',
    batch: row.batch,
    expiry: row.expiry,
    created_at: row.created_at,
  };
}

function dateOnly(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const s = String(ts);
  // Both `YYYY-MM-DD HH:MM:SS` (SQLite default) and ISO strings start with the date.
  return s.slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Allocate payments against debits FIFO (oldest debt settled first).
 * Returns the amount still owed on each row id.
 */
function allocateFifo(rows: RawTxRow[]): Map<number, number> {
  const open: { id: number; remaining: number }[] = [];
  const remainingById = new Map<number, number>();
  for (const r of rows) {
    const amount = toNumber(r.amount);
    if (amount > 0) {
      open.push({ id: r.id, remaining: amount });
      remainingById.set(r.id, amount);
    } else if (amount < 0) {
      let pool = -amount;
      while (pool > EPSILON && open.length > 0) {
        const head = open[0];
        const take = Math.min(pool, head.remaining);
        head.remaining -= take;
        pool -= take;
        remainingById.set(head.id, head.remaining);
        if (head.remaining <= EPSILON) open.shift();
      }
    } else {
      remainingById.set(r.id, 0);
    }
  }
  return remainingById;
}

export function getUdhaarLedger(customerId: number): UdhaarLedger {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as
    | Customer
    | undefined;
  if (!customer) throw new Error('Customer not found');

  const creditDays = Math.max(0, Math.floor(toNumber(customer.credit_days)));
  const today = todayIso();

  const txs = db
    .prepare(
      `SELECT ct.id, ct.customer_id, ct.sale_id, ct.payment_id, ct.amount, ct.type, ct.created_at,
              SUM(ct.amount) OVER (ORDER BY ct.id) AS running,
              s.invoice_no AS invoice_no,
              s.notes AS sale_notes,
              ue.note AS entry_note,
              ue.reference AS entry_reference,
              u.username AS cashier_name,
              date(ct.created_at, '+' || ? || ' days') AS due_date
       FROM customer_transactions ct
       LEFT JOIN sales s ON s.id = ct.sale_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN udhaar_entries ue ON ue.transaction_id = ct.id
       WHERE ct.customer_id = ?
       ORDER BY ct.id`
    )
    .all(creditDays, customerId) as unknown as RawTxRow[];

  const saleItems = db
    .prepare(
      `SELECT si.id, si.sale_id, si.product_id, si.qty, si.unit_price, si.discount, si.line_total,
              si.unit_name, si.display_qty, p.name AS product_name, p.barcode AS barcode,
              s.invoice_no AS invoice_no, s.created_at AS created_at, ct.id AS transaction_id
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN customer_transactions ct ON ct.sale_id = s.id AND ct.amount > 0
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.customer_id = ?`
    )
    .all(customerId) as unknown as RawSaleItemRow[];

  const manualItems = db
    .prepare(
      `SELECT id, transaction_id, sale_id, product_id, invoice_no, barcode, name, unit,
              qty, rate, discount, line_total, batch, expiry, direction, created_at
       FROM udhaar_items
       WHERE customer_id = ?`
    )
    .all(customerId) as unknown as RawManualItemRow[];

  const itemsByTx = new Map<number, UdhaarItemLine[]>();
  const pushItem = (txId: number | null, line: UdhaarItemLine) => {
    if (txId == null) return;
    const list = itemsByTx.get(txId) ?? [];
    list.push(line);
    itemsByTx.set(txId, list);
  };
  for (const s of saleItems) pushItem(s.transaction_id, itemLineFromSale(s));
  for (const m of manualItems) pushItem(m.transaction_id, itemLineFromManual(m));

  const remainingById = allocateFifo(txs);

  let itemsValue = 0;
  let overdueAmount = 0;
  let lastPaymentAt: string | null = null;
  let lastSaleAt: string | null = null;

  const rows: UdhaarLedgerRow[] = txs.map((t) => {
    const amount = toNumber(t.amount);
    const isDebit = amount > 0;
    const remaining = isDebit ? Math.max(0, remainingById.get(t.id) ?? 0) : 0;
    const paid = !isDebit || remaining <= EPSILON;
    const dueDate = isDebit ? t.due_date : null;
    const overdue = isDebit && !paid && creditDays > 0 && !!dueDate && dueDate < today;
    if (overdue) overdueAmount += remaining;
    if (isDebit && t.created_at && (!lastSaleAt || t.created_at > lastSaleAt)) lastSaleAt = t.created_at;
    if (!isDebit && t.created_at && (!lastPaymentAt || t.created_at > lastPaymentAt)) lastPaymentAt = t.created_at;

    const items = (itemsByTx.get(t.id) ?? []).slice();
    for (const it of items) if (it.direction === 'debit') itemsValue += it.line_total;

    const note = t.sale_notes || t.entry_note || noteFromType(t.type);
    return {
      id: t.id,
      customer_id: t.customer_id,
      sale_id: t.sale_id,
      payment_id: t.payment_id,
      amount,
      type: t.type,
      created_at: t.created_at ?? undefined,
      running: toNumber(t.running),
      invoice_no: t.invoice_no,
      note,
      reference: t.entry_reference ?? null,
      cashier_name: t.cashier_name,
      direction: isDebit ? 'debit' : 'credit',
      remaining,
      paid,
      due_date: dueDate,
      overdue,
      items,
    };
  });

  const outstanding = toNumber(customer.balance);
  const creditLimit = toNumber(customer.credit_limit);
  const summary: UdhaarAccountSummary = {
    outstanding,
    credit_limit: creditLimit,
    available: creditLimit > 0 ? Math.max(0, creditLimit - outstanding) : 0,
    last_payment_at: lastPaymentAt,
    last_sale_at: lastSaleAt,
    overdue_amount: overdueAmount,
    credit_days: creditDays,
    blocked: toNumber(customer.block_on_exceed) === 1,
    over_limit: creditLimit > 0 && outstanding > creditLimit,
    items_value: itemsValue,
  };

  return { customer, rows, summary };
}

export interface UdhaarStatementRange {
  from: string | null;
  to: string | null;
  opening_balance: number;
  closing_balance: number;
  rows: UdhaarLedgerRow[];
  /** Item lines carried by the in-range rows. */
  items: UdhaarItemLine[];
  summary: UdhaarAccountSummary;
}

/** Split a ledger into an opening balance + the rows inside a date range. */
export function getUdhaarStatement(
  customerId: number,
  from?: string,
  to?: string
): { ledger: UdhaarLedger; statement: UdhaarStatementRange } {
  const ledger = getUdhaarLedger(customerId);
  const fromD = from || null;
  const toD = to || null;

  let opening = 0;
  const rows: UdhaarLedgerRow[] = [];
  for (const r of ledger.rows) {
    const d = dateOnly(r.created_at);
    if (fromD && d && d < fromD) {
      opening += r.amount;
      continue;
    }
    if (toD && d && d > toD) continue;
    rows.push(r);
  }

  const items: UdhaarItemLine[] = [];
  for (const r of rows) for (const it of r.items) items.push(it);

  const inRange = rows.reduce((s, r) => s + r.amount, 0);
  const closing = opening + inRange;

  return {
    ledger,
    statement: {
      from: fromD,
      to: toD,
      opening_balance: opening,
      closing_balance: closing,
      rows,
      items,
      summary: ledger.summary,
    },
  };
}

export { noteFromType };

// ═══════════════════════════════════════════════════════════════════
//  PHASE 4 — receivables aging + write-off
// ═══════════════════════════════════════════════════════════════════

/** Whole days from one YYYY-MM-DD to another (b − a). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000);
}

function emptyBuckets(): UdhaarAgingBucket {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
}

const AGING_KEYS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'] as const;

/**
 * Receivables aging across every customer with a positive balance.
 *
 * Each customer's unpaid debits (their FIFO `remaining`) are bucketed by how
 * long past their due date they are — a debit with no scheduled due date counts
 * as "current" and is aged by its entry date only for the oldest-due column.
 * The bucket sum is reconciled to the authoritative `customers.balance` so the
 * report can never drift a cent from the ledger on legacy/rounding data.
 */
export function getUdhaarAging(): UdhaarAging {
  const db = getDb();
  const today = todayIso();
  const customers = db
    .prepare('SELECT * FROM customers WHERE balance > ? ORDER BY balance DESC')
    .all(EPSILON) as unknown as Customer[];

  const rows: UdhaarAgingRow[] = [];
  const totals = emptyBuckets();

  for (const c of customers) {
    let ledger: UdhaarLedger;
    try {
      ledger = getUdhaarLedger(c.id);
    } catch {
      continue;
    }

    const buckets = emptyBuckets();
    let oldestDue: string | null = null;
    // Only a customer with a credit period can be "overdue" — matching the
    // ledger, where `overdue` requires credit_days > 0. With no credit period
    // every unpaid charge is simply "current".
    const creditDays = Math.max(0, Math.floor(toNumber(c.credit_days)));

    for (const r of ledger.rows) {
      if (r.direction !== 'debit' || r.remaining <= EPSILON) continue;
      const amt = r.remaining;
      // Age by due date when the shop grants credit days; an item with no due
      // date is treated as not-yet-due (it is aged by its entry date only for
      // reporting the oldest outstanding charge).
      const anchor = creditDays > 0 ? r.due_date : null;
      const days = anchor ? daysBetween(anchor, today) : 0;
      if (!anchor || days <= 0) buckets.current += amt;
      else if (days <= 30) buckets.d1_30 += amt;
      else if (days <= 60) buckets.d31_60 += amt;
      else if (days <= 90) buckets.d61_90 += amt;
      else buckets.d90_plus += amt;
      buckets.total += amt;
      if (anchor && (!oldestDue || anchor < oldestDue)) oldestDue = anchor;
    }

    // Reconcile against the authoritative running balance (FIFO rounding on old
    // data) so the five buckets always add up to what the customer actually owes.
    const outstanding = toNumber(c.balance);
    const drift = round2(outstanding - buckets.total);
    if (Math.abs(drift) > EPSILON) {
      buckets.current += drift;
      buckets.total += drift;
    }

    for (const k of AGING_KEYS) buckets[k] = round2(buckets[k]);
    for (const k of AGING_KEYS) totals[k] = round2(totals[k] + buckets[k]);

    rows.push({
      customer_id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      outstanding,
      oldest_due_date: oldestDue,
      days_overdue: oldestDue ? Math.max(0, daysBetween(oldestDue, today)) : 0,
      buckets,
    });
  }

  return { as_of: today, rows, totals };
}

/**
 * Forgive part of a customer's debt (owner-only at the IPC layer).
 *
 * Writes a negative `customer_transactions` row typed `write_off[:note]` — the
 * same shape the FIFO allocator already understands — and lowers the running
 * balance. No cash moves, so this never touches the drawer.
 */
export function writeOffUdhaar(
  customerId: number,
  amount: number,
  note?: string
): { ok: boolean; message?: string; customer?: Customer } {
  const db = getDb();
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as unknown as
    | Customer
    | undefined;
  if (!c) return { ok: false, message: 'Customer not found' };

  const amt = round2(toNumber(amount));
  if (!(amt > 0)) return { ok: false, message: 'Write-off amount must be greater than zero' };

  const balance = toNumber(c.balance);
  if (amt > balance + EPSILON) {
    return {
      ok: false,
      message: `Cannot write off more than the outstanding balance (${round2(balance)})`,
    };
  }

  try {
    db.exec('BEGIN');
    db.prepare(
      'INSERT INTO customer_transactions (customer_id, amount, type, sale_id) VALUES (?, ?, ?, NULL)'
    ).run(customerId, -amt, note && note.trim() ? `write_off:${note.trim()}` : 'write_off');
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amt, customerId);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* nothing to roll back */
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  logActivity('udhaar_write_off', 'customer', customerId, `amount=${amt}${note ? ` note=${note}` : ''}`);
  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as unknown as Customer;
  return { ok: true, customer: updated };
}

// ═══════════════════════════════════════════════════════════════════
//  PHASE 2 — manual item entries + the Udhaar item catalog
// ═══════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function productLookupRow(p: Record<string, unknown>): UdhaarItemLookup {
  const retail = toNumber(p.sale_price);
  const wholesale = toNumber(p.wholesale_price, retail);
  return {
    found: true,
    source: 'inventory',
    product_id: Number(p.id),
    barcode: (p.barcode as string) ?? null,
    name: String(p.name),
    unit: (p.unit_name as string) ?? null,
    retail,
    wholesale: wholesale > 0 ? wholesale : retail,
    price: retail,
    stock: toNumber(p.stock_qty),
    batch: (p.batch_no as string) ?? null,
    expiry: (p.expiry_date as string) ?? null,
  };
}

function catalogLookupRow(c: Record<string, unknown>): UdhaarItemLookup {
  const price = toNumber(c.price);
  return {
    found: true,
    source: 'catalog',
    product_id: null,
    barcode: (c.barcode as string) ?? null,
    name: String(c.name),
    unit: (c.unit as string) ?? null,
    retail: price,
    wholesale: price,
    price,
    stock: 0,
    batch: null,
    expiry: null,
  };
}

function emptyLookup(code: string | null): UdhaarItemLookup {
  return {
    found: false,
    source: 'none',
    product_id: null,
    barcode: code,
    name: '',
    unit: null,
    retail: 0,
    wholesale: 0,
    price: 0,
    stock: 0,
    batch: null,
    expiry: null,
  };
}

/**
 * Barcode / SKU lookup for the Add Udhaar dialog.
 * 1) Inventory (barcode or SKU)  → 2) the Udhaar item catalog  → 3) not found.
 */
export function lookupUdhaarItem(code: string): UdhaarItemLookup {
  const clean = (code || '').trim();
  if (!clean) return emptyLookup(null);
  const db = getDb();
  const p = db
    .prepare(
      `SELECT p.id, p.name, p.barcode, p.sale_price, p.wholesale_price, p.stock_qty,
              p.expiry_date, p.batch_no, u.name AS unit_name
       FROM products p LEFT JOIN units u ON u.id = p.unit_id
       WHERE p.barcode = ? OR p.sku = ? LIMIT 1`
    )
    .get(clean, clean) as Record<string, unknown> | undefined;
  if (p) return productLookupRow(p);
  const c = db
    .prepare('SELECT barcode, name, price, unit FROM udhaar_item_catalog WHERE barcode = ? LIMIT 1')
    .get(clean) as Record<string, unknown> | undefined;
  if (c) return catalogLookupRow(c);
  return emptyLookup(clean);
}

/** Name/typed autocomplete across inventory and the catalog. */
export function searchUdhaarItems(term: string, limit = 20): UdhaarItemLookup[] {
  const q = (term || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  const db = getDb();
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.barcode, p.sale_price, p.wholesale_price, p.stock_qty,
              p.expiry_date, p.batch_no, u.name AS unit_name
       FROM products p LEFT JOIN units u ON u.id = p.unit_id
       WHERE p.active = 1 AND (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)
       ORDER BY p.name LIMIT ?`
    )
    .all(like, like, like, limit) as unknown as Record<string, unknown>[];
  const out = products.map(productLookupRow);
  const catalog = db
    .prepare(
      'SELECT barcode, name, price, unit FROM udhaar_item_catalog WHERE name LIKE ? OR barcode LIKE ? ORDER BY name LIMIT ?'
    )
    .all(like, like, limit) as unknown as Record<string, unknown>[];
  for (const c of catalog) out.push(catalogLookupRow(c));
  return out.slice(0, limit);
}

export function listUdhaarCatalog(): UdhaarCatalogItem[] {
  return getDb()
    .prepare('SELECT id, barcode, name, price, unit, created_at FROM udhaar_item_catalog ORDER BY name')
    .all() as unknown as UdhaarCatalogItem[];
}

export function upsertUdhaarCatalog(item: {
  id?: number;
  barcode?: string | null;
  name: string;
  price: number;
  unit?: string | null;
}): UdhaarCatalogItem {
  const db = getDb();
  const barcode = item.barcode?.trim() || null;
  const name = (item.name || '').trim();
  const price = toNumber(item.price);
  const unit = item.unit?.trim() || null;
  if (!name) throw new Error('Item name is required');

  if (item.id) {
    db.prepare('UPDATE udhaar_item_catalog SET barcode = ?, name = ?, price = ?, unit = ? WHERE id = ?').run(
      barcode,
      name,
      price,
      unit,
      item.id
    );
    return db.prepare('SELECT id, barcode, name, price, unit, created_at FROM udhaar_item_catalog WHERE id = ?').get(item.id) as unknown as UdhaarCatalogItem;
  }
  if (barcode) {
    db.prepare(
      `INSERT INTO udhaar_item_catalog (barcode, name, price, unit) VALUES (?, ?, ?, ?)
       ON CONFLICT(barcode) DO UPDATE SET name = excluded.name, price = excluded.price, unit = excluded.unit`
    ).run(barcode, name, price, unit);
    return db
      .prepare('SELECT id, barcode, name, price, unit, created_at FROM udhaar_item_catalog WHERE barcode = ?')
      .get(barcode) as unknown as UdhaarCatalogItem;
  }
  const info = db.prepare('INSERT INTO udhaar_item_catalog (barcode, name, price, unit) VALUES (NULL, ?, ?, ?)').run(name, price, unit);
  return db
    .prepare('SELECT id, barcode, name, price, unit, created_at FROM udhaar_item_catalog WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as UdhaarCatalogItem;
}

export function deleteUdhaarCatalog(id: number): boolean {
  getDb().prepare('DELETE FROM udhaar_item_catalog WHERE id = ?').run(id);
  return true;
}

/** Minimal CSV splitter (handles quoted cells and "" escapes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a `barcode,name,price,unit` CSV (header row optional). Pure. */
export function parseCatalogCsv(text: string): { barcode: string | null; name: string; price: number; unit: string | null }[] {
  const rows: { barcode: string | null; name: string; price: number; unit: string | null }[] = [];
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = splitCsvLine(raw);
    if (i === 0 && /^(barcode|name)$/i.test((cells[0] || '').trim())) continue;
    const name = (cells[1] || '').trim();
    if (!name) continue;
    rows.push({
      barcode: (cells[0] || '').trim() || null,
      name,
      price: toNumber(cells[2]),
      unit: (cells[3] || '').trim() || null,
    });
  }
  return rows;
}

export function bulkUpsertCatalog(items: { barcode: string | null; name: string; price: number; unit: string | null }[]): number {
  let n = 0;
  for (const it of items) {
    try {
      upsertUdhaarCatalog(it);
      n++;
    } catch {
      /* skip a bad row rather than abort the whole import */
    }
  }
  return n;
}

export const catalogCsvHeaders = ['barcode', 'name', 'price', 'unit'];

/**
 * Create a manual 'Udhaar (items)' entry (debit) or an items-return (credit).
 *
 * One atomic unit: the money row, the entry header, its item lines, the balance
 * update, the stock movements and any catalog memory all commit together, so a
 * half-written udhaar entry (the classic balance/stock drift bug) is impossible.
 */
export function createUdhaarEntry(input: UdhaarEntryInput): UdhaarEntryResult {
  const db = getDb();
  try {
    const customer = db
      .prepare('SELECT id, name, balance, credit_limit, block_on_exceed FROM customers WHERE id = ?')
      .get(input.customer_id) as { id: number; balance: number } | undefined;
    if (!customer) return { ok: false, message: 'Customer not found' };

    const lines = (input.lines || [])
      .filter((l) => l && l.name && l.name.trim() && toNumber(l.qty) > 0)
      .map((l) => {
        const qty = toNumber(l.qty);
        const rate = toNumber(l.rate);
        const discount = toNumber(l.discount);
        return { ...l, qty, rate, discount, line_total: Math.max(0, round2(qty * rate - discount)) };
      });
    if (lines.length === 0) return { ok: false, message: 'Add at least one item with a quantity' };

    const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
    if (total <= 0) return { ok: false, message: 'Entry total must be greater than zero' };

    const isDebit = input.direction !== 'credit';
    const amount = isDebit ? total : -total;

    // A credit limit only constrains what the customer OWES (debit).
    if (isDebit) {
      const check = checkCredit(input.customer_id, total);
      if (!check.allowed && !input.override_user_id) {
        return {
          ok: false,
          blocked: true,
          message: check.reason || 'Credit limit exceeded',
          credit_limit: check.credit_limit,
          current_balance: check.current_balance,
        };
      }
      if (!check.allowed && input.override_user_id) {
        logActivity(
          'udhaar_override',
          'customer',
          input.customer_id,
          `credit_limit=${check.credit_limit} | balance=${check.current_balance} | entry=${total} | by_user=${input.override_user_id}`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const createdAt = input.date ? `${input.date}T${nowIso.slice(11)}` : nowIso;

    let txId = 0;
    db.exec('BEGIN');
    try {
      const txInfo = db
        .prepare(
          'INSERT INTO customer_transactions (customer_id, sale_id, amount, type, created_at) VALUES (?, NULL, ?, ?, ?)'
        )
        .run(input.customer_id, amount, 'udhaar_items', createdAt);
      txId = Number(txInfo.lastInsertRowid);

      db.prepare(
        `INSERT INTO udhaar_entries (customer_id, transaction_id, note, reference, deduct_stock, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.customer_id,
        txId,
        input.note?.trim() || null,
        input.reference?.trim() || null,
        input.deduct_stock ? 1 : 0,
        input.override_user_id ?? null,
        createdAt
      );

      const insItem = db.prepare(
        `INSERT INTO udhaar_items
           (customer_id, transaction_id, product_id, barcode, name, unit, qty, rate, discount, line_total, batch, expiry, direction, deduct_stock, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const l of lines) {
        let productId = l.product_id ?? null;
        // A product created on the fly starts at 0 stock, so it must NOT then be
        // deducted from (that would drive it negative and roll the entry back).
        let freshlyCreated = false;

        // "Also add to Inventory" for a line we had to type in by hand.
        if (!productId && l.add_to_inventory) {
          try {
            const created = createProduct({
              name: l.name.trim(),
              barcode: l.barcode?.trim() || null,
              sale_price: l.rate,
              stock_qty: 0,
              unit_id: null,
            });
            productId = created?.id ?? null;
            freshlyCreated = productId != null;
          } catch {
            productId = null; // a duplicate barcode must not lose the entry
          }
        }

        // Remember the barcode → item mapping for next time.
        if (l.remember && l.barcode?.trim()) {
          try {
            upsertUdhaarCatalog({ barcode: l.barcode, name: l.name, price: l.rate, unit: l.unit ?? null });
          } catch {
            /* catalog memory is best-effort */
          }
        }

        insItem.run(
          input.customer_id,
          txId,
          productId,
          l.barcode?.trim() || null,
          l.name.trim(),
          l.unit ?? null,
          l.qty,
          l.rate,
          l.discount,
          l.line_total,
          l.batch ?? null,
          l.expiry ?? null,
          isDebit ? 'debit' : 'credit',
          input.deduct_stock ? 1 : 0,
          createdAt
        );

        // Stock: taken out on a debit, put back on a return. Only real
        // inventory products move, only when the toggle is on, and never a
        // product this entry itself just created (it has no stock to take).
        if (productId && input.deduct_stock && l.qty > 0 && !freshlyCreated) {
          const delta = isDebit ? -l.qty : l.qty;
          adjustStock(
            productId,
            delta,
            isDebit ? 'udhaar_item' : 'udhaar_item_return',
            'udhaar',
            txId
          );
        }
      }

      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, input.customer_id);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    logActivity(
      'udhaar_entry',
      'customer',
      input.customer_id,
      `tx=${txId} | ${isDebit ? 'debit' : 'credit'}=${total} | lines=${lines.length} | deduct_stock=${input.deduct_stock ? 1 : 0}`
    );

    return { ok: true, message: isDebit ? 'Udhaar entry saved.' : 'Items returned.', transaction_id: txId, total };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** One manual entry with its lines — the data behind the credit slip / WhatsApp text. */
export function getUdhaarEntry(transactionId: number): UdhaarEntryDetail | null {
  const db = getDb();
  const tx = db
    .prepare('SELECT id, customer_id, amount, type, created_at FROM customer_transactions WHERE id = ?')
    .get(transactionId) as
    | { id: number; customer_id: number; amount: number; type: string; created_at: string | null }
    | undefined;
  if (!tx) return null;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(tx.customer_id) as Customer | undefined;
  if (!customer) return null;

  const entry = db
    .prepare('SELECT note, reference, deduct_stock FROM udhaar_entries WHERE transaction_id = ?')
    .get(transactionId) as { note: string | null; reference: string | null; deduct_stock: number } | undefined;

  const rawItems = db
    .prepare('SELECT * FROM udhaar_items WHERE transaction_id = ? ORDER BY id')
    .all(transactionId) as unknown as Record<string, unknown>[];

  const items: UdhaarItemLine[] = rawItems.map((it) => ({
    key: `manual:${it.id}`,
    source: 'manual',
    transaction_id: (it.transaction_id as number) ?? null,
    sale_id: (it.sale_id as number) ?? null,
    invoice_no: (it.invoice_no as string) ?? null,
    product_id: (it.product_id as number) ?? null,
    barcode: (it.barcode as string) ?? null,
    name: String(it.name),
    unit: (it.unit as string) ?? null,
    qty: toNumber(it.qty),
    rate: toNumber(it.rate),
    discount: toNumber(it.discount),
    line_total: toNumber(it.line_total),
    direction: it.direction === 'credit' ? 'credit' : 'debit',
    batch: (it.batch as string) ?? null,
    expiry: (it.expiry as string) ?? null,
    created_at: (it.created_at as string) ?? null,
  }));

  const amount = toNumber(tx.amount);
  return {
    transaction_id: Number(tx.id),
    customer,
    amount,
    direction: amount < 0 ? 'credit' : 'debit',
    note: entry?.note ?? null,
    reference: entry?.reference ?? null,
    deduct_stock: !!entry?.deduct_stock,
    created_at: tx.created_at ?? null,
    total: Math.abs(amount),
    items,
  };
}
