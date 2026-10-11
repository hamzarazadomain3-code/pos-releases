import { useEffect, useRef } from 'react';
import {
  keyboardScopes,
  toComboSet,
  type ScopeKind,
  type ScopeShortcut,
} from '../keyboard/scopeRegistry';

export interface KeyboardScopeOptions {
  /** 'page' (default) or 'modal'. Modals mask pages underneath. */
  kind?: ScopeKind;
  /** Extra combos handled directly — not routed through the admin shortcut map. */
  keys?: string[];
  /** Admin action id -> handler (Ctrl+S = 'save', Ctrl+P = 'print', …). */
  actions?: Record<string, (e: KeyboardEvent) => void>;
  /** Escape handler for this scope. */
  onEscape?: () => void;
  /** Entries for the F1 help overlay. */
  shortcuts?: ScopeShortcut[];
  /** Label shown in help (usually the page name). */
  label?: string;
  /** Set false to temporarily withdraw the scope (e.g. while a child modal owns it). */
  enabled?: boolean;
}

/**
 * Register the current component as a keyboard scope.
 *
 * The registered object exposes getters over a ref, so the handlers/actions
 * stay fresh across renders without re-registering on every change. Callers
 * therefore do NOT need to memoise the callbacks they pass in.
 */
export function useKeyboardScope(options: KeyboardScopeOptions): void {
  const latest = useRef<KeyboardScopeOptions>(options);
  latest.current = options;

  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    const live = {
      kind: latest.current.kind ?? 'page',
      get keys() {
        return toComboSet(latest.current.keys ?? []);
      },
      get actions() {
        return latest.current.actions ?? {};
      },
      get onEscape() {
        return latest.current.onEscape;
      },
      get shortcuts() {
        return latest.current.shortcuts ?? [];
      },
      get label() {
        return latest.current.label;
      },
    };

    const id = keyboardScopes.register(live);
    return () => keyboardScopes.unregister(id);
  }, [enabled]);
}
