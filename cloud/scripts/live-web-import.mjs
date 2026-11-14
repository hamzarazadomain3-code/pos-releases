// live-web-import.mjs — proves the Inventory file import works on a LIVE deployment.
//
// The web transport is JSON: `cloud/web/electron-browser.ts` posts
// `JSON.stringify({ channel, args })` to /api/rpc, so the picked workbook reaches
// the Worker as a plain string (base64) — a raw Uint8Array would arrive as a
// plain object and die with "The first argument must be of type string or an
// instance of Buffer, …".
//
// This signs up a throwaway shop on the live worker, sends a real .xlsx through
// /api/rpc exactly the way the browser does, and asserts the products really
// landed in that shop.
//
//   ROKAR_LIVE_BASE=https://rokar-pos.bakery-saas.workers.dev node scripts/live-web-import.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const XLSX = require(path.join(root, '..', 'node_modules', 'xlsx'));

const BASE = (process.env.ROKAR_LIVE_BASE || 'https://rokar-pos.bakery-saas.workers.dev').replace(/\/$/, '');
const SHOP_NAME = `Live Import Check ${Date.now()}`;

let checks = 0;
let failures = 0;
function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

/** The same base64 codec the renderer uses (src/shared/binaryTransfer.ts). */
function toBase64Payload(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[n & 63] : '=';
  }
  return 'base64:' + out;
}

function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'SKU', 'Barcode', 'Cost Price', 'Sale Price', 'Stock Qty', 'Tax %'],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function rpc(token, channel, args) {
  const res = await fetch(BASE + '/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, args }),
  });
  return res.json();
}

async function main() {
  console.log(`=== live web import check @ ${BASE} ===`);

  const signupRes = await fetch(BASE + '/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopName: SHOP_NAME, username: 'admin', password: 'live-import-pass' }),
  });
  const session = await signupRes.json();
  if (!session.ok) {
    console.error('signup failed', session);
    process.exit(1);
  }
  console.log(`[live] shop ${session.shop.slug}`);

  // The first authenticated call opens the Durable Object and runs its
  // migrations, so give it a moment (the same warm-up the web smoke does).
  for (let i = 0; i < 180; i++) {
    const warm = await rpc(session.token, 'auth:currentUser', []);
    if (warm && warm.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // ── the browser's own payload: a base64 string ─────────────────────────────
  const workbook = buildWorkbook([
    ['Live Apple', 'LIA-1', '1234509876543', 60, 100, 12, 0],
    ['Live Mango', 'LIM-1', '3214509876543', 40, 80, 7, 5],
  ]);
  const payload = toBase64Payload(workbook);
  const res = await rpc(session.token, 'excel:importProductsFromData', [payload]);
  check('the rpc call succeeded', res && res.ok === true, JSON.stringify(res && res.error));
  const data = res && res.data ? res.data : {};
  check('the import reports no errors', Array.isArray(data.errors) && data.errors.length === 0, JSON.stringify(data.errors));
  check('both rows were inserted', data.inserted === 2, String(data.inserted));

  // ── the products really are in the shop ────────────────────────────────────
  const list = await rpc(session.token, 'inventory:list', []);
  const products = list && list.ok && Array.isArray(list.data) ? list.data : [];
  check('the inventory now holds the two products', products.length === 2, String(products.length));
  const apple = products.find((p) => p.sku === 'LIA-1');
  check('the imported product kept its name', !!apple && apple.name === 'Live Apple');
  check('the imported product kept its sale price', !!apple && Number(apple.sale_price) === 100);
  check('the imported product kept its stock', !!apple && Number(apple.stock_qty) === 12);

  // ── the old (flattened) payload still works — the server is tolerant ───────
  const second = buildWorkbook([
    ['Live Plum', 'LIP-1', '4564509876543', 20, 45, 3, 0],
  ]);
  const flat = JSON.parse(JSON.stringify(second)); // a plain object, as JSON makes it
  const res2 = await rpc(session.token, 'excel:importProductsFromData', [flat]);
  check('a flattened payload is accepted too', res2 && res2.ok === true, JSON.stringify(res2 && res2.error));
  check('the flattened payload imported its row', res2 && res2.data && res2.data.inserted === 1, JSON.stringify(res2 && res2.data));

  // ── the Excel export comes back as a REAL workbook ─────────────────────────
  const exp = await rpc(session.token, 'excel:exportProducts', [{ search: '', includeInactive: false }]);
  check('the export call succeeded', exp && exp.ok === true, JSON.stringify(exp && exp.error));
  const exportPayload = exp && exp.data;
  check('the export carries a base64 payload', typeof exportPayload === 'string' && exportPayload.startsWith('base64:'));
  if (typeof exportPayload === 'string' && exportPayload.startsWith('base64:')) {
    const bytes = Buffer.from(exportPayload.slice('base64:'.length), 'base64');
    check('the exported file is not empty', bytes.length > 1000, String(bytes.length));
    const back = XLSX.read(bytes, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true });
    check('the exported workbook has its header row', Array.isArray(rows[0]) && rows[0][0] === 'ID');
    check('the exported workbook carries the imported product', rows.some((r) => r[1] === 'Live Apple'));
  }

  // ── the purchase import from a file ───────────────────────────────────────
  const purchaseCsv = [
    'barcode,sku,product name,qty,unit,cost rate,sale price',
    '1110001110001,SKU-1,Rice 5kg,10,Bag,100,120',
    ',SKU-2,Cooking Oil,6,pcs,50,60',
  ].join('\r\n');
  const purchasePayload = toBase64Payload(new Uint8Array(Buffer.from(purchaseCsv, 'utf8')));
  const parsed = await rpc(session.token, 'purchases:importParseData', ['purchases.csv', purchasePayload]);
  check('the purchase import call succeeded', parsed && parsed.ok === true, JSON.stringify(parsed && parsed.error));
  const purchase = parsed && parsed.data ? parsed.data : {};
  check('the purchase file name is kept', purchase.file_name === 'purchases.csv', purchase.file_name);
  check('the purchase header row was found', purchase.header_row === 1, String(purchase.header_row));
  check('both purchase rows were read', Array.isArray(purchase.rows) && purchase.rows.length === 2, JSON.stringify((purchase.rows || []).length));
  check('the purchase row keeps its product name', !!(purchase.rows && purchase.rows[0] && purchase.rows[0].values['product name'] === 'Rice 5kg'), JSON.stringify(purchase.rows && purchase.rows[0]));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('Live web import check: PASS');
}

main().catch((e) => {
  console.error('Live check crashed:', e);
  process.exit(1);
});
