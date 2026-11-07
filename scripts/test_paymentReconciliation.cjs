/**
 * Test for the pure payment reconciliation module (dist/shared/paymentReconciliation.js).
 * Tests various payment scenarios: cash with change, card, split, change given,
 * returned_amount > 0, credit sale without payment row.
 */

const { reconcilePayments } = require('../dist/shared/paymentReconciliation.js');

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
    passed++;
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error('      ' + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

console.log('\n=== paymentReconciliation pure module tests ===');

// Helper to create a sale
function makeSale(id, net_total, payments) {
  return { id, net_total, payments };
}

// Test 1: Cash sale with exact amount
test('Cash sale exact amount - no change', () => {
  const sales = [makeSale(1, 100, [{ mode: 'Cash', amount: 100 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 100);
  assertEqual(result.remainder, 0);
});

// Test 2: Cash sale with change given
test('Cash sale with change given', () => {
  const sales = [makeSale(1, 100, [{ mode: 'Cash', amount: 150 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 100);
  assertEqual(result.remainder, 0);
});

// Test 3: Card payment exact amount
test('Card payment exact amount', () => {
  const sales = [makeSale(1, 100, [{ mode: 'Card', amount: 100 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Card'), 100);
  assertEqual(result.remainder, 0);
});

// Test 4: Split payment - cash + card
test('Split payment - cash + card exact', () => {
  const sales = [makeSale(1, 100, [{ mode: 'Cash', amount: 60 }, { mode: 'Card', amount: 40 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 60);
  assertEqual(result.breakdown.get('Card'), 40);
  assertEqual(result.remainder, 0);
});

// Test 5: Split payment with change (cash first allocation)
test('Split payment with change - cash allocated first', () => {
  // Sale 100, Cash 120, Card 30 = tendered 150, given 50
  // Cash gets change first: 120 - 50 = 70 collected, Card 30 collected
  const sales = [makeSale(1, 100, [{ mode: 'Cash', amount: 120 }, { mode: 'Card', amount: 30 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 70);
  assertEqual(result.breakdown.get('Card'), 30);
  assertEqual(result.remainder, 0);
});

// Test 6: Split payment with change - card first (no cash)
test('Split payment with change - no cash, card gets change', () => {
  // Sale 100, Card 80, UPI 70 = tendered 150, given 50
  // Card gets change first (no cash): 80 - 50 = 30 collected, UPI 70 collected
  const sales = [makeSale(1, 100, [{ mode: 'Card', amount: 80 }, { mode: 'UPI', amount: 70 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Card'), 30);
  assertEqual(result.breakdown.get('UPI'), 70);
  assertEqual(result.remainder, 0);
});

// Test 7: Returned amount > 0 (returned sale)
test('Returned amount reduces net total', () => {
  // Sale total 200, returned 50, net = 150
  // Cash 200 tendered, given = 200 - 150 = 50
  // Cash collected = 200 - 50 = 150
  const sales = [makeSale(1, 150, [{ mode: 'Cash', amount: 200 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 150);
  assertEqual(result.remainder, 0);
});

// Test 8: Credit sale with no payment row
test('Credit sale with no payment row - remainder', () => {
  // Sale 100, no payments = net 100, tendered 0, given = 0
  // remainder = 100 - 0 = 100 (unpaid credit)
  const sales = [makeSale(1, 100, [])];
  const result = reconcilePayments(sales);
  assertEqual(result.remainder, 100);
  assertEqual(result.breakdown.size, 0);
});

// Test 9: Multiple sales with mixed payments
test('Multiple sales with mixed payments', () => {
  const sales = [
    makeSale(1, 100, [{ mode: 'Cash', amount: 100 }]),
    makeSale(2, 200, [{ mode: 'Card', amount: 200 }]),
    makeSale(3, 150, [{ mode: 'Cash', amount: 100 }, { mode: 'Card', amount: 50 }]),
  ];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 100 + 100);
  assertEqual(result.breakdown.get('Card'), 200 + 50);
  assertEqual(result.remainder, 0);
});

// Test 10: Multiple sales with change allocation
test('Multiple sales with change - cash allocated first across sales', () => {
  const sales = [
    makeSale(1, 100, [{ mode: 'Cash', amount: 120 }]),
    makeSale(2, 100, [{ mode: 'Cash', amount: 110 }]),
  ];
  const result = reconcilePayments(sales);
  // Sale 1: net=100, tendered=120, given=20, cash collected=100
  // Sale 2: net=100, tendered=110, given=10, cash collected=100
  // Total cash = 200, remainder = 0
  assertEqual(result.breakdown.get('Cash'), 200);
  assertEqual(result.remainder, 0);
});

// Test 11: Sales without payment rows are counted in totalSales
test('Sales without payment rows counted in totalSales', () => {
  const sales = [
    makeSale(1, 100, [{ mode: 'Cash', amount: 100 }]),
    makeSale(2, 50, []), // no payment
  ];
  const result = reconcilePayments(sales);
  // Total sales = 100 + 50 = 150
  // Collected = 100
  // Remainder = 50 (unpaid credit)
  assertEqual(result.breakdown.get('Cash'), 100);
  assertEqual(result.remainder, 50);
});

// Test 12: Split payment with multiple modes, change allocated to cash first
test('Split payment with 3 modes, change to cash first', () => {
  // Sale 100, Cash 50, Card 60, UPI 40 = tendered 150, given 50
  // Cash gets change first: 50 - 50 = 0 collected
  // Card: 60 - 0 = 60 collected (no change left)
  // UPI: 40 collected
  const sales = [makeSale(1, 100, [{ mode: 'Cash', amount: 50 }, { mode: 'Card', amount: 60 }, { mode: 'UPI', amount: 40 }])];
  const result = reconcilePayments(sales);
  assertEqual(result.breakdown.get('Cash'), 0);
  assertEqual(result.breakdown.get('Card'), 60);
  assertEqual(result.breakdown.get('UPI'), 40);
  assertEqual(result.remainder, 0);
});

// Test 13: Sum of breakdown + remainder equals total_sales
test('Sum of breakdown + remainder equals total_sales', () => {
  const sales = [
    makeSale(1, 100, [{ mode: 'Cash', amount: 120 }]),
    makeSale(2, 200, [{ mode: 'Card', amount: 200 }]),
    makeSale(3, 50, []), // credit sale
  ];
  const result = reconcilePayments(sales);
  const totalSales = 100 + 200 + 50;
  const sumBreakdown = Array.from(result.breakdown.values()).reduce((a, b) => a + b, 0);
  assertEqual(sumBreakdown + result.remainder, 350);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
else console.log('ALL PASSED');