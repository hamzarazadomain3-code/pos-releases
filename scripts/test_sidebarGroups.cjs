/**
 * Item 4 — collapsible groups and the remembered state.
 *
 * Imports the REAL compiled code (dist/shared/sidebarMenu.js) and checks the
 * pure reducer:
 *   - every group starts expanded
 *   - a toggle flips one group and leaves the others alone
 *   - the group holding the ACTIVE page is always expanded
 *   - a stored state is restored
 *   - a CORRUPT stored value is ignored (it falls back to the default)
 *   - the state key is per user
 */
const {
  parseGroupState,
  toggleGroup,
  groupStateReducer,
  groupForRoute,
  isGroupExpanded,
  DEFAULT_GROUP_STATE,
  GROUP_STATE_KEY_PREFIX,
  groupStateKey,
  SIDEBAR_GROUPS,
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

console.log('=== test_sidebarGroups (item 4) ===');

section('The defaults');
check('there are five groups', SIDEBAR_GROUPS.length === 5);
check(
  'every group starts expanded',
  SIDEBAR_GROUPS.every((g) => DEFAULT_GROUP_STATE[g.id] === true)
);
check(
  'an empty stored value gives the defaults',
  Object.values(parseGroupState(null)).every((v) => v === true)
);
check(
  'an empty stored value has one entry per group',
  Object.keys(parseGroupState(null)).length === SIDEBAR_GROUPS.length
);

section('Toggling');
const collapsed = toggleGroup(DEFAULT_GROUP_STATE, 'stock');
check('a toggle collapses that group', collapsed.stock === false);
check('a toggle leaves the other groups alone', collapsed.daily === true && collapsed.sales === true && collapsed.money === true && collapsed.setup === true);
check('a toggle does not mutate the old state', DEFAULT_GROUP_STATE.stock === true);
const reexpanded = toggleGroup(collapsed, 'stock');
check('a second toggle expands it again', reexpanded.stock === true);
check(
  'the reducer does the same as the helper',
  groupStateReducer(DEFAULT_GROUP_STATE, { type: 'toggle', groupId: 'stock' }).stock === false
);
check(
  'the reducer leaves the state alone for an unknown action',
  groupStateReducer(DEFAULT_GROUP_STATE, { type: 'nope' }) === DEFAULT_GROUP_STATE
);

section('The active page always wins');
check('Billing belongs to the daily group', groupForRoute('billing') === 'daily');
check('Inventory belongs to the stock group', groupForRoute('inventory') === 'stock');
check('Settings belongs to the setup group', groupForRoute('settings') === 'setup');
check('an unknown route belongs to no group', groupForRoute('nope') === null);
check('an empty route belongs to no group', groupForRoute('') === null);
check(
  'a collapsed group is expanded again while its page is the active one',
  isGroupExpanded(collapsed, 'stock', 'inventory') === true
);
check(
  'a collapsed group stays collapsed when another page is active',
  isGroupExpanded(collapsed, 'stock', 'billing') === false
);
check(
  'a group with no stored entry is expanded',
  isGroupExpanded({}, 'stock', 'billing') === true
);
check(
  'the active page of a collapsed group is still found',
  groupForRoute('inventory') === 'stock' && isGroupExpanded(collapsed, 'stock', 'inventory')
);

section('The stored state');
const stored = JSON.stringify({ daily: false, stock: true, sales: false });
const restored = parseGroupState(stored);
check('a stored state is restored', restored.daily === false && restored.sales === false && restored.stock === true);
check('a group missing from the stored state keeps the default', restored.money === true && restored.setup === true);
check(
  'the reducer restores a stored state',
  groupStateReducer(DEFAULT_GROUP_STATE, { type: 'restore', raw: stored }).daily === false
);

section('A corrupt stored value is ignored');
check('corrupt JSON falls back to the defaults', Object.values(parseGroupState('{not json')).every((v) => v === true));
check('a JSON array falls back to the defaults', Object.values(parseGroupState('[1,2,3]')).every((v) => v === true));
check('a JSON string falls back to the defaults', Object.values(parseGroupState('"hello"')).every((v) => v === true));
check('JSON null falls back to the defaults', Object.values(parseGroupState('null')).every((v) => v === true));
check('JSON 42 falls back to the defaults', Object.values(parseGroupState('42')).every((v) => v === true));
check(
  'a non-boolean entry is ignored and the default stands',
  parseGroupState(JSON.stringify({ daily: 'yes' })).daily === true
);
check(
  'an entry for a group that no longer exists is dropped',
  Object.keys(parseGroupState(JSON.stringify({ daily: false, ghostGroup: false }))).length === SIDEBAR_GROUPS.length
);
check(
  'a stored state with only a bad entry keeps every default',
  Object.values(parseGroupState(JSON.stringify({ daily: 1, stock: 'x' }))).every((v) => v === true)
);
check('an empty string falls back to the defaults', Object.values(parseGroupState('')).every((v) => v === true));

section('The state is per user');
check('the key has a prefix', GROUP_STATE_KEY_PREFIX === 'pos_sidebar_groups_');
check('the key carries the user id', groupStateKey(7) === 'pos_sidebar_groups_7');
check('two users get two keys', groupStateKey(1) !== groupStateKey(2));
check('a missing user still gets a key', groupStateKey(null) === 'pos_sidebar_groups_anon');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
