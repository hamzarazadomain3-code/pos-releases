#!/usr/bin/env node
/**
 * Hold -> Resume round-trip test (pure Node, no Electron).
 *
 * Reproduces the v2.15.1 bug where a held bill resumed with an empty price box,
 * a blank unit dropdown and NaN subtotals: `doHold()` serialized only a subset
 * of the cart line, so name / retail_price / wholesale_price / cost_price were
 * lost on the round-trip. The fix persists the FULL line (`serializeCartLine`)
 * and re-hydrates it on resume (`rehydrateCartLines`), coercing every number.
 *
 * Run: npm run test:holdresume   (builds dist/shared first)
 */
const {
  lineTotals,
  serializeCartLine,
  rehydrateCartLine,
  rehydrateCartLines,
  safeNum,
} = require('../dist/shared/cartMath.js');

let checks = 0;
let failures = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
const round = (n) => Math.round(n * 100) / 100;

// ── Mixed-unit fixtures: piece, box (12x), kilogram ──────────────────────────
const unitsPiece = [
  { id: 1, product_id: 1, level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: '1001', price: 100, is_base: true },
];
const unitsBox = [
  { id: 2, product_id: 2, level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: '2001', price: 20, is_base: true },
  { id: 3, product_id: 2, level: 1, name: 'Box', quantity_in_base_units: 12, barcode: '2002', price: 220, is_base: false },
];
const unitsKg = [
  { id: 4, product_id: 3, level: 0, name: 'Kilogram', quantity_in_base_units: 1, barcode: '3001', price: 250, is_base: true },
];

const products = [
  { id: 1, name: 'Soap', sale_price: 100, wholesale_price: 90, cost_price: 60, stock_qty: 25, tax_rate: 0, expiry_date: null, shelf_location: 'A1', unit_name: 'Piece', units: unitsPiece },
  { id: 2, name: 'Biscuits', sale_price: 20, wholesale_price: 18, cost_price: 12, stock_qty: 120, tax_rate: 5, expiry_date: null, shelf_location: 'B2', unit_name: 'Piece', units: unitsBox },
  { id: 3, name: 'Rice', sale_price: 250, wholesale_price: 230, cost_price: 200, stock_qty: 50, tax_rate: 0, expiry_date: null, shelf_location: 'C3', unit_name: 'Kilogram', units: unitsKg },
];

const cart = [
  { product_id: 1, name: 'Soap', qty: 2, price: 100, retail_price: 100, wholesale_price: 90, cost_price: 60, line_discount: 0, tax_rate: 0, expired: false, shelf_location: 'A1', stock_qty: 25, units: unitsPiece, selected_unit_level: 0 },
  { product_id: 2, name: 'Biscuits', qty: 24, price: 18.33, retail_price: 20, wholesale_price: 18, cost_price: 12, line_discount: 5, tax_rate: 5, expired: false, shelf_location: 'B2', stock_qty: 120, units: unitsBox, selected_unit_level: 1 },
  { product_id: 3, name: 'Rice', qty: 0.5, price: 250, retail_price: 250, wholesale_price: 230, cost_price: 200, line_discount: 0, tax_rate: 0, expired: false, shelf_location: 'C3', stock_qty: 50, units: unitsKg, selected_unit_level: 0 },
];

console.log('=== Hold -> Resume round-trip ===');
const preTotals = lineTotals(cart, 0, 'amount', {});

// Simulate hold: full serialization -> JSON in SQLite -> list out -> parse.
const held = { items: cart.map(serializeCartLine), customer_id: null, bill_discount: 0, discount_type: 'amount', price_mode: 'retail' };
const dbRoundTrip = JSON.parse(JSON.stringify(held));

const resumed = rehydrateCartLines(dbRoundTrip.items, products, dbRoundTrip.price_mode);
const postTotals = lineTotals(resumed, 0, 'amount', {});

check('resume restores every line', resumed.length === 3, `${resumed.length} lines`);
check(
  'product names survive the round-trip',
  resumed.map((r) => r.name).join(',') === 'Soap,Biscuits,Rice',
  resumed.map((r) => r.name).join(','),
);
check('unit lists survive (unit dropdown not blank)', resumed.every((r) => Array.isArray(r.units) && r.units.length >= 1));
check(
  'no rendered field is undefined after resume',
  resumed.every((r) => ['name', 'price', 'retail_price', 'cost_price', 'qty', 'tax_rate', 'line_discount', 'stock_qty'].every((k) => r[k] !== undefined)),
);
check('pre-hold subtotal === post-resume subtotal', round(preTotals.subtotal) === round(postTotals.subtotal), `${round(preTotals.subtotal)} vs ${round(postTotals.subtotal)}`);
check('pre-hold total === post-resume total', round(preTotals.total) === round(postTotals.total), `${round(preTotals.total)} vs ${round(postTotals.total)}`);
check('post-resume totals are finite (not NaN)', [postTotals.subtotal, postTotals.tax, postTotals.total].every(Number.isFinite));

// ── Legacy held bill: only the pre-fix subset of fields ──────────────────────
console.log('\n── Legacy held bills (pre-fix payloads) ──');
const legacy = { items: [{ product_id: 2, qty: 24, price: 18.33, line_discount: 5, tax_rate: 5, units: unitsBox, selected_unit_level: 1 }] };
const legacyResumed = rehydrateCartLines(legacy.items, products, 'wholesale');
check('legacy bill restores the name from current product data', legacyResumed[0].name === 'Biscuits', legacyResumed[0].name);
check('legacy bill restores the unit list from current product data', (legacyResumed[0].units || []).length === 2);
check('legacy bill resumes without NaN', lineTotals(legacyResumed, 0, 'amount', {}).subtotal > 0);
check('legacy bill honours wholesale mode for the fallback price', legacyResumed[0].retail_price === 20);

// A legacy line whose UNIT list is also missing still renders (falls back to product).
const bareLegacy = rehydrateCartLine({ product_id: 3, qty: 1.5 }, products[2], 'retail');
check('bare legacy line falls back to product name/units', bareLegacy.name === 'Rice' && bareLegacy.units.length === 1, bareLegacy.name);
check('bare legacy line price falls back to retail price', bareLegacy.price === 250, String(bareLegacy.price));

// ── Garbage input must never yield NaN ───────────────────────────────────────
console.log('\n── Defensive coercion ──');
check('safeNum coerces undefined/null/NaN/strings', safeNum(undefined) === 0 && safeNum(null) === 0 && safeNum(NaN) === 0 && safeNum('12.5') === 12.5);
const garbage = lineTotals(
  [{ product_id: 9, name: '', qty: undefined, price: undefined, retail_price: undefined, wholesale_price: null, cost_price: undefined, line_discount: undefined, tax_rate: undefined, expired: false, shelf_location: null, stock_qty: undefined, units: [], selected_unit_level: undefined }],
  undefined,
  'amount',
  {},
);
check('a garbage cart still yields finite totals', [garbage.subtotal, garbage.tax, garbage.total].every(Number.isFinite));

console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
