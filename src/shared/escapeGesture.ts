/**
 * The Esc gesture — a PURE state machine.
 *
 * One key (Esc) does three things, decided by what is currently open:
 *
 *  1. Something is open (a modal, a dropdown, a combobox, a popover, a menu,
 *     or the Pause bill-edit mode) → Esc closes ONLY the topmost one. The
 *     keypress is consumed: no refresh, no navigation.
 *  2. Nothing is open → Esc REFRESHES the current page (reload its data,
 *     clear its search boxes and temporary filters, close popovers, scroll to
 *     top, focus the page's main input). It never reloads the Electron window
 *     and never touches the current bill.
 *  3. Esc twice within the double-tap window → GO TO BILLING and focus the
 *     product search. The bill is preserved. On Billing it only focuses the
 *     search box and clears its text.
 *
 * The gesture never fires while a payment / print / save is running, during
 * IME composition, inside the Urdu keyboard, on the login/lock screen, or on
 * the label/receipt designer canvas.
 *
 * This module is dependency-free so it can be unit tested with fake timers and
 * reused by every page through the `usePageRefresh` hook.
 */

export type EscapeAction = 'close-top' | 'refresh' | 'go-billing' | 'ignore';

export interface EscapeContext {
  /** A modal, dropdown, combobox, popover, open menu or the bill-edit mode. */
  hasTopLayer: boolean;
  /** A payment, print or save is running. */
  busy: boolean;
  /** An IME composition is in progress (Urdu / Chinese input). */
  composing: boolean;
  /** The keystroke happened inside the Urdu keyboard component. */
  inUrduKeyboard: boolean;
  /** The login or lock screen is showing. */
  onLockScreen: boolean;
  /** The label / receipt designer canvas has focus. */
  onDesignerCanvas: boolean;
  /** The current page has unsaved edits. */
  unsavedChanges: boolean;
  /** The current page IS Billing. */
  onBilling: boolean;
  /** The feature is switched on in Settings > Keyboard. */
  enabled: boolean;
}

export interface EscapeState {
  /**
   * Timestamp (ms) of the last Esc that was acted upon, or null when there is
   * no pending first press.
   */
  lastEscapeAt: number | null;
}

export interface EscapeInput {
  /** The current clock (ms). Injected so tests can use fake timers. */
  now: number;
  state: EscapeState;
  context: EscapeContext;
  /** The double-tap window in ms (300-800, default 400). */
  doubleTapWindowMs?: number;
}

export interface EscapeDecision {
  action: EscapeAction;
  /** The state to store for the next keypress. */
  nextState: EscapeState;
  /** True when the keypress must be consumed (preventDefault + stopPropagation). */
  consume: boolean;
  /** True when the caller must ask "Discard changes?" before navigating. */
  requiresDiscardPrompt: boolean;
}

export const DEFAULT_DOUBLE_TAP_WINDOW_MS = 400;
export const MIN_DOUBLE_TAP_WINDOW_MS = 300;
export const MAX_DOUBLE_TAP_WINDOW_MS = 800;

/** Clamp the configured window into the allowed range. */
export function normalizeDoubleTapWindow(ms: unknown): number {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_DOUBLE_TAP_WINDOW_MS;
  return Math.min(MAX_DOUBLE_TAP_WINDOW_MS, Math.max(MIN_DOUBLE_TAP_WINDOW_MS, Math.trunc(n)));
}

/**
 * Decide what an Esc keypress does. Pure: the same input always gives the
 * same answer.
 */
export function decideEscape(input: EscapeInput): EscapeDecision {
  const { now, state, context } = input;
  const windowMs = normalizeDoubleTapWindow(input.doubleTapWindowMs);
  const previous = state?.lastEscapeAt ?? null;
  const untouched: EscapeState = { lastEscapeAt: null };

  // 4) Places where the gesture must never fire.
  if (!context.enabled) {
    return { action: 'ignore', nextState: untouched, consume: false, requiresDiscardPrompt: false };
  }
  if (context.composing || context.inUrduKeyboard) {
    return { action: 'ignore', nextState: untouched, consume: false, requiresDiscardPrompt: false };
  }
  if (context.onLockScreen || context.onDesignerCanvas) {
    return { action: 'ignore', nextState: untouched, consume: false, requiresDiscardPrompt: false };
  }
  // While a payment / print / save is running, Esc is ignored entirely.
  if (context.busy) {
    return { action: 'ignore', nextState: untouched, consume: false, requiresDiscardPrompt: false };
  }

  // 1) Something is open → close the topmost one and nothing else.
  if (context.hasTopLayer) {
    return {
      action: 'close-top',
      nextState: { lastEscapeAt: null },
      consume: true,
      requiresDiscardPrompt: false,
    };
  }

  // 3) A second Esc inside the window → go to Billing.
  const isDoubleTap = previous !== null && now - previous <= windowMs;
  if (isDoubleTap) {
    return {
      action: 'go-billing',
      nextState: { lastEscapeAt: null },
      consume: true,
      requiresDiscardPrompt: !!context.unsavedChanges,
    };
  }

  // 2) A single Esc with nothing open → refresh this page.
  return {
    action: 'refresh',
    nextState: { lastEscapeAt: now },
    consume: true,
    requiresDiscardPrompt: false,
  };
}

/**
 * The refresh half of the gesture, described as data so every page can run
 * the same steps: reload the page data, clear the search boxes and temporary
 * filters, close the popovers, scroll to top and focus the main input.
 *
 * The cart, the held bills, the customer, the discounts and any typed notes
 * are NOT touched — a refresh never disturbs the current bill.
 */
export interface PageRefreshPlan {
  /** Reload the page's data from the main process. */
  reloadData: boolean;
  /** Clear the page's search boxes. */
  clearSearch: boolean;
  /** Clear the page's temporary filters. */
  clearFilters: boolean;
  /** Close any open popover / dropdown. */
  closePopovers: boolean;
  /** Scroll the page back to the top. */
  scrollToTop: boolean;
  /** Focus the page's main input (Billing: the product search). */
  focusMainInput: boolean;
  /** The current bill is NEVER touched by a refresh. */
  preserveBill: true;
}

/** The plan a page runs when the gesture says "refresh". */
export function pageRefreshPlan(): PageRefreshPlan {
  return {
    reloadData: true,
    clearSearch: true,
    clearFilters: true,
    closePopovers: true,
    scrollToTop: true,
    focusMainInput: true,
    preserveBill: true,
  };
}
