import { getDb } from '../db';
import { getSessionUserId, currentUser } from './auth';
import { getSetting } from './settings';
import { printDocument } from './printService';
import { stripCostFields } from '../../shared/historyPrivacy';
import {
  businessDayBounds,
  currentBusinessDate,
  defaultHistoryFilters,
  DEFAULT_SHOP_TIMEZONE,
  getTzOffsetMinutes,
  localDayOf,
  localTimeOf,
  normalizeBusinessDayStart,
  normalizeHistoryTypes,
  normalizePage,
  presetRange,
  roundMoney,
  type HistoryDetail,
  type HistoryEventRow,
  type HistoryEventType,
  type HistoryFilters,
  type HistoryListResult,
  type HistorySummary,
  type HistoryTypeCount,
} from '../../shared/salesHistory';

export interface RecordSaleEventInput {
  event_type: HistoryEventType;
  sale_id?: number | null;
  held_bill_id?: number | null;
  invoice_no?: string | null;
  user_id?: number | null;
  amount?: number | null;
  reason?: string | null;
  snapshot?: unknown;
  created_at?: string | null;
}

/**
 * Append one timeline event. Callers that already hold an open transaction
 * (createSale / voidSale / returns / holds) must call this BEFORE COMMIT so the
 * event and the action commit or roll back together. It never opens its own
 * transaction.
 */
export function recordSaleEvent(input: RecordSaleEventInput): number {
  const db = getDb();
  const amount = Number(input.amount);
  const snapshot =
    input.snapshot === undefined || input.snapshot === null
      ? null
      : typeof input.snapshot === 'string'
        ? input.snapshot
        : JSON.stringify(input.snapshot);
  const info = db
    .prepare(
      `INSERT INTO sale_events
        (event_type, sale_id, held_bill_id, invoice_no, user_id, amount, reason, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.event_type,
      input.sale_id ?? null,
      input.held_bill_id ?? null,
      input.invoice_no ?? null,
      input.user_id ?? getSessionUserId() ?? 1,
      Number.isFinite(amount) ? amount : 0,
      input.reason?.trim() || null,
      snapshot,
      input.created_at || new Date().toISOString()
    );
  return Number(info.lastInsertRowid);
}

/** The optional business-day anchor stored in settings (0 = midnight). */
export function getBusinessDayStartHour(): number {
  return normalizeBusinessDayStart(getSetting('business_day_start_hour') ?? 0);
}

/** The shop's IANA timezone (default Asia/Karachi). */
export function getShopTimezone(): string {
  return getSetting('shop_timezone') ?? DEFAULT_SHOP_TIMEZONE;
}

/** Check if the current user is a cashier (restricted to own events). */
function isCashier(): boolean {
  const user = currentUser();
  return user?.role === 'cashier';
}

/** Enforce server-side role rules: cashiers only see their own events. */
function enforceRoleRules(filters: HistoryFilters): HistoryFilters {
  if (isCashier()) {
    // Cashier: ignore client's onlyMySales, force to true
    return { ...filters, onlyMySales: true };
  }
  return filters;
}

function effectiveFilters(filters: HistoryFilters): Required<
  Pick<HistoryFilters, 'from' | 'to' | 'businessDayStartHour'>
> & HistoryFilters {
  const startHour = normalizeBusinessDayStart(
    filters.businessDayStartHour ?? getBusinessDayStartHour()
  );
  const tz = getShopTimezone();
  const today = currentBusinessDate(startHour, new Date(), tz);
  return {
    ...filters,
    from: filters.from || today,
    to: filters.to || filters.from || today,
    businessDayStartHour: startHour,
  };
}

interface WhereParts {
  sql: string;
  params: (string | number)[];
}

function buildWhere(filters: HistoryFilters): WhereParts {
  const f = effectiveFilters(filters);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const tz = getShopTimezone();
  const { fromUtc, toUtc } = businessDayBounds(f.from!, f.to!, f.businessDayStartHour!, tz);
  clauses.push('datetime(e.created_at) >= datetime(?)');
  params.push(fromUtc);
  clauses.push('datetime(e.created_at) < datetime(?)');
  params.push(toUtc);

  const types = normalizeHistoryTypes(f.types);
  if (types.length > 0) {
    clauses.push(`e.event_type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }

  if (f.search?.trim()) {
    const like = `%${f.search.trim()}%`;
    clauses.push(
      `(COALESCE(e.invoice_no,'') LIKE ?
        OR COALESCE(c.name,'') LIKE ?
        OR COALESCE(u.username,'') LIKE ?
        OR COALESCE(e.reason,'') LIKE ?
        OR COALESCE(e.snapshot_json,'') LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  if (f.customerId) {
    clauses.push("(s.customer_id = ? OR json_extract(e.snapshot_json, '$.customer_id') = ?)");
    params.push(f.customerId, f.customerId);
  }
  if (f.customer?.trim()) {
    const like = `%${f.customer.trim()}%`;
    clauses.push(
      `(COALESCE(c.name,'') LIKE ? OR COALESCE(json_extract(e.snapshot_json, '$.customer_name'),'') LIKE ?)`
    );
    params.push(like, like);
  }
  if (f.userId) {
    clauses.push('e.user_id = ?');
    params.push(f.userId);
  }
  if (f.onlyMySales) {
    const uid = getSessionUserId();
    if (uid) {
      clauses.push('e.user_id = ?');
      params.push(uid);
    }
  }
  if (f.paymentMode?.trim()) {
    const mode = f.paymentMode.trim().toLowerCase();
    clauses.push(
      `(EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = e.sale_id AND lower(p.mode) = ?)
        OR lower(COALESCE(json_extract(e.snapshot_json, '$.payment_mode'),
                          json_extract(e.snapshot_json, '$.refund_mode'), '')) LIKE ?)`
    );
    params.push(mode, `%${mode}%`);
  }
  if (f.product?.trim()) {
    const like = `%${f.product.trim()}%`;
    clauses.push(
      `(EXISTS (
          SELECT 1 FROM sale_items si
          LEFT JOIN products pr ON pr.id = si.product_id
          WHERE si.sale_id = e.sale_id AND COALESCE(pr.name,'') LIKE ?
        )
        OR COALESCE(e.snapshot_json,'') LIKE ?)`
    );
    params.push(like, like);
  }
  const min = Number(f.minAmount);
  if (f.minAmount !== null && f.minAmount !== undefined && Number.isFinite(min)) {
    clauses.push('ABS(e.amount) >= ?');
    params.push(min);
  }
  const max = Number(f.maxAmount);
  if (f.maxAmount !== null && f.maxAmount !== undefined && Number.isFinite(max)) {
    clauses.push('ABS(e.amount) <= ?');
    params.push(max);
  }

  return { sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

const EVENT_SELECT = `
  SELECT
    e.id AS event_id,
    e.event_type,
    e.created_at AS occurred_at,
    e.invoice_no,
    e.sale_id,
    e.held_bill_id,
    e.user_id,
    COALESCE(c.name, json_extract(e.snapshot_json, '$.customer_name'), '') AS customer,
    COALESCE(u.username, json_extract(e.snapshot_json, '$.user_name'), '') AS user,
    COALESCE(e.amount, 0) AS amount,
    COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = e.sale_id AND lower(p.mode) = 'cash'
    ), 0) AS cash_amount,
    CASE
      WHEN e.event_type IN ('return', 'cash_refund') THEN
        COALESCE(json_extract(e.snapshot_json, '$.refund_mode'),
                 json_extract(e.snapshot_json, '$.mode'), '')
      ELSE
        COALESCE((
          SELECT group_concat(DISTINCT p.mode) FROM payments p WHERE p.sale_id = e.sale_id
        ), json_extract(e.snapshot_json, '$.payment_mode'),
           json_extract(e.snapshot_json, '$.refund_mode'), '')
    END AS payment_mode,
    COALESCE(s.status, json_extract(e.snapshot_json, '$.state'), '') AS status,
    e.reason,
    COALESCE(json_extract(e.snapshot_json, '$.reference_invoice'),
             json_extract(e.snapshot_json, '$.original_invoice'), '') AS reference_invoice,
    json_extract(e.snapshot_json, '$.details') AS details,
    CASE WHEN e.snapshot_json IS NULL THEN 0 ELSE 1 END AS has_snapshot
  FROM sale_events e
  LEFT JOIN sales s ON s.id = e.sale_id
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN users u ON u.id = e.user_id
`;

function mapRow(raw: Record<string, unknown>): HistoryEventRow {
  const amount = Number(raw.amount);
  const cash = Number(raw.cash_amount);
  return {
    event_id: Number(raw.event_id),
    event_type: String(raw.event_type) as HistoryEventType,
    occurred_at: String(raw.occurred_at ?? ''),
    local_day: localDayOf(String(raw.occurred_at ?? ''), getShopTimezone()),
    invoice_no: (raw.invoice_no as string | null) ?? null,
    sale_id: raw.sale_id == null ? null : Number(raw.sale_id),
    held_bill_id: raw.held_bill_id == null ? null : Number(raw.held_bill_id),
    customer: (raw.customer as string | null) || null,
    user: (raw.user as string | null) || null,
    amount: Number.isFinite(amount) ? roundMoney(amount) : 0,
    cash_amount: Number.isFinite(cash) ? roundMoney(cash) : 0,
    payment_mode: (raw.payment_mode as string | null) || null,
    status: (raw.status as string | null) || null,
    reason: (raw.reason as string | null) || null,
    reference_invoice: (raw.reference_invoice as string | null) || null,
    details: (raw.details as string | null) || null,
    has_snapshot: !!raw.has_snapshot,
  };
}

export function listHistoryEvents(
  filters: HistoryFilters = {},
  page = 1,
  pageSize = 100
): HistoryListResult {
  const db = getDb();
  const enforced = enforceRoleRules(filters);
  const { sql, params } = buildWhere(enforced);
  const paging = normalizePage(page, pageSize);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_events e
       LEFT JOIN sales s ON s.id = e.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = e.user_id
       ${sql}`
    )
    .get(...params) as unknown as { c: number } | undefined;

  const rows = db
    .prepare(
      `${EVENT_SELECT}
       ${sql}
       ORDER BY datetime(e.created_at) DESC, e.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, paging.pageSize, (paging.page - 1) * paging.pageSize) as unknown as Record<
    string,
    unknown
  >[];

  return {
    rows: rows.map(mapRow),
    total: Number(totalRow?.c ?? 0),
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

export function historyTypeCounts(filters: HistoryFilters = {}): HistoryTypeCount[] {
  const db = getDb();
  const enforced = enforceRoleRules(filters);
  const { sql, params } = buildWhere(enforced);
  const rows = db
    .prepare(
      `SELECT e.event_type, COUNT(*) AS count, COALESCE(SUM(e.amount),0) AS total
       FROM sale_events e
       LEFT JOIN sales s ON s.id = e.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = e.user_id
       ${sql}
       GROUP BY e.event_type`
    )
    .all(...params) as unknown as { event_type: HistoryEventType; count: number; total: number }[];
  return rows.map((r) => ({
    event_type: r.event_type,
    count: Number(r.count) || 0,
    total: roundMoney(Number(r.total) || 0),
  }));
}

export function historyOpenHeldCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM held_bills WHERE kind = 'held' AND deleted_at IS NULL")
    .get() as unknown as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

export function historySummary(filters: HistoryFilters = {}): HistorySummary {
  const db = getDb();
  const enforced = enforceRoleRules(filters);
  const { sql, params } = buildWhere(enforced);
  // Join sales to get status and returned_amount.
  // Only 'completed' sales contribute to salesTotal (voided sales are excluded;
  // their cancellation is represented by the 'void' event).
  // For completed sales, use (total_amount - returned_amount) so salesTotal
  // matches Dashboard's today_sales (which already subtracts legacy returns).
  const rows = db
    .prepare(
      `SELECT e.event_type,
              COALESCE(e.amount,0) AS amount,
              COALESCE((
                SELECT SUM(p.amount) FROM payments p
                WHERE p.sale_id = e.sale_id AND lower(p.mode) = 'cash'
              ), 0) AS cash_amount,
              s.status AS sale_status,
              COALESCE(s.total_amount,0) AS sale_total,
              COALESCE(s.returned_amount,0) AS sale_returned,
              e.snapshot_json
       FROM sale_events e
       LEFT JOIN sales s ON s.id = e.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = e.user_id
       ${sql}`
    )
    .all(...params) as unknown as {
    event_type: HistoryEventType;
    amount: number;
    cash_amount: number;
    sale_status: string | null;
    sale_total: number;
    sale_returned: number;
    snapshot_json: string | null;
  }[];

  const s: HistorySummary = {
    salesCount: 0,
    salesTotal: 0,
    returnsCount: 0,
    returnsTotal: 0,
    cashRefundsCount: 0,
    cashRefundsTotal: 0,
    voidsCount: 0,
    voidsTotal: 0,
    deletesCount: 0,
    deletesTotal: 0,
    holdCreatedCount: 0,
    holdResumedCount: 0,
    holdDeletedCount: 0,
    netSales: 0,
    cashTotal: 0,
    nonCashTotal: 0,
    cancelledValue: 0,
    openHeldBills: historyOpenHeldCount(),
  };

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    switch (r.event_type) {
      case 'sale': {
        // Only count sales that are still 'completed'.
        // Voided sales have a separate 'void' event; their sale event is excluded.
        // For completed sales, use (total_amount - returned_amount) to match Dashboard.
        if (r.sale_status === 'completed') {
          const netAmount = Number(r.sale_total) - Number(r.sale_returned);
          s.salesCount++;
          s.salesTotal += netAmount;
          s.cashTotal += Number(r.cash_amount) || 0;
        }
        // If sale_status is null (historical sale before events table), include it.
        else if (r.sale_status === null) {
          s.salesCount++;
          s.salesTotal += amount;
          s.cashTotal += Number(r.cash_amount) || 0;
        }
        // voided/returned sales: skip the sale event; void/return events handle it.
        break;
      }
case 'return': {
        // Legacy invoice returns (createReturn) update sales.returned_amount,
        // which is already subtracted from salesTotal above. Skip them.
        // Cart returns (createReturnBill) create a separate negative sale
        // (status='returned') and are NOT in salesTotal, so count them.
        if (r.sale_status === 'returned') {
          s.returnsCount++;
          s.returnsTotal += Math.abs(amount);
        }
        break;
      }
      case 'cash_refund':
        s.cashRefundsCount++;
        s.cashRefundsTotal += Math.abs(amount);
        break;
      case 'void':
        s.voidsCount++;
        s.voidsTotal += Math.abs(amount);
        break;
      case 'delete':
        s.deletesCount++;
        s.deletesTotal += Math.abs(amount);
        break;
      case 'hold_created':
        s.holdCreatedCount++;
        break;
      case 'hold_resumed':
        s.holdResumedCount++;
        break;
      case 'hold_deleted':
        s.holdDeletedCount++;
        break;
      default:
        break;
    }
  }

  s.salesTotal = roundMoney(s.salesTotal);
  s.returnsTotal = roundMoney(s.returnsTotal);
  s.cashRefundsTotal = roundMoney(s.cashRefundsTotal);
  s.voidsTotal = roundMoney(s.voidsTotal);
  s.deletesTotal = roundMoney(s.deletesTotal);
  s.cashTotal = roundMoney(s.cashTotal);
  s.nonCashTotal = roundMoney(s.salesTotal - s.cashTotal);
  // netSales = completed sales (net of legacy returns) - timeline returns - cash refunds
  s.netSales = roundMoney(s.salesTotal - s.returnsTotal - s.cashRefundsTotal);
  // cancelledValue = voids + deletes (never subtracted from netSales)
  s.cancelledValue = roundMoney(s.voidsTotal + s.deletesTotal);
  return s;
}

export function getHistoryDetail(eventId: number): HistoryDetail | null {
  const db = getDb();
  const raw = db
    .prepare(`${EVENT_SELECT} WHERE e.id = ?`)
    .get(eventId) as unknown as Record<string, unknown> | undefined;
  if (!raw) return null;
  const event = mapRow(raw);
  const cashier = isCashier();

  // Server-side role check: cashier can only view their own events.
  if (cashier) {
    const uid = getSessionUserId();
    if (Number(raw.user_id) !== uid) {
      return null;
    }
  }

  let snapshot: unknown = null;
  if (event.has_snapshot) {
    const snapRow = db
      .prepare('SELECT snapshot_json FROM sale_events WHERE id = ?')
      .get(eventId) as unknown as { snapshot_json: string | null } | undefined;
    if (snapRow?.snapshot_json) {
      try {
        snapshot = JSON.parse(snapRow.snapshot_json);
      } catch {
        snapshot = snapRow.snapshot_json;
      }
    }
  }
  // A cashier never receives cost/profit keys, even inside a hold snapshot.
  if (cashier && snapshot && typeof snapshot === 'object') {
    snapshot = stripCostFields(snapshot);
  }

  const items = event.sale_id
    ? (db
        .prepare(
          `SELECT COALESCE(p.name, 'Product #' || si.product_id) AS product_name,
                  si.qty, si.unit_price, si.discount, si.tax_rate, si.line_total
           FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
           WHERE si.sale_id = ? ORDER BY si.id`
        )
        .all(event.sale_id) as unknown as HistoryDetail['items'])
    : [];

  const payments = event.sale_id
    ? (db
        .prepare('SELECT mode, amount, reference FROM payments WHERE sale_id = ? ORDER BY id')
        .all(event.sale_id) as unknown as HistoryDetail['payments'])
    : [];

  return { event, snapshot, items, payments };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Print the CURRENT filtered timeline through the shared print service (A4,
 * invoice printer slot). Same rows the screen is showing, newest first.
 */
export async function printHistoryReport(filters: HistoryFilters = {}) {
  const enforced = enforceRoleRules(filters);
  const list = listHistoryEvents(enforced, 1, 500);
  const summary = historySummary(enforced);
  const f = effectiveFilters(filters);
  const tz = getShopTimezone();
  const rows = list.rows
    .map(
      (e) => `<tr>
        <td>${escapeHtml(localDayOf(e.occurred_at, tz))} ${escapeHtml(localTimeOf(e.occurred_at, tz))}</td>
        <td>${escapeHtml(e.event_type)}</td>
        <td>${escapeHtml(e.invoice_no ?? '')}</td>
        <td>${escapeHtml(e.customer ?? '')}</td>
        <td>${escapeHtml(e.user ?? '')}</td>
        <td>${escapeHtml(e.payment_mode ?? '')}</td>
        <td class="r">${e.amount.toFixed(2)}</td>
        <td>${escapeHtml(e.reason ?? '')}</td>
        <td>${escapeHtml(e.reference_invoice ?? '')}</td>
      </tr>`
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sales History</title>
    <style>
      @page { size: A4; margin: 10mm; }
      body { font-family: Arial, sans-serif; color: #111; font-size: 10px; }
      h2 { margin: 0 0 4px; font-size: 16px; }
      .meta { margin: 0 0 8px; color: #555; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #ccc; padding: 3px 4px; text-align: left; vertical-align: top; }
      th { background: #f0f0f0; font-size: 9px; text-transform: uppercase; }
      .r { text-align: right; }
      .tot { margin-top: 10px; font-weight: 700; }
    </style></head><body>
    <h2>Sales History — ${escapeHtml(f.from)} → ${escapeHtml(f.to)}</h2>
    <p class="meta">${list.total} event(s). NET sales ${summary.netSales.toFixed(2)} · returns ${summary.returnsTotal.toFixed(2)} · refunds ${summary.cashRefundsTotal.toFixed(2)} · cancelled ${summary.cancelledValue.toFixed(2)}</p>
    <table><thead><tr><th>Time</th><th>Type</th><th>Invoice</th><th>Customer</th><th>Cashier</th><th>Payment</th><th class="r">Amount</th><th>Reason</th><th>Reference</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9">No activity in this range.</td></tr>'}</tbody></table>
    </body></html>`;
  return printDocument({ html, paper: 'a4', printerKey: 'invoice', jobName: 'Sales History' });
}

export interface HistoryClockOptions {
  now?: Date;
  startHour?: number;
  timezone?: string;
}

export function historyPresetRange(
  preset: string,
  options: HistoryClockOptions = {}
): { from: string; to: string } {
  const startHour = options.startHour ?? getBusinessDayStartHour();
  const tz = options.timezone ?? getShopTimezone();
  const valid = ['today', 'yesterday', 'week', 'month', 'lastmonth', 'custom'] as const;
  const p = valid.includes(preset as any) ? (preset as typeof valid[number]) : 'today';
  return presetRange(p, startHour, options.now ?? new Date(), tz);
}

/** The default view every caller should open Sales History with. */
export function historyDefaults(
  businessDayStartHour?: number,
  options: Omit<HistoryClockOptions, 'startHour'> = {}
): HistoryFilters {
  const tz = options.timezone ?? getShopTimezone();
  return defaultHistoryFilters(
    currentBusinessDate(
      businessDayStartHour ?? getBusinessDayStartHour(),
      options.now ?? new Date(),
      tz
    )
  );
}

export const salesHistoryService = {
  record: recordSaleEvent,
  list: listHistoryEvents,
  counts: historyTypeCounts,
  summary: historySummary,
  openHeldCount: historyOpenHeldCount,
  detail: getHistoryDetail,
  defaults: historyDefaults,
};
