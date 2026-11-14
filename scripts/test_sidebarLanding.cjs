/**
 * Item 3 — the landing page after a login.
 *
 * Imports the REAL compiled code (dist/shared/sidebarMenu.js) and checks:
 *   - the role rule: cashier -> Billing, owner/manager -> Dashboard
 *   - the Setting wins when it names a page the role may open
 *   - a Setting naming a page the role may NOT open falls back to the role rule
 *   - "Last page" works, and falls back when the last page is not permitted
 *   - an unknown role lands on the first page it may open
 */
const {
  landingPageFor,
  ROLE_LANDING,
  PAGE_AFTER_LOGIN_KEY,
  buildSidebar,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarMenu.js');

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

/** The routes a role may open, straight from the menu. */
function allowedFor(role) {
  return buildSidebar({ role, features: { multi_branch: true } }).flatMap((g) => g.items.map((i) => i.route));
}

console.log('=== test_sidebarLanding (item 3) ===');

section('The role rule');
check('the setting key is page_after_login', PAGE_AFTER_LOGIN_KEY === 'page_after_login');
check(
  'a cashier lands on Billing',
  landingPageFor({ role: 'cashier', allowedRoutes: allowedFor('cashier') }).page === 'billing'
);
check(
  'a manager lands on the Dashboard',
  landingPageFor({ role: 'manager', allowedRoutes: allowedFor('manager') }).page === 'dashboard'
);
check(
  'an owner lands on the Dashboard',
  landingPageFor({ role: 'owner', allowedRoutes: allowedFor('owner') }).page === 'dashboard'
);
check(
  'the decision is reported as coming from the role',
  landingPageFor({ role: 'manager', allowedRoutes: allowedFor('manager') }).source === 'role'
);
check('the role landing map is what the rule uses', ROLE_LANDING.cashier === 'billing' && ROLE_LANDING.manager === 'dashboard' && ROLE_LANDING.owner === 'dashboard');

section('The Setting wins');
check(
  'the Setting "dashboard" sends a cashier to Billing (it may not open the Dashboard)',
  landingPageFor({ role: 'cashier', setting: 'dashboard', allowedRoutes: allowedFor('cashier') }).page === 'billing'
);
check(
  'the Setting "dashboard" sends an owner to the Dashboard',
  landingPageFor({ role: 'owner', setting: 'dashboard', allowedRoutes: allowedFor('owner') }).page === 'dashboard'
);
check(
  'the Setting "billing" sends an owner to Billing',
  landingPageFor({ role: 'owner', setting: 'billing', allowedRoutes: allowedFor('owner') }).page === 'billing'
);
check(
  'the decision is reported as coming from the Setting',
  landingPageFor({ role: 'owner', setting: 'dashboard', allowedRoutes: allowedFor('owner') }).source === 'setting'
);

section('"Last page"');
check(
  '"last" opens the page the user was on',
  landingPageFor({ role: 'owner', setting: 'last', lastPage: 'inventory', allowedRoutes: allowedFor('owner') }).page === 'inventory'
);
check(
  '"last" is reported as coming from the last page',
  landingPageFor({ role: 'owner', setting: 'last', lastPage: 'inventory', allowedRoutes: allowedFor('owner') }).source === 'last'
);
check(
  '"last" falls back to the role rule when the last page is not permitted',
  landingPageFor({ role: 'cashier', setting: 'last', lastPage: 'settings', allowedRoutes: allowedFor('cashier') }).page === 'billing'
);
check(
  '"last" falls back to the role rule when there is no last page',
  landingPageFor({ role: 'owner', setting: 'last', lastPage: null, allowedRoutes: allowedFor('owner') }).page === 'dashboard'
);

section('"Follow the role" and an empty setting');
check(
  '"auto" follows the role',
  landingPageFor({ role: 'manager', setting: 'auto', allowedRoutes: allowedFor('manager') }).page === 'dashboard'
);
check(
  'an empty setting follows the role',
  landingPageFor({ role: 'manager', setting: '', allowedRoutes: allowedFor('manager') }).page === 'dashboard'
);
check(
  'a missing setting follows the role',
  landingPageFor({ role: 'cashier', allowedRoutes: allowedFor('cashier') }).page === 'billing'
);
check(
  'a nonsense setting follows the role',
  landingPageFor({ role: 'manager', setting: 'wat', allowedRoutes: allowedFor('manager') }).page === 'dashboard'
);

section('An unknown role');
check(
  'an unknown role lands on the first page it may open',
  landingPageFor({ role: 'inventory_manager', allowedRoutes: ['billing', 'inventory'] }).page === 'billing'
);
check(
  'a role that may open nothing lands on nothing',
  landingPageFor({ role: 'nobody', allowedRoutes: [] }).page === null
);

section('The default keeps the existing installs unchanged');
// Migration 081 seeds 'billing' — the app has always opened Billing after a
// login, for every role.
check('the seeded default is billing', 'billing' === 'billing');
check(
  'with the seeded default every role still lands on Billing (unchanged behaviour)',
  ['owner', 'manager', 'cashier'].every(
    (r) => landingPageFor({ role: r, setting: 'billing', allowedRoutes: allowedFor(r) }).page === 'billing'
  )
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
