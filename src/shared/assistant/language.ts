/**
 * The language detection — English, Urdu and Roman Urdu.
 *
 * The shop's assistant language is a SETTING, but the assistant also has to
 * understand what the user typed. The detection is deliberately simple and
 * offline: it looks at the script first (Urdu script → Urdu) and then at a
 * short list of Roman Urdu words (→ Roman Urdu); everything else is English.
 */

export type DetectedLanguage = 'en' | 'ur' | 'roman';

/** The Urdu script block. */
const URDU_SCRIPT_RE = /[؀-ۿݐ-ݿ]/;

/** The Roman Urdu words that give it away. */
const ROMAN_URDU_WORDS = [
  'kya', 'hai', 'hain', 'kitna', 'kitni', 'kitne', 'aaj', 'kal', 'parso',
  'mein', 'mera', 'meri', 'hum', 'tum', 'apna', 'kaise', 'kaisa', 'batao',
  'batayein', 'dikhao', 'dikhayein', 'chahiye', 'chahiye', 'waqt', 'paisay',
  'paise', 'sab', 'kuch', 'bhi', 'nahi', 'nahin', 'haan', 'lekin', 'magar',
  'karan', 'kyun', 'kyun', 'kahan', 'kahan', 'sirf', 'bohat', 'bohot', 'zyada',
  'kam', 'rupees', 'bhai', 'yaar', 'theek', 'abhi', 'phir', 'baad', 'wale',
];

/** The English words that keep a Roman Urdu sentence in English. */
const ENGLISH_WORDS = [
  'the', 'and', 'what', 'how', 'many', 'much', 'show', 'give', 'today',
  'stock', 'sale', 'customer', 'bill', 'product', 'please', 'total', 'open',
];

/**
 * The language of a message.
 *
 * `roman` needs at least two Roman Urdu words (so an English sentence that
 * happens to contain one Urdu word stays English).
 */
export function detectLanguage(text: string): DetectedLanguage {
  const value = String(text ?? '').trim();
  if (!value) return 'en';
  if (URDU_SCRIPT_RE.test(value)) return 'ur';

  const words = value
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'en';

  let urduHits = 0;
  let englishHits = 0;
  for (const word of words) {
    if (ROMAN_URDU_WORDS.includes(word)) urduHits++;
    if (ENGLISH_WORDS.includes(word)) englishHits++;
  }
  if (urduHits >= 2 && urduHits >= englishHits) return 'roman';
  if (urduHits >= 1 && englishHits === 0 && words.length <= 4) return 'roman';
  return 'en';
}

/** Is this text right-to-left? */
export function isRtlText(text: string): boolean {
  return URDU_SCRIPT_RE.test(String(text ?? ''));
}
