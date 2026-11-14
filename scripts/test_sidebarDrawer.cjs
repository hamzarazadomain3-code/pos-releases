/**
 * Item 10b — the phone drawer state machine.
 *
 * Imports the REAL compiled code (dist/shared/sidebarDrawer.js) and checks the
 * open / close / toggle / route-change / back rules.
 */
const { drawerReducer, isDrawerOpen } = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarDrawer.js');

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

console.log('=== test_sidebarDrawer (item 10b) ===');

let s = 'closed';
check('it starts closed', s === 'closed');
s = drawerReducer(s, { type: 'open' });
check('open opens it', s === 'open' && isDrawerOpen(s));
s = drawerReducer(s, { type: 'close' });
check('close closes it', s === 'closed' && !isDrawerOpen(s));
s = drawerReducer(s, { type: 'toggle' });
check('toggle from closed opens it', s === 'open');
s = drawerReducer(s, { type: 'toggle' });
check('toggle from open closes it', s === 'closed');
s = drawerReducer('open', { type: 'routeChanged' });
check('a route change closes it', s === 'closed');
s = drawerReducer('open', { type: 'back' });
check('back closes it', s === 'closed');
s = drawerReducer('closed', { type: 'back' });
check('back on a closed drawer stays closed', s === 'closed');

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
