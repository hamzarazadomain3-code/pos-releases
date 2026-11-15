/**
 * The quick-action chips — the one-tap questions.
 *
 * The chips depend on the ROLE (a cashier never gets a profit question) and
 * on the PAGE (the "guide for this page" chip only appears where there is a
 * guide). The labels are i18n keys; the prompt is what the assistant is asked.
 */
import type { AssistantRole } from './types';

export interface AssistantChip {
  id: string;
  /** The i18n key of the label. */
  labelKey: string;
  /** The question that is sent when the chip is tapped. */
  prompt: string;
}

interface ChipSpec {
  id: string;
  labelKey: string;
  prompt: string;
  minRole: AssistantRole;
  /** The routes this chip makes sense on ('*' = everywhere). */
  routes?: string[];
}

const SPECS: ChipSpec[] = [
  {
    id: 'today_sale',
    labelKey: 'assistant.chips.todaySale',
    prompt: "How much did we sell today, and how many bills were there?",
    minRole: 'manager',
  },
  {
    id: 'low_stock',
    labelKey: 'assistant.chips.lowStock',
    prompt: 'Which products are low in stock right now?',
    minRole: 'manager',
  },
  {
    id: 'udhaar_overdue',
    labelKey: 'assistant.chips.udhaarOverdue',
    prompt: 'Which customers have an overdue udhaar balance, and how much in total?',
    minRole: 'manager',
  },
  {
    id: 'shift_status',
    labelKey: 'assistant.chips.shiftStatus',
    prompt: 'What is the status of the current shift?',
    minRole: 'cashier',
  },
  {
    id: 'below_cost',
    labelKey: 'assistant.chips.belowCost',
    prompt: 'Which products were sold below their cost price?',
    minRole: 'manager',
  },
  {
    id: 'page_guide',
    labelKey: 'assistant.chips.pageGuide',
    prompt: 'Show me how this page works.',
    minRole: 'cashier',
  },
];

/**
 * The chips for this role and this page.
 *
 * The order is the registry order, so the list is stable.
 */
export function chipsForContext(role: string | null | undefined, route: string | null | undefined): AssistantChip[] {
  if (!role) return [];
  const rank: Record<AssistantRole, number> = { cashier: 1, manager: 2, owner: 3 };
  const userRank = rank[role as AssistantRole];
  if (!userRank) return [];
  return SPECS.filter((spec) => {
    if (userRank < rank[spec.minRole]) return false;
    if (spec.id === 'page_guide' && !route) return false;
    if (spec.routes && route && !spec.routes.includes(route) && !spec.routes.includes('*')) return false;
    return true;
  }).map((spec) => ({ id: spec.id, labelKey: spec.labelKey, prompt: spec.prompt }));
}

/** Every chip (the privacy page lists them). */
export function allChips(): AssistantChip[] {
  return SPECS.map((spec) => ({ id: spec.id, labelKey: spec.labelKey, prompt: spec.prompt }));
}
