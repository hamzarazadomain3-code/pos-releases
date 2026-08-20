/**
 * Unit tests for BayLan RLS1100 Label Scale barcode parser (v1.7.1)
 * Run: node scripts/test_scaleBarcode.js
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const SCALE_PREFIX = '21';

function isValidEan13(barcode) {
  if (!/^\d{13}$/.test(barcode)) return false;
  const sum = barcode
    .slice(0, 12)
    .split('')
    .reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(barcode[12]);
}

function isScaleBarcode(barcode) {
  return barcode.length === 13 && barcode.startsWith(SCALE_PREFIX);
}

function parseBayLanBarcode(barcode) {
  if (!/^\d{13}$/.test(barcode)) {
    return { plu: '', price: 0, isValid: false, error: 'Barcode must be 13 numeric digits' };
  }
  if (!barcode.startsWith(SCALE_PREFIX)) {
    return { plu: '', price: 0, isValid: false, error: 'Barcode does not start with scale prefix "21"' };
  }
  if (!isValidEan13(barcode)) {
    return { plu: '', price: 0, isValid: false, error: 'Invalid EAN-13 checksum' };
  }
  const plu = barcode.substring(2, 7);
  const priceStr = barcode.substring(7, 12);
  const price = parseInt(priceStr, 10);
  if (isNaN(price) || price <= 0) {
    return { plu, price: 0, isValid: false, error: 'Decoded price is zero or invalid' };
  }
  return { plu, price, isValid: true };
}

// DB-backed: getProductByBarcode
const tmpDb = path.join(require('os').tmpdir(), 'test_scalebarcode_db.db');
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
const db = new DatabaseSync(tmpDb);
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, cost_price REAL, sale_price REAL, stock_qty REAL, category_id INTEGER, unit_id INTEGER, active INTEGER DEFAULT 1);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE units (id INTEGER PRIMARY KEY, name TEXT, symbol TEXT);
  INSERT INTO categories VALUES (1, 'Snacks'), (2, 'Drinks');
  INSERT INTO units VALUES (1, 'Piece', 'pc'), (2, 'Kg', 'kg');
  INSERT INTO products VALUES
    (1, 'Biscuits Assorted', '10001', '10001', 10, 50, 100, 1, 1, 1),
    (2, 'Candy Bar', '10002', '10002', 5, 30, 50, 1, 1, 1),
    (3, 'No PLU Product', 'SKU999', null, 20, 100, 10, 1, 1, 1);
`);

function getProductByBarcode(barcode) {
  const row = db.prepare(
    `SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.barcode = ? AND p.active = 1`
  ).get(barcode);
  return row ?? null;
}

let pass = 0, fail = 0;

function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS: ' + msg); }
  else { fail++; console.error('  FAIL: ' + msg); console.error('    Expected: ' + JSON.stringify(expected)); console.error('    Actual:   ' + JSON.stringify(actual)); }
}

// ==================== TESTS ====================

console.log('\n=== Test 1: Valid BayLan barcode 2110001002342 ===');
assertEqual(isScaleBarcode('2110001002342'), true, 'isScaleBarcode = true for valid "21" prefix + 13 digits');
assertEqual(isValidEan13('2110001002342'), true, 'isValidEan13 = true');
assertEqual(parseBayLanBarcode('2110001002342'), { plu: '10001', price: 234, isValid: true }, 'parseBayLanBarcode: PLU="10001", price=234, valid=true');

console.log('\n=== Test 2: Wrong prefix (not "21") ===');
assertEqual(isScaleBarcode('3110001002342'), false, 'isScaleBarcode = false for prefix "31"');
const r2 = parseBayLanBarcode('3110001002342');
assertEqual(r2.isValid, false, 'parseBayLanBarcode isValid=false for wrong prefix');
assertEqual(typeof r2.error, 'string', 'parseBayLanBarcode returns error message for wrong prefix');

console.log('\n=== Test 3: Invalid checksum ===');
assertEqual(isValidEan13('2110001002343'), false, 'isValidEan13 = false for wrong check digit');
const r3 = parseBayLanBarcode('2110001002343');
assertEqual(r3.isValid, false, 'parseBayLanBarcode isValid=false for bad checksum');

console.log('\n=== Test 4: Short barcode (< 13 digits) ===');
assertEqual(isScaleBarcode('211000100234'), false, 'isScaleBarcode = false for 12-digit input');
const r4 = parseBayLanBarcode('211000100234');
assertEqual(r4.isValid, false, 'parseBayLanBarcode isValid=false for short barcode');

console.log('\n=== Test 5: Non-numeric input ===');
assertEqual(isScaleBarcode('21ABCDE10023'), false, 'isScaleBarcode = false for non-numeric');
const r5 = parseBayLanBarcode('21ABCDE100234');
assertEqual(r5.isValid, false, 'parseBayLanBarcode isValid=false for non-numeric input');

console.log('\n=== Test 6: Zero price ===');
assertEqual(isValidEan13('2110001000003'), true, 'EAN-13 valid for zero-price barcode');
const r6 = parseBayLanBarcode('2110001000003');
assertEqual(r6.isValid, false, 'parseBayLanBarcode isValid=false for zero decoded price');
assertEqual(typeof r6.error, 'string', 'parseBayLanBarcode returns error for zero price');

console.log('\n=== Test 7: PLU → Product lookup ===');
const lookup1 = getProductByBarcode('10001');
assertEqual(lookup1 !== null, true, 'PLU "10001" found in products table');
assertEqual(lookup1?.name, 'Biscuits Assorted', 'PLU "10001" maps to "Biscuits Assorted"');
const lookup2 = getProductByBarcode('10002');
assertEqual(lookup2?.name, 'Candy Bar', 'PLU "10002" maps to "Candy Bar"');
const lookup3 = getProductByBarcode('99999');
assertEqual(lookup3, null, 'PLU "99999" returns null (no match)');

console.log('\n=== Test 8: isScaleBarcode edge cases ===');
assertEqual(isScaleBarcode('21'), false, '2-char input returns false');
assertEqual(isScaleBarcode('2100000000000'), true, '13-digit "21" prefix returns true');
assertEqual(isScaleBarcode('2200000000000'), false, '"22" prefix returns false');
assertEqual(isScaleBarcode('210000000000'), false, '12-digit input returns false');
assertEqual(isScaleBarcode(''), false, 'empty string returns false');

console.log('\n=== Test 9: Prompt spec example ===');
const prompt = parseBayLanBarcode('2110001002342');
assertEqual(prompt.plu, '10001', 'PLU is "10001" (5 digits, positions 3-7)');
assertEqual(prompt.price, 234, 'Price is 234 (digits 8-12 = "00234")');
assertEqual(prompt.isValid, true, 'Result is valid');

db.close();
fs.unlinkSync(tmpDb);

console.log('\n========================================');
console.log('RESULTS: ' + pass + ' passed, ' + fail + ' failed');
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
