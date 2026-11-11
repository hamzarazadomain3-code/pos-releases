import { useEffect, useRef } from 'react';
import {
  decideEscape,
  normalizeDoubleTapWindow,
  type EscapeContext,
  type EscapeState,
} from '@shared/escapeGesture';

/**
 * The renderer half of the Esc gesture.
 *
 * The PURE rules live in `src/shared/escapeGesture.ts`; this module only
 * remembers the state between keypresses and keeps the registry of "what does
 * a refresh mean on THIS page".
 */

export interface PageRefreshHandlers {
  /** Reload the page's data from the main process. */
  reloadData?: () => void | Promise<void>;
  /** Clear the page's search boxes. */
  clearSearch?: () => void;
  /** Clear the page's temporary filters. */
  clearFilters?: () => void;
  /** Close any open popover / dropdown. */
  closePopovers?: () => void;
  /** Focus the page's main input (Billing: the product search). */
  focusMainInput?: () => void;
  /** Scroll the page back to the top. Return false when the page cannot scroll. */
  scrollToTop?: () => boolean;
}

interface RegistryEntry {
  id: number;
  handlers: PageRefreshHandlers;
}

const registry: RegistryEntry[] = [];
let seq = 0;

export function registerPageRefresh(handlers: PageRefreshHandlers): number {
  const id = ++seq;
  registry.push({ id, handlers });
  return id;
}

export function unregisterPageRefresh(id: number): void {
  const i = registry.findIndex((r) => r.id === id);
  if (i >= 0) registry.splice(i, 1);
}

/** The refresh handlers of the page that is currently on top. */
export function activePageRefresh(): PageRefreshHandlers | null {
  return registry.length > 0 ? registry[registry.length - 1].handlers : null;
}

// ── The gesture state (shared by the global layer and Billing) ─────────────

let gestureState: EscapeState = { lastEscapeAt: null };

export function resetEscapeGesture(): void {
  gestureState = { lastEscapeAt: null };
}

export interface EscapeGestureOptions {
  /** The setting toggle (Settings > Keyboard). Default ON. */
  enabled?: boolean;
  /** The double-tap window in ms. */
  windowMs?: number;
  /** Extra context flags. */
  context?: Partial<EscapeContext>;
}

/**
 * Run the gesture for one Escape keypress. Returns the decision so the caller
 * can act on it (and so it can be logged).
 */
export function runEscapeGesture(
  now: number,
  options: EscapeGestureOptions = {}
): ReturnType<typeof decideEscape> {
  const decision = decideEscape({
    now,
    state: gestureState,
    context: {
      hasTopLayer: false,
      busy: false,
      composing: false,
      inUrduKeyboard: false,
      onLockScreen: false,
      onDesignerCanvas: false,
      unsavedChanges: false,
      onBilling: false,
      enabled: options.enabled ?? true,
      ...(options.context ?? {}),
    },
    doubleTapWindowMs: normalizeDoubleTapWindow(options.windowMs),
  });
  gestureState = decision.nextState;
  return decision;
}

/** Run the standard refresh steps for the active page. */
export async function runPageRefresh(handlers: PageRefreshHandlers | null): Promise<void> {
  if (!handlers) return;
  handlers.closePopovers?.();
  handlers.clearFilters?.();
  handlers.clearSearch?.();
  try {
    await handlers.reloadData?.();
  } catch {
    /* a failed reload must not break the gesture */
  }
  handlers.scrollToTop?.();
  handlers.focusMainInput?.();
}

/**
 * `usePageRefresh` — a page registers what a refresh means for it.
 *
 * The returned `refreshNow` can be called by a page button; the global Esc
 * gesture calls the same steps.
 */
export function usePageRefresh(
  handlers: PageRefreshHandlers,
  active = true
): { refreshNow: () => Promise<void> } {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!active) return;
    const id = registerPageRefresh({
      reloadData: () => ref.current.reloadData?.(),
      clearSearch: () => ref.current.clearSearch?.(),
      clearFilters: () => ref.current.clearFilters?.(),
      closePopovers: () => ref.current.closePopovers?.(),
      focusMainInput: () => ref.current.focusMainInput?.(),
      scrollToTop: () => ref.current.scrollToTop?.() ?? false,
    });
    return () => unregisterPageRefresh(id);
  }, [active]);

  return {
    refreshNow: async () => {
      await runPageRefresh(ref.current);
    },
  };
}
