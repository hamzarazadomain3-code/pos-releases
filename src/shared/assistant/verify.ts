/**
 * The number verifier — every numeric answer must come from a tool result.
 *
 * The system prompt forbids inventing numbers. This module is the post-check:
 * after the model answers, the verifier compares every number in the reply with
 * the tool results. If a number is not present in any tool result, the reply is
 * rejected and the model is asked to retry once (the retry is driven by the
 * caller, not here).
 *
 * The verification is per-language: it recognises numbers in English (12,500),
 * Urdu (١٢،٥٠٠) and Roman Urdu (12500 / 12,500).
 *
 * The comparison is NUMERIC, not textual: "12,500", "12500" and "12500.00" are
 * the same number, and a model that rounds a tool value to a whole unit
 * ("1,235" for 1234.56) still counts as that number.
 */
import type { AssistantLanguage } from './types';

/** The Arabic-Indic digits (٠١٢) and the Extended Arabic-Indic digits (۰۱۲). */
const D = '\\u0660-\\u0669\\u06F0-\\u06F9';
/** The Urdu thousands separator (٬) and the Arabic comma (،). */
const URDU_GROUP = '[\\u066C\\u060C,]';
/** The Urdu decimal separator (٫). */
const URDU_DECIMAL = '\\u066B';

/** Latin digits: 12,500 / 12500 / 12.50 / 1,234.56 */
const LATIN_NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
/**
 * The same, written in Urdu digits with the Urdu separators.
 *
 * The separator may sit anywhere between the digits (the Urdu thousands
 * separator ٬ and the Arabic comma ،), so "١٢،٥٠۰" is one number and not two.
 */
const URDU_NUMBER_RE = new RegExp(
  `[${D}]+(?:${URDU_GROUP}[${D}]+)*(?:[${URDU_DECIMAL}.][${D}]+)?`,
  'g'
);

/**
 * The numbers that are NOT shop data and must never be checked: a list
 * marker ("1."), a shortcut ("F1", "Ctrl+2"), a date, a time, a version or a
 * step number ("Step 2"). Without this the assistant would be told off for
 * writing "1." in a list.
 *
 * An identifier ("INV-2026-0042", "RET-20260116-0003") and a reference ("bill
 * #12") are stripped too: they are names, not figures, and a false alarm
 * would block a correct answer.
 */
const NON_DATA_PATTERNS: RegExp[] = [
  /^\s*\d{1,2}[.)]\s+/gm, // a list marker at the start of a line
  /\b(?:Ctrl|Alt|Shift|Control|Cmd|Command|Option|F)\+?\d{1,2}\b/gi, // a shortcut
  /\bv?\d+\.\d+\.\d+\b/gi, // a version number
  /\b\d{4}-\d{2}-\d{2}\b/g, // a date
  /\b\d{1,2}:\d{2}\b/g, // a time
  /\b(?:step|page|section|level|part|way)\s+\d{1,3}\b/gi, // "Step 2", "page 3"
  /\b[A-Z]{2,}[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*\b/g, // an identifier
  /(?:^|\s)(?:#|No\.?|Nr\.?|Ref\.?)\s*\d+\b/gi, // "bill #12"
];

export interface VerifyResult {
  ok: boolean;
  /** The numbers found in the reply (as they were written). */
  found: string[];
  /** The numbers that could not be matched to any tool result. */
  unverified: string[];
  /** The numbers that were matched. */
  matched: string[];
}

/**
 * Remove the numbers that are not shop data (the list markers, the shortcuts,
 * the dates…). The verification never looks at them.
 */
export function stripNonDataNumbers(text: string): string {
  let out = String(text ?? '');
  for (const pattern of NON_DATA_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/** Turn an Urdu/Arabic-Indic digit string into a plain number string. */
export function urduToPlain(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u066C\u060C,]/g, '')
    .replace(/[\u066B]/g, '.')
    .replace(/\s/g, '');
}

/** Normalise a number string to a comparable form (no commas, no spaces). */
export function normaliseNumber(text: string): string {
  return String(text ?? '')
    .replace(/[,\s]/g, '')
    .replace(/[\u066C\u060C]/g, '')
    .replace(/[\u066B]/g, '.');
}

/** The numeric value of a number string (null when it is not a number). */
export function numberValue(text: string): number | null {
  const cleaned = normaliseNumber(text);
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Extract all numbers from a text, in the user's language. */
export function extractNumbers(text: string, language: AssistantLanguage = 'en'): string[] {
  const value = stripNonDataNumbers(String(text ?? ''));
  const numbers: string[] = [];
  if (language === 'ur') {
    // An Urdu answer may write its digits in the Urdu form or in the Latin
    // one (both are common), so both are read.
    for (const n of value.match(URDU_NUMBER_RE) ?? []) numbers.push(urduToPlain(n));
    for (const n of value.match(LATIN_NUMBER_RE) ?? []) numbers.push(n);
  } else {
    numbers.push(...(value.match(LATIN_NUMBER_RE) ?? []));
  }
  return numbers;
}

/**
 * The set of numbers that appear in the tool results.
 *
 * The length of every list counts too: a tool that returned seven customers
 * proves the number 7 even though no "7" is written anywhere.
 *
 * A number with a leading zero ("0001" in an invoice number) is skipped: it is
 * an identifier, not a quantity, and it would otherwise "prove" any answer
 * that mentions the number 1.
 */
export function toolResultNumbers(results: unknown[]): string[] {
  const set = new Set<string>();
  const walk = (value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) set.add(String(value));
      return;
    }
    if (typeof value === 'string') {
      for (const n of value.match(LATIN_NUMBER_RE) ?? []) {
        if (/^0\d/.test(n)) continue;
        set.add(normaliseNumber(n));
      }
      return;
    }
    if (Array.isArray(value)) {
      set.add(String(value.length));
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };
  for (const result of results) walk(result);
  return [...set];
}

/**
 * Does a number in the answer match a number from a tool result?
 *
 * The match is numeric: the thousands separator and the decimals do not
 * matter, and a whole-unit rounding of a tool value still counts (the model
 * may write "1,235" for 1234.56 — that is the same money).
 */
export function numberMatches(value: number, toolValue: number): boolean {
  if (value === toolValue) return true;
  if (!Number.isInteger(value)) return false;
  // A whole-unit rounding: the answer may sit anywhere between the floor and
  // the ceiling of the tool value (1234.56 → 1234 or 1235).
  return value >= Math.floor(toolValue) && value <= Math.ceil(toolValue);
}

/** Verify every number in the reply against the tool results. */
export function verifyReply(
  reply: string,
  toolResults: unknown[],
  language: AssistantLanguage = 'en'
): VerifyResult {
  const replyNums = extractNumbers(reply, language);
  const toolValues: number[] = [];
  for (const raw of toolResultNumbers(toolResults)) {
    const value = numberValue(raw);
    if (value !== null) toolValues.push(value);
  }
  const matched: string[] = [];
  const unverified: string[] = [];
  for (const raw of replyNums) {
    const value = numberValue(raw);
    if (value === null) continue;
    if (toolValues.some((toolValue) => numberMatches(value, toolValue))) matched.push(raw);
    else unverified.push(raw);
  }
  return {
    ok: unverified.length === 0,
    found: replyNums,
    matched,
    unverified,
  };
}

/** A digit written in any of its three forms (Arabic, Extended, Latin). */
function digitClass(digit: string): string {
  const i = Number(digit);
  const arabic = String.fromCharCode(0x0660 + i);
  const extended = String.fromCharCode(0x06f0 + i);
  return `[${arabic}${extended}${digit}]`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mark the unverified numbers in the reply (for the retry prompt).
 * Uses a distinctive tag so the model knows which numbers are the problem.
 */
export function markUnverified(reply: string, unverified: string[], language: AssistantLanguage = 'en'): string {
  if (!unverified.length) return reply;
  if (language !== 'ur') {
    let out = reply;
    for (const n of unverified) {
      const tag = `<unverified>${n}</unverified>`;
      out = out.replace(new RegExp(escapeRegExp(n), 'g'), tag);
    }
    return out;
  }
  // For Urdu the reply writes its digits in the Arabic-Indic (١) or the
  // Extended Arabic-Indic (۱) form, sometimes mixed, and the thousands
  // separator may be an Arabic comma (،). The extracted number is always
  // plain, so every digit becomes a character class that accepts all three
  // forms and the separator between two digits is optional.
  const patterns = unverified
    .map((n) => normaliseNumber(n))
    .sort((a, b) => b.length - a.length)
    .map((plain) =>
      [...plain]
        .map((d) => (/\d/.test(d) ? digitClass(d) : escapeRegExp(d)))
        .join('[\\s\\u060C,\\u066C]?')
    );
  const re = new RegExp(patterns.map((p) => `(?:${p})`).join('|'), 'g');
  return reply.replace(re, (m) => `<unverified>${m}</unverified>`);
}

/**
 * The friendly message the model gets when it used a number that came from
 * nowhere. The unverified numbers are marked so the model can see which ones
 * are the problem.
 */
export function numberRetryMessage(
  reply: string,
  result: VerifyResult,
  language: AssistantLanguage = 'en'
): string {
  const marked = markUnverified(reply, result.unverified, language);
  return `${marked}\n\n${unverifiedMessage(language)}`;
}

/**
 * The friendly message the model sees when a number is unverified.
 * It is the same text the system prompt uses.
 */
export const UNVERIFIED_NUMBER_MESSAGE = {
  en: 'One or more numbers in your answer did not come from any tool result. Please rephrase using only the numbers the tools returned.',
  ur: 'آپ کے جواب میں ایک یا زیادہ عدد ہیں جو کسی ٹول سے نہیں آئے۔ براہ کرم صرف ٹولز کے عددوں سے جواب دیں۔',
  roman: 'Aap ke jawab mein ek ya zyada adad hain jo kisi tool se nahi aaye. Barah karam sirf tools ke adad se jawab dein.',
};

export function unverifiedMessage(language: AssistantLanguage = 'en'): string {
  if (language === 'ur') return UNVERIFIED_NUMBER_MESSAGE.ur;
  if (language === 'roman') return UNVERIFIED_NUMBER_MESSAGE.roman;
  return UNVERIFIED_NUMBER_MESSAGE.en;
}

/**
 * The message the USER sees when the model could not be made to use only the
 * numbers the tools returned. The invented numbers are never shown: the shop
 * owner gets the reason instead of a wrong figure.
 */
export const UNVERIFIED_FALLBACK_MESSAGE = {
  en: 'I could not confirm every number in my answer against the shop data, so I am not showing the figure. Please ask again, or check the page yourself.',
  ur: 'میں اپنے جواب کا ہر عدد دکان کے ڈیٹا سے تصدیق نہیں کر سکا، اس لیے میں یہ عدد نہیں دکھا رہا۔ براہ کرم دوبارہ پوچھیں یا خود صفحہ دیکھ لیں۔',
  roman: 'Main apne jawab ka har adad shop ke data se verify nahi kar saka, is liye main yeh adad nahi dikha raha. Barah karam dobara poochein ya khud page dekh lein.',
};

export function unverifiedFallbackMessage(language: AssistantLanguage = 'en'): string {
  if (language === 'ur') return UNVERIFIED_FALLBACK_MESSAGE.ur;
  if (language === 'roman') return UNVERIFIED_FALLBACK_MESSAGE.roman;
  return UNVERIFIED_FALLBACK_MESSAGE.en;
}
