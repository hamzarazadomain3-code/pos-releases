/**
 * Item 8 — the keyboard navigation of the sidebar.
 *
 * Imports the REAL compiled code (dist/shared/sidebarKeyboardNav.js) and checks
 * the wrap-around, the collapsed-group skipping, the clamping, the shortcut
 * hint and the aria-current rule.
 */
const { flatNavItems, navIndexFor, clampNavIndex, moveNavIndex, shortcutHintLabel, isCurrentNav, navAriaCurrent, navCount } =
  require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarKeyboardNav.js');
const { SIDEBAR_GROUPS } = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarMenu.js');

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

console.log('=== test_sidebarKeyboardNav (item 8) ===');

const allOpen = () => true;
const allItems = flatNavItems(SIDEBAR_GROUPS, allOpen);
const total = navCount(allItems);

section('The flat list');
check('there are 23 reachable items', total === 23, `${total} items`);
check('the first item is billing', allItems[0]?.route === 'billing');
check('every item has a route', allItems.every((i) => typeof i.route === 'string' && i.route.length > 0));

section('Collapsed groups are skipped');
const dailyOnly = flatNavItems(SIDEBAR_GROUPS, (id) => id === 'daily');
check('only the daily group contributes', dailyOnly.length === 5, `${dailyOnly.length} items`);
const noneOpen = flatNavItems(SIDEBAR_GROUPS, () => false);
check('nothing is reachable when everything is collapsed', noneOpen.length === 0);

section('The index of the open page');
check('billing is at index 0', navIndexFor(allItems, 'billing') === 0);
check('a page that is not in the menu is -1', navIndexFor(allItems, 'no-such-page') === -1);
check('a missing page is -1', navIndexFor(null, 'billing') === -1);

section('Moving around wraps at both ends');
check('down from 0 goes to 1', moveNavIndex(0, total, 1) === 1);
check('up from 0 wraps to the last', moveNavIndex(0, total, -1) === total - 1);
check('down from the last wraps to 0', moveNavIndex(total - 1, total, 1) === 0);
check('up from 1 goes to 0', moveNavIndex(1, total, -1) === 0);
check('an empty list gives -1', moveNavIndex(0, 0, 1) === -1);
check('a negative index is clamped first', moveNavIndex(-5, total, 1) === 1);

section('Clamping');
check('a too-low index becomes 0', clampNavIndex(-3, total) === 0);
check('a too-high index becomes the last', clampNavIndex(999, total) === total - 1);
check('an empty list gives 0', clampNavIndex(5, 0) === 0);

section('The shortcut hint');
check('a combo is shown as it is', shortcutHintLabel('Ctrl+N') === 'Ctrl+N');
check('an empty combo is no hint', shortcutHintLabel('') === null);
check('a missing combo is no hint', shortcutHintLabel(null) === null);
check('a space-only combo is no hint', shortcutHintLabel('   ') === null);

section('The aria-current rule');
check('the open page is current', navAriaCurrent(allItems[0], 'billing') === 'page');
check('a closed page is not current', navAriaCurrent(allItems[1], 'billing') === undefined);
check('isCurrentNav agrees', isCurrentNav(allItems[0], 'billing') === true);

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
