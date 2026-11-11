import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { eventCombo, normalizeStoredKey } from '../utils/shortcutKeys';
import { keyboardScopes } from './scopeRegistry';
import { BUILTIN_DEFAULTS } from './shortcuts';
import { CommandPalette, type PalettePage } from '../components/CommandPalette';
import { KeyboardHelp } from '../components/KeyboardHelp';
import { runEscapeGesture, runPageRefresh, activePageRefresh } from './escapeRefresh';

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
  /** Settings > Keyboard: the Esc gesture (default ON). */
  escapeGestureEnabled?: boolean;
  /** Settings > Keyboard: the double-Esc window in ms. */
  escapeDoubleTapWindowMs?: number;
  /** "Go to Billing" (double Esc) — the app shell provides it. */
  onGoToBilling?: () => void;
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
  escapeGestureEnabled = true,
  escapeDoubleTapWindowMs,
  onGoToBilling,
  children,
}: KeyboardProviderProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const escapeBusy = useRef(false);

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

      // ── The Esc gesture ──────────────────────────────────────────────────
      // A modal / overlay is open → Esc closes only the topmost one. Nothing
      // open → Esc refreshes the page; Esc twice → Billing.
      //
      // Only pages that REGISTERED a refresh handler take part, so a legacy
      // screen (which owns its own Escape key) keeps its current behaviour.
      if (combo === 'escape') {
        if (scope?.onEscape) {
          e.preventDefault();
          scope.onEscape();
          return;
        }
        const refreshHandlers = activePageRefresh();
        if (!refreshHandlers) return; // no page opted in — leave Escape alone
        const decision = runEscapeGesture(Date.now(), {
          enabled: escapeGestureEnabled,
          windowMs: escapeDoubleTapWindowMs,
          context: { hasTopLayer: keyboardScopes.hasModal() },
        });
        if (decision.action === 'ignore') return;
        e.preventDefault();
        e.stopPropagation();
        if (decision.action === 'go-billing') {
          onGoToBilling?.();
          return;
        }
        if (decision.action === 'refresh') {
          if (escapeBusy.current) return;
          escapeBusy.current = true;
          void runPageRefresh(refreshHandlers).finally(() => {
            escapeBusy.current = false;
          });
        }
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
  }, [
    comboToAction,
    paletteOpen,
    helpOpen,
    onAction,
    enabled,
    escapeGestureEnabled,
    escapeDoubleTapWindowMs,
    onGoToBilling,
  ]);

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
