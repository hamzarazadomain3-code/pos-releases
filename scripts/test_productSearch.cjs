#!/usr/bin/env node
/**
 * Product search pure function test suite.
 *
 * Tests the `matchProducts`, `findExactCodeMatch`, `getProductCode` functions
 * from `src/shared/productSearch.ts` using the REAL built dist code.
 *
 * Usage: npm run test:productSearch
 * Exit code 0 = all checks passed.
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Build test products with various code/name combinations. */
function makeProducts() {
  return [
    { id: 1, sku: 'ABC123', barcode: '1234567890123', name: 'Apple iPhone 15', sale_price: 1000, active: 1 },
    { id: 2, sku: 'ABC124', barcode: '1234567890124', name: 'Apple iPhone 15 Pro', sale_price: 1200, active: 1 },
    { id: 3, sku: 'XYZ789', barcode: '9876543210987', name: 'Samsung Galaxy S24', sale_price: 900, active: 1 },
    { id: 4, sku: 'ABC', barcode: '1111111111111', name: 'Apple Watch', sale_price: 400, active: 1 },
    { id: 5, sku: null, barcode: '2222222222222', name: 'Google Pixel 8', sale_price: 800, active: 1 },
    { id: 6, sku: 'SKU001', barcode: null, name: 'OnePlus 12', sale_price: 700, active: 1 },
    { id: 7, sku: 'ABC123', barcode: '3333333333333', name: 'Apple iPad', sale_price: 600, active: 1 }, // duplicate sku
    { id: 8, sku: '  abc123  ', barcode: '4444444444444', name: 'Test whitespace', sale_price: 50, active: 1 }, // whitespace in sku
    { id: 9, sku: 'URDU123', barcode: '5555555555555', name: 'پروڈکٹ اردو', sale_price: 300, active: 1 }, // Urdu name
    { id: 10, sku: '', barcode: '6666666666666', name: 'Empty SKU', sale_price: 200, active: 1 }, // empty string sku
    { id: 11, sku: 'INACTIVE', barcode: '7777777777777', name: 'Inactive Product', sale_price: 100, active: 0 }, // inactive
  ];
}

async function run() {
  // Import the REAL built dist code
  const { matchProducts, findExactCodeMatch, getProductCode } = require('../dist/shared/productSearch.js');

  const products = makeProducts();
  const activeProducts = products.filter(p => p.active === 1);

  console.log('=== Product Search Pure Function Tests ===');

  // ── matchProducts basic behavior ────────────────────────────────────────────
  section('matchProducts: exact code match first');
  let results = matchProducts(activeProducts, 'ABC123');
  check('exact sku "ABC123" returns exact match first', results[0]?.sku === 'ABC123' && results[0]?.id === 1, `got id=${results[0]?.id}`);

  results = matchProducts(activeProducts, '1234567890123');
  check('exact barcode returns exact match first', results[0]?.barcode === '1234567890123', `got barcode=${results[0]?.barcode}`);

  results = matchProducts(activeProducts, 'XYZ789');
  check('exact sku "XYZ789" returns Samsung', results[0]?.name === 'Samsung Galaxy S24', `got ${results[0]?.name}`);

  // ── matchProducts: prefix code ──────────────────────────────────────────────
  section('matchProducts: code startsWith');
  results = matchProducts(activeProducts, 'ABC');
  check('prefix "ABC" matches codes starting with ABC (case-insensitive)', results.every(r => (r.sku?.trim().toLowerCase().startsWith('abc') || r.barcode?.trim().toLowerCase().startsWith('abc'))), 'all start with ABC');
  check('exact code "ABC" (id=4) ranked before prefix matches', results[0]?.id === 4, `first id=${results[0]?.id}`);

  results = matchProducts(activeProducts, '123');
  check('prefix "123" ranks prefix matches first', results[0]?.barcode?.startsWith('123') && results[1]?.barcode?.startsWith('123'), `first two: ${results.slice(0,2).map(r=>r.id).join(',')}`);

  // ── matchProducts: prefix name ──────────────────────────────────────────────
  section('matchProducts: name startsWith');
  results = matchProducts(activeProducts, 'Apple');
  check('prefix "Apple" matches names starting with Apple', results.every(r => r.name.startsWith('Apple')), 'all start with Apple');
  check('Apple iPhone 15 (id=1) before Apple iPhone 15 Pro (id=2)', results[0]?.id === 1 && results[1]?.id === 2, `order: ${results.map(r=>r.id).join(',')}`);

  results = matchProducts(activeProducts, 'Samsung');
  check('prefix "Samsung" matches Samsung Galaxy', results[0]?.name === 'Samsung Galaxy S24', `got ${results[0]?.name}`);

  // ── matchProducts: contains ─────────────────────────────────────────────────
  section('matchProducts: name/code contains');
  results = matchProducts(activeProducts, 'iPhone');
  check('contains "iPhone" matches iPhone products', results.length >= 2, `count=${results.length}`);
  check('all contain "iPhone" in name', results.every(r => r.name.toLowerCase().includes('iphone')), 'all contain iPhone');

  results = matchProducts(activeProducts, '123');
  check('contains "123" in code/barcode works', results.length >= 1, `count=${results.length}`);

  // ── matchProducts: case insensitive ─────────────────────────────────────────
  section('matchProducts: case insensitive');
  results = matchProducts(activeProducts, 'abc123');
  check('lowercase "abc123" matches uppercase SKU', results[0]?.sku === 'ABC123', `got ${results[0]?.sku}`);
  results = matchProducts(activeProducts, 'apple');
  check('lowercase "apple" matches "Apple"', results.every(r => r.name.toLowerCase().includes('apple')), 'all match');

  // ── matchProducts: trims spaces ─────────────────────────────────────────────
  section('matchProducts: trims spaces');
  results = matchProducts(activeProducts, '  ABC123  ');
  check('spaces trimmed around query', results[0]?.sku === 'ABC123', `got ${results[0]?.sku}`);
  results = matchProducts(activeProducts, ' abc ');
  check('spaces trimmed inside not required', results.length > 0, `count=${results.length}`);

  // ── matchProducts: Urdu names ───────────────────────────────────────────────
  section('matchProducts: Urdu names');
  results = matchProducts(activeProducts, 'اردو');
  check('Urdu query matches Urdu name', results[0]?.name === 'پروڈکٹ اردو', `got ${results[0]?.name}`);

  // ── matchProducts: null/empty fields safe ───────────────────────────────────
  section('matchProducts: null/empty fields');
  results = matchProducts(activeProducts, 'SKU001');
  check('null barcode with sku works', results[0]?.sku === 'SKU001', `got ${results[0]?.sku}`);
  results = matchProducts(activeProducts, '2222222222222');
  check('null sku with barcode works', results[0]?.barcode === '2222222222222', `got ${results[0]?.barcode}`);
  results = matchProducts(activeProducts, 'Empty SKU');
  check('empty string sku works', results[0]?.name === 'Empty SKU', `got ${results[0]?.name}`);

  // ── matchProducts: duplicate codes ──────────────────────────────────────────
  section('matchProducts: duplicate codes');
  results = matchProducts(activeProducts, 'ABC123');
  check('duplicate sku "ABC123" returns both', results.filter(r => r.sku === 'ABC123').length === 2, `count=${results.filter(r => r.sku === 'ABC123').length}`);
  check('exact match (id=1) before second (id=7)', results[0]?.id === 1 && results[1]?.id === 7, `order: ${results.slice(0,2).map(r=>r.id).join(',')}`);

  // ── matchProducts: limit respected ──────────────────────────────────────────
  section('matchProducts: limit');
  results = matchProducts(activeProducts, 'A', 3);
  check('limit=3 returns max 3', results.length === 3, `got ${results.length}`);
  results = matchProducts(activeProducts, '');
  check('empty query returns all (up to limit)', results.length === activeProducts.length, `got ${results.length}`);

  // ── findExactCodeMatch ──────────────────────────────────────────────────────
  section('findExactCodeMatch');
  let exact = findExactCodeMatch(activeProducts, 'ABC123');
  check('exact sku match', exact?.id === 1, `got id=${exact?.id}`);
  exact = findExactCodeMatch(activeProducts, '1234567890123');
  check('exact barcode match', exact?.id === 1, `got id=${exact?.id}`);
  exact = findExactCodeMatch(activeProducts, 'XYZ789');
  check('exact sku match for Samsung', exact?.id === 3, `got id=${exact?.id}`);
  exact = findExactCodeMatch(activeProducts, 'abc123');
  check('case insensitive exact match', exact?.id === 1, `got id=${exact?.id}`);
  exact = findExactCodeMatch(activeProducts, 'NOTEXIST');
  check('non-existent returns undefined', exact === undefined, `got ${exact}`);
  exact = findExactCodeMatch(activeProducts, '');
  check('empty query returns undefined', exact === undefined, `got ${exact}`);

  // ── getProductCode ──────────────────────────────────────────────────────────
  section('getProductCode');
  check('prefers sku over barcode', getProductCode({ sku: 'SKU1', barcode: 'BAR1' }) === 'SKU1');
  check('falls back to barcode when sku null', getProductCode({ sku: null, barcode: 'BAR2' }) === 'BAR2');
  check('falls back to barcode when sku empty', getProductCode({ sku: '', barcode: 'BAR3' }) === 'BAR3');
  check('returns null when both null', getProductCode({ sku: null, barcode: null }) === null);
  check('returns null when both empty', getProductCode({ sku: '', barcode: '' }) === null);

  // ── Inactive products (caller should filter, function ranks only) ────────────
  section('Inactive products (caller filters)');
  results = matchProducts(activeProducts, 'INACTIVE');
  check('inactive product not in results when caller filters', results.length === 0, `got ${results.length}`);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILED'}: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});