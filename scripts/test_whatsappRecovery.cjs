/**
 * Unit test for the WhatsApp page-reload recovery helpers.
 * Imports real dist code and asserts every branch.
 */
const {
  isWWebJsLost,
  describeWhatsAppFailure,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/whatsappRecovery.js');

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('=== test_whatsappRecovery ===\n');

// 1. The exact error the shop owner reported.
test('the reported getChat error is recognised as a lost injection', () => {
  const msg =
    "Cannot read properties of undefined (reading 'getChat')";
  assert(isWWebJsLost(msg) === true);
});

test('the getChatId variant is recognised', () => {
  assert(isWWebJsLost("Cannot read properties of undefined (reading 'getChatId')") === true);
});

test('a WWebJS mention is recognised', () => {
  assert(isWWebJsLost('window.WWebJS is not defined') === true);
});

test('a generic "undefined property" error is recognised', () => {
  assert(isWWebJsLost("Cannot read properties of undefined (reading 'foo')") === true);
});

test('a getMessages variant is recognised', () => {
  assert(isWWebJsLost("Cannot read properties of undefined (reading 'getMessages')") === true);
});

// 2. Errors that are NOT a lost injection.
test('an unrelated error is not treated as a lost injection', () => {
  assert(isWWebJsLost('Invalid phone number.') === false);
});

test('a network error is not treated as a lost injection', () => {
  assert(isWWebJsLost('connect ECONNREFUSED 127.0.0.1:443') === false);
});

test('an empty message is not treated as a lost injection', () => {
  assert(isWWebJsLost('') === false);
});

test('a null-ish message is not treated as a lost injection', () => {
  assert(isWWebJsLost('undefined') === false);
});

// 3. The message the owner actually sees.
test('a lost injection produces an actionable message', () => {
  const out = describeWhatsAppFailure("Cannot read properties of undefined (reading 'getChat')");
  assert(out.includes('Reconnect'), 'should tell the owner to reconnect');
  assert(out.includes('linked'), 'should say WhatsApp stays linked');
  assert(!out.includes('getChat'), 'should not leak the raw JS error');
});

test('an invalid phone number keeps its own message', () => {
  assert(describeWhatsAppFailure('Invalid phone number.') === 'Invalid phone number.');
});

test('a network error produces a plain-English message', () => {
  const out = describeWhatsAppFailure('connect ECONNREFUSED 127.0.0.1:443');
  assert(out.includes('internet'), 'should mention the internet');
  assert(!out.includes('ECONNREFUSED'), 'should not leak the raw error');
});

test('a not-connected error points at the QR code', () => {
  const out = describeWhatsAppFailure('WhatsApp not connected.');
  assert(out.includes('QR'), 'should mention the QR code');
});

test('an unknown error is passed through unchanged', () => {
  assert(describeWhatsAppFailure('Something odd happened') === 'Something odd happened');
});

test('an empty error still yields a sentence', () => {
  assert(describeWhatsAppFailure('').length > 0);
});

console.log(`\n=== ${passed} tests passed ===`);