/**
 * The pending actions — the assistant proposes, the owner decides.
 *
 * A write tool never runs inside the agent loop. It becomes a row in the
 * app's own `assistant_pending_actions` table and waits there:
 *
 *   1. the model proposes  → the row is created (status `pending`),
 *   2. the owner confirms  → the tool's REAL implementation runs, with the
 *                             role of the SESSION (never the role the model
 *                             asked for), and the result is stored,
 *   3. the owner cancels   → the row becomes `cancelled` and nothing happens,
 *   4. nobody acts         → the row expires after ten minutes.
 *
 * Every step is written to the app's own activity log, so the owner can see
 * exactly what the assistant proposed and what was really done.
 */
import { getDb } from '../../db';
import { currentUser } from '../auth';
import { logAssistantActivity } from './activity';
import {
  canCancel,
  canConfirm,
  expiryFrom,
  isExpired,
  isPending,
  nextStatus,
  type AssistantPendingRow,
  type AssistantPendingStatus,
} from '../../../shared/assistant/pending';
import type { AssistantContext } from '../../../shared/assistant/types';

interface RawRow {
  id: number;
  tool: string;
  args_json: string;
  preview_json: string | null;
  risk: string;
  reason: string | null;
  status: string;
  created_at: string;
  created_by: number | null;
  username: string | null;
  expires_at: string | null;
  confirmed_at: string | null;
  result_json: string | null;
  error: string | null;
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toRow(row: RawRow): AssistantPendingRow {
  const preview = parseJson<{ summary?: string; details?: { label: string; before?: unknown; after?: unknown }[] } | null>(
    row.preview_json,
    null
  );
  return {
    id: row.id,
    tool: row.tool,
    args: parseJson<Record<string, unknown>>(row.args_json, {}),
    preview: preview?.summary,
    details: preview?.details?.map((d) => ({
      label: d.label,
      before: (d.before as string | number | null) ?? null,
      after: (d.after as string | number | null) ?? null,
    })),
    risk: row.risk,
    reason: row.reason ?? undefined,
    status: row.status as AssistantPendingStatus,
    created_at: row.created_at,
    username: row.username ?? undefined,
    expires_at: row.expires_at ?? undefined,
    confirmed_at: row.confirmed_at ?? undefined,
    result: parseJson<unknown>(row.result_json, undefined),
    error: row.error ?? undefined,
  };
}

/** Mark the actions that waited too long as expired. */
export function expirePendingActions(now: number = Date.now()): number {
  const rows = getDb()
    .prepare(`SELECT id, expires_at FROM assistant_pending_actions WHERE status = 'pending'`)
    .all() as unknown as { id: number; expires_at: string | null }[];
  let expired = 0;
  for (const row of rows) {
    if (!isExpired({ status: 'pending', expires_at: row.expires_at }, now)) continue;
    getDb()
      .prepare(`UPDATE assistant_pending_actions SET status = 'expired' WHERE id = ?`)
      .run(row.id);
    expired++;
  }
  return expired;
}

/** The waiting actions (the newest first). */
export function listPendingActions(includeSettled = false): AssistantPendingRow[] {
  expirePendingActions();
  const sql = includeSettled
    ? `SELECT * FROM assistant_pending_actions ORDER BY id DESC LIMIT 50`
    : `SELECT * FROM assistant_pending_actions WHERE status = 'pending' ORDER BY id DESC LIMIT 50`;
  return (getDb().prepare(sql).all() as unknown as RawRow[]).map(toRow);
}

/** One action by its id. */
export function getPendingAction(id: number): AssistantPendingRow | null {
  expirePendingActions();
  const row = getDb()
    .prepare(`SELECT * FROM assistant_pending_actions WHERE id = ?`)
    .get(id) as unknown as RawRow | undefined;
  return row ? toRow(row) : null;
}

/** Create a waiting action (the model proposed it; nothing has happened yet). */
export function createPendingAction(input: {
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  reason?: string;
  preview?: { summary?: string; details?: { label: string; before?: unknown; after?: unknown }[] };
  userId?: number | null;
  username?: string | null;
}): AssistantPendingRow {
  const now = Date.now();
  const expiresAt = expiryFrom(now);
  const info = getDb()
    .prepare(
      `INSERT INTO assistant_pending_actions
         (tool, args_json, preview_json, risk, reason, status, created_at, created_by, username, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .run(
      input.tool,
      JSON.stringify(input.args ?? {}),
      input.preview ? JSON.stringify(input.preview) : null,
      input.risk,
      input.reason ?? null,
      new Date(now).toISOString(),
      input.userId ?? null,
      input.username ?? null,
      expiresAt
    );
  const row = getPendingAction(Number(info.lastInsertRowid));
  logAssistantActivity('action_proposed', `tool=${input.tool} id=${info.lastInsertRowid}`);
  if (!row) throw new Error('the pending action could not be created');
  return row;
}

/**
 * Confirm an action — the owner said yes, so the REAL service runs now.
 *
 * The tool's implementation is the very same one the normal UI uses, and the
 * role comes from the session, never from the model.
 */
export async function confirmPendingAction(
  id: number,
  execute: (tool: string, args: Record<string, unknown>, ctx: AssistantContext) => Promise<unknown>,
  ctx: AssistantContext
): Promise<{ ok: boolean; row: AssistantPendingRow | null; message?: string }> {
  const row = getPendingAction(id);
  if (!row) return { ok: false, row: null, message: 'That action is no longer there.' };
  if (!canConfirm(row)) {
    return { ok: false, row, message: 'That action has expired. Ask the assistant again.' };
  }
  const user = currentUser();
  try {
    const result = await execute(row.tool, row.args, ctx);
    getDb()
      .prepare(
        `UPDATE assistant_pending_actions
         SET status = ?, confirmed_at = ?, result_json = ?
         WHERE id = ?`
      )
      .run(nextStatus(row.status, 'confirmed'), new Date().toISOString(), JSON.stringify(result ?? null), id);
    logAssistantActivity('action_confirmed', `tool=${row.tool} id=${id} user=${user?.username ?? '-'}`);
    return { ok: true, row: getPendingAction(id), message: 'Done.' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    getDb()
      .prepare(`UPDATE assistant_pending_actions SET status = ?, error = ? WHERE id = ?`)
      .run(nextStatus(row.status, 'failed'), message, id);
    logAssistantActivity('action_failed', `tool=${row.tool} id=${id} error=${message}`);
    return { ok: false, row: getPendingAction(id), message };
  }
}

/** Cancel an action — nothing happens. */
export function cancelPendingAction(id: number): { ok: boolean; row: AssistantPendingRow | null; message?: string } {
  const row = getPendingAction(id);
  if (!row) return { ok: false, row: null, message: 'That action is no longer there.' };
  if (!canCancel(row)) return { ok: false, row, message: 'That action is already settled.' };
  getDb()
    .prepare(`UPDATE assistant_pending_actions SET status = ? WHERE id = ?`)
    .run(nextStatus(row.status, 'cancelled'), id);
  logAssistantActivity('action_cancelled', `tool=${row.tool} id=${id}`);
  return { ok: true, row: getPendingAction(id), message: 'Cancelled — nothing was changed.' };
}
