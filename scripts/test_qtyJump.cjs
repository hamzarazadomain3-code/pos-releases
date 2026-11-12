/**
 * Unit test for the pure qtyJump decision function.
 * Imports real dist code and asserts all branches.
 */
const { shouldJumpToQty } = require('E:/antigravty/billing softwere/pos-app/dist/shared/qtyJump.js');

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('=== test_qtyJump ===\n');

// 1. Setting disabled → never jump
test('setting disabled → false for dropdown', () => {
  const r = shouldJumpToQty({ source: 'dropdown', enabled: false, isScale: false });
  assert(r.shouldJump === false);
  assert(r.reason === 'setting disabled');
});

test('setting disabled → false for scan', () => {
  const r = shouldJumpToQty({ source: 'scan', enabled: false, isScale: false });
  assert(r.shouldJump === false);
  assert(r.reason === 'setting disabled');
});

test('setting disabled → false for scale dropdown', () => {
  const r = shouldJumpToQty({ source: 'dropdown', enabled: false, isScale: true });
  assert(r.shouldJump === false);
});

// 2. Scanner path → never jump (even if enabled)
test('scan source → false even if enabled', () => {
  const r = shouldJumpToQty({ source: 'scan', enabled: true, isScale: false });
  assert(r.shouldJump === false);
  assert(r.reason === 'scanner path — keep search focus');
});

test('scan source → false even for scale item', () => {
  const r = shouldJumpToQty({ source: 'scan', enabled: true, isScale: true });
  assert(r.shouldJump === false);
  assert(r.reason === 'scanner path — keep search focus');
});

// 3. Dropdown (manual pick) → jump when enabled
test('dropdown source + enabled → true', () => {
  const r = shouldJumpToQty({ source: 'dropdown', enabled: true, isScale: false });
  assert(r.shouldJump === true);
  assert(r.reason === 'manual dropdown pick');
});

test('dropdown source + enabled + scale → true', () => {
  const r = shouldJumpToQty({ source: 'dropdown', enabled: true, isScale: true });
  assert(r.shouldJump === true);
  assert(r.reason === 'manual dropdown pick');
});

// 4. Enum source safety — only 'dropdown' | 'scan' allowed by TypeScript
// (no runtime test needed)

console.log(`\n=== ${passed} tests passed ===`);