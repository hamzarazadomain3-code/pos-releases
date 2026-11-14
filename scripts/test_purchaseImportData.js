#!/usr/bin/env node
/**
 * The purchase import from a file — the web path and the desktop path.
 *
 * The web app has no file system: the renderer picks the file with an
 * `<input type="file">` and sends its bytes (base64, because the web transport
 * is JSON). This drives the REAL `parsePurchaseData` /
 * `savePurchaseImportTemplate` from dist/main/services/purchaseImport.js and
 * the REAL `parsePurchaseFile`, with the payload transported exactly the way
 * the web transport transports it.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_purchaseImportData.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-purchase-import-data-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'purchase-import-data.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

/** EXACTLY what cloud/web/electron-browser.ts does to the IPC arguments. */
function webTransport(value) {
  return JSON.parse(JSON.stringify({ channel: 'purchases:importParseData', args: ['purchases.csv', value] })).args[1];
}

const CSV = [
  'barcode,sku,product name,qty,unit,cost rate,sale price',
  '1110001110001,SKU-1,Rice 5kg,10,Bag,100,120',
  ',SKU-2,Cooking Oil,6,pcs,50,60',
].join('\r\n');

function buildXlsx() {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Acme Supplies — purchase sheet'],
    [],
    ['barcode', 'sku', 'product name', 'qty', 'unit', 'cost rate', 'sale price'],
    ['2220002220002', 'SKU-3', 'Tea 2kg', 4, 'Box', 300, 350],
    ['', 'SKU-4', 'Sugar 1kg', 20, 'kg', 90, 110],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Purchase Import');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  await initDatabase();

  const { parsePurchaseData, parsePurchaseFile, savePurchaseImportTemplate } =
    require('../dist/main/services/purchaseImport.js');
  const { toBase64Payload } = require('../dist/shared/binaryTransfer.js');

  // ── 1. the web path: a CSV sent as base64 ─────────────────────────────────
  console.log('\n=== The web path (CSV as base64) ===');
  const csvBytes = new Uint8Array(Buffer.from(CSV, 'utf8'));
  const csvPayload = webTransport(toBase64Payload(csvBytes));
  check('the payload survives JSON as a string', typeof csvPayload === 'string');

  const csv = parsePurchaseData('purchases.csv', csvPayload);
  check('the file name is kept', csv.file_name === 'purchases.csv', csv.file_name);
  check('the header row was found', csv.header_row === 1, String(csv.header_row));
  check('the headers were read', csv.headers[0] === 'barcode' && csv.headers[2] === 'product name', JSON.stringify(csv.headers));
  check('both data rows were read', csv.rows.length === 2, String(csv.rows.length));
  check('the first row keeps its values', csv.rows[0].values['product name'] === 'Rice 5kg', csv.rows[0].values['product name']);
  check('the first row keeps its qty', csv.rows[0].values.qty === '10', csv.rows[0].values.qty);
  check('the second row keeps its sku', csv.rows[1].values.sku === 'SKU-2', csv.rows[1].values.sku);
  check('the rows are numbered from the file', csv.rows[0].row === 2 && csv.rows[1].row === 3, `${csv.rows[0].row},${csv.rows[1].row}`);

  // ── 2. the web path: an .xlsx sent as base64 ───────────────────────────────
  console.log('\n=== The web path (XLSX as base64) ===');
  const xlsxPayload = webTransport(toBase64Payload(buildXlsx()));
  const xlsx = parsePurchaseData('purchases.xlsx', xlsxPayload);
  check('the sheet name is reported', typeof xlsx.sheet === 'string' && xlsx.sheet.length > 0, xlsx.sheet);
  check('the title row above the header was skipped', xlsx.header_row === 3, String(xlsx.header_row));
  check('the headers were read', xlsx.headers[0] === 'barcode', JSON.stringify(xlsx.headers));
  check('both data rows were read', xlsx.rows.length === 2, String(xlsx.rows.length));
  check('the first row keeps its values', xlsx.rows[0].values['product name'] === 'Tea 2kg', xlsx.rows[0].values['product name']);
  check('the rows are numbered from the file', xlsx.rows[0].row === 4, String(xlsx.rows[0].row));

  // ── 3. the old, flattened payload is still accepted ───────────────────────
  console.log('\n=== A flattened payload ===');
  const flat = webTransport(new Uint8Array(Buffer.from(CSV, 'utf8')));
  const flatResult = parsePurchaseData('purchases.csv', flat);
  check('a flattened payload still parses', flatResult.rows.length === 2, String(flatResult.rows.length));

  // ── 4. the desktop path (a real file on disk) is untouched ────────────────
  console.log('\n=== The desktop path (a file on disk) ===');
  const csvPath = path.join(tmpDir, 'desktop-purchases.csv');
  fs.writeFileSync(csvPath, CSV, 'utf8');
  const disk = parsePurchaseFile(csvPath);
  check('the desktop parse still works', disk.rows.length === 2, String(disk.rows.length));
  check('the desktop parse keeps the file name', disk.file_name === 'desktop-purchases.csv', disk.file_name);
  check('the desktop parse reads the same values', disk.rows[0].values['product name'] === 'Rice 5kg', disk.rows[0].values['product name']);

  // ── 5. the sample template ────────────────────────────────────────────────
  console.log('\n=== The sample template ===');
  const template = await savePurchaseImportTemplate(null);
  check('the web template comes back as a base64 payload', typeof template === 'string' && template.startsWith('base64:'));
  if (typeof template === 'string' && template.startsWith('base64:')) {
    const bytes = Buffer.from(template.slice('base64:'.length), 'base64');
    check('the template file is not empty', bytes.length > 1000, String(bytes.length));
    const XLSX = require('xlsx');
    const wb = XLSX.read(bytes, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
    check('the template carries the canonical columns', rows[0][0] === 'barcode' && rows[0].includes('product name'), JSON.stringify(rows[0]));
    check('the template carries a sample row', rows.length >= 2 && rows[1][2] === 'Basmati Rice 5kg', JSON.stringify(rows[1] || []));
  }

  // ── 6. a broken file is reported, not thrown as a crash ───────────────────
  console.log('\n=== A broken file ===');
  let threw = false;
  try {
    parsePurchaseData('broken.xlsx', toBase64Payload(new Uint8Array([1, 2, 3])));
  } catch {
    threw = true;
  }
  check('a broken file is reported as an error', threw);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All purchase-import-from-file checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
