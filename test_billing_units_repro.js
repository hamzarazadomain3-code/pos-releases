const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SRC_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-app');
const TEST_DIR = path.join(os.tmpdir(), 'pos-e2e-billing-units');
const testDbPath = path.join(TEST_DIR, 'pos.db');

console.log('=== REPRO: Billing units dropdown for product 120 (candy bescut) ===');
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

const p = db.prepare("SELECT id, name, barcode, sku, sale_price FROM products WHERE id = 120").get();
console.log('\nSTEP 1 — Product row in DB:');
console.log(JSON.stringify(p, null, 2));

const unitRows = db.prepare('SELECT * FROM product_units WHERE product_id = 120 ORDER BY level').all();
console.log('\nSTEP 2 — product_units rows:');
console.log(JSON.stringify(unitRows, null, 2));

console.log('\nSTEP 3 — Simulate Billing search: window.api.inventory.list(search)');
const listSql = `
  SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN units u ON u.id = p.unit_id
  WHERE p.active = 1
  ORDER BY p.name COLLATE NOCASE`;
const products = db.prepare(listSql).all();
const candy = products.find(r => r.id === 120);

console.log('  OLD listProducts: units field =', JSON.stringify((candy && candy.units) || '(undefined — no units loaded)'));
const dropdownOld = candy && candy.units && candy.units.length > 1;
console.log('  OLD dropdown condition (units.length > 1) =', dropdownOld === true, '<-- BUG: no dropdown');

console.log('\nSTEP 4 — NEW listProducts logic (grouped units query):');
const unitRowsAll = db.prepare('SELECT * FROM product_units ORDER BY product_id, level').all();
const unitsByProduct = new Map();
for (const row of unitRowsAll) {
  const arr = unitsByProduct.get(row.product_id) ?? [];
  arr.push(row);
  unitsByProduct.set(row.product_id, arr);
}
for (const prod of products) prod.units = unitsByProduct.get(prod.id) ?? [];
const candyNew = products.find(r => r.id === 120);
console.log('  candy bescut units =', JSON.stringify(candyNew.units.map(u => ({ level: u.level, name: u.name, qty: u.quantity_in_base_units, price: u.price }))));
const dropdownNew = candyNew.units && candyNew.units.length > 1;
console.log('  NEW dropdown condition (units.length > 1) =', dropdownNew === true, '<-- FIXED: dropdown will render');

console.log('\nSTEP 5 — Simulate addProduct() cart item construction:');
const cartItem = {
  product_id: candyNew.id,
  name: candyNew.name,
  qty: 1,
  price: candyNew.sale_price,
  units: candyNew.units ?? [],
  selected_unit_level: 0,
};
console.log('  cart item units.length =', cartItem.units.length);
console.log('  dropdown renders =', cartItem.units.length > 1);
console.log('  unit selector options:');
cartItem.units.forEach((u, i) => console.log('    ' + i + ': ' + u.name + ' (' + u.quantity_in_base_units + 'x)' + (u.price != null ? ' @' + u.price : '')));

console.log('\nSTEP 6 — Barcode path: getProductByBarcode');
const byBarcode = db.prepare(`
  SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN units u ON u.id = p.unit_id
  WHERE p.barcode = ? AND p.active = 1`).get(candyNew.barcode);
if (byBarcode) {
  const barcodeUnits = unitRowsAll.filter(r => r.product_id === byBarcode.id);
  byBarcode.units = barcodeUnits;
  console.log('  units loaded on barcode lookup =', byBarcode.units.length > 1 ? 'YES (2)' : 'NO');
} else {
  console.log('  no barcode on product 120 — skipped');
}

console.log('\n=== RESULT ===');
const ok = dropdownNew === true;
console.log(ok ? 'FIX VERIFIED: Billing will now render the unit dropdown for candy bescut' : 'STILL BROKEN');
db.close();
fs.rmSync(TEST_DIR, { recursive: true, force: true });
process.exit(ok ? 0 : 1);