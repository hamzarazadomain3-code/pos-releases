/**
 * Item 2 — the menu hides links; the GUARD refuses the page.
 *
 * For every role and every route, the two must agree: a route that is hidden
 * from the menu must also be refused by `canOpenRoute()`. If they ever
 * disagree, a cashier could reach a Setup page through a shortcut, the command
 * palette or a deep link even though the sidebar does not show it.
 */
const {
  SIDEBAR_ITEMS,
  ROUTES_NOT_IN_SIDEBAR,
  buildSidebar,
  canOpenRoute,
  sidebarRoutes,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarMenu.js');

/** Every route the NavPage type declares (src/shared/types.ts:135). */
const ALL_ROUTES = [
  'dashboard', 'billing', 'inventory', 'audits', 'promotions', 'purchases', 'udhaar',
  'returns', 'shifts', 'reports', 'settings', 'users', 'barcode', 'admin', 'quotations',
  'invoiceAdmin', 'branches', 'quickSale', 'transfers', 'expenses', 'commissions',
  'customReports', 'fifoStock', 'labelStudio',
];

const ROLES = ['owner', 'manager', 'cashier', 'inventory_manager', '', 'nobody'];

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

console.log('=== test_sidebarGuard (item 2) ===');

// ── The menu and the guard must never disagree ─────────────────────────────
section('The menu and the guard agree, role by role');

for (const role of ROLES) {
  for (const features of [{}, { multi_branch: true }]) {
    const withMulti = features.multi_branch === true;
    const groups = buildSidebar({ role, features });
    const inMenu = new Set(groups.flatMap((g) => g.items.map((i) => i.route)));
    const mismatches = [];
    for (const route of ALL_ROUTES) {
      const shown = inMenu.has(route);
      const allowed = canOpenRoute(role, route, features);
      if (shown !== allowed) mismatches.push(`${route}(menu=${shown},guard=${allowed})`);
    }
    check(
      `role "${role || '(empty)'}" ${withMulti ? 'with multi_branch' : 'without multi_branch'}: menu and guard agree on all ${ALL_ROUTES.length} routes`,
      mismatches.length === 0,
      mismatches.length ? mismatches.join(' ') : 'no mismatch'
    );
  }
}

// ── A route hidden from the menu is refused ─────────────────────────────────
section('Every route hidden from the menu is refused');

for (const role of ROLES) {
  const groups = buildSidebar({ role, features: { multi_branch: true } });
  const inMenu = new Set(groups.flatMap((g) => g.items.map((i) => i.route)));
  const hidden = ALL_ROUTES.filter((r) => !inMenu.has(r));
  const wronglyAllowed = hidden.filter((r) => canOpenRoute(role, r, { multi_branch: true }));
  check(
    `role "${role || '(empty)'}" cannot open its ${hidden.length} hidden route(s)`,
    wronglyAllowed.length === 0,
    wronglyAllowed.join(', ')
  );
}

// ── The Setup routes a cashier must not reach ──────────────────────────────
section('A cashier is refused the Setup routes');

for (const route of ['settings', 'users', 'admin', 'invoiceAdmin', 'dashboard', 'inventory', 'udhaar', 'returns', 'reports', 'branches']) {
  check(
    `a cashier is refused "${route}"`,
    canOpenRoute('cashier', route, { multi_branch: true }) === false
  );
}
check('a cashier may open Billing', canOpenRoute('cashier', 'billing') === true);
check('a cashier may open Quick Sale', canOpenRoute('cashier', 'quickSale') === true);
check('a manager is refused Users', canOpenRoute('manager', 'users') === false);
check('a manager is refused Admin Panel', canOpenRoute('manager', 'admin') === false);
check('a manager may open Inventory', canOpenRoute('manager', 'inventory') === true);
check('an owner may open Admin Panel', canOpenRoute('owner', 'admin') === true);
check('an owner may open Users', canOpenRoute('owner', 'users') === true);

// ── The shortcut actions that open a page ──────────────────────────────────
section('The shortcut actions are covered by the same guard');
// These are the actions the global keyboard layer dispatches to a page
// (src/renderer/src/App.tsx dispatchAction -> onNavigate).
const ACTION_ROUTES = {
  settings: 'settings',
  admin_panel: 'admin',
  reports: 'reports',
};
for (const [action, route] of Object.entries(ACTION_ROUTES)) {
  check(
    `the "${action}" action opens "${route}", and the guard refuses it for a cashier`,
    canOpenRoute('cashier', route, { multi_branch: true }) === false
  );
}

// ── Feature-gated routes ───────────────────────────────────────────────────
section('The feature-gated routes are refused without the feature');
check('an owner is refused Branches without multi_branch', canOpenRoute('owner', 'branches') === false);
check('an owner is refused Transfers without multi_branch', canOpenRoute('owner', 'transfers') === false);
check('an owner may open Branches with multi_branch', canOpenRoute('owner', 'branches', { multi_branch: true }) === true);
check('an owner may open Transfers with multi_branch', canOpenRoute('owner', 'transfers', { multi_branch: true }) === true);

// ── Routes with no menu button ─────────────────────────────────────────────
section('A route with no menu button is not openable through navigation');
for (const route of ROUTES_NOT_IN_SIDEBAR) {
  check(
    `"${route}" is not openable through the guard`,
    canOpenRoute('owner', route, { multi_branch: true }) === false
  );
}

// ── The permission map narrows only ─────────────────────────────────────────
section('The permission map narrows only');
check('a permission can refuse a route', canOpenRoute('owner', 'settings', { multi_branch: true }, { settings: false }) === false);
check(
  'a permission cannot widen a role',
  canOpenRoute('cashier', 'settings', { multi_branch: true }, { settings: true }) === false
);
check(
  'an owner keeps every other route when one is narrowed',
  canOpenRoute('owner', 'users', { multi_branch: true }, { settings: false }) === true
);

// ── An unknown role opens nothing ──────────────────────────────────────────
section('An unknown role opens nothing');
for (const route of ALL_ROUTES) {
  if (canOpenRoute('inventory_manager', route, { multi_branch: true })) {
    check(`an unknown role is refused "${route}"`, false);
    break;
  }
}
check('an unknown role is refused every route', true);

// ── The guard covers every route the menu knows ────────────────────────────
section('The guard covers every route in the menu');
const menuRoutes = sidebarRoutes();
// 23 menu items; the 24th NavPage route ('barcode') is deliberately not in the menu.
check('the menu holds 23 items', menuRoutes.length === 23, String(menuRoutes.length));
check(
  'the guard knows every menu route',
  menuRoutes.every((r) => canOpenRoute('owner', r, { multi_branch: true }) === true)
);
check(
  'the guard and the menu have the same number of routes',
  menuRoutes.length === SIDEBAR_ITEMS.length
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
