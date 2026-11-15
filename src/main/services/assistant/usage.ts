/**
 * The assistant's daily usage — what the budget is measured against.
 *
 * One row per day. The row is written after every turn, so a restart cannot
 * reset the owner's daily cap.
 */
import { getDb } from '../../db';
import { todayLocal } from '../../utils/timezone';
import type { AssistantUsage } from '../../../shared/assistant/types';

export interface DayUsage {
  day: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Today's usage row (the shop's local day). */
export function getDayUsage(day: string = todayLocal()): DayUsage {
  const row = getDb()
    .prepare('SELECT day, cost_usd, calls, input_tokens, output_tokens FROM assistant_usage WHERE day = ?')
    .get(day) as { day: string; cost_usd: number; calls: number; input_tokens: number; output_tokens: number } | undefined;
  if (!row) return { day, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
  return {
    day: row.day,
    costUsd: Number(row.cost_usd) || 0,
    calls: Number(row.calls) || 0,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
  };
}

/** Add a turn's usage to the day. */
export function addDayUsage(usage: AssistantUsage, day: string = todayLocal()): DayUsage {
  const db = getDb();
  db.prepare(
    `INSERT INTO assistant_usage (day, cost_usd, calls, input_tokens, output_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(day) DO UPDATE SET
       cost_usd = cost_usd + excluded.cost_usd,
       calls = calls + excluded.calls,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    day,
    Number.isFinite(usage.costUsd) ? usage.costUsd : 0,
    usage.calls || 0,
    usage.inputTokens || 0,
    usage.outputTokens || 0
  );
  return getDayUsage(day);
}
