import { normalizeStoredKey } from '../utils/shortcutKeys';

/**
 * A keyboard "scope" is a region of the UI that owns some key handling —
 * usually a page, or a modal sitting on top of it. The registry keeps a stack
 * of live scopes so the global shortcut layer can route an event to the one
 * that is actually on top, and so the F1 help overlay can show only the keys
 * that are valid right now.
 *
 * Scopes are registered through `useKeyboardScope()`; nothing else should touch
 * this module directly.
 */

export type ScopeKind = 'page' | 'modal';

/** One entry shown in the F1 "Keyboard shortcuts" overlay. */
export interface ScopeShortcut {
  /** Admin shortcut action id (resolved against the live shortcut map). */
  action?: string;
  /** Fallback / literal combo to display when there is no action id. */
  keys?: string;
  /** Human description, e.g. "Save expense". */
  label: string;
}

export interface RegisteredScope {
  id: number;
  kind: ScopeKind;
  /** Normalised combos this scope handles directly (not admin actions). */
  keys: Set<string>;
  /** Admin action id -> handler (Ctrl+S = "save", etc.). */
  actions: Record<string, (e: KeyboardEvent) => void>;
  /** Escape handler for the scope (page-level cancel, modal close). */
  onEscape?: () => void;
  /** Entries for the F1 overlay. */
  shortcuts: ScopeShortcut[];
  /** Optional label shown in help, e.g. "Purchases". */
  label?: string;
}

export type ScopeInput = Omit<RegisteredScope, 'id'>;

class ScopeRegistry {
  private scopes = new Map<number, RegisteredScope>();
  private seq = 0;
  private listeners = new Set<() => void>();

  register(scope: ScopeInput): number {
    const id = ++this.seq;
    // The caller may pass an object with getters (see useKeyboardScope), so we
    // store the reference as-is and only stamp an id on it.
    (scope as RegisteredScope).id = id;
    this.scopes.set(id, scope as RegisteredScope);
    this.notify();
    return id;
  }

  unregister(id: number): void {
    if (this.scopes.delete(id)) this.notify();
  }

  /**
   * The scope that currently owns the keyboard: the most recently registered
   * modal if any is open, otherwise the most recently registered page.
   */
  active(): RegisteredScope | null {
    let modal: RegisteredScope | null = null;
    for (const s of this.scopes.values()) {
      if (s.kind === 'modal') modal = s;
    }
    if (modal) return modal;
    let page: RegisteredScope | null = null;
    for (const s of this.scopes.values()) page = s;
    return page;
  }

  hasModal(): boolean {
    for (const s of this.scopes.values()) if (s.kind === 'modal') return true;
    return false;
  }

  activeShortcuts(): ScopeShortcut[] {
    return this.active()?.shortcuts ?? [];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const keyboardScopes = new ScopeRegistry();

/** Normalise a comma/array of combos into a Set of canonical combos. */
export function toComboSet(keys: string[]): Set<string> {
  return new Set(keys.map((k) => normalizeStoredKey(k)));
}
