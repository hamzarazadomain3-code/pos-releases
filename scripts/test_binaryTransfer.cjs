/**
 * The web file-transfer transport.
 *
 * Imports the REAL compiled code (dist/shared/binaryTransfer.js) and checks the
 * rules that keep a picked file intact when it crosses the **web** transport:
 * `cloud/web/electron-browser.ts` posts `JSON.stringify({ channel, args })` to
 * /api/rpc, so a `Uint8Array` arrives on the server as a plain object
 * (`{"0":72,"1":105,...}`) — which is what made the Inventory import die with
 *
 *   "The first argument must be of type string or an instance of Buffer, …"
 *
 * Run with: npm run test:binaryTransfer
 */
const path = require('path');

const {
  BASE64_PREFIX,
  encodeBytesToBase64,
  decodeBase64ToBytes,
  toBase64Payload,
  normalizeBinaryPayload,
  fileBytesFromResult,
} = require(path.join(__dirname, '..', 'dist', 'shared', 'binaryTransfer.js'));

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function bytesOf(text) {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

console.log('=== test_binaryTransfer (web file transfer) ===');

// ── base64 codec ─────────────────────────────────────────────────────────────
check('an empty buffer encodes to an empty string', encodeBytesToBase64(new Uint8Array(0)) === '');
check('one byte encodes to two chars + "=="', encodeBytesToBase64(bytesOf('M')) === 'TQ==');
check('two bytes encode to three chars + "="', encodeBytesToBase64(bytesOf('Ma')) === 'TWE=');
check('three bytes encode to four chars', encodeBytesToBase64(bytesOf('Man')) === 'TWFu');
check('"Hello" encodes to the RFC 4648 value', encodeBytesToBase64(bytesOf('Hello')) === 'SGVsbG8=');
check('"Hello" decodes back', decodeBase64ToBytes('SGVsbG8=')?.length === 5);
check('text that is not base64 is rejected', decodeBase64ToBytes('not base64!!') === null);

let roundTripOk = true;
for (let len = 0; len <= 300; len++) {
  const src = new Uint8Array(len);
  for (let i = 0; i < len; i++) src[i] = (i * 37 + len * 11) & 0xff;
  if (!sameBytes(decodeBase64ToBytes(encodeBytesToBase64(src)), src)) roundTripOk = false;
}
check('every length from 0 to 300 bytes round-trips', roundTripOk);
check('a 1000-byte file round-trips', sameBytes(
  decodeBase64ToBytes(encodeBytesToBase64(new Uint8Array(1000).fill(7))),
  new Uint8Array(1000).fill(7)
));

// ── the payload the renderer sends ───────────────────────────────────────────
const sample = bytesOf('Rokar POS inventory workbook');
const payload = toBase64Payload(sample);
check('the payload carries the base64 prefix', payload.startsWith(BASE64_PREFIX));
check('the payload decodes to the original bytes', sameBytes(decodeBase64ToBytes(payload.slice(BASE64_PREFIX.length)), sample));
check('a payload survives JSON untouched', JSON.parse(JSON.stringify(payload)) === payload);

// ── normalising whatever the transport delivered ─────────────────────────────
check('a Uint8Array passes through', sameBytes(normalizeBinaryPayload(sample), sample));
check('a Buffer passes through', sameBytes(normalizeBinaryPayload(Buffer.from(sample)), sample));
check('an ArrayBuffer passes through', sameBytes(normalizeBinaryPayload(sample.buffer.slice(0)), sample));
check(
  'a typed-array view passes through',
  sameBytes(normalizeBinaryPayload(new Uint8Array(sample.buffer, 0, sample.length)), sample)
);
check('a base64 payload decodes', sameBytes(normalizeBinaryPayload(payload), sample));
check('a number array becomes bytes', sameBytes(normalizeBinaryPayload([1, 2, 3]), new Uint8Array([1, 2, 3])));

// THE web failure: JSON.stringify turns a Uint8Array into a plain object.
const asWebObject = JSON.parse(JSON.stringify(sample));
check('the web payload really is a plain object', typeof asWebObject === 'object' && !(asWebObject instanceof Uint8Array));
check('the web payload normalises back to the original bytes', sameBytes(normalizeBinaryPayload(asWebObject), sample));

// A Node Buffer stringifies to { type: 'Buffer', data: [...] }.
const asBufferObject = JSON.parse(JSON.stringify(Buffer.from(sample)));
check('the web payload for a Buffer carries type "Buffer"', asBufferObject.type === 'Buffer');
check('the web payload for a Buffer normalises back', sameBytes(normalizeBinaryPayload(asBufferObject), sample));

check('null is not a payload', normalizeBinaryPayload(null) === null);
check('undefined is not a payload', normalizeBinaryPayload(undefined) === null);
check('a boolean is not a payload', normalizeBinaryPayload(true) === null);
check('an empty object is zero bytes', normalizeBinaryPayload({}).length === 0);

// ── the result of a file export ──────────────────────────────────────────────
check('"true" (the desktop wrote the file) carries no bytes', fileBytesFromResult(true) === null);
check('a file path carries no bytes', fileBytesFromResult('C:\\Users\\shop\\products.xlsx') === null);
check('a base64 payload carries bytes', sameBytes(fileBytesFromResult(payload), sample));
check('raw bytes carry bytes', sameBytes(fileBytesFromResult(sample), sample));
check('the web export result carries bytes', sameBytes(fileBytesFromResult(JSON.parse(JSON.stringify(payload))), sample));

// ── a real workbook survives the whole trip ──────────────────────────────────
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['Name', 'Sale Price', 'Stock Qty'],
  ['Web Apple', 100, 12],
  ['Web Mango', 80, 7],
]);
XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
const workbook = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const transported = JSON.parse(JSON.stringify(workbook));
const recovered = normalizeBinaryPayload(transported);
check('the workbook bytes survive the web transport', sameBytes(recovered, workbook));
if (recovered) {
  const back = XLSX.read(recovered, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true });
  check('the recovered workbook still has its header row', rows[0][0] === 'Name');
  check('the recovered workbook still has its first product', rows[1][0] === 'Web Apple');
  check('the recovered workbook still has its price', Number(rows[1][1]) === 100);
}

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
