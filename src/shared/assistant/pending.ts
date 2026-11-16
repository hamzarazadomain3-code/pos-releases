/**
 * The pending-action model — the assistant proposes, the owner decides.
 *
 * A write tool NEVER runs inside the agent loop: it becomes a pending action
 * that waits in the app's own database until the owner confirms it. This
 * module is the PURE half (the state machine, the expiry rule and the row
 * shape) — it is shared by the main process (the service) and the renderer
 * (the action card), so the card and the service can never disagree.
 */

/** Where a pending action is in its life. */
export type AssistantPendingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed';

/** How long an action waits for the owner (minutes). */
export const PENDING_ACTION_TTL_MINUTES = 10;

/** The row as the renderer sees it. */
export interface AssistantPendingRow {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  /** The one-line summary of what the action would change. */
  preview?: string;
  /** The before/after of every affected value. */
  details?: { label: string; before?: string | number | null; after?: string | number | null }[];
  risk: string;
  reason?: string;
  status: AssistantPendingStatus;
  created_at: string;
  username?: string;
  expires_at?: string;
  confirmed_at?: string;
  /** The result of the action (after a confirmation). */
  result?: unknown;
  error?: string;
}

/** Is this action still waiting? */
export function isPending(row: { status: string }): boolean {
  return row.status === 'pending';
}

/**
 * Has the action waited too long?
 *
 * An action that waited longer than the TTL is dead: the shop may have moved
 * on, so it must be asked for again (and the model may have forgotten the
 * context).
 */
export function isExpired(row: { status: string; expires_at?: string | null }, now: number = Date.now()): boolean {
  if (!isPending(row)) return false;
  if (!row.expires_at) return false;
  const at = Date.parse(row.expires_at);
  if (!Number.isFinite(at)) return false;
  return at <= now;
}

/** May the owner confirm this action right now? */
export function canConfirm(
  row: { status: string; expires_at?: string | null },
  now: number = Date.now()
): boolean {
  return isPending(row) && !isExpired(row, now);
}

/** May the owner cancel this action right now? */
export function canCancel(row: { status: string }): boolean {
  return isPending(row);
}

/** The moment the action dies (the ISO string), from now. */
export function expiryFrom(
  now: number = Date.now(),
  minutes: number = PENDING_ACTION_TTL_MINUTES
): string {
  return new Date(now + minutes * 60_000).toISOString();
}

/**
 * The next status of an action.
 *
 * The state machine is tiny on purpose: pending → confirmed / cancelled /
 * expired / failed, and nothing ever goes back to pending.
 */
export function nextStatus(
  current: AssistantPendingStatus,
  outcome: 'confirmed' | 'cancelled' | 'expired' | 'failed'
): AssistantPendingStatus {
  if (current !== 'pending') return current;
  return outcome;
}

/** The status the action shows when it is over. */
export function isOver(status: AssistantPendingStatus): boolean {
  return status !== 'pending';
}

/** The tool name → the i18n key of its card title. */
export function pendingTitleKey(tool: string): string {
  return `assistant.pending.tools.${tool}`;
}

/** The tool names that have a card title (the tests and the panel use it). */
export const PENDING_TOOL_NAMES = [
  'create_customer',
  'set_customer_discount',
  'add_to_bill',
  'hold_bill',
  'create_expense_draft',
  'create_promotion_draft',
  'stock_adjustment',
  'update_product_price',
];
