import { logError } from './logger';

/**
 * Phase 0 item 0.2 — one error boundary for every IPC handler.
 *
 * Services deliberately throw plain `Error`s with shop-readable messages
 * ("Insufficient stock: …", "Expired items: …", "No open shift …"). Those are
 * *expected* outcomes and must reach the renderer unchanged — the UI shows
 * `err.message` today.
 *
 * Anything else (SQLite failures, TypeErrors, JSON/network faults) is a defect.
 * Those are logged in full (stack + channel + error id) to the daily log file,
 * and the renderer gets a friendly bilingual message plus a short error id the
 * shop can quote to support. Success values are never touched.
 */

/** Errors that mean "the code broke", not "the shop did something invalid". */
const INTERNAL_PATTERNS: RegExp[] = [
  /SQLITE/i,
  /constraint failed/i,
  /no such (table|column|function|module)/i,
  /database (is locked|disk image is malformed)/i,
  /disk I\/O error/i,
  /out of memory/i,
  /Cannot (read|set) propert/i,
  /undefined is not/i,
  /is not a function/i,
  /is not iterable/i,
  /Converting circular structure/i,
  /Maximum call stack/i,
  /Unexpected token/i,
  /JSON\.parse/i,
  /fetch failed/i,
  /network error/i,
  /Failed to (load|create|save|update|delete|read|write|open|close|parse|serialize)/i,
  /\b(EPIPE|ECONNRESET|ECONNREFUSED|EACCES|ENOENT|ENOSPC|EBUSY|ETIMEDOUT)\b/,
];

export function isInternalIpcError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (err.name === 'TypeError' || err.name === 'ReferenceError' || err.name === 'SyntaxError') {
    return true;
  }
  const code = String((err as { code?: unknown }).code ?? '');
  if (/^(ERR_SQLITE|SQLITE_|ERR_INVALID_STATE)/.test(code)) return true;
  const message = err.message ?? '';
  if (!message.trim()) return true;
  return INTERNAL_PATTERNS.some((re) => re.test(message));
}

/**
 * Short, time-ordered, unambiguous id: `E-YYMMDDHHMMSS-XXXX`.
 * The timestamp makes the matching log line easy to find; the random suffix
 * prevents two errors in the same second colliding.
 */
export function newErrorId(now: Date = new Date(), random: () => number = Math.random): string {
  const iso = now.toISOString().replace(/[-:TZ.]/g, '');
  const stamp = iso.slice(2, 14); // YYMMDDHHMMSS
  const rand = Math.floor(random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `E-${stamp}-${rand}`;
}

/** Bilingual on purpose: the main process cannot read the renderer's language. */
export function friendlyIpcMessage(errorId: string): string {
  return (
    `Something went wrong (${errorId}). Please try again or give this code to support. ` +
    `کچھ غلط ہو گیا (${errorId})۔ دوبارہ کوشش کریں یا سپورٹ کو یہ کوڈ بتائیں۔`
  );
}

export interface WrapIpcOptions {
  /** Test seam — defaults to the real rotating logger. */
  log?: (context: string, err: unknown) => void;
  /** Test seam — defaults to `newErrorId()`. */
  makeId?: () => string;
}

/**
 * Wrap one `ipcMain.handle` listener. Expected validation errors pass through
 * untouched; internal errors become `Error(friendly + id)` with `errorId`
 * attached and the full original stored as `cause` + written to the log.
 */
export function wrapIpcHandler<Args extends unknown[], Result>(
  channel: string,
  listener: (...args: Args) => Result | Promise<Result>,
  options: WrapIpcOptions = {}
): (...args: Args) => Promise<Result> {
  const log = options.log ?? logError;
  const makeId = options.makeId ?? (() => newErrorId());
  return async (...args: Args): Promise<Result> => {
    try {
      return await listener(...args);
    } catch (err) {
      if (!isInternalIpcError(err)) throw err;
      const errorId = makeId();
      try {
        log(`ipc ${channel} [${errorId}]`, err);
      } catch {
        /* logging must never mask the original failure */
      }
      const friendly = new Error(friendlyIpcMessage(errorId));
      friendly.name = 'IpcError';
      (friendly as Error & { errorId?: string; cause?: unknown }).errorId = errorId;
      (friendly as Error & { errorId?: string; cause?: unknown }).cause = err;
      throw friendly;
    }
  };
}
