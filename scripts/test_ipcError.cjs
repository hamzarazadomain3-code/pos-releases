#!/usr/bin/env node
/**
 * Phase 0 item 0.2 — IPC error boundary.
 *
 * Proves three things without booting Electron:
 *   1. expected validation errors are classified as user errors and reach the
 *      renderer unchanged (the UI already shows `err.message`),
 *   2. internal faults (SQLite / TypeError / network) become a friendly
 *      bilingual message carrying a short error id, with the original error
 *      attached as `cause` and written to the log,
 *   3. success values pass through untouched (sync, async, null, object).
 *
 * Run: npm run test:ipcError
 */
const path = require('path');

const {
  isInternalIpcError,
  newErrorId,
  friendlyIpcMessage,
  wrapIpcHandler,
} = require(path.resolve(__dirname, '..', 'dist', 'main', 'ipcError.js'));

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
}

async function expectReject(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

async function run() {
  console.log('=== classification: expected user errors pass through ===');
  const userErrors = [
    'Insufficient stock: Widget (2 available)',
    'Expired items: Juice',
    'No open shift - please open a shift before billing',
    'Below cost items: Widget',
    'Expired stock needs a manager approval',
    'License expired — grace period over',
    'Unpaid balance requires a customer (Udhaar)',
    'Customer not found',
  ];
  for (const message of userErrors) {
    check(`user error kept: "${message}"`, isInternalIpcError(new Error(message)) === false);
  }

  console.log('\n=== classification: defects become friendly errors ===');
  const internal = [
    Object.assign(new Error('UNIQUE constraint failed: users.username'), { code: 'ERR_SQLITE_ERROR' }),
    new Error('no such column: si.price'),
    new TypeError('Cannot read properties of undefined (reading id)'),
    new ReferenceError('foo is not defined'),
    new Error('fetch failed'),
    new Error(''),
  ];
  for (const err of internal) {
    check(`internal: ${err.name}: ${err.message || '(empty)'}`, isInternalIpcError(err) === true);
  }
  check('non-Error throw is internal', isInternalIpcError('boom') === true);
  check('null throw is internal', isInternalIpcError(null) === true);

  console.log('\n=== error id + bilingual message ===');
  const fixed = new Date('2026-11-26T09:08:07.123Z');
  const id = newErrorId(fixed, () => 0.5);
  check('id format E-YYMMDDHHMMSS-XXXX', /^E-\d{12}-[A-Z0-9]{4}$/.test(id), id);
  check('id embeds the timestamp', id.startsWith('E-261126090807'), id);
  const id2 = newErrorId(fixed, () => 0.9);
  check('random suffix changes the id', id !== id2, `${id} vs ${id2}`);
  const msg = friendlyIpcMessage(id);
  check('friendly message contains the id', msg.includes(id));
  check('friendly message is English', msg.includes('Something went wrong'));
  check('friendly message is Urdu', msg.includes('کچھ غلط ہو گیا'));

  console.log('\n=== wrapper: success shapes unchanged ===');
  const wrappedSync = wrapIpcHandler('test:sync', (_e, a, b) => a + b, {
    log: () => { throw new Error('log should not run'); },
  });
  check('sync number passes through', (await wrappedSync({}, 2, 3)) === 5);

  const obj = { ok: true, rows: [1, 2, 3] };
  const wrappedObj = wrapIpcHandler('test:obj', async () => obj, { log: () => {} });
  const got = await wrappedObj({});
  check('async object passes through (same reference)', got === obj);

  const wrappedNull = wrapIpcHandler('test:null', () => null, { log: () => {} });
  check('null passes through', (await wrappedNull({})) === null);

  console.log('\n=== wrapper: user error unchanged, no id ===');
  const user = new Error('Insufficient stock: Widget (2 available)');
  const wrappedUser = wrapIpcHandler('sales:create', () => { throw user; }, {
    log: () => { throw new Error('user errors must not be logged as defects'); },
  });
  const rejectedUser = await expectReject(wrappedUser({}));
  check('user error is rethrown', rejectedUser !== null);
  check('user error keeps its message', rejectedUser?.message === user.message, rejectedUser?.message);
  check('user error has no errorId', !rejectedUser?.errorId);

  console.log('\n=== wrapper: internal error logged + friendly ===');
  const original = new TypeError('Cannot read properties of undefined (reading sale)');
  const logs = [];
  const wrappedInternal = wrapIpcHandler('reports:profitability', () => { throw original; }, {
    log: (context, err) => logs.push({ context, err }),
    makeId: () => 'E-261126090807-TEST',
  });
  const rejected = await expectReject(wrappedInternal({}));
  check('internal error is rethrown', rejected !== null);
  check('friendly message carries the id', rejected?.message.includes('E-261126090807-TEST'), rejected?.message);
  check('friendly message does not leak the stack/message', !rejected?.message.includes('Cannot read propert'));
  check('errorId property is attached', rejected?.errorId === 'E-261126090807-TEST');
  check('original error is kept as cause', rejected?.cause === original);
  check('error name marks the boundary', rejected?.name === 'IpcError', rejected?.name);
  check('log called exactly once', logs.length === 1, String(logs.length));
  check('log context names the channel + id', logs[0]?.context === 'ipc reports:profitability [E-261126090807-TEST]', logs[0]?.context);
  check('log receives the original error', logs[0]?.err === original);

  console.log('\n=== wrapper: a broken logger cannot mask the error ===');
  const wrappedBrokenLog = wrapIpcHandler('x:y', () => { throw new Error('SQLITE_BUSY: database is locked'); }, {
    log: () => { throw new Error('disk full'); },
    makeId: () => 'E-261126090807-LOG0',
  });
  const rejectedBroken = await expectReject(wrappedBrokenLog({}));
  check('error still becomes friendly when the log throws', rejectedBroken?.errorId === 'E-261126090807-LOG0');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('All IPC error-boundary checks passed.');
}

run().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
