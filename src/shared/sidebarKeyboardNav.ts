/**
 * The sidebar's keyboard navigation — the pure rules.
 *
 * The menu is a tree (groups of items). When the keyboard focus moves through
 * it, two things must hold:
 *   - a collapsed group's items are skipped (they are not on the screen);
 *   - the focus wraps around at both ends, so the owner never gets stuck.
 *
 * Both rules live here, so they can be tested without a browser.
 */
import type { SidebarGroup, SidebarItem } from './sidebarMenu';

/** The items of a group that is open, in order. */
export function groupItems(group: SidebarGroup | null | undefined): SidebarItem[] {
  return group?.items ?? [];
}

/**
 * The flat list of items the keyboard can reach.
 *
 * A group that is collapsed contributes nothing — its items are off the
 * screen, so they must not be focusable.
 */
export function flatNavItems(
  groups: SidebarGroup[] | null | undefined,
  isExpanded: (groupId: string) => boolean = () => true
): SidebarItem[] {
  const out: SidebarItem[] = [];
  for (const group of groups ?? []) {
    if (!isExpanded(group.id)) continue;
    for (const item of group.items ?? []) out.push(item);
  }
  return out;
}

/** The index of the page that is open, or -1 when it is not in the menu. */
export function navIndexFor(items: SidebarItem[] | null | undefined, page: string | null | undefined): number {
  if (!items || !page) return -1;
  return items.findIndex((i) => i.route === page);
}

/** Clamp an index into the valid range — used when restoring a saved focus. */
export function clampNavIndex(index: number, n: number): number {
  if (!Number.isFinite(index) || n <= 0) return 0;
  if (index < 0) return 0;
  if (index >= n) return n - 1;
  return Math.floor(index);
}

/**
 * Move the focus one step.
 *
 * Wraps around at both ends, so pressing ArrowDown on the last item lands on
 * the first, and ArrowUp on the first lands on the last.
 */
export function moveNavIndex(current: number, n: number, direction: 1 | -1 = 1): number {
  if (n <= 0) return -1;
  const safe = clampNavIndex(current, n);
  return (((safe + direction) % n) + n) % n;
}

/** The label a shortcut hint shows — null when there is no shortcut. */
export function shortcutHintLabel(combo: string | null | undefined): string | null {
  const s = String(combo ?? '').trim();
  return s ? s : null;
}

/** Whether a page is the one currently open. */
export function isCurrentNav(item: SidebarItem | null | undefined, page: string | null | undefined): boolean {
  return !!item && item.route === page;
}

/** The aria-current value for a nav item. */
export function navAriaCurrent(item: SidebarItem | null | undefined, page: string | null | undefined): 'page' | undefined {
  return isCurrentNav(item, page) ? 'page' : undefined;
}

/** The number of items the keyboard can reach. */
export function navCount(items: SidebarItem[] | null | undefined): number {
  return items?.length ?? 0;
}

/**
 * The Ctrl+K palette filter — the pure rule.
 *
 * Matches the query against the page label and the page key, case-insensitive.
 * An empty query returns every page unchanged (so the palette shows everything
 * on open).
 */
export function filterPalettePages<T extends { key: string; label: string }>(
  pages: T[] | null | undefined,
  query: string | null | undefined
): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return (pages ?? []).slice();
  return (pages ?? []).filter(
    (p) => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
  );
}
