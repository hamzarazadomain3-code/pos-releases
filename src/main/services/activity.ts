import { getDb } from '../db';
import { getSessionUserId } from './auth';

export interface ActivityRow {
  id: number;
  user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  created_at?: string;
  username?: string | null;
}

export function logActivity(
  action: string,
  entity?: string | null,
  entityId?: number | null,
  details?: string | null,
  userId?: number | null
): void {
  getDb()
    .prepare('INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? getSessionUserId() ?? 1, action, entity ?? null, entityId ?? null, details ?? null);
}

export function listActivity(limit = 100): ActivityRow[] {
  return getDb()
    .prepare(
      `SELECT a.*, u.username
       FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit) as unknown as ActivityRow[];
}