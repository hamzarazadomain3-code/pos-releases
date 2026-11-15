/**
 * The assistant's conversation history — stored LOCALLY, per user.
 *
 * The history never leaves the device (it is not sent to the provider except
 * as the conversation context of the current turn, which the redaction layer
 * controls). It is capped in both messages and characters, and every read and
 * write is wrapped in try/catch: a browser with storage disabled must not
 * break the assistant.
 *
 * Nothing secret is ever stored here — the messages are the user's own
 * questions and the assistant's answers.
 */

export interface StoredAssistantMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** The tool the answer came from (the source line under the answer). */
  source?: string;
}

/** How many messages are kept per user. */
export const ASSISTANT_HISTORY_LIMIT = 40;
/** The character cap for the whole history. */
export const ASSISTANT_HISTORY_MAX_CHARS = 20_000;

/** The storage key for one user's history. */
export function historyKey(userId: number | string): string {
  return `assistant_history_${userId}`;
}

/**
 * Trim a history: the newest `limit` messages, and never more than
 * `maxChars` characters (oldest first removed).
 */
export function trimHistory(
  messages: StoredAssistantMessage[],
  limit: number = ASSISTANT_HISTORY_LIMIT,
  maxChars: number = ASSISTANT_HISTORY_MAX_CHARS
): StoredAssistantMessage[] {
  const kept = messages.slice(-Math.max(0, limit));
  let total = kept.reduce((sum, m) => sum + (m.text ? m.text.length : 0), 0);
  const out = kept.slice();
  while (out.length > 0 && total > maxChars) {
    const dropped = out.shift();
    total -= dropped && dropped.text ? dropped.text.length : 0;
  }
  return out;
}

/** Read one user's history. A broken store is treated as "no history". */
export function loadHistory(userId: number | string): StoredAssistantMessage[] {
  try {
    const raw = globalThis.localStorage?.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => ({ role: m.role, text: m.text, at: Number(m.at) || 0, source: typeof m.source === 'string' ? m.source : undefined }));
  } catch {
    return [];
  }
}

/** Write one user's history (trimmed). A full store is not an error. */
export function saveHistory(userId: number | string, messages: StoredAssistantMessage[]): void {
  try {
    globalThis.localStorage?.setItem(historyKey(userId), JSON.stringify(trimHistory(messages)));
  } catch {
    /* storage disabled or full — the assistant keeps working without a history */
  }
}

/** Forget one user's history. */
export function clearHistory(userId: number | string): void {
  try {
    globalThis.localStorage?.removeItem(historyKey(userId));
  } catch {
    /* nothing to do */
  }
}
