import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { eventCombo, normalizeStoredKey } from '../utils/shortcutKeys';
import { keyboardScopes } from './scopeRegistry';
import { BUILTIN_DEFAULTS } from './shortcuts';
import { CommandPalette, type PalettePage } from '../components/CommandPalette';
import { KeyboardHelp } from '../components/KeyboardHelp';

export interface KeyboardProviderProps {
  /** action -> combo from the admin shortcuts table. */
  shortcutMap: Record<string, string>;
  /** Pages offered in the Ctrl+K palette (already role-filtered). */
  pages: PalettePage[];
  onNavigate: (key: string) => void;
  /**
   * An admin action fired on a screen that did not register a handler.
   * Optional — without it, unknown combinations are simply ignored.
   */
  onAction?: (action: string, e: KeyboardEvent) => void;
  /** When false the global layer is inert (e.g. behind the lock screen). */
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Single global keydown listener + the Ctrl+K palette and F1 help overlay.
 *
 * Routing rules (deliberate, so nothing existing breaks):
 *  1. Anything already preventDefault()'d is ignored — the barcode scanner
 *     runs in the capture phase and must win.
 *  2. Ctrl+K and F1 are built-ins and always work.
 *  3. While an overlay is open everything else is blocked, so a shortcut
 *     cannot fire behind the modal.
 *  4. Admin combos (Ctrl+S / Ctrl+P / Ctrl+F …) are dispatched only to the
 *     active keyboard scope. Screens that have not been migrated register no
 *     scope and keep handling their own keys (legacy handlers still run first).
 */
export function KeyboardProvider({
  shortcutMap,
  pages,
  onNavigate,
  onAction,
  enabled = true,
  children,
}: KeyboardProviderProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Close any overlay and stop listening when the layer is disabled.
  useEffect(() => {
    if (!enabled) {
      setPaletteOpen(false);
      setHelpOpen(false);
    }
  }, [enabled]);

  const comboToAction = useMemo(() => {
    const map = new Map<string, string>();
    for (const [action, key] of Object.entries(shortcutMap)) {
      if (!key) continue;
      map.set(normalizeStoredKey(key), action);
    }
    // Built-in defaults only fill a combo that no admin action has claimed.
    for (const [action, key] of Object.entries(BUILTIN_DEFAULTS)) {
      if (action === 'command_palette' || action === 'help') continue;
      const combo = normalizeStoredKey(key);
      if (!map.has(combo)) map.set(combo, action);
    }
    return map;
  }, [shortcutMap]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const combo = eventCombo(e);

      // ── Built-ins ────────────────────────────────────────────────────────
      if (combo === 'f1') {
        e.preventDefault();
        e.stopPropagation();
        setHelpOpen((o) => !o);
        return;
      }
      if (combo === 'ctrl+k') {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
        return;
      }

      // ── Overlays are modal: nothing fires behind them ────────────────────
      if (paletteOpen || helpOpen) {
        if (combo === 'escape') {
          e.preventDefault();
          setPaletteOpen(false);
          setHelpOpen(false);
        }
        return;
      }

      const scope = keyboardScopes.active();

      // ── Escape fallback (scopes that are open but not focused) ───────────
      if (combo === 'escape' && scope?.onEscape) {
        e.preventDefault();
        scope.onEscape();
        return;
      }

      // ── Admin shortcuts, routed to the active scope ──────────────────────
      const action = comboToAction.get(combo);
      if (action) {
        if (!scope) return; // unmigrated screen owns its own handler
        const fn = scope.actions?.[action];
        if (fn) {
          e.preventDefault();
          e.stopPropagation();
          fn(e);
          return;
        }
        onAction?.(action, e);
        return;
      }

      // ── Combos a scope declared directly ─────────────────────────────────
      if (scope?.keys?.has(combo)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [comboToAction, paletteOpen, helpOpen, onAction, enabled]);

  return (
    <>
      {children}
      {enabled && paletteOpen && (
        <CommandPalette
          pages={pages}
          onNavigate={(key) => {
            setPaletteOpen(false);
            onNavigate(key);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {enabled && helpOpen && (
        <KeyboardHelp shortcutMap={shortcutMap} onClose={() => setHelpOpen(false)} />
      )}
    </>
  );
}
