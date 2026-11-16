/**
 * The proactive insights — the main-process half.
 *
 * It reads the shop's OWN numbers (the very same services the Dashboard and
 * the reports use), turns them into the countable FACTS the pure rules want,
 * and returns the suggestions.
 *
 * Two gates come FIRST, before a single fact is read:
 *   1. the assistant's own switch (`assistant_enabled`) and the proactive
 *      switch (`assistant_proactive_enabled`) — both are OFF by default,
 *   2. the role of the SESSION (never a role the model asked for).
 */
import { currentUser } from '../auth';
import { listLowStock } from '../inventory';
import { listBelowCostProducts } from '../reports';
import { getUdhaarAging } from '../udhaar';
import { currentShift } from '../shifts';
import { getAssistantSettings, assistantOptedOut } from './settings';
import {
  buildProactiveSuggestions,
  type ProactiveFact,
  type ProactiveSuggestion,
} from '../../../shared/assistant/proactive';

/**
 * The facts about the shop right now.
 *
 * Only COUNTS and TOTALS leave this function — never a row, never a name.
 */
export function collectProactiveFacts(): ProactiveFact[] {
  const facts: ProactiveFact[] = [];
  try {
    facts.push({ kind: 'low_stock', count: listLowStock().length });
  } catch {
    facts.push({ kind: 'low_stock', count: 0 });
  }
  try {
    facts.push({ kind: 'below_cost', count: listBelowCostProducts().length });
  } catch {
    facts.push({ kind: 'below_cost', count: 0 });
  }
  try {
    const aging = getUdhaarAging();
    const overdue = aging.rows.filter((row) => Number(row.days_overdue) > 0);
    facts.push({
      kind: 'overdue_customers',
      count: overdue.length,
      amount: overdue.reduce((sum, row) => sum + Number(row.outstanding || 0), 0),
    });
  } catch {
    facts.push({ kind: 'overdue_customers', count: 0 });
  }
  try {
    facts.push({ kind: 'shift_open', count: currentShift() ? 1 : 0 });
    facts.push({ kind: 'shift_missing', count: currentShift() ? 0 : 1 });
  } catch {
    facts.push({ kind: 'shift_open', count: 0 });
    facts.push({ kind: 'shift_missing', count: 1 });
  }
  return facts;
}

/**
 * The suggestions for the signed-in user.
 *
 * An empty list means "nothing to say" — and it is also the answer when the
 * switches are off, when the role may not use the assistant at all, or when
 * nobody is signed in.
 */
export function getProactiveSuggestions(): ProactiveSuggestion[] {
  const settings = getAssistantSettings();
  if (!settings.enabled || !settings.proactiveEnabled) return [];
  const user = currentUser();
  if (!user) return [];
  if (!settings.roles.includes(user.role as 'owner' | 'manager' | 'cashier')) return [];
  // The user's own opt-out wins over everything else.
  if (assistantOptedOut(user.id)) return [];
  try {
    return buildProactiveSuggestions(collectProactiveFacts(), user.role);
  } catch {
    // A suggestion must never break the panel.
    return [];
  }
}
