/**
 * The redaction layer — what may leave the device.
 *
 * Three data levels, and the rule is simple: the model only ever sees what
 * the shop owner allowed:
 *
 *   aggregates — numbers and counts only. No names, no contact details, no
 *                free text (a product name, a note or a customer's address can
 *                carry anything, including an instruction).
 *   names     — the numbers plus the product and customer NAMES. The contact
 *                details (phone, address, email, WhatsApp) are still removed.
 *   full      — everything the tool returned.
 *
 * On top of the level, SECRETS are always stripped: the provider key, the
 * licence key, the SMTP password — nothing that looks like a secret ever
 * leaves the shop, whatever the level is.
 */
import type { AssistantDataLevel } from './types';

export const REDACTED = '[redacted]';

/** The fields that carry a person or a product name. */
const IDENTITY_FIELDS = new Set([
  'name', 'customer_name', 'product_name', 'supplier_name', 'username',
  'business_name', 'contact_person', 'urdu_name', 'customer_name',
]);

/** The fields that carry contact details. */
const CONTACT_FIELDS = new Set([
  'phone', 'phone_alt', 'whatsapp', 'email', 'address', 'city', 'invoice_no',
  'barcode', 'sku',
]);

/** The fields that carry free text (a note can carry anything). */
const NOTE_FIELDS = new Set([
  'notes', 'note', 'description', 'title', 'reason', 'label', 'comment',
  'message', 'summary', 'detail', 'details',
]);

/** The fields that are safe to keep at every level (they carry no shop data). */
const SAFE_LABEL_FIELDS = new Set([
  'metric', 'unit', 'status', 'refund_mode', 'bucket', 'day', 'period',
  'reason_code', 'type', 'kind',
]);

/** A phone number (with spaces, dashes or a + prefix). */
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
/** A national identity number (the CNIC shape: 5-7-1 digits). */
const CNIC_RE = /\b\d{5}-?\d{7}-?\d\b/g;
/** A card number (13-19 digits with spaces or dashes). */
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

/** The secret-looking values that must never be sent, whatever the level. */
export function secretPatterns(secrets: string[] = []): RegExp[] {
  const patterns: RegExp[] = [];
  for (const secret of secrets) {
    const value = (secret ?? '').trim();
    if (value.length < 8) continue;
    patterns.push(new RegExp(escapeRegExp(value), 'g'));
  }
  return patterns;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip the known secrets from a piece of text. */
export function stripSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const pattern of secretPatterns(secrets)) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Redact one string.
 *
 * At `full` only the secrets are removed. At `names` the contact details go
 * too. At `aggregates` the free text goes as well.
 */
export function redactText(text: string, level: AssistantDataLevel, secrets: string[] = []): string {
  let out = stripSecrets(text, secrets);
  if (level === 'full') return out;
  out = out.replace(PHONE_RE, REDACTED).replace(CNIC_RE, REDACTED).replace(CARD_RE, REDACTED);
  if (level === 'aggregates') {
    // A free-text value at the aggregates level carries no number the model
    // needs — it is dropped by the caller (redactValue).
    return out;
  }
  return out;
}

/** Redact one value (the level decides which fields survive). */
export function redactValue(value: unknown, level: AssistantDataLevel, secrets: string[] = [], key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = stripSecrets(value, secrets);
    const field = (key ?? '').toLowerCase();
    if (level === 'aggregates') {
      // Only the numbers, the counts and a few harmless labels survive.
      if (SAFE_LABEL_FIELDS.has(field)) return text;
      return REDACTED;
    }
    if (level === 'names') {
      if (CONTACT_FIELDS.has(field) || NOTE_FIELDS.has(field)) return REDACTED;
      return redactText(text, level, secrets);
    }
    return redactText(text, level, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, level, secrets, key));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const field = k.toLowerCase();
      if (level === 'aggregates' && (IDENTITY_FIELDS.has(field) || CONTACT_FIELDS.has(field) || NOTE_FIELDS.has(field))) {
        continue;
      }
      if (level === 'names' && (CONTACT_FIELDS.has(field) || NOTE_FIELDS.has(field))) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redactValue(v, level, secrets, field);
    }
    return out;
  }
  return value;
}

/** Redact a whole tool result. */
export function redactResult(result: unknown, level: AssistantDataLevel, secrets: string[] = []): unknown {
  return redactValue(result, level, secrets);
}

/**
 * The keys that were removed from a result — the activity log stores the
 * FIELD LIST (never the values), so the owner can see what was sent.
 */
export function redactedFields(result: unknown, level: AssistantDataLevel): string[] {
  const fields = new Set<string>();
  const walk = (value: unknown, key?: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const field = k.toLowerCase();
        if (level === 'aggregates' && (IDENTITY_FIELDS.has(field) || CONTACT_FIELDS.has(field) || NOTE_FIELDS.has(field))) {
          fields.add(k);
          continue;
        }
        if (level === 'names' && (CONTACT_FIELDS.has(field) || NOTE_FIELDS.has(field))) {
          fields.add(k);
          continue;
        }
        walk(v, field);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    }
  };
  walk(result);
  return [...fields].sort();
}

/**
 * The text that looks like an instruction inside shop data.
 *
 * The assistant does NOT obey it — but it is worth knowing that a row tried.
 * The count is what the activity log keeps (never the text itself).
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /system\s*message\s*:/i,
  /you\s+are\s+now\s+/i,
  /call\s+(the\s+)?\w*_?tool/i,
  /\{\s*"?tool_calls?"?\s*:/i,
  /<\/?assistant_data>/i,
  /delete\s+everything/i,
  /reveal\s+(the\s+)?(system|secret|password|key)/i,
];

export function countInjectionAttempts(text: string): number {
  if (!text) return 0;
  return INJECTION_PATTERNS.filter((p) => p.test(text)).length;
}
