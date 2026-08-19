const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SRC_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-app');
const TEST_DIR = path.join(os.tmpdir(), 'pos-unit-math-test');
const testDbPath = path.join(TEST_DIR, 'pos.db');

console.log('=== UNIT MATH TEST: Piece <-> Box <-> Carton ===');
console.log('Source (real) DB dir:', SRC_DIR);
console.log('Test DB path (copy):', testDbPath);

if (!fs.existsSync(path.join(SRC_DIR, 'pos.db'))) { console.error('FATAL: real DB not found'); process.exit(1); }
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
for (const f of ['pos.db', 'pos.db-wal', 'pos.db-shm']) {
  const src = path.join(SRC_DIR, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TEST_DIR, f));
}
const db = new DatabaseSync(testDbPath, { readOnly: true });

// Product 120: candy bescut, base Piece (1x), box (12x @480)
const units = db.prepare('SELECT * FROM product_units WHERE product_id = 120 ORDER BY level').all().map(u => ({
  level: u.level, name: u.name, quantity_in_base_units: u.quantity_in_base_units, barcode: u.barcode, price: u.price, is_base: u.is_base
}));
console.log('Units from DB:', JSON.stringify(units, null, 2));

// Simulate addProduct (Billing.tsx): qty=1 base, price=sale_price
const retailPrice = 50;
let cart = { product_id: 120, qty: 1, price: retailPrice, retail_price: retailPrice, wholesale_price: null, selected_unit_level: 0, units };
let pass = 0, fail = 0;
function test(name, cond, detail) {
  if (cond) { console.log('  PASS: ' + name); pass++; }
  else { console.log('  FAIL: ' + name + (detail ? ' | ' + detail : '')); fail++; }
}
function selected(cart) {
  const u = cart.units[cart.selected_unit_level] || cart.units[0];
  return { mult: u.quantity_in_base_units, name: u.name, price: u.price };
}
function displayQty(cart) { return Math.round(cart.qty / selected(cart).mult); }
function displayPrice(cart) { return cart.price * selected(cart).mult; }
function lineTotal(cart) { return cart.price * cart.qty; }

// handleUnitChange (new implementation, priceMode retail, no promo)
function handleUnitChange(cart, newLevel) {
  const newUnit = cart.units[newLevel];
  if (!newUnit) return cart;
  const basePiece = cart.wholesale_price != null ? cart.wholesale_price : cart.retail_price;
  const newBasePrice = newUnit.price != null ? newUnit.price / newUnit.quantity_in_base_units : basePiece;
  return { ...cart, selected_unit_level: newLevel, qty: newUnit.quantity_in_base_units, price: newBasePrice };
}
// handleQtyChange (new implementation): newQty in SELECTED units
function handleQtyChange(cart, newQty) {
  return { ...cart, qty: newQty * selected(cart).mult };
}

console.log('\n--- Scenario 1: add 1 piece, switch Piece -> Box ---');
test('initial: 1 piece @ 50', cart.qty === 1 && cart.price === 50);
console.log('  display:', displayQty(cart), selected(cart).name, '@', displayPrice(cart), 'total', lineTotal(cart));
cart = handleUnitChange(cart, 1);
console.log('  after switch:', JSON.stringify({ qty: cart.qty, price: cart.price, level: cart.selected_unit_level }));
test('internal qty = 12 base units', cart.qty === 12);
test('internal price = 40 per base unit', cart.price === 40);
test('display: 1 box @ 480', displayQty(cart) === 1 && displayPrice(cart) === 480);
test('line total = 480', lineTotal(cart) === 480);
test('stock deduction = 12 pieces', cart.qty === 12);

console.log('\n--- Scenario 2: switch Box -> Piece ---');
cart = handleUnitChange(cart, 0);
test('display: 1 piece @ 50', displayQty(cart) === 1 && displayPrice(cart) === 50);
test('internal: qty=1, price=50', cart.qty === 1 && cart.price === 50);
test('total = 50', lineTotal(cart) === 50);

console.log('\n--- Scenario 3: add Carton level (24x @900), Piece -> Carton -> Box ---');
const cartonUnits = [...units, { level: 2, name: 'Carton', quantity_in_base_units: 24, barcode: null, price: 900, is_base: 0 }];
cart = { ...cart, units: cartonUnits };
cart = handleUnitChange(cart, 2);
test('internal: qty=24, price=37.5', cart.qty === 24 && cart.price === 37.5);
test('display: 1 carton @ 900', displayQty(cart) === 1 && displayPrice(cart) === 900);
test('total = 900', lineTotal(cart) === 900);
cart = handleUnitChange(cart, 1);
test('back to box: 1 box @ 480', displayQty(cart) === 1 && displayPrice(cart) === 480 && lineTotal(cart) === 480);

console.log('\n--- Scenario 4: qty +/- at box level ---');
cart = { ...cart, qty: 12, price: 40, selected_unit_level: 1 };
cart = handleQtyChange(cart, 2);
test('2 boxes: display 2 @ 480, total 960', displayQty(cart) === 2 && displayPrice(cart) === 480 && lineTotal(cart) === 960);
test('stock deduction = 24 pieces', cart.qty === 24);
cart = handleQtyChange(cart, Math.max(1, displayQty(cart) - 1));
test('minus: back to 1 box, total 480', displayQty(cart) === 1 && lineTotal(cart) === 480);

console.log('\n--- Scenario 5: unit WITHOUT configured price falls back to base price ---');
const noPriceUnits = [
  { level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: null, price: null, is_base: 1 },
  { level: 1, name: 'Box', quantity_in_base_units: 6, barcode: null, price: null, is_base: 0 },
];
cart = { product_id: 999, qty: 1, price: 50, retail_price: 50, wholesale_price: null, selected_unit_level: 0, units: noPriceUnits };
cart = handleUnitChange(cart, 1);
test('box w/o price: internal price = base 50, qty=6', cart.price === 50 && cart.qty === 6);
test('display: 1 box @ 300 (50x6)', displayQty(cart) === 1 && displayPrice(cart) === 300);
test('total = 300', lineTotal(cart) === 300);

console.log('\n--- Scenario 6: wholesale mode ---');
cart = { product_id: 999, qty: 1, price: 45, retail_price: 50, wholesale_price: 45, selected_unit_level: 0, units };
cart = handleUnitChange(cart, 1);
test('wholesale: box price 480 still wins when configured', cart.price === 40 && displayPrice(cart) === 480);

console.log('\n=== SUMMARY ===');
console.log('Passed: ' + pass + ' | Failed: ' + fail);
console.log(fail === 0 ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
db.close();
fs.rmSync(TEST_DIR, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);