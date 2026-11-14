/**
 * Item 10 — the brand header.
 *
 * Imports the REAL compiled code (dist/shared/sidebarBrand.js) and checks the
 * pure rules: the shop name wins, the product name is only the fallback, a
 * blank name falls back, the branch subtitle only appears for a multi-branch
 * shop, and the initials are sensible.
 */
const { brandDisplayName, brandSubtitle, brandInitials, PRODUCT_NAME } =
  require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarBrand.js');

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

console.log('=== test_sidebarBrand (item 10) ===');

check('the shop name wins', brandDisplayName('Hamza Mart') === 'Hamza Mart');
check('a blank name falls back to the product', brandDisplayName('') === PRODUCT_NAME);
check('a missing name falls back to the product', brandDisplayName(null) === PRODUCT_NAME);
check('spaces-only falls back', brandDisplayName('   ') === PRODUCT_NAME);
check('the product name is "Rokar POS"', PRODUCT_NAME === 'Rokar POS');
check('a custom product name can be used', brandDisplayName('', 'My POS') === 'My POS');
check('the name is trimmed', brandDisplayName('  Hamza Mart  ') === 'Hamza Mart');

check('no subtitle for a single-branch shop', brandSubtitle(false, 'Main') === null);
check('no subtitle when multi-branch is missing', brandSubtitle(null, 'Main') === null);
check('the branch name is the subtitle', brandSubtitle(true, 'Branch 2') === 'Branch 2');
check('a blank branch name gives no subtitle', brandSubtitle(true, '') === null);
check('a missing branch name gives no subtitle', brandSubtitle(true, null) === null);

check('one word gives one letter', brandInitials('Hamza') === 'H');
check('two words give two letters', brandInitials('Hamza Mart') === 'HM');
check('an empty name gives a question mark', brandInitials('') === '?');
check('a missing name gives a question mark', brandInitials(null) === '?');

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
