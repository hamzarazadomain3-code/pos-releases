import type { NavPage, UserRole } from './types';
import { roleAtLeast } from './roles';

/**
 * THE sidebar menu — one definition, every layout.
 *
 * The desktop sidebar, the tablet rail, the phone drawer, the phone bottom bar
 * and the Ctrl+K page search are all fed from `buildSidebar()`. There is no
 * second list of pages anywhere in the app.
 *
 * Each item carries:
 *   id              stable id (never reused, never renamed)
 *   route           the NavPage it opens
 *   i18nKey         the label key (navigation.* for items, sidebarGroups.* for groups)
 *   iconId          the id of the icon in the ONE icon set
 *   minRole         the minimum role — the SAME rule the main process guard uses
 *   shortcutAction  the shortcut-registry action whose combo is shown as a hint
 *   badgeId         the live-count badge this item can carry
 *   mobilePinned    the phone bottom-bar slot(s) this item takes for a role
 *   feature         the feature toggle that must be ON for the item to exist
 */

export type SidebarGroupId = 'daily' | 'stock' | 'sales' | 'money' | 'setup';

export type SidebarBadgeId = 'inventory' | 'shifts' | 'udhaar' | 'audits' | 'promotions';

export interface SidebarItem {
  id: string;
  route: NavPage;
  i18nKey: string;
  iconId: string;
  minRole: UserRole;
  shortcutAction?: string;
  badgeId?: SidebarBadgeId;
  /** The phone bottom-bar slot for each role. The slot is 1..4. */
  mobilePinned?: Partial<Record<UserRole, number>>;
  /** The feature toggle that must be enabled for this item to exist. */
  feature?: string;
}

export interface SidebarGroup {
  id: SidebarGroupId;
  i18nKey: string;
  /** Setup sits at the bottom, separated by a divider. */
  separated?: boolean;
  items: SidebarItem[];
}

/**
 * The menu, in the order the groups render.
 *
 * Group order: Daily work, Stock, Sales and marketing, Money and reports, Setup.
 */
export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    id: 'daily',
    i18nKey: 'sidebarGroups.daily',
    items: [
      { id: 'billing', route: 'billing', i18nKey: 'navigation.billing', iconId: 'billing', minRole: 'cashier', shortcutAction: 'billing_search', mobilePinned: { cashier: 1, manager: 1, owner: 1 } },
      { id: 'quickSale', route: 'quickSale', i18nKey: 'navigation.quickSale', iconId: 'quickSale', minRole: 'cashier', mobilePinned: { cashier: 2 } },
      { id: 'returns', route: 'returns', i18nKey: 'navigation.returns', iconId: 'returns', minRole: 'manager', shortcutAction: 'new_return', mobilePinned: { cashier: 4 } },
      { id: 'udhaar', route: 'udhaar', i18nKey: 'navigation.udhaar', iconId: 'udhaar', minRole: 'manager', shortcutAction: 'new_customer', badgeId: 'udhaar', mobilePinned: { cashier: 3 } },
      { id: 'shifts', route: 'shifts', i18nKey: 'navigation.shifts', iconId: 'shifts', minRole: 'manager', shortcutAction: 'open_shift', badgeId: 'shifts' },
    ],
  },
  {
    id: 'stock',
    i18nKey: 'sidebarGroups.stock',
    items: [
      { id: 'inventory', route: 'inventory', i18nKey: 'navigation.inventory', iconId: 'inventory', minRole: 'manager', shortcutAction: 'new_product', badgeId: 'inventory', mobilePinned: { manager: 2, owner: 2 } },
      { id: 'purchases', route: 'purchases', i18nKey: 'navigation.purchases', iconId: 'purchases', minRole: 'manager' },
      { id: 'transfers', route: 'transfers', i18nKey: 'navigation.transfers', iconId: 'transfers', minRole: 'manager', feature: 'multi_branch' },
      { id: 'audits', route: 'audits', i18nKey: 'navigation.audits', iconId: 'audits', minRole: 'manager', badgeId: 'audits' },
      { id: 'fifoStock', route: 'fifoStock', i18nKey: 'navigation.fifoStock', iconId: 'fifoStock', minRole: 'manager' },
      { id: 'labelStudio', route: 'labelStudio', i18nKey: 'navigation.labelStudio', iconId: 'labelStudio', minRole: 'manager' },
      { id: 'branches', route: 'branches', i18nKey: 'navigation.branches', iconId: 'branches', minRole: 'owner', feature: 'multi_branch' },
    ],
  },
  {
    id: 'sales',
    i18nKey: 'sidebarGroups.sales',
    items: [
      { id: 'quotations', route: 'quotations', i18nKey: 'navigation.quotations', iconId: 'quotations', minRole: 'manager' },
      { id: 'promotions', route: 'promotions', i18nKey: 'navigation.promotions', iconId: 'promotions', minRole: 'manager', badgeId: 'promotions' },
      { id: 'commissions', route: 'commissions', i18nKey: 'navigation.commissions', iconId: 'commissions', minRole: 'manager' },
    ],
  },
  {
    id: 'money',
    i18nKey: 'sidebarGroups.money',
    items: [
      { id: 'dashboard', route: 'dashboard', i18nKey: 'navigation.dashboard', iconId: 'dashboard', minRole: 'manager', mobilePinned: { manager: 3, owner: 3 } },
      { id: 'reports', route: 'reports', i18nKey: 'navigation.reports', iconId: 'reports', minRole: 'manager', shortcutAction: 'reports', mobilePinned: { manager: 4, owner: 4 } },
      { id: 'customReports', route: 'customReports', i18nKey: 'navigation.customReports', iconId: 'customReports', minRole: 'manager' },
      { id: 'expenses', route: 'expenses', i18nKey: 'navigation.expenses', iconId: 'expenses', minRole: 'manager' },
    ],
  },
  {
    id: 'setup',
    i18nKey: 'sidebarGroups.setup',
    separated: true,
    items: [
      { id: 'invoiceAdmin', route: 'invoiceAdmin', i18nKey: 'navigation.invoiceAdmin', iconId: 'invoiceAdmin', minRole: 'manager' },
      { id: 'settings', route: 'settings', i18nKey: 'navigation.settings', iconId: 'settings', minRole: 'owner', shortcutAction: 'settings' },
      { id: 'users', route: 'users', i18nKey: 'navigation.users', iconId: 'users', minRole: 'owner' },
      { id: 'admin', route: 'admin', i18nKey: 'navigation.admin', iconId: 'admin', minRole: 'owner', shortcutAction: 'admin_panel' },
    ],
  },
];

/** Every item, flattened. */
export const SIDEBAR_ITEMS: SidebarItem[] = SIDEBAR_GROUPS.flatMap((g) => g.items);

/**
 * Routes that exist in `NavPage` but are deliberately NOT in the sidebar.
 *
 * `barcode` is the former Barcode Labels page; it now lives inside Label
 * Studio as its "Quick" mode, so the route stays in the type for the deep link
 * but there is no sidebar button for it.
 */
export const ROUTES_NOT_IN_SIDEBAR: NavPage[] = ['barcode'];

export interface SidebarBuildInput {
  /** The signed-in user's role. An unknown role sees nothing. */
  role: string | null | undefined;
  /**
   * Optional per-route narrowing. `permissions[route] === false` HIDES the
   * item; anything else leaves it to the role rule. It can only narrow, never
   * widen — widening would be a second permission model, which this app must
   * not have.
   */
  permissions?: Record<string, boolean>;
  /** Feature toggles, e.g. `{ multi_branch: true }`. */
  features?: Record<string, boolean>;
  /** The UI language, carried through for the search and the labels. */
  language?: 'en' | 'ur';
  /** The resolved label per route for `language` (the renderer passes i18n's). */
  labels?: Record<string, string>;
}

export interface SidebarItemView extends SidebarItem {
  /** The label to render. Falls back to the i18n key when no label was given. */
  label: string;
}

export interface SidebarGroupView {
  id: SidebarGroupId;
  i18nKey: string;
  label: string;
  separated: boolean;
  items: SidebarItemView[];
}

/**
 * The visible menu for a role.
 *
 * A group with no visible item disappears entirely (an empty "Stock" heading
 * for a cashier is noise).
 */
export function buildSidebar(input: SidebarBuildInput): SidebarGroupView[] {
  const { role, permissions, features, language, labels } = input;
  const groups: SidebarGroupView[] = [];

  for (const group of SIDEBAR_GROUPS) {
    const items: SidebarItemView[] = [];
    for (const item of group.items) {
      if (!roleAtLeast(role, item.minRole)) continue;
      if (item.feature && !(features && features[item.feature] === true)) continue;
      if (permissions && permissions[item.route] === false) continue;
      items.push({ ...item, label: labels?.[item.route] ?? item.i18nKey });
    }
    if (items.length === 0) continue;
    groups.push({
      id: group.id,
      i18nKey: group.i18nKey,
      label: labels?.[group.i18nKey] ?? group.i18nKey,
      separated: group.separated === true,
      items,
    });
  }
  return groups;
}

/** Every route the menu can open, flattened and de-duplicated. */
export function sidebarRoutes(): NavPage[] {
  return SIDEBAR_ITEMS.map((i) => i.route);
}

/**
 * THE route guard — the single answer to "may this role open this page?".
 *
 * The menu HIDES a link; this REFUSES the page. They read the same rules
 * (the same `minRole`, the same feature toggle, the same narrowing map), so a
 * route that is hidden from the menu is also refused here. There is no second
 * permission model and no way for the two to drift apart.
 *
 * A route that is not in the menu at all (`ROUTES_NOT_IN_SIDEBAR`) is not
 * openable through the navigation.
 */
export function canOpenRoute(
  role: string | null | undefined,
  route: string,
  features?: Record<string, boolean>,
  permissions?: Record<string, boolean>,
): boolean {
  const item = sidebarItemFor(route);
  if (!item) return false;
  if (!roleAtLeast(role, item.minRole)) return false;
  if (item.feature && !(features && features[item.feature] === true)) return false;
  if (permissions && permissions[route] === false) return false;
  return true;
}

/** The item for a route, or undefined. */
export function sidebarItemFor(route: string): SidebarItem | undefined {
  return SIDEBAR_ITEMS.find((i) => i.route === route);
}

/**
 * The page a role lands on after logging in, when no Setting overrides it.
 *
 * A cashier bills, so Billing. An owner or a manager starts the day on the
 * Dashboard. The shop can override this with the "Page to open after login"
 * setting.
 */
export const ROLE_LANDING: Record<UserRole, NavPage> = {
  cashier: 'billing',
  manager: 'dashboard',
  owner: 'dashboard',
};

/** The setting key (the `settings` table) and its accepted values. */
export const PAGE_AFTER_LOGIN_KEY = 'page_after_login';
export type PageAfterLogin = 'auto' | 'billing' | 'dashboard' | 'last';

export interface LandingDecision {
  /** The page to open, or null when the role may open nothing at all. */
  page: NavPage | null;
  /** Where the decision came from — useful for the settings hint text. */
  source: 'setting' | 'role' | 'last';
}

/**
 * Which page opens after login.
 *
 * The Setting wins when it names a page the role may open; otherwise the role
 * rule applies; a role that may open nothing lands on nothing.
 */
export function landingPageFor(params: {
  role: string | null | undefined;
  /** The raw setting value. Anything unknown means "follow the role". */
  setting?: string | null;
  /** The page the user was last on — for the "Last page" choice. */
  lastPage?: string | null;
  /** The routes this role may open. */
  allowedRoutes?: string[];
}): LandingDecision {
  const { role, setting, lastPage } = params;
  const allowed = params.allowedRoutes ?? [];
  const canOpen = (r: string) => allowed.includes(r);

  const raw = String(setting ?? '').trim().toLowerCase();
  const mode: PageAfterLogin =
    raw === 'billing' || raw === 'dashboard' || raw === 'last' ? (raw as PageAfterLogin) : 'auto';

  if (mode === 'last' && lastPage && canOpen(lastPage)) {
    return { page: lastPage as NavPage, source: 'last' };
  }
  if (mode === 'billing' && canOpen('billing')) {
    return { page: 'billing', source: 'setting' };
  }
  if (mode === 'dashboard' && canOpen('dashboard')) {
    return { page: 'dashboard', source: 'setting' };
  }

  // The role rule.
  const rolePage = ROLE_LANDING[role as UserRole] ?? 'billing';
  if (canOpen(rolePage)) {
    return { page: rolePage, source: 'role' };
  }
  // A role that may not open its own landing page opens the first page it may.
  const first = (allowed[0] ?? null) as NavPage | null;
  return { page: first, source: 'role' };
}

/**
 * The phone bottom bar for a role: the pinned items, in slot order.
 *
 * The slots come from `mobilePinned` in the menu above — there is no second
 * hard-coded list of "important pages".
 */
export function mobilePinnedFor(role: string | null | undefined, groups: SidebarGroupView[]): SidebarItemView[] {
  const pinned: Array<{ slot: number; item: SidebarItemView }> = [];
  for (const group of groups) {
    for (const item of group.items) {
      const slot = item.mobilePinned?.[role as UserRole];
      if (typeof slot === 'number' && slot > 0) pinned.push({ slot, item });
    }
  }
  pinned.sort((a, b) => a.slot - b.slot);
  return pinned.map((p) => p.item);
}

// ── Collapsible groups ─────────────────────────────────────────────────────

/** groupId -> expanded? A missing entry means "expanded". */
export type GroupState = Record<string, boolean>;

/** Every group starts expanded. */
export const DEFAULT_GROUP_STATE: GroupState = SIDEBAR_GROUPS.reduce((acc, g) => {
  acc[g.id] = true;
  return acc;
}, {} as GroupState);

/** The localStorage key prefix — the state is remembered PER USER. */
export const GROUP_STATE_KEY_PREFIX = 'pos_sidebar_groups_';

export function groupStateKey(userId: string | number | null | undefined): string {
  return `${GROUP_STATE_KEY_PREFIX}${userId ?? 'anon'}`;
}

/**
 * Read a stored group state.
 *
 * A corrupt value (not JSON, not an object, a non-boolean entry) is IGNORED:
 * the group falls back to the default instead of the app breaking. An entry
 * for a group that no longer exists is dropped.
 */
export function parseGroupState(raw: string | null | undefined): GroupState {
  const out: GroupState = { ...DEFAULT_GROUP_STATE };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out; // corrupt JSON -> the defaults
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  const known = new Set<string>(SIDEBAR_GROUPS.map((g) => g.id));
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!known.has(key)) continue; // a group that no longer exists
    if (typeof value === 'boolean') out[key] = value;
    // anything else is ignored -> the default stands
  }
  return out;
}

/** Flip one group. */
export function toggleGroup(state: GroupState, groupId: string): GroupState {
  const current = state[groupId] !== false; // missing = expanded
  return { ...state, [groupId]: !current };
}

/** The group a route belongs to, or null. */
export function groupForRoute(route: string | null | undefined): SidebarGroupId | null {
  if (!route) return null;
  const group = SIDEBAR_GROUPS.find((g) => g.items.some((i) => i.route === route));
  return group ? group.id : null;
}

/**
 * Is a group expanded?
 *
 * The group holding the ACTIVE page is always expanded — a collapsed group
 * must never hide the page the user is on.
 */
export function isGroupExpanded(
  state: GroupState,
  groupId: SidebarGroupId | string,
  activeRoute?: string | null
): boolean {
  if (activeRoute && groupForRoute(activeRoute) === groupId) return true;
  return state[groupId] !== false;
}

/**
 * The reducer the sidebar uses. One pure function, so the behaviour can be
 * tested without a browser.
 */
export function groupStateReducer(
  state: GroupState,
  action: { type: 'toggle'; groupId: string } | { type: 'restore'; raw: string | null }
): GroupState {
  switch (action.type) {
    case 'toggle':
      return toggleGroup(state, action.groupId);
    case 'restore':
      return parseGroupState(action.raw);
    default:
      return state;
  }
}
