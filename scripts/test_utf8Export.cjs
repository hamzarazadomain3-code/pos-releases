/**
 * UTF-8 Export/Import test (Run 11 - Item 2).
 *
 * Verifies the real `buildCsvBuffer` function from export.ts:
 *   - CSV export starts with UTF-8 BOM (EF BB BF)
 *   - Urdu text and en-dash survive round-trip
 *   - Commas and quotes are escaped correctly
 *   - XLSX round-trip (tests the library only)
 */
const { buildCsvBuffer } = require("../dist/main/services/export.js");
const XLSX = require("xlsx");

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

console.log("\n=== UTF-8 Export test (real buildCsvBuffer) ===");

async function runTests() {
  await test("buildCsvBuffer: CSV starts with UTF-8 BOM (EF BB BF)", async () => {
    const headers = ['Name', 'SKU', 'Sale Price', 'Cost Price'];
    const rows = [
      ['آیت مہربانی', 'SKU-URDU', 100, 50],
      ['Product – with en-dash', 'SKU-DASH', 200, 100],
      ['Normal Product', 'SKU-NORMAL', 300, 150],
    ];

    const buffer = buildCsvBuffer(headers, rows);

    // Check BOM
    assertEqual(buffer[0], 0xEF, "First byte should be EF (BOM)");
    assertEqual(buffer[1], 0xBB, "Second byte should be BB (BOM)");
    assertEqual(buffer[2], 0xBF, "Third byte should be BF (BOM)");

    // Check Urdu text is present
    const csvString = buffer.toString('utf8');
    assert(csvString.includes('آیت مہربانی'), "CSV should contain Urdu text");
    assert(csvString.includes('Product – with en-dash'), "CSV should contain en-dash");
    assert(csvString.includes('Normal Product'), "CSV should contain normal text");

    // Check escaping: if a field contains comma or quote, it should be quoted
    const buffer2 = buildCsvBuffer(['Name', 'Desc'], [['Test, with comma', 'Has "quote"']]);
    const csv2 = buffer2.toString('utf8');
    assert(csv2.includes('"Test, with comma"'), "Comma should be quoted");
    assert(csv2.includes('"Has ""quote"""'), "Quote should be escaped");

    console.log("      CSV preview:", buffer.toString('utf8').substring(0, 100));
  });

  await test("XLSX round-trip: Urdu + en-dash survive (library test)", async () => {
    const XLSX = require("xlsx");

    const products = [
      { name: 'آیت مہربانی', sku: 'SKU-URDU', sale_price: 100, cost_price: 50 },
      { name: 'Product – with en-dash', sku: 'SKU-DASH', sale_price: 200, cost_price: 100 },
      { name: 'Normal Product', sku: 'SKU-NORMAL', sale_price: 300, cost_price: 150 },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'SKU', 'Sale Price', 'Cost Price'],
      ...products.map(p => [p.name, p.sku, p.sale_price, p.cost_price]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Products');

    // Write to buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Read back and verify
    const wb2 = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb2.Sheets[wb2.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    assertEqual(data.length, 4, "Should have header + 3 data rows");
    assertEqual(data[1][0], 'آیت مہربانی', "Urdu name should round-trip");
    assertEqual(data[2][0], 'Product – with en-dash', "en-dash should round-trip");
    assertEqual(data[3][0], 'Normal Product', "Normal name should round-trip");
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
  else console.log("ALL PASSED");
}

async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected \"" + expected + "\", got \"" + actual + "\"");
}

runTests().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});