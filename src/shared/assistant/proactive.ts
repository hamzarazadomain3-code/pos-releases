/**
 * The proactive insights — the pure rules.
 *
 * The assistant may NOTICE something on its own (a product that ran low, a
 * customer whose udhaar is overdue, a price below the cost) and offer to look
 * into it. It is OPT-IN: the switch (`assistant_proactive_enabled`) is off
 * until the owner turns it on, and the switch is checked in the main process
 * before a single fact is read.
 *
 * The rules live here, away from the database, so the panel and the test can
 * never disagree about what a suggestion means. The FACTS come from the app's
 * own services (the very same numbers the Dashboard shows).
 */
import type { AssistantRole } from './types';

/** How loudly the suggestion asks for attention. */
export type ProactiveSeverity = 'info' | 'warning';

/** The kinds of thing the assistant may notice. */
export type ProactiveFactKind =
  | 'low_stock'
  | 'below_cost'
  | 'overdue_customers'
  | 'shift_open'
  | 'shift_missing';

/** One fact about the shop (a COUNT, never a row of data). */
export interface ProactiveFact {
  kind: ProactiveFactKind;
  /** How many things the fact is about (0 means "nothing to say"). */
  count: number;
  /** The money the fact is about (when there is any). */
  amount?: number;
}

/** One suggestion the owner may tap. */
export interface ProactiveSuggestion {
  /** Stable id (the panel keys the list by it). */
  id: string;
  severity: ProactiveSeverity;
  /** The i18n key of the title. */
  titleKey: string;
  /** The i18n key of the message (it may use {count} and {amount}). */
  messageKey: string;
  /** The values the message uses. */
  values: { count?: number; amount?: number };
  /** The page the suggestion is about (the panel can open it). */
  route?: string;
  /** The question that is sent when the owner taps the suggestion. */
  prompt: string;
  /** The lowest role that may see this suggestion. */
  minRole: AssistantRole;
}

/** At most this many suggestions are shown at once. */
export const MAX_PROACTIVE_SUGGESTIONS = 3;

interface Rule {
  kind: ProactiveFactKind;
  severity: ProactiveSeverity;
  titleKey: string;
  messageKey: string;
  route?: string;
  prompt: string;
  minRole: AssistantRole;
}

/** The rules — one per fact. The order is the order they are shown in. */
const RULES: Rule[] = [
  {
    kind: 'low_stock',
    severity: 'warning',
    titleKey: 'assistant.proactive.lowStockTitle',
    messageKey: 'assistant.proactive.lowStockBody',
    route: 'inventory',
    prompt: 'Which products are low in stock right now?',
    minRole: 'manager',
  },
  {
    kind: 'below_cost',
    severity: 'warning',
    titleKey: 'assistant.proactive.belowCostTitle',
    messageKey: 'assistant.proactive.belowCostBody',
    route: 'reports',
    prompt: 'Which products were sold below their cost price?',
    minRole: 'manager',
  },
  {
    kind: 'overdue_customers',
    severity: 'warning',
    titleKey: 'assistant.proactive.overdueTitle',
    messageKey: 'assistant.proactive.overdueBody',
    route: 'udhaar',
    prompt: 'Which customers have an overdue udhaar balance, and how much in total?',
    minRole: 'manager',
  },
  {
    kind: 'shift_missing',
    severity: 'info',
    titleKey: 'assistant.proactive.noShiftTitle',
    messageKey: 'assistant.proactive.noShiftBody',
    route: 'billing',
    prompt: 'What is the status of the current shift?',
    minRole: 'cashier',
  },
  {
    kind: 'shift_open',
    severity: 'info',
    titleKey: 'assistant.proactive.shiftTitle',
    messageKey: 'assistant.proactive.shiftBody',
    route: 'billing',
    prompt: 'What is the status of the current shift?',
    minRole: 'cashier',
  },
];

function roleRank(role: string | null | undefined): number {
  const rank: Record<AssistantRole, number> = { cashier: 1, manager: 2, owner: 3 };
  return rank[role as AssistantRole] ?? 0;
}

/**
 * The suggestions for these facts.
 *
 * The warnings come first, the list is capped, and a role never sees a
 * suggestion it may not act on (a cashier never gets the profit ones).
 */
export function buildProactiveSuggestions(
  facts: ProactiveFact[],
  role: string | null | undefined,
  limit: number = MAX_PROACTIVE_SUGGESTIONS
): ProactiveSuggestion[] {
  const rank = roleRank(role);
  if (!rank) return [];
  const byKind = new Map<ProactiveFactKind, ProactiveFact>();
  for (const fact of facts ?? []) {
    if (!fact || !byKind.has(fact.kind)) byKind.set(fact.kind, fact);
  }
  const suggestions: ProactiveSuggestion[] = [];
  for (const rule of RULES) {
    if (rank < roleRank(rule.minRole)) continue;
    const fact = byKind.get(rule.kind);
    if (!fact) continue;
    // A fact with nothing in it is not worth a line on the screen. The shift
    // facts are complementary: only one of them ever has a count.
    if (fact.count <= 0) continue;
    suggestions.push({
      id: rule.kind,
      severity: rule.severity,
      titleKey: rule.titleKey,
      messageKey: rule.messageKey,
      values: { count: fact.count, ...(fact.amount !== undefined ? { amount: fact.amount } : {}) },
      route: rule.route,
      prompt: rule.prompt,
      minRole: rule.minRole,
    });
  }
  // The warnings first, the order of the rules decides the rest.
  suggestions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1));
  const max = Math.max(0, limit);
  return suggestions.slice(0, max);
}

/** The facts every rule needs — a plain, countable shape. */
export function factCount(facts: ProactiveFact[], kind: ProactiveFactKind): number {
  const fact = (facts ?? []).find((f) => f && f.kind === kind);
  return fact ? Number(fact.count) || 0 : 0;
}
