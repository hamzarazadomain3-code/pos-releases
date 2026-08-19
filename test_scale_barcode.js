// TEST: BayLan RLS1100 scale barcode parser + EAN-13 check digit
// Mirrors parseBayLanBarcode() / isValidEan13() in src/renderer/src/pages/Billing.tsx
// Format: 2 | PPPPPP (PLU) | WWWWW (grams) | C (EAN-13 check digit)
// Example: 2110001002342 -> PLU=110001, Weight=234g

function isValidEan13(barcode) {
  if (!/^\d{13}$/.test(barcode)) return false;
  const sum = barcode
    .slice(0, 12)
    .split('')
    .reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(barcode[12]);
}

function parseBayLanBarcode(barcode) {
  if (barcode.length !== 13) return null;
  if (barcode[0] !== '2') return null;
  if (!isValidEan13(barcode)) return null;
  const plu = barcode.substring(1, 7);
  const weightStr = barcode.substring(7, 12);
  const weightG = parseInt(weightStr, 10);
  if (isNaN(weightG) || weightG <= 0) return null;
  const weightKg = weightG / 1000;
  return { plu, weightG, weightKg };
}

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}\n    expected ${e}\n    got      ${a}`); }
}

console.log('=== SCALE BARCODE TEST: BayLan RLS1100 ===');

// Valid: PLU=110001, weight=234g, EAN-13 check digit = 2
check('2110001002342 -> PLU 110001, 234g', parseBayLanBarcode('2110001002342'), { plu: '110001', weightG: 234, weightKg: 0.234 });

// Invalid check digit (real EAN: ...42, tampered: ...45)
check('2110001002345 rejected (bad check digit)', parseBayLanBarcode('2110001002345'), null);

// Checklist barcode contains letter "D" -> invalid
check('2110000D234200 rejected (non-digit)', parseBayLanBarcode('2110000D234200'), null);

// Wrong length
check('12 digits rejected', parseBayLanBarcode('211000100234'), null);
check('14 digits rejected', parseBayLanBarcode('21100010023421'), null);

// Wrong flag
check('Flag 3 rejected', parseBayLanBarcode('3110001002342'), null);

// Zero weight rejected
check('Weight 00000 rejected', parseBayLanBarcode('2110001000003'), null);

// Weight 1kg = 01000g
check('2110001010002 -> 1000g = 1.0kg', parseBayLanBarcode('2110001010002'), { plu: '110001', weightG: 1000, weightKg: 1 });

// Max weight 99999g
check('2110001999994 -> 99999g', parseBayLanBarcode('2110001999994'), { plu: '110001', weightG: 99999, weightKg: 99.999 });

// Leading zeros in PLU
check('2000121002349 -> PLU 000121', parseBayLanBarcode('2000121002349'), { plu: '000121', weightG: 234, weightKg: 0.234 });

console.log(`\n=== SUMMARY ===\nPassed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('ALL TESTS PASSED');
