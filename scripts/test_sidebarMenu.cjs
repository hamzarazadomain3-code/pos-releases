/**
 * Item 1 — the single sidebar menu definition.
 *
 * Imports the REAL compiled code (dist/shared/sidebarMenu.js) and checks:
 *   - every role gets exactly the expected items (owner / manager / cashier /
 *     an unknown role)
 *   - no duplicate routes, no duplicate ids
 *   - every route in the NavPage union is either in the menu or listed in
 *     ROUTES_NOT_IN_SIDEBAR
 *   - the feature-gated items (Transfers, Branches) disappear without
 *     multi_branch and reappear with it
 *   - the group order is the agreed one
 *   - a group with no visible item is hidden
 *   - the permission map can only NARROW, never widen
 */
const {
  SIDEBAR_GROUPS,
  SIDEBAR_ITEMS,
  ROUTES_NOT_IN_SIDEBAR,
  buildSidebar,
  sidebarRoutes,
  mobilePinnedFor,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarMenu.js');
const { roleAtLeast } = require('E:/antigravty/billing softwere/pos-app/dist/shared/roles.js');

/** Every route the NavPage type declares (src/shared/types.ts:135). */
const ALL_ROUTES = [
  'dashboard', 'billing', 'inventory', 'audits', 'promotions', 'purchases', 'udhaar',
  'returns', 'shifts', 'reports', 'settings', 'users', 'barcode', 'admin', 'quotations',
  'invoiceAdmin', 'branches', 'quickSale', 'transfers', 'expenses', 'commissions',
  'customReports', 'fifoStock', 'labelStudio',
];

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function routesOf(groups) {
  return groups.flatMap((g) => g.items.map((i) => i.route));
}

console.log('=== test_sidebarMenu (item 1) ===');

// ── The shape of the definition ────────────────────────────────────────────
section('The menu definition');

check('there are five groups', SIDEBAR_GROUPS.length === 5, SIDEBAR_GROUPS.map((g) => g.id).join(', '));
check(
  'the group order is Daily work, Stock, Sales and marketing, Money and reports, Setup',
  SIDEBAR_GROUPS.map((g) => g.id).join(',') === 'daily,stock,sales,money,setup'
);
check('only Setup is separated', SIDEBAR_GROUPS.filter((g) => g.separated).length === 1 && SIDEBAR_GROUPS[4].separated === true);
check('every item has an id, route, i18n key and icon', SIDEBAR_ITEMS.every((i) => i.id && i.route && i.i18nKey && i.iconId));
check('every item has a minimum role', SIDEBAR_ITEMS.every((i) => !!i.minRole));

// ── No duplicates ─────────────────────────────────────────────────────────
section('No duplicates');
const ids = SIDEBAR_ITEMS.map((i) => i.id);
const routes = SIDEBAR_ITEMS.map((i) => i.route);
check('no duplicate item ids', new Set(ids).size === ids.length, `${ids.length} items`);
check('no duplicate routes', new Set(routes).size === routes.length, `${routes.length} routes`);

// ── Route coverage ─────────────────────────────────────────────────────────
section('Route coverage');
const inMenu = new Set(routes);
const notInMenu = ALL_ROUTES.filter((r) => !inMenu.has(r));
check(
  'every route is either in the menu or explicitly listed as not in the sidebar',
  notInMenu.every((r) => ROUTES_NOT_IN_SIDEBAR.includes(r)),
  `not in menu: ${notInMenu.join(', ')}`
);
check('the not-in-sidebar list holds only barcode', ROUTES_NOT_IN_SIDEBAR.join(',') === 'barcode');
check('the menu holds every route except the listed ones', notInMenu.length === ROUTES_NOT_IN_SIDEBAR.length, `${notInMenu.length} missing`);

// ── Per-role expectations ──────────────────────────────────────────────────
section('Each role gets exactly the expected items');

const DAILY = ['billing', 'quickSale', 'returns', 'udhaar', 'shifts'];
const STOCK = ['inventory', 'purchases', 'transfers', 'audits', 'fifoStock', 'labelStudio', 'branches'];
const SALES = ['quotations', 'promotions', 'commissions'];
const MONEY = ['dashboard', 'reports', 'customReports', 'expenses'];
const SETUP = ['invoiceAdmin', 'settings', 'users', 'admin'];

const CASHIER = ['billing', 'quickSale'];
// The expected lists follow the GROUP order (the order the buttons render).
const MANAGER = [
  // Daily work
  'billing', 'quickSale', 'returns', 'udhaar', 'shifts',
  // Stock
  'inventory', 'purchases', 'transfers', 'audits', 'fifoStock', 'labelStudio',
  // Sales and marketing
  'quotations', 'promotions', 'commissions',
  // Money and reports
  'dashboard', 'reports', 'customReports', 'expenses',
  // Setup
  'invoiceAdmin',
];
const OWNER = [
  'billing', 'quickSale', 'returns', 'udhaar', 'shifts',
  'inventory', 'purchases', 'transfers', 'audits', 'fifoStock', 'labelStudio', 'branches',
  'quotations', 'promotions', 'commissions',
  'dashboard', 'reports', 'customReports', 'expenses',
  'invoiceAdmin', 'settings', 'users', 'admin',
];

const ownerGroups = buildSidebar({ role: 'owner', features: { multi_branch: true } });
const managerGroups = buildSidebar({ role: 'manager', features: { multi_branch: true } });
const cashierGroups = buildSidebar({ role: 'cashier', features: { multi_branch: true } });

check(
  'the owner sees every item',
  routesOf(ownerGroups).join(',') === OWNER.join(','),
  `${routesOf(ownerGroups).length} items`
);
check(
  'the manager sees the four content groups plus Invoice Designer',
  routesOf(managerGroups).join(',') === MANAGER.join(','),
  `${routesOf(managerGroups).length} items`
);
check(
  'the cashier sees only the two Daily work items it may open',
  routesOf(cashierGroups).join(',') === CASHIER.join(','),
  routesOf(cashierGroups).join(',')
);
check('the cashier sees no group with an empty heading', cashierGroups.length === 1, cashierGroups.map((g) => g.id).join(','));

// The group membership must be right, not just the route list.
section('Group membership');
const groupOf = (groups, route) => groups.find((g) => g.items.some((i) => i.route === route))?.id;
check('Billing is in Daily work', groupOf(ownerGroups, 'billing') === 'daily');
check('Transfers is in Stock', groupOf(ownerGroups, 'transfers') === 'stock');
check('Branches is in Stock', groupOf(ownerGroups, 'branches') === 'stock');
check('Quotations is in Sales and marketing', groupOf(ownerGroups, 'quotations') === 'sales');
check('Dashboard is in Money and reports', groupOf(ownerGroups, 'dashboard') === 'money');
check('Settings is in Setup', groupOf(ownerGroups, 'settings') === 'setup');
check('Invoice Designer is in Setup', groupOf(ownerGroups, 'invoiceAdmin') === 'setup');
check(
  'the group order in the built menu is daily, stock, sales, money, setup',
  ownerGroups.map((g) => g.id).join(',') === 'daily,stock,sales,money,setup'
);

// ── Feature gating ─────────────────────────────────────────────────────────
section('Feature-gated items');
const noMulti = buildSidebar({ role: 'owner' });
const withMulti = buildSidebar({ role: 'owner', features: { multi_branch: true } });
check('without multi_branch, Transfers is gone', !routesOf(noMulti).includes('transfers'));
check('without multi_branch, Branches is gone', !routesOf(noMulti).includes('branches'));
check('with multi_branch, Transfers is back', routesOf(withMulti).includes('transfers'));
check('with multi_branch, Branches is back', routesOf(withMulti).includes('branches'));
check(
  'an unknown feature toggle does not open the item',
  !routesOf(buildSidebar({ role: 'owner', features: { multi_branch: false } })).includes('branches')
);

// ── The permission map narrows only ─────────────────────────────────────────
section('The permission map narrows only');
const narrowed = buildSidebar({ role: 'owner', permissions: { settings: false }, features: { multi_branch: true } });
check('permissions can hide an item', !routesOf(narrowed).includes('settings'));
check('permissions do not hide anything else', routesOf(narrowed).length === OWNER.length - 1);
const widened = buildSidebar({ role: 'cashier', permissions: { settings: true }, features: { multi_branch: true } });
check('permissions cannot widen the role rule', !routesOf(widened).includes('settings'));
check('a cashier still sees only its two items', routesOf(widened).join(',') === CASHIER.join(','));

// ── Unknown roles ──────────────────────────────────────────────────────────
section('Unknown roles');
check('an unknown role sees nothing', routesOf(buildSidebar({ role: 'inventory_manager' })).length === 0);
check('a missing role sees nothing', routesOf(buildSidebar({ role: null })).length === 0);
check('roleAtLeast rejects an unknown role', roleAtLeast('inventory_manager', 'cashier') === false);
check('roleAtLeast accepts owner over cashier', roleAtLeast('owner', 'cashier') === true);
check('roleAtLeast rejects cashier over owner', roleAtLeast('cashier', 'owner') === false);

// ── The phone bottom bar (item 10b data) ───────────────────────────────────
section('The phone bottom bar picks from the same menu');
const cashierBar = mobilePinnedFor('cashier', cashierGroups);
const managerBar = mobilePinnedFor('manager', managerGroups);
check('the manager bar has exactly four items', managerBar.length === 4, managerBar.map((i) => i.route).join(', '));
check('the manager bar is Billing, Inventory, Dashboard, Reports', managerBar.map((i) => i.route).join(',') === 'billing,inventory,dashboard,reports');
check('the manager bar has no duplicates', new Set(managerBar.map((i) => i.route)).size === 4);

// The brief asks for a cashier bar of Billing, Quick Sale, Udhaar, Returns.
// Udhaar and Returns are manager-only in the menu today (Item 2 forbids
// widening that), so the bar can only carry what the cashier may OPEN.
// The PINNED DATA still carries the brief's four, so the bar fills up by
// itself the moment the owner widens the rule.
const pinnedForCashier = SIDEBAR_ITEMS
  .filter((i) => typeof i.mobilePinned?.cashier === 'number')
  .map((i) => i.route)
  .sort();
check(
  'the pinned data records the brief\'s cashier bar: Billing, Quick Sale, Udhaar, Returns',
  pinnedForCashier.join(',') === 'billing,quickSale,returns,udhaar',
  pinnedForCashier.join(', ')
);
check(
  'the cashier bar only carries what the cashier may open',
  cashierBar.map((i) => i.route).join(',') === 'billing,quickSale',
  cashierBar.map((i) => i.route).join(', ')
);
check('the cashier bar never repeats an item', new Set(cashierBar.map((i) => i.route)).size === cashierBar.length);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
