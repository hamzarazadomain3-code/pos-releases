import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

function isTextArea(el: HTMLElement | null): boolean {
  return !!el && el.tagName === 'TEXTAREA';
}

function isButton(el: HTMLElement | null): boolean {
  return !!el && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
}

function moveFocus(container: HTMLElement, current: HTMLElement | null, dir: 1 | -1): boolean {
  const items = getFocusable(container);
  if (items.length === 0) return false;
  const idx = current ? items.indexOf(current) : -1;
  if (idx === -1) {
    (dir === 1 ? items[0] : items[items.length - 1]).focus();
    return true;
  }
  const next = idx + dir;
  if (next < 0 || next >= items.length) return false;
  items[next].focus();
  return true;
}

export interface UseFormKeyboardOptions {
  containerRef: RefObject<HTMLElement>;
  /** Called when Enter is pressed on the last field (or with no next field). */
  onSubmit?: () => void;
  /** Called on Escape. Typically closes the modal. */
  onCancel?: () => void;
  /** Focus the first field (or initialFocusRef) when the form mounts. */
  autoFocus?: boolean;
  /** Prefer this element for the initial focus. */
  initialFocusRef?: RefObject<HTMLElement>;
  enabled?: boolean;
}

/**
 * Consistent keyboard behaviour for forms and modals:
 *   - Enter       → next field; on the last field → submit
 *   - Shift+Enter → previous field
 *   - Escape      → cancel/close
 *   - Tab / Shift+Tab are trapped inside the container
 *   - numeric inputs select-all when focused
 *   - the first field is focused on open
 *
 * Returned `onKeyDown` must be spread onto the container element. It runs in
 * the React bubble phase, so a field's own onKeyDown still gets first refusal.
 */
export function useFormKeyboard({
  containerRef,
  onSubmit,
  onCancel,
  autoFocus = true,
  initialFocusRef,
  enabled = true,
}: UseFormKeyboardOptions): { onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void } {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    let clearFocusTimer: () => void = () => undefined;
    if (autoFocus) {
      // Prefer the first real form control so the header's close button does
      // not steal focus from the form.
      const preferred = container.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      const target = initialFocusRef?.current ?? preferred ?? getFocusable(container)[0] ?? null;
      // Defer one tick so any children that mount alongside are in the DOM.
      const t = window.setTimeout(() => target?.focus(), 0);
      clearFocusTimer = () => window.clearTimeout(t);
    }

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.tagName !== 'INPUT') return;
      const input = el as HTMLInputElement;
      const wantsSelect =
        input.type === 'number' ||
        input.inputMode === 'decimal' ||
        input.dataset.select === 'true';
      if (wantsSelect) {
        try {
          input.select();
        } catch {
          /* some input types cannot select */
        }
      }
    };

    container.addEventListener('focusin', onFocusIn);
    return () => {
      clearFocusTimer();
      container.removeEventListener('focusin', onFocusIn);
    };
  }, [enabled, autoFocus, containerRef, initialFocusRef]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    // A field that already handled the key (staged search, qty box, line-item
    // cell) wins — never steal its Enter/Escape.
    if (e.defaultPrevented) return;
    const container = containerRef.current;
    if (!container) return;
    const target = e.target as HTMLElement | null;
    const key = e.key;

    if (key === 'Escape') {
      if (onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      return;
    }

    if (key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(container, target, e.shiftKey ? -1 : 1);
      return;
    }

    if (key === 'Enter') {
      // Textareas keep their newlines; buttons keep their activation.
      if (isTextArea(target) && !e.shiftKey) return;
      if (isButton(target)) return;
      const el = target as HTMLInputElement | null;
      // Checkboxes / radios toggle with Space; Enter should move on.
      if (el && el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        // Let the control receive the event; Space already toggles it.
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        moveFocus(container, target, -1);
        return;
      }
      const moved = moveFocus(container, target, 1);
      if (!moved) onSubmit?.();
    }
  };

  return { onKeyDown };
}
