/**
 * The source line — WHERE a number came from.
 *
 * The system prompt tells the model to show the source of a number
 * ("Dashboard: today's sale"). This module is the app's half of that rule: the
 * tool names the model used are turned into the short labels the shop already
 * uses (the page names), so the source line reads "Dashboard" or "Inventory"
 * and never leaks a tool name into the UI.
 *
 * The labels come from the app's OWN navigation names (the i18n keys in
 * `navigation.*`), so the source line is never a second, drifting copy of the
 * menu.
 */
import type { AssistantLanguage } from './types';

/** The tool → the i18n key of the page the data came from. */
const TOOL_SOURCE_KEY: Record<string, string> = {
  get_today_summary: 'navigation.dashboard',
  get_sales_range: 'navigation.reports',
  get_top_products: 'navigation.reports',
  get_low_stock: 'navigation.inventory',
  get_product: 'navigation.inventory',
  get_customer: 'navigation.udhaar',
  get_customer_balance: 'navigation.udhaar',
  list_overdue_customers: 'navigation.udhaar',
  get_supplier_payables: 'navigation.purchases',
  get_shift_status: 'navigation.shifts',
  get_returns_summary: 'navigation.returns',
  get_below_cost_products: 'navigation.reports',
  explain_number: 'navigation.reports',
  search_help: 'assistant.source.help',
  open_page: 'assistant.source.navigation',
  start_guide: 'assistant.source.guide',
  highlight: 'assistant.source.guide',
};

/**
 * The fallback labels for the tools whose page has no navigation name.
 * They are plain English because the panel translates them through the i18n
 * keys the app already carries.
 */
export const ASSISTANT_SOURCE_LABELS: Record<string, string> = {
  'navigation.dashboard': 'Dashboard',
  'navigation.reports': 'Reports',
  'navigation.inventory': 'Inventory',
  'navigation.udhaar': 'Udhaar',
  'navigation.purchases': 'Purchases',
  'navigation.shifts': 'Shifts',
  'navigation.returns': 'Returns',
  'assistant.source.help': 'Help',
  'assistant.source.navigation': 'Navigation',
  'assistant.source.guide': 'Guide',
};

/** The i18n key of a tool's source (null when the tool is unknown). */
export function sourceKeyFor(tool: string): string | null {
  return TOOL_SOURCE_KEY[tool] ?? null;
}

/**
 * The source keys of a list of tools, in the order the tools ran and without
 * repeats.
 */
export function sourceKeysFor(tools: string[]): string[] {
  const out: string[] = [];
  for (const tool of tools) {
    const key = TOOL_SOURCE_KEY[tool];
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * The source line of an answer — the labels of the tools that ran, joined.
 * The labels come from the app's own navigation names.
 */
export function sourceLineFor(
  tools: string[],
  translate: (key: string) => string = (key) => ASSISTANT_SOURCE_LABELS[key] ?? key
): string {
  return sourceKeysFor(tools).map(translate).join(' · ');
}

/** The source line in the assistant's own language (for the model). */
export function sourceLineText(tools: string[], language: AssistantLanguage = 'en'): string {
  const labels = sourceKeysFor(tools).map((key) => ASSISTANT_SOURCE_LABELS[key] ?? key);
  if (!labels.length) return '';
  if (language === 'ur') return `ماخذ: ${labels.join('، ')}`;
  if (language === 'roman') return `Source: ${labels.join(', ')}`;
  return `Source: ${labels.join(', ')}`;
}
