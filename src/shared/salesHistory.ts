/**
 * Shared Sales History timeline types + pure local-time helpers.
 *
 * PHASE 3d: the Sales History screen is a timeline, not a "sales table". One
 * event row per thing that actually happened (sale, return, cash refund, void,
 * delete, held-bill lifecycle, quotation conversion) and every day/range filter
 * is resolved in the shop's LOCAL calendar (Asia/Karachi, UTC+05:00, no DST)
 * instead of comparing a UTC date to a local one.
 *
 * The module is dependency-free so BOTH the main process (SQL bounds) and the
 * renderer (default filters / labels) import the same rules, and so the test
 * suite can pin the 23:50 / 00:10 / 04:55 boundaries without a database.
 */

export type HistoryEventType =
  | 'sale'
  | 'return'
  | 'cash_refund'
  | 'void'
  | 'delete'
  | 'hold_created'
  | 'hold_resumed'
  | 'hold_deleted'
  | 'quotation_converted';

/** Every event the timeline knows about, in display order for the chips. */
export const HISTORY_EVENT_TYPES: HistoryEventType[] = [
  'sale',
  'return',
  'cash_refund',
  'void',
  'delete',
  'hold_created',
  'hold_resumed',
  'hold_deleted',
  'quotation_converted',
];

/** Event types whose signed amount leaves the drawer / reduces net sales. */
export const NEGATIVE_HISTORY_EVENTS: HistoryEventType[] = [
  'return',
  'cash_refund',
  'void',
  'delete',
  'hold_deleted',
];

export const HISTORY_EVENT_LABELS: Record<HistoryEventType, string> = {
  sale: 'Sale',
  return: 'Return',
  cash_refund: 'Cash Refund',
  void: 'Void',
  delete: 'Delete',
  hold_created: 'Held',
  hold_resumed: 'Resumed',
  hold_deleted: 'Hold Deleted',
  quotation_converted: 'Quote → Sale',
};

export const HISTORY_EVENT_CLASSES: Record<HistoryEventType, string> = {
  sale: 'hist-type-sale',
  return: 'hist-type-return',
  cash_refund: 'hist-type-refund',
  void: 'hist-type-void',
  delete: 'hist-type-delete',
  hold_created: 'hist-type-hold',
  hold_resumed: 'hist-type-resume',
  hold_deleted: 'hist-type-delete',
  quotation_converted: 'hist-type-quote',
};

export interface HistoryFilters {
  /** Local calendar date YYYY-MM-DD (inclusive). Defaults to the current business day. */
  from?: string;
  to?: string;
  /** Empty / undefined / every type = show everything. */
  types?: HistoryEventType[];
  /** Free-text over invoice, customer, cashier, reason and reference. */
  search?: string;
  customerId?: number | null;
  customer?: string;
  /** Cashier/user who performed the event. */
  userId?: number | null;
  paymentMode?: string;
  /** Product name (sale/return lines) or held-refund free text. */
  product?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  onlyMySales?: boolean;
  /** Optional business-day anchor hour (0-23). Defaults to the stored setting. */
  businessDayStartHour?: number | null;
}

export interface HistoryEventRow {
  event_id: number;
  event_type: HistoryEventType;
  /** Raw UTC timestamp as stored (ISO with Z or `YYYY-MM-DD HH:MM:SS`). */
  occurred_at: string;
  /** Local (Asia/Karachi) calendar day of `occurred_at`. */
  local_day: string;
  invoice_no: string | null;
  sale_id: number | null;
  held_bill_id: number | null;
  customer: string | null;
  user: string | null;
  /** Signed: sales/holds positive, returns/refunds/voids/deletes negative. */
  amount: number;
  /** Cash portion of a sale (0 for non-sale events). */
  cash_amount: number;
  payment_mode: string | null;
  status: string | null;
  reason: string | null;
  reference_invoice: string | null;
  details: string | null;
  has_snapshot: boolean;
}

export interface HistoryListResult {
  rows: HistoryEventRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HistoryTypeCount {
  event_type: HistoryEventType;
  count: number;
  total: number;
}

export interface HistorySummary {
  salesCount: number;
  salesTotal: number;
  returnsCount: number;
  returnsTotal: number;
  cashRefundsCount: number;
  cashRefundsTotal: number;
  voidsCount: number;
  voidsTotal: number;
  deletesCount: number;
  deletesTotal: number;
  holdCreatedCount: number;
  holdResumedCount: number;
  holdDeletedCount: number;
  /** completed sales - returns - cash refunds (voids/deletes never add revenue). */
  netSales: number;
  cashTotal: number;
  nonCashTotal: number;
  /** voided + deleted value (never subtracted twice from net sales). */
  cancelledValue: number;
  /** Held bills still open right now (not filtered by date). */
  openHeldBills: number;
}

export interface HistoryDetailSaleItem {
  product_name: string;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
}

export interface HistoryDetailPayment {
  mode: string;
  amount: number;
  reference: string | null;
}

export interface HistoryDetail {
  event: HistoryEventRow;
  snapshot: unknown;
  items: HistoryDetailSaleItem[];
  payments: HistoryDetailPayment[];
}

/** Pakistan has observed UTC+05:00 with no DST since 2009. */
export const PKT_OFFSET_MINUTES = 300;

/** Parse a DB timestamp that may be `...Z`, ISO with offset, or bare UTC. */
export function parseDbTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const raw = String(ts).trim();
  if (!raw) return null;
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // `YYYY-MM-DD HH:MM:SS` / `YYYY-MM-DDTHH:MM:SS` with no zone: the DB writes UTC.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The Asia/Karachi calendar day (`YYYY-MM-DD`) of a UTC timestamp. */
export function localDayOf(ts: string | null | undefined): string {
  const d = parseDbTimestamp(ts);
  if (!d) return '';
  const shifted = new Date(d.getTime() + PKT_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The Asia/Karachi clock time (`HH:MM:SS`) of a UTC timestamp. */
export function localTimeOf(ts: string | null | undefined): string {
  const d = parseDbTimestamp(ts);
  if (!d) return '';
  const shifted = new Date(d.getTime() + PKT_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(11, 19);
}

function localDateToUtcMs(dateStr: string, hour: number): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, hour, 0, 0, 0) - PKT_OFFSET_MINUTES * 60_000;
}

function toSqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * UTC [from, to) bounds for a local calendar range. With a 04:00 business-day
 * anchor `2026-11-09..2026-11-09` means 2026-11-09 04:00 → 2026-11-10 04:00 PKT.
 */
export function businessDayBounds(
  from: string,
  to: string,
  startHour = 0
): { fromUtc: string; toUtc: string } {
  const hour = normalizeBusinessDayStart(startHour);
  const startMs = localDateToUtcMs(from, hour);
  const endMs = localDateToUtcMs(to, hour) + 24 * 60 * 60 * 1000;
  return { fromUtc: toSqlUtc(startMs), toUtc: toSqlUtc(endMs) };
}

/** Clamp an arbitrary setting value into 0..23 (default 0). */
export function normalizeBusinessDayStart(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

/**
 * The date whose business day contains `now`. With a 04:00 anchor, 02:00 on
 * 10 Nov is still the business day that started on 9 Nov.
 */
export function currentBusinessDate(startHour = 0, now: Date = new Date()): string {
  const hour = normalizeBusinessDayStart(startHour);
  const shifted = new Date(now.getTime() + PKT_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const localHour = shifted.getUTCHours();
  const base = new Date(Date.UTC(y, m, d));
  if (localHour < hour) base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

/** Default view: the current business day, every event type. */
export function defaultHistoryFilters(today: string): HistoryFilters {
  return {
    from: today,
    to: today,
    types: [...HISTORY_EVENT_TYPES],
    search: '',
    customerId: null,
    customer: '',
    userId: null,
    paymentMode: '',
    product: '',
    minAmount: null,
    maxAmount: null,
    onlyMySales: false,
    businessDayStartHour: null,
  };
}

/**
 * Compute the from/to local calendar dates for a Sales History date preset.
 * Uses the business-day anchor so a 04:00 shop sees the previous business day
 * at 02:00 instead of the calendar day.
 */
export function presetRange(
  preset: 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'custom',
  startHour = 0,
  now: Date = new Date()
): { from: string; to: string } {
  const today = currentBusinessDate(startHour, now);
  const [y, m, d] = today.split('-').map(Number);

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const base = new Date(Date.UTC(y, m - 1, d - 1));
      const yest = base.toISOString().slice(0, 10);
      return { from: yest, to: yest };
    }
    case 'week': {
      const base = new Date(Date.UTC(y, m - 1, d - 6));
      const from = base.toISOString().slice(0, 10);
      return { from, to: today };
    }
    case 'month': {
      const base = new Date(Date.UTC(y, m - 1, 1));
      const from = base.toISOString().slice(0, 10);
      return { from, to: today };
    }
    case 'lastmonth': {
      const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { from, to };
    }
    default:
      return { from: today, to: today };
  }
}
export function normalizeHistoryTypes(types?: HistoryEventType[] | null): HistoryEventType[] {
  if (!types || types.length === 0) return [...HISTORY_EVENT_TYPES];
  const valid = types.filter((t) => HISTORY_EVENT_TYPES.includes(t));
  if (valid.length === 0 || valid.length === HISTORY_EVENT_TYPES.length) {
    return [...HISTORY_EVENT_TYPES];
  }
  return valid;
}

export function isNegativeHistoryEvent(type: HistoryEventType): boolean {
  return NEGATIVE_HISTORY_EVENTS.includes(type);
}

/** Clamp a page/pageSize pair into safe bounds (no NaN / negative offsets). */
export function normalizePage(page?: unknown, pageSize?: unknown): { page: number; pageSize: number } {
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const size = Math.min(500, Math.max(1, Math.trunc(Number(pageSize)) || 100));
  return { page: p, pageSize: size };
}

/** Money rounding used everywhere in the summary so 0.1+0.2 never shows. */
export function roundMoney(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
