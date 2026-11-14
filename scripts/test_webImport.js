#!/usr/bin/env node
/**
 * The web Inventory file import.
 *
 * The web app posts JSON to /api/rpc (`cloud/web/electron-browser.ts`), so the
 * picked workbook used to reach the main process as a plain object and the
 * import died with:
 *
 *   "The first argument must be of type string or an instance of Buffer, …"
 *
 * This drives the REAL `importProductsFromBuffer` from
 * dist/main/services/export.js against a throwaway database, with the payload
 * transported exactly the way the web transport transports it.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_webImport.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-web-import-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'web-import.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

/** A workbook with two product rows, as an Inventory sheet. */
function buildWorkbook(rows) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'SKU', 'Barcode', 'Cost Price', 'Sale Price', 'Stock Qty', 'Tax %'],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/** EXACTLY what cloud/web/electron-browser.ts does to the IPC arguments. */
function webTransport(value) {
  return JSON.parse(JSON.stringify({ channel: 'excel:importProductsFromData', args: [value] })).args[0];
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const { importProductsFromBuffer } = require('../dist/main/services/export.js');
  const { toBase64Payload } = require('../dist/shared/binaryTransfer.js');

  const productCount = () => Number(db.prepare('SELECT COUNT(*) AS n FROM products').get().n);

  // ── 1. the failure the shop owner hit ──────────────────────────────────────
  console.log('\n=== The old web payload (a plain object) ===');
  const workbook = buildWorkbook([
    ['Web Apple', 'WIA-1', '1112223334445', 60, 100, 12, 0],
    ['Web Mango', 'WIM-1', '5556667778889', 40, 80, 7, 5],
  ]);
  const asWebObject = webTransport(workbook);
  check('the web payload is a plain object', typeof asWebObject === 'object' && !(asWebObject instanceof Uint8Array));

  let oldCodeThrew = false;
  try {
    Buffer.from(asWebObject);
  } catch (e) {
    oldCodeThrew = /first argument must be of type string/i.test(String(e && e.message));
  }
  check('the old Buffer.from(payload) really did throw', oldCodeThrew);

  const res1 = importProductsFromBuffer(asWebObject);
  check('the import reports no errors', res1.errors.length === 0, JSON.stringify(res1.errors));
  check('both rows were inserted', res1.inserted === 2, String(res1.inserted));
  check('the products are really in the database', productCount() === 2, String(productCount()));

  const apple = db.prepare('SELECT * FROM products WHERE sku = ?').get('WIA-1');
  check('the imported product kept its name', !!apple && apple.name === 'Web Apple');
  check('the imported product kept its sale price', !!apple && Number(apple.sale_price) === 100);
  check('the imported product kept its stock', !!apple && Number(apple.stock_qty) === 12);

  // ── 2. the payload the renderer now sends (base64 over JSON) ───────────────
  console.log('\n=== The base64 payload the renderer sends ===');
  const workbook2 = buildWorkbook([
    ['Base64 Pear', 'WIP-1', '9998887776665', 30, 55, 4, 0],
  ]);
  const payload2 = webTransport(toBase64Payload(workbook2));
  check('the base64 payload survives JSON as a string', typeof payload2 === 'string');
  const res2 = importProductsFromBuffer(payload2);
  check('the base64 import reports no errors', res2.errors.length === 0, JSON.stringify(res2.errors));
  check('the base64 import inserted the row', res2.inserted === 1, String(res2.inserted));
  check('the database now holds three products', productCount() === 3, String(productCount()));

  // ── 3. the desktop path is untouched ───────────────────────────────────────
  console.log('\n=== The desktop path (a real Buffer) ===');
  const workbook3 = buildWorkbook([
    ['Desktop Plum', 'WID-1', '1231231231235', 20, 45, 3, 0],
  ]);
  const res3 = importProductsFromBuffer(Buffer.from(workbook3));
  check('the desktop import reports no errors', res3.errors.length === 0, JSON.stringify(res3.errors));
  check('the desktop import inserted the row', res3.inserted === 1, String(res3.inserted));
  check('the database now holds four products', productCount() === 4, String(productCount()));

  // ── 4. a bad file is still reported, not thrown ────────────────────────────
  console.log('\n=== A broken file ===');
  const res4 = importProductsFromBuffer('not a workbook at all');
  check('a broken file is reported as an error', res4.errors.length > 0, JSON.stringify(res4.errors));
  check('a broken file inserts nothing', productCount() === 4, String(productCount()));

  const res5 = importProductsFromBuffer(null);
  check('a missing file is reported as an error', res5.errors.length > 0, JSON.stringify(res5.errors));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All web-import checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
