import {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  resolveCombo,
  isActionAllowedOn,
  actionsForScreen,
  hintRows,
  defaultCombo,
  getAction,
  type ScreenId,
  type ShortcutActionDef,
} from '@shared/shortcuts';

export {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  resolveCombo,
  isActionAllowedOn,
  actionsForScreen,
  hintRows,
  defaultCombo,
  getAction,
  type ScreenId,
  type ShortcutActionDef,
};

/**
 * Backwards-compatible alias for the registry definition. Prefer importing
 * `ShortcutActionDef` from `@shared/shortcuts` directly in new code.
 */
export type ShortcutDef = ShortcutActionDef;

/**
 * The catalog now lives in `src/shared/shortcuts.ts` so the main process (which
 * seeds the admin `shortcuts` table), the global provider and the F1 overlay all
 * read the same rows. These re-exports keep the old import sites working.
 */
export const GLOBAL_SHORTCUTS: ShortcutActionDef[] = SHORTCUT_ACTIONS.filter((a) => a.global);

/**
 * Fallback combos for the handful of actions the global provider needs even on a
 * fresh install, before the admin table has been seeded. Everything else uses
 * the admin binding first and the registry default second (`resolveCombo`).
 */
export const BUILTIN_DEFAULTS: Record<string, string> = {
  command_palette: defaultCombo('command_palette'),
  help: defaultCombo('help'),
  new_record: 'Ctrl+N',
};

/**
 * Resolve the effective combo for an action: admin binding first, then the
 * registry default, then the provider's BUILTIN_DEFAULTS. Returns '' when unbound.
 */
export function resolveActionKey(
  action: string,
  shortcutMap: Record<string, string>,
): string {
  return resolveCombo(action, shortcutMap) || BUILTIN_DEFAULTS[action] || '';
}
