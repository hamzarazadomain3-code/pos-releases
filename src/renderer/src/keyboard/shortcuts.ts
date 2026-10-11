/**
 * Catalog of keyboard actions used by the global shortcut layer and the F1
 * help overlay.
 *
 * `GLOBAL_SHORTCUTS` are app-wide built-ins. They always work, regardless of
 * the admin `shortcuts` table, so a fresh install (or one that never ran
 * "Reset shortcuts") still has a command palette and a help overlay.
 *
 * Everything else is admin-driven: the owner can rebind the combo in
 * Admin → Shortcuts, and each page declares which actions it can actually run.
 */

export interface ShortcutDef {
  /** Action id (matches `admin.shortcuts.action` where one exists). */
  id: string;
  /** Human description. */
  label: string;
  /** Combo used when the admin shortcut table has no binding for this action. */
  defaultKey: string;
  /** Built-ins cannot be rebound and are always active. */
  global?: boolean;
}

export const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { id: 'command_palette', label: 'Go to page (command palette)', defaultKey: 'Ctrl+K', global: true },
  { id: 'help', label: 'Keyboard shortcuts help', defaultKey: 'F1', global: true },
];

/** Fallback combos for page actions that do not have to exist in the DB. */
export const BUILTIN_DEFAULTS: Record<string, string> = {
  command_palette: 'Ctrl+K',
  help: 'F1',
  new_record: 'Ctrl+N',
};

/**
 * Resolve the effective combo for an action: admin binding first, then a
 * built-in default. Returns '' when unbound.
 */
export function resolveActionKey(
  action: string,
  shortcutMap: Record<string, string>,
): string {
  return shortcutMap[action] ?? BUILTIN_DEFAULTS[action] ?? '';
}
