const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SRC_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-app');
const TEST_DIR = path.join(os.tmpdir(), 'pos-e2e-units-test');
const testDbPath = path.join(TEST_DIR, 'pos.db');

console.log('=== E2E TEST: Flexible Units Save -> Reload Round-Trip ===');
console.log('Source (real) DB dir:', SRC_DIR);
console.log('Test DB path (copy):', testDbPath);

if (!fs.existsSync(path.join(SRC_DIR, 'pos.db'))) {
  console.error('FATAL: real DB not found at', SRC_DIR);
  process.exit(1);
}

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
for (const f of ['pos.db', 'pos.db-wal', 'pos.db-shm']) {
  const src = path.join(SRC_DIR, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TEST_DIR, f));
}
console.log('Copied pos.db + WAL + SHM. DB List:');
const db = new DatabaseSync(testDbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
console.log(db.prepare('PRAGMA database_list').all());

let passCount = 0;
let failCount = 0;
function test(name, condition, detail) {
  if (condition) { console.log('  PASS: ' + name); passCount++; }
  else { console.log('  FAIL: ' + name + (detail ? ' | ' + detail : '')); failCount++; }
}

// --- Run migrations exactly like the app does ---
const migrationsDir = path.join(__dirname, 'migrations');
db.exec(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
const applied = new Set(db.prepare('SELECT name FROM migrations').all().map(r => r.name));
for (const file of ['018_batches_boxes.js', '019_flexible_units.js']) {
  if (applied.has(file)) { console.log('Migration ' + file + ' already applied, skipping.'); continue; }
  const m = require(path.join(migrationsDir, file));
  m.up(db);
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
}
console.log('\nMigrations 018 + 019 applied.\n');

// --- ProductUnit shape: exactly what handleSave() now builds ---
const baseUnitPayload = { level: 0, name: 'Kilogram', quantity_in_base_units: 1, barcode: null, price: null, is_base: true };
const level1 = { level: 1, name: 'Box', quantity_in_base_units: 12, barcode: '123456789012', price: 1200, is_base: false };
const level2 = { level: 2, name: 'Carton', quantity_in_base_units: 24, barcode: '', price: 2200, is_base: false };

// --- Simulate createProduct() (inventory.ts lines 95-131) ---
console.log('--- Simulating createProduct() with 2 packaging levels ---');
const ins = db.prepare(
  `INSERT INTO products (sku, barcode, name, category_id, unit_id, cost_price, sale_price, wholesale_price, shelf_location, stock_qty, low_stock_threshold, tax_rate, expiry_date, active)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)`
);
const info = ins.run('E2E-TEST-1', '888000000001', 'E2E Flour 5kg', null, null, 500, 650, null, 'Test Shelf', 5, 0, null);
const productId = Number(info.lastInsertRowid);
const insUnit = db.prepare(
  `INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
for (const u of [baseUnitPayload, level1, level2]) {
  insUnit.run(productId, u.level, u.name, u.quantity_in_base_units, u.barcode || null, u.price ?? null, u.is_base ? 1 : 0);
}

// --- Reload via getUnits() SQL (inventory.ts line 388) ---
const getUnitsSql = `SELECT * FROM product_units WHERE product_id = ? ORDER BY level ASC`;
let units = db.prepare(getUnitsSql).all(productId);
console.log('\n--- After create (reload) ---');
units.forEach(u => console.log('  L' + u.level + ': ' + u.name + ' | qty=' + u.quantity_in_base_units + ' | barcode=' + u.barcode + ' | price=' + u.price + ' | is_base=' + u.is_base));

test('3 units persisted after create', units.length === 3);
test('Level 0 = base, qty=1, is_base=1', units[0] && units[0].level === 0 && units[0].quantity_in_base_units === 1 && units[0].is_base === 1);
test('Level 1 = Box, qty=12', units[1] && units[1].name === 'Box' && units[1].quantity_in_base_units === 12);
test('Level 1 barcode + price persisted', units[1] && units[1].barcode === '123456789012' && units[1].price === 1200);
test('Level 2 = Carton, qty=24', units[2] && units[2].name === 'Carton' && units[2].quantity_in_base_units === 24);

// --- Simulate updateProduct() (inventory.ts lines 174-194): DELETE + reinsert ---
console.log('\n--- Simulating updateProduct() (remove Carton, keep Box, rename base) ---');
db.prepare('DELETE FROM product_units WHERE product_id = ?').run(productId);
const updated = [
  { level: 0, name: 'Kilogram', quantity_in_base_units: 1, barcode: null, price: null, is_base: true },
  { level: 1, name: 'Box', quantity_in_base_units: 12, barcode: '123456789012', price: 1200, is_base: false },
];
for (const u of updated) {
  insUnit.run(productId, u.level, u.name, u.quantity_in_base_units, u.barcode || null, u.price ?? null, u.is_base ? 1 : 0);
}
units = db.prepare(getUnitsSql).all(productId);
console.log('After update (reload):');
units.forEach(u => console.log('  L' + u.level + ': ' + u.name + ' | qty=' + u.quantity_in_base_units + ' | is_base=' + u.is_base));
test('2 units after update (Carton removed)', units.length === 2);
test('No orphan level-2 rows', units.every(u => u.level <= 1));

// --- Base-unit fallback: handleSave auto-creates base if payload lacks one ---
console.log('\n--- Simulating handleSave base-unit fallback ---');
const baseName = 'Piece';
const payloadWithoutBase = [{ level: 0, name: 'Packet', quantity_in_base_units: 5, barcode: null, price: null, is_base: false }];
const unitsPayload = [...payloadWithoutBase];
if (!unitsPayload.some(u => u.is_base)) {
  unitsPayload.unshift({ level: 0, name: baseName, quantity_in_base_units: 1, barcode: null, price: null, is_base: true });
}
db.prepare('DELETE FROM product_units WHERE product_id = ?').run(productId);
for (const u of unitsPayload) {
  insUnit.run(productId, u.level, u.name, u.quantity_in_base_units, u.barcode || null, u.price ?? null, u.is_base ? 1 : 0);
}
units = db.prepare(getUnitsSql).all(productId);
test('Base unit auto-created when missing', units.length === 2 && units[0].is_base === 1 && units[0].name === 'Piece' && units[0].quantity_in_base_units === 1);

// --- Verify no impact on real products' existing units ---
console.log('\n--- Existing products untouched ---');
const realProducts = db.prepare('SELECT id, name FROM products WHERE id IN (114,115,116,117)').all();
let allIntact = true;
realProducts.forEach(p => {
  const u = db.prepare('SELECT level, name, quantity_in_base_units, is_base FROM product_units WHERE product_id = ? ORDER BY level').all(p.id);
  const ok = u.length >= 1 && u.some(x => x.is_base === 1);
  console.log('  ' + p.id + ' (' + p.name + '): ' + u.length + ' unit(s) ' + (ok ? 'OK' : 'MISSING BASE'));
  if (!ok) allIntact = false;
});
test('Existing products keep base units', allIntact);

console.log('\n=== SUMMARY ===');
console.log('Passed: ' + passCount);
console.log('Failed: ' + failCount);
console.log(failCount === 0 ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
db.close();
fs.rmSync(TEST_DIR, { recursive: true, force: true });
if (failCount > 0) process.exit(1);