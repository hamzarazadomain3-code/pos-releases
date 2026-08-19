const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const migration = require('./migrations/019_flexible_units.js');

const testDbPath = path.join(__dirname, 'pos_flexible_test.db');
const db = new DatabaseSync(testDbPath);

console.log('=== Running Migration 019 on TEST DB (copy of real) ===\n');
console.log('DB Path:', testDbPath);
console.log('DB List:', db.prepare('PRAGMA database_list').all());

try {
  migration.up(db);
  console.log('\nMigration UP completed successfully\n');
} catch (e) {
  console.error('Migration FAILED:', e.message);
  process.exit(1);
}

console.log('=== VERIFICATION TESTS ===\n');

let passCount = 0;
let failCount = 0;

function test(name, condition) {
  if (condition) {
    console.log('  PASS: ' + name);
    passCount++;
  } else {
    console.log('  FAIL: ' + name);
    failCount++;
  }
}

// TEST 1: product_units table exists
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
test('product_units table exists', tables.includes('product_units'));

// TEST 2: All products have at least one unit (base unit)
const products = db.prepare('SELECT id, name FROM products').all();
let allHaveBase = true;
products.forEach(p => {
  const units = db.prepare('SELECT * FROM product_units WHERE product_id = ? AND level = 0 AND is_base = 1').all(p.id);
  if (units.length !== 1) {
    console.log('    Product ' + p.id + ' (' + p.name + ') has ' + units.length + ' base units');
    allHaveBase = false;
  }
});
test('Every product has exactly 1 base unit (level 0)', allHaveBase);

// TEST 3: Products with units_per_box have 2 units (base + box)
const productsWithBox = db.prepare(`
  SELECT id, name, units_per_box FROM products 
  WHERE units_per_box IS NOT NULL AND units_per_box > 0
`).all();
let boxMappingsCorrect = true;
productsWithBox.forEach(p => {
  const units = db.prepare('SELECT * FROM product_units WHERE product_id = ? ORDER BY level').all(p.id);
  if (units.length !== 2) {
    console.log('    Product ' + p.id + ' (' + p.name + '): expected 2 units, got ' + units.length);
    boxMappingsCorrect = false;
  } else if (units[0].level !== 0 || units[1].level !== 1) {
    console.log('    Product ' + p.id + ' (' + p.name + '): levels incorrect');
    boxMappingsCorrect = false;
  } else if (units[1].quantity_in_base_units !== p.units_per_box) {
    console.log('    Product ' + p.id + ' (' + p.name + '): box quantity ' + units[1].quantity_in_base_units + ' != units_per_box ' + p.units_per_box);
    boxMappingsCorrect = false;
  }
});
test('Products with units_per_box have 2 units (base + box) with correct quantities', boxMappingsCorrect);

// TEST 4: Box price and barcode migrated
let boxPriceMigrated = true;
let boxBarcodeMigrated = true;
productsWithBox.forEach(p => {
  const boxUnit = db.prepare('SELECT * FROM product_units WHERE product_id = ? AND level = 1').get(p.id);
  if (p.box_price && boxUnit.price !== p.box_price) {
    console.log('    Product ' + p.id + ' (' + p.name + '): box_price ' + p.box_price + ' != migrated ' + boxUnit.price);
    boxPriceMigrated = false;
  }
  if (p.box_barcode && boxUnit.barcode !== p.box_barcode) {
    console.log('    Product ' + p.id + ' (' + p.name + '): box_barcode ' + p.box_barcode + ' != migrated ' + boxUnit.barcode);
    boxBarcodeMigrated = false;
  }
});
test('Box price migrated correctly', boxPriceMigrated);
test('Box barcode migrated correctly', boxBarcodeMigrated);

// TEST 5: Base unit name from unit_id or 'Piece'
const productsWithUnitId = db.prepare(`
  SELECT p.id, p.name, p.unit_id, u.name as unit_name
  FROM products p
  LEFT JOIN units u ON u.id = p.unit_id
  WHERE p.unit_id IS NOT NULL
`).all();
let baseNamesCorrect = true;
productsWithUnitId.forEach(p => {
  const baseUnit = db.prepare('SELECT * FROM product_units WHERE product_id = ? AND level = 0 AND is_base = 1').get(p.id);
  const expectedName = p.unit_name || 'Piece';
  if (baseUnit && baseUnit.name !== expectedName) {
    console.log('    Product ' + p.id + ' (' + p.name + '): base unit name ' + baseUnit.name + ' != expected ' + expectedName);
    baseNamesCorrect = false;
  }
});
test('Base unit names from unit_id/unit_name', baseNamesCorrect);

// TEST 6: Unique constraint on barcode (only one per barcode)
const duplicateBarcodes = db.prepare(`
  SELECT barcode, COUNT(*) as cnt 
  FROM product_units 
  WHERE barcode IS NOT NULL 
  GROUP BY barcode 
  HAVING COUNT(*) > 1
`).all();
test('No duplicate barcodes in product_units', duplicateBarcodes.length === 0);

// TEST 7: Indexes created
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_product_units%'").all();
test('Indexes created (product, barcode)', indexes.length >= 2);

// TEST 8: Products without unit_id get default 'Piece' base unit
const productsNoUnit = db.prepare(`
  SELECT p.id FROM products p
  WHERE p.unit_id IS NULL
    AND p.units_per_box IS NULL
    AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.level = 0)
`).all();
test('Products without unit_id get default base unit', productsNoUnit.length === 0);

// TEST 9: Total unit count sanity check
const totalUnits = db.prepare('SELECT COUNT(*) as cnt FROM product_units').get().cnt;
const expectedMinUnits = products.length; // at least 1 per product
test('Unit count >= product count', totalUnits >= expectedMinUnits);

// TEST 10: Verify specific products from real DB
console.log('\n--- Sample Product Unit Details ---');
const sampleProducts = db.prepare('SELECT id, name, units_per_box FROM products WHERE id IN (114,115,116,117)').all();
sampleProducts.forEach(p => {
  const units = db.prepare('SELECT level, name, quantity_in_base_units, barcode, price, is_base FROM product_units WHERE product_id = ? ORDER BY level').all(p.id);
  console.log('  ' + p.id + ' (' + p.name + '): ' + units.length + ' unit(s)');
  units.forEach(u => console.log('    Level ' + u.level + ': ' + u.name + ' | qty=' + u.quantity_in_base_units + ' | barcode=' + u.barcode + ' | price=' + u.price + ' | is_base=' + u.is_base));
});

console.log('\n=== SUMMARY ===');
console.log('Passed: ' + passCount);
console.log('Failed: ' + failCount);
console.log(failCount === 0 ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');

db.close();
if (failCount > 0) process.exit(1);