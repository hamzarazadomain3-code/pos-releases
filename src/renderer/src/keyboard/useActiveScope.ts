import { useEffect, useReducer } from 'react';
import { keyboardScopes, type RegisteredScope } from './scopeRegistry';

/**
 * Subscribe to the scope registry and return the scope that currently owns the
 * keyboard. Used by the F1 help overlay so it lists only the keys that are
 * valid right now.
 */
export function useActiveScope(): RegisteredScope | null {
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => keyboardScopes.subscribe(() => force()), []);

  return keyboardScopes.active();
}

/** Re-render when any scope registers/unregisters. */
export function useScopeRevision(): number {
  const [revision, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => keyboardScopes.subscribe(() => force()), []);

  return revision;
}
