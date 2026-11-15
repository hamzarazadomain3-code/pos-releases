/**
 * The assistant's activity log.
 *
 * Every assistant action (a question answered, an action proposed, an action
 * confirmed or cancelled) is written to the app's OWN `activity_log` table with
 * an `assistant_` prefix, so the Admin → Activity Log screen and the
 * Assistant screen read the same rows — there is no second audit trail.
 */
import { getDb } from '../../db';
import { logActivity } from '../activity';
import { getSessionUserId } from '../auth';

export const ASSISTANT_ACTIVITY_PREFIX = 'assistant_';

export interface AssistantActivityRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  username: string | null;
  user_id: number | null;
}

/** Write one assistant activity row. `action` is the bare name (no prefix). */
export function logAssistantActivity(action: string, details: string): void {
  logActivity(`${ASSISTANT_ACTIVITY_PREFIX}${action}`, 'assistant', null, details, getSessionUserId());
}

/** The newest assistant activity rows. */
export function listAssistantActivity(limit = 50): AssistantActivityRow[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at, a.user_id, u.username
       FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action LIKE ?
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(`${ASSISTANT_ACTIVITY_PREFIX}%`, limit) as unknown as AssistantActivityRow[];
  return rows;
}
