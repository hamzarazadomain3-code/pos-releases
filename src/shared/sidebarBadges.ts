/**
 * The sidebar badges — the small numbers next to a page in the menu.
 *
 * The rules live here (pure), the numbers come from the main process:
 *   - a badge only shows for a role that may open the page it belongs to
 *     (the minimum role is read from the ONE menu definition, so the badge and
 *     the menu can never disagree);
 *   - a count is always a whole number, never NaN and never negative;
 *   - a count over 99 shows "99+";
 *   - a badge with nothing to say is simply not there (no "0" on the screen).
 */

import type { SidebarBadgeId } from './sidebarMenu';
import { SIDEBAR_ITEMS } from './sidebarMenu';
import { roleAtLeast } from './roles';
import type { UserRole } from './types';

/** A count over this shows "99+". */
export const BADGE_CAP = 99;

/** The badges are refreshed at most once a minute. */
export const BADGE_REFRESH_MS = 60_000;

/** A number badge or a plain dot. */
export type SidebarBadgeKind = 'count' | 'dot';

export interface SidebarBadge {
  id: SidebarBadgeId;
  kind: SidebarBadgeKind;
  /** The number behind the badge (1 for a dot, 0 when there is nothing). */
  count: number;
  /** What the badge shows: "7" or "99+" (empty for a dot). */
  display: string;
}

/** What the main process collects; the role rules are applied here. */
export interface SidebarBadgeInput {
  id: SidebarBadgeId;
  kind: SidebarBadgeKind;
  /** The count — for a dot, 1 means "on" and 0 means "nothing to say". */
  count?: number;
}

/**
 * A safe count.
 *
 * NaN, undefined, a string that is not a number and a negative number all
 * become 0 — a badge must never show "NaN".
 */
export function badgeCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** What the badge shows: "7", or "99+" once the count passes the cap. */
export function badgeDisplay(raw: unknown): string {
  const n = badgeCount(raw);
  return n > BADGE_CAP ? `${BADGE_CAP}+` : String(n);
}

/**
 * The minimum role for a badge — read from the ONE menu definition.
 *
 * The badge hangs on a menu item, so it follows that item's rule. A badge
 * whose item is gone falls back to the strictest role (owner).
 */
export function badgeMinRole(id: SidebarBadgeId): UserRole {
  const item = SIDEBAR_ITEMS.find((i) => i.badgeId === id);
  return item?.minRole ?? 'owner';
}

/**
 * The badges a role may see.
 *
 * A count of zero (or a dot that is off) means "nothing to say", so the badge
 * is left out entirely.
 */
export function buildBadges(
  role: string | null | undefined,
  inputs: SidebarBadgeInput[] | null | undefined
): SidebarBadge[] {
  const out: SidebarBadge[] = [];
  for (const input of inputs ?? []) {
    if (!input || !input.id) continue;
    if (!roleAtLeast(role, badgeMinRole(input.id))) continue;
    const count = badgeCount(input.count);
    if (count <= 0) continue;
    out.push({
      id: input.id,
      kind: input.kind,
      count,
      display: input.kind === 'dot' ? '' : badgeDisplay(count),
    });
  }
  return out;
}

/** The badge of one id, or undefined. */
export function badgeFor(
  badges: SidebarBadge[] | null | undefined,
  id: SidebarBadgeId
): SidebarBadge | undefined {
  return (badges ?? []).find((b) => b.id === id);
}
