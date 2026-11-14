import type { UserRole } from './types';

/**
 * THE role hierarchy — one place, shared by the main process guard and the
 * renderer.
 *
 * Before this module the rank map existed TWICE: `RANK` in
 * `src/main/services/auth.ts` (the security guard behind every owner-gated IPC
 * handler) and `ROLE_RANK` in `src/renderer/src/App.tsx` (which only decided
 * which menu links to hide). Two copies of a security rule is one copy too
 * many, so both now read the map from here.
 */
export const ROLE_RANK: Record<UserRole, number> = { cashier: 1, manager: 2, owner: 3 };

/**
 * Does `role` reach at least `required`?
 *
 * An unknown role (a role a future build adds but this build does not know)
 * ranks 0 — it opens NOTHING. That is the safe direction: a role this build
 * cannot rank must not inherit owner rights.
 */
export function roleAtLeast(role: string | null | undefined, required: UserRole): boolean {
  const rank = ROLE_RANK[role as UserRole];
  if (!rank) return false;
  return rank >= ROLE_RANK[required];
}

/** The role names this build knows, weakest first. */
export const KNOWN_ROLES: UserRole[] = ['cashier', 'manager', 'owner'];
