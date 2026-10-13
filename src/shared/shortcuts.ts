/**
 * SINGLE SOURCE OF TRUTH for every keyboard shortcut in the app.
 *
 * Both processes import this module:
 *   - main  → `admin.resetShortcuts()` seeds the `shortcuts` table from
 *             `DEFAULT_SHORTCUTS`, so the canonical combos live here, not in SQL
 *             (previously duplicated between `admin.ts` and `shortcuts.ts`).
 *   - renderer → the global provider resolves combos with `resolveCombo()`; each
 *             page declares its screen id; and Billing's footer hint bar + F1
 *             help are generated from these same rows.
 *
 * `screens` is what stops one action firing on the wrong page: lookups are
 * scoped to the actions allowed on the current screen, so F5 can mean
 * "New bill" on Billing and "New product" on Inventory.
 *
 * Order matters: it drives the footer hint bar and the F1 help list.
 */

export type ScreenId =
  | 'global'
  | 'billing'
  | 'quicksale'
  | 'inventory'
  | 'audits'
  | 'promotions'
  | 'purchases'
  | 'udhaar'
  | 'returns'
  | 'shifts'
  | 'reports'
  | 'settings'
  | 'users'
  | 'barcode'
  | 'admin'
  | 'quotations'
  | 'invoiceAdmin'
  | 'branches'
  | 'transfers'
  | 'expenses'
  | 'commissions'
  | 'customReports'
  | 'fifoStock'
  | 'labelStudio';

export interface ShortcutActionDef {
  /** Action id (matches `admin.shortcuts.action` where one exists). */
  id: string;
  /** Human description, reused by the F1 help overlay. */
  label: string;
  /** Combo used when the admin shortcut table has no binding for this action. */
  defaultKey: string;
  /** Screens where the action may run. `global` means everywhere. */
  screens: ScreenId[];
  /** Built-ins cannot be rebound and are always active. */
  global?: boolean;
  /** Seeded into the admin `shortcuts` table. Defaults to true (false for globals). */
  dbBacked?: boolean;
  /** Shown in Billing's one-line footer hint bar. */
  hint?: boolean;
  /** Short label for the footer strip. */
  short?: string;
}

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  // ── Always-on built-ins (not rebindable) ──────────────────────────────────
  { id: 'command_palette', label: 'Go to page (command palette)', defaultKey: 'Ctrl+K', screens: ['global'], global: true, dbBacked: false },
  { id: 'help', label: 'Keyboard shortcuts help', defaultKey: 'F1', screens: ['global'], global: true, dbBacked: false },

  // ── Billing-local keys (fixed; the core POS workflow) ─────────────────────
  { id: 'billing_search', label: 'Focus search / barcode input', defaultKey: 'F2', screens: ['billing'], dbBacked: false, hint: true, short: 'search' },
  { id: 'billing_new', label: 'New bill (clear cart)', defaultKey: 'F5', screens: ['billing'], dbBacked: false, hint: true, short: 'new' },
  { id: 'billing_repeat', label: 'Repeat last sale', defaultKey: 'F7', screens: ['billing'], dbBacked: false, hint: true, short: 'repeat' },
  { id: 'billing_express', label: 'Express checkout (cash)', defaultKey: 'F8', screens: ['billing'], dbBacked: false, hint: true, short: 'express' },
  { id: 'billing_hold', label: 'Hold current bill', defaultKey: 'F9', screens: ['billing'], dbBacked: false, hint: true, short: 'hold' },
  { id: 'billing_held', label: 'Open held bills list', defaultKey: 'F12', screens: ['billing'], dbBacked: false, hint: true, short: 'held' },

  // ── Admin-editable app actions ────────────────────────────────────────────
  { id: 'new_sale', label: 'New sale / bill', defaultKey: 'F2', screens: ['billing'] },
  { id: 'new_product', label: 'Add product', defaultKey: 'F5', screens: ['inventory'] },
  { id: 'new_customer', label: 'Add customer', defaultKey: 'F9', screens: ['udhaar'] },
  { id: 'save', label: 'Save (Pay & Save)', defaultKey: 'Ctrl+S', screens: ['billing', 'quicksale', 'purchases'], hint: true, short: 'save' },
  { id: 'save_print', label: 'Save & print receipt', defaultKey: 'Ctrl+Shift+S', screens: ['billing'], hint: true, short: 'save+print' },
  { id: 'print', label: 'Print last sale', defaultKey: 'Ctrl+P', screens: ['billing', 'quotations'], hint: true, short: 'print' },
  { id: 'new_return', label: 'Return / Refund', defaultKey: 'Ctrl+Shift+R', screens: ['billing'], hint: true, short: 'return' },
  { id: 'search', label: 'Focus search', defaultKey: 'Ctrl+F', screens: ['inventory', 'billing', 'udhaar', 'returns', 'barcode', 'labelStudio', 'purchases', 'expenses', 'transfers', 'promotions', 'commissions', 'branches', 'users', 'customReports', 'quotations', 'audits', 'invoiceAdmin', 'fifoStock', 'reports'] },
  { id: 'duplicate_sale', label: 'Repeat last sale', defaultKey: 'Shift+F2', screens: ['billing'] },
  { id: 'bulk_product', label: 'Bulk add products', defaultKey: 'Shift+F5', screens: ['inventory'] },
  { id: 'permanent_delete', label: 'Permanently delete selected', defaultKey: 'Shift+Delete', screens: ['inventory'] },
  { id: 'cash_drawer', label: 'Open cash drawer', defaultKey: 'Ctrl+D', screens: ['billing', 'shifts'] },
  { id: 'open_shift', label: 'Open shift', defaultKey: 'Ctrl+O', screens: ['billing', 'shifts'] },
  { id: 'close_shift', label: 'Close shift', defaultKey: 'Ctrl+Shift+C', screens: ['billing', 'shifts'] },
  { id: 'hold_bill', label: 'Hold bill', defaultKey: 'Ctrl+H', screens: ['billing'] },
  { id: 'recall_bill', label: 'Recall held bill', defaultKey: 'Ctrl+Shift+H', screens: ['billing'] },
  { id: 'quit', label: 'Quit application', defaultKey: 'Ctrl+Q', screens: ['billing', 'inventory', 'admin', 'settings'] },
  { id: 'reports', label: 'Reports', defaultKey: 'Ctrl+R', screens: ['billing', 'inventory', 'admin', 'reports'] },
  { id: 'logout', label: 'Log out', defaultKey: 'Ctrl+L', screens: ['billing', 'inventory', 'admin', 'settings'] },
  { id: 'settings', label: 'Settings', defaultKey: 'Alt+S', screens: ['billing', 'inventory', 'admin'] },
  { id: 'admin_panel', label: 'Admin panel', defaultKey: 'Alt+A', screens: ['billing', 'inventory'] },
];

const ACTION_BY_ID: Record<string, ShortcutActionDef> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a]),
);

/** Combos seeded into the admin `shortcuts` table (everything not global). */
export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.filter((a) => (a.dbBacked ?? !a.global)).map((a) => [a.id, a.defaultKey]),
);

export function getAction(id: string): ShortcutActionDef | undefined {
  return ACTION_BY_ID[id];
}

/** The default combo for an action, or '' when the id is unknown. */
export function defaultCombo(id: string): string {
  return ACTION_BY_ID[id]?.defaultKey ?? '';
}

/** Actions allowed on a screen (globals included), in registry order. */
export function actionsForScreen(screen: ScreenId): ShortcutActionDef[] {
  return SHORTCUT_ACTIONS.filter((a) => a.screens.includes('global') || a.screens.includes(screen));
}

/** Whether an action may run on a screen. Unknown ids are treated as global. */
export function isActionAllowedOn(id: string, screen: ScreenId): boolean {
  const a = ACTION_BY_ID[id];
  if (!a) return true;
  return a.screens.includes('global') || a.screens.includes(screen);
}

/**
 * Resolve the effective combo for an action: the admin binding first, then the
 * registry default. Returns '' when unbound.
 */
export function resolveCombo(id: string, shortcutMap: Record<string, string> = {}): string {
  return shortcutMap[id] ?? ACTION_BY_ID[id]?.defaultKey ?? '';
}

/** Registry rows for a screen that should appear in the footer hint strip. */
export function hintRows(screen: ScreenId): { id: string; key: string; label: string; short: string }[] {
  return SHORTCUT_ACTIONS
    .filter((a) => a.hint && a.screens.includes(screen))
    .map((a) => ({ id: a.id, key: a.defaultKey, label: a.label, short: a.short ?? a.label }));
}
