/**
 * Item 10b — the layout mode.
 *
 * Imports the REAL compiled code (dist/shared/layoutMode.js) and checks the
 * phone / tablet / desktop breakpoints and the NaN / 0 / negative safety.
 */
const { layoutModeFor, isPhone, isTablet, isDesktop, BREAKPOINT_PHONE, BREAKPOINT_TABLET } =
  require('E:/antigravty/billing softwere/pos-app/dist/shared/layoutMode.js');

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

console.log('=== test_layoutMode (item 10b) ===');

check('320 is a phone', layoutModeFor(320) === 'phone');
check('360 is a phone', layoutModeFor(360) === 'phone');
check('390 is a phone', layoutModeFor(390) === 'phone');
check('767 is a phone', layoutModeFor(767) === 'phone');
check('768 is a tablet', layoutModeFor(768) === 'tablet');
check('1023 is a tablet', layoutModeFor(1023) === 'tablet');
check('1024 is desktop', layoutModeFor(1024) === 'desktop');
check('1280 is desktop', layoutModeFor(1280) === 'desktop');
check('1920 is desktop', layoutModeFor(1920) === 'desktop');

check('NaN is safe (desktop)', layoutModeFor(NaN) === 'desktop');
check('0 is safe (desktop)', layoutModeFor(0) === 'desktop');
check('a negative width is safe (desktop)', layoutModeFor(-100) === 'desktop');
check('null is safe (desktop)', layoutModeFor(null) === 'desktop');
check('undefined is safe (desktop)', layoutModeFor(undefined) === 'desktop');

check('isPhone agrees', isPhone(360) === true && isPhone(1280) === false);
check('isTablet agrees', isTablet(768) === true && isTablet(360) === false);
check('isDesktop agrees', isDesktop(1280) === true && isDesktop(360) === false);
check('the breakpoints are 768 and 1024', BREAKPOINT_PHONE === 768 && BREAKPOINT_TABLET === 1024);

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
