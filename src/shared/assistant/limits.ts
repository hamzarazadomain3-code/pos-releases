/**
 * The assistant's hard limits.
 *
 * The agent loop is server-side, so every limit is enforced there — the model
 * cannot talk its way past any of them.
 */
import type { AssistantUsage } from './types';

export interface AssistantLimits {
  /** How many tool calls one turn may make. */
  maxToolCallsPerTurn: number;
  /** How many provider round-trips one turn may make. */
  maxTurns: number;
  /** The output token cap of one provider call. */
  maxOutputTokens: number;
  /** The wall-clock cap of one turn (ms). */
  wallClockMs: number;
  /** How many turns one user may start per minute. */
  turnsPerMinute: number;
  /** The daily spend cap (USD). */
  dailyBudgetUsd: number;
}

export const DEFAULT_ASSISTANT_LIMITS: AssistantLimits = {
  maxToolCallsPerTurn: 6,
  maxTurns: 4,
  maxOutputTokens: 1024,
  wallClockMs: 30_000,
  turnsPerMinute: 10,
  dailyBudgetUsd: 1,
};

export interface BudgetState {
  /** What has been spent today (USD). */
  spentUsd: number;
  /** The cap for today (USD). */
  budgetUsd: number;
}

/** Is there money left today? */
export function budgetAvailable(state: BudgetState): boolean {
  if (!Number.isFinite(state.budgetUsd) || state.budgetUsd <= 0) return false;
  return state.spentUsd < state.budgetUsd;
}

/** The money that is left today. */
export function budgetRemaining(state: BudgetState): number {
  return Math.max(0, Math.round((state.budgetUsd - state.spentUsd) * 10000) / 10000);
}

/** Add a turn's usage to today's spend. */
export function addUsage(spentUsd: number, usage: AssistantUsage): number {
  const next = spentUsd + (Number.isFinite(usage.costUsd) ? usage.costUsd : 0);
  return Math.round(next * 10000) / 10000;
}

export interface ToolCallSignature {
  name: string;
  input: Record<string, unknown>;
}

/** A stable signature for a tool call (the same call = the same signature). */
export function callSignature(call: ToolCallSignature): string {
  let input = '';
  try {
    input = JSON.stringify(call.input, Object.keys(call.input ?? {}).sort());
  } catch {
    input = JSON.stringify(Object.keys(call.input ?? {}).sort());
  }
  return `${call.name}:${input}`;
}

/**
 * Loop detection: the same tool with the same arguments, over and over.
 *
 * The loop is stopped when the same signature shows up three times — that is
 * a model that is stuck, not one that is working.
 */
export function isLoopDetected(calls: ToolCallSignature[], threshold = 3): boolean {
  const seen = new Map<string, number>();
  for (const call of calls) {
    const key = callSignature(call);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= threshold) return true;
  }
  return false;
}

/**
 * The per-user rate limiter (in memory — one process, one shop).
 *
 * The windows are one minute long and slide with the clock.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number = DEFAULT_ASSISTANT_LIMITS.turnsPerMinute) {}

  /** May this user start another turn right now? */
  allow(key: string, now: number = Date.now()): boolean {
    const window = 60_000;
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < window);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** How many turns the user made in the current window. */
  used(key: string, now: number = Date.now()): number {
    const window = 60_000;
    return (this.hits.get(key) ?? []).filter((t) => now - t < window).length;
  }

  /** Forget everything (the tests use it). */
  reset(): void {
    this.hits.clear();
  }
}
