/**
 * Item 9 — the Ctrl+K palette filter.
 *
 * Imports the REAL compiled code (dist/shared/sidebarKeyboardNav.js) and checks
 * the pure filter rule: empty query returns every page, a query matches the
 * label or the key, the match is case-insensitive, and a missing query is safe.
 */
const { filterPalettePages } = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarKeyboardNav.js');

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

console.log('=== test_sidebarSearch (item 9) ===');

const pages = [
  { key: 'billing', label: 'Billing' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'udhaar', label: 'Udhaar / Khata' },
  { key: 'settings', label: 'Settings' },
];

check('an empty query returns every page', filterPalettePages(pages, '').length === 4);
check('a missing query returns every page', filterPalettePages(pages, null).length === 4);
check('a space-only query returns every page', filterPalettePages(pages, '   ').length === 4);
check('null pages are safe', filterPalettePages(null, 'x').length === 0);
check('a missing pages list is safe', filterPalettePages(undefined, 'x').length === 0);

check('a label match works', filterPalettePages(pages, 'bill').map((p) => p.key).join(',') === 'billing');
check('a key match works', filterPalettePages(pages, 'udhaar').map((p) => p.key).join(',') === 'udhaar');
check('the match is case-insensitive', filterPalettePages(pages, 'BILL').map((p) => p.key).join(',') === 'billing');
check('a partial match works', filterPalettePages(pages, 'sett').map((p) => p.key).join(',') === 'settings');
check('a query with no match gives nothing', filterPalettePages(pages, 'zzzz').length === 0);
check('the original list is not mutated', pages.length === 4);

// The palette reuses the ONE menu: every page the palette offers is a page the
// menu offers too. (Checked here on the shape, not the content.)
check('the result is a new array', filterPalettePages(pages, '') !== pages);

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
