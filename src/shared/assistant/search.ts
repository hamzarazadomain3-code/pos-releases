/**
 * The in-app help search — the `search_help` tool.
 *
 * It searches the guides and the FAQ that the app already carries. It works
 * with NO internet and NO AI key, which is the point: the owner gets an
 * answer even when the assistant is switched off.
 *
 * The search understands Roman Urdu, because that is how the shop asks: "bill
 * banana tareeqa" finds the "make a bill" guide. The synonym table is small
 * and lives here (one place, next to the search that uses it).
 */
import { FAQ, type FaqEntry } from './faq';
import { GUIDES, type Guide } from './guides';

/** A word and the words it stands for. */
const SYNONYMS: Record<string, string[]> = {
  bill: ['sale', 'invoice', 'billing', 'sell', 'checkout'],
  banana: ['bill', 'make', 'create'],
  banao: ['bill', 'make', 'create'],
  tareeqa: ['how', 'way', 'guide', 'step'],
  tarika: ['how', 'way', 'guide', 'step'],
  kaise: ['how', 'way', 'guide', 'step'],
  dikhao: ['show', 'guide', 'highlight', 'where'],
  dikha: ['show', 'guide', 'highlight', 'where'],
  show: ['guide', 'highlight', 'where'],
  udhaar: ['credit', 'debt', 'khata'],
  udhar: ['credit', 'debt', 'khata'],
  wapas: ['return', 'refund'],
  wapasi: ['return', 'refund'],
  return: ['refund', 'wapas'],
  refund: ['return', 'wapas'],
  stock: ['inventory', 'product', 'item'],
  product: ['stock', 'inventory', 'item', 'saman'],
  saman: ['product', 'stock', 'item'],
  price: ['rate', 'qeemat', 'cost'],
  qeemat: ['price', 'rate'],
  discount: ['off', 'dascount'],
  dascount: ['discount', 'off'],
  customer: ['client', 'kustomer'],
  kustomer: ['customer', 'client'],
  user: ['cashier', 'staff', 'employee', 'manager'],
  backup: ['copy', 'restore'],
  dashboard: ['home', 'today', 'summary'],
  drawer: ['cash', 'shift'],
  shift: ['drawer', 'day', 'cash'],
  receipt: ['print', 'reprint', 'bill'],
  print: ['receipt', 'printer'],
  assistant: ['help', 'ai'],
  madad: ['help', 'guide'],
};

/**
 * The words that carry no meaning in a question. They are dropped so that
 * "how do I change the shop name" is not matched by a guide that happens to
 * contain the word "the".
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'how', 'do', 'does', 'i', 'a', 'an', 'to', 'in', 'is', 'of', 'on',
  'my', 'are', 'can', 'you', 'it', 'this', 'that', 'with', 'from', 'at', 'be', 'was', 'me',
  'ka', 'ki', 'ke', 'ko', 'se', 'hai', 'kya', 'mein', 'aur', 'hai', 'ho', 'hain', 'par',
  'karo', 'karna', 'karna', 'sirf', 'bas', 'bhi', 'toh',
]);

/** Split a text into the words the search understands. */
export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** The words a token stands for (itself + its synonyms). */
function expand(token: string): string[] {
  const out = new Set<string>([token]);
  for (const synonym of SYNONYMS[token] ?? []) out.add(synonym);
  return [...out];
}

export interface HelpResult {
  kind: 'guide' | 'faq';
  id: string;
  /** The title of the guide / the question of the FAQ entry. */
  title: string;
  /** The text the model reads (the guide's steps or the FAQ's answer). */
  body: string;
  /** The page the answer is about. */
  route?: string;
  /** How well it matched (higher is better). */
  score: number;
  /** The guide's steps (a guide result only). */
  steps?: { id: string; anchor: string; title: string; body: string }[];
}

/** The words of an entry that the query is matched against. */
function entryWords(
  title: string,
  body: string,
  keywords: string[]
): { head: string[]; body: string[] } {
  return {
    head: tokenize(`${title} ${keywords.join(' ')}`),
    body: tokenize(body),
  };
}

/**
 * Score one entry against the query (0 = no match).
 *
 * The title and the keywords weigh more than the body text, and a word the
 * user actually typed weighs more than a synonym.
 */
function scoreWords(query: string[], head: string[], body: string[]): number {
  let score = 0;
  for (const token of query) {
    for (const word of expand(token)) {
      const own = word === token;
      if (head.includes(word)) score += own ? 5 : 2;
      else if (body.includes(word)) score += own ? 2 : 1;
    }
  }
  return score;
}

/**
 * Search the guides and the FAQ.
 *
 * The guides come first (a step-by-step answer beats a one-liner), and the
 * best match comes first inside each group.
 */
export function searchHelp(
  query: string,
  options: { guides?: Guide[]; faq?: FaqEntry[]; limit?: number } = {}
): HelpResult[] {
  const guides = options.guides ?? GUIDES;
  const faq = options.faq ?? FAQ;
  const limit = Math.max(1, Math.min(10, options.limit ?? 5));
  const queryWords = tokenize(query);
  if (!queryWords.length) return [];

  const guideResults: HelpResult[] = [];
  for (const guide of guides) {
    const guideText = guide.steps.map((s) => `${s.title} ${s.body}`).join(' ');
    const words = entryWords(guide.title, guideText, guide.keywords);
    const score = scoreWords(queryWords, words.head, words.body);
    if (score <= 0) continue;
    guideResults.push({
      kind: 'guide',
      id: guide.id,
      title: guide.title,
      body: guideText,
      route: guide.route,
      score,
      steps: guide.steps.map((s) => ({ id: s.id, anchor: s.anchor, title: s.title, body: s.body })),
    });
  }

  const faqResults: HelpResult[] = [];
  for (const entry of faq) {
    const words = entryWords(entry.question, entry.answer, entry.keywords);
    const score = scoreWords(queryWords, words.head, words.body);
    if (score <= 0) continue;
    faqResults.push({
      kind: 'faq',
      id: entry.id,
      title: entry.question,
      body: entry.answer,
      route: entry.route,
      score,
    });
  }

  guideResults.sort((a, b) => b.score - a.score);
  faqResults.sort((a, b) => b.score - a.score);
  // The best match wins — a guide and an FAQ entry compete on the score, and
  // a guide wins a tie (a step-by-step answer beats a one-liner).
  return [...guideResults, ...faqResults]
    .sort((a, b) => (b.score - a.score) || (a.kind === b.kind ? 0 : a.kind === 'guide' ? -1 : 1))
    .slice(0, limit);
}

/**
 * The guide that fits the question best (the first guide result), or null.
 * This is what the `start_guide` tool proposes to the user.
 */
export function bestGuideFor(
  query: string,
  options: { guides?: Guide[] } = {}
): Guide | null {
  const results = searchHelp(query, { ...options, faq: [], limit: 1 });
  const first = results[0];
  if (!first || first.kind !== 'guide') return null;
  return (options.guides ?? GUIDES).find((g) => g.id === first.id) ?? null;
}
