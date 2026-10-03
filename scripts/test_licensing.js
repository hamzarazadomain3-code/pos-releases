#!/usr/bin/env node
/**
 * Licensing test suite.
 *
 * Runs the REAL src/main/services/licensing.ts against a throwaway database with a
 * stubbed licence server, so the assertions cover the shipped code path.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_licensing.js
 *
 * Why this suite exists: the licensing model changed from a 1-year subscription to
 * a perpetual one-time purchase, and three defects were found while making that
 * change. None of them would show up by reading the code, because each one is a
 * case where the code does something that looks correct:
 *
 *   1. `device_id` was never sent, so the server's max_devices check was dead code
 *      and one key validated from unlimited machines. With no expiry left, that
 *      would have made a perpetual licence trivially shareable.
 *   2. A server rejection (revoked / expired) was thrown INSIDE the try block whose
 *      catch said "network error", so it was swallowed and the shop carried on
 *      billing. Revocation is the only kill switch a perpetual licence has.
 *   3. ensureLicenseValidSync() returns early for a lifetime key, so a revocation
 *      learned at startup was never enforced per sale.
 *
 * The device limit is a server-side rule, so it is re-implemented here as the
 * stub server's own logic and asserted against the client. That keeps the test
 * honest about which side owns the rule.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// Electron treats the script's folder as the app root, which would send db.ts
// looking for `scripts/migrations`. Point both back at the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-licensing-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'licensing-test.db');

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

async function throws(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Stub licence server. Owns the device limit and the revocation flag, exactly as
 * license-server/server.js does, and records what the client actually sent.
 */
function makeServer(row) {
  const state = {
    row: { revoked: 0, lifetime: 0, max_devices: 5, activated_devices: '[]', ...row },
    lastPayload: null,
    calls: 0,
  };
  state.handler = async (url, init) => {
    state.calls++;
    const payload = JSON.parse(init.body);
    state.lastPayload = payload;
    const r = state.row;
    const fail = (msg) => ({ ok: false, msg, lifetime: Number(r.lifetime) === 1 });
    if (payload.key !== 'TEST-KEY' || payload.shop !== 'Test Shop') return fail('Invalid key');
    if (r.revoked === 1) return fail('Revoked');
    if (Number(r.lifetime) !== 1 && new Date() > new Date(r.expires_at)) return fail('Expired');
    // Mirrors server.js: device_id is mandatory.
    if (!payload.device_id) return fail('device_id required');
    let activated = JSON.parse(r.activated_devices || '[]');
    if (!activated.includes(payload.device_id)) {
      if (activated.length >= r.max_devices) return fail('Device limit reached');
      activated.push(payload.device_id);
      r.activated_devices = JSON.stringify(activated);
    }
    return {
      ok: true,
      expires: Number(r.lifetime) === 1 ? null : r.expires_at,
      lifetime: Number(r.lifetime) === 1,
      max_devices: r.max_devices,
    };
  };
  return state;
}

/** Offline: every request fails the way a shop with no internet sees it. */
function makeOfflineServer() {
  return async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
}

function setSettings(settings, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) settings.setSetting(k, '');
    else settings.setSetting(k, String(v));
  }
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const licensing = require('../dist/main/services/licensing.js');
  const settings = require('../dist/main/services/settings.js');
  const { getDeviceId } = require('../dist/main/services/recovery.js');

  await initDatabase();

  console.log('=== Rokar POS -- Licensing Test Suite ===');
  console.log(`db: ${process.env.POS_DB_PATH}`);
  console.log(`device: ${getDeviceId()}`);

  const HOUR = 60 * 60 * 1000;
  const past = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
  const future = new Date(Date.now() + 300 * 24 * HOUR).toISOString();
  const realFetch = globalThis.fetch;

  // ---------------------------------------------------------------- 1
  section('device_id is actually sent (the dead max_devices check)');
  {
    const server = makeServer({ lifetime: 1 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, {
      license_key: 'TEST-KEY',
      shop_name: 'Test Shop',
      license_expires: '',
      license_lifetime: null,
      license_revoked: null,
      license_last_check: 0,
    });
    await licensing.activateLicense('TEST-KEY');
    check('activateLicense sent a device_id', !!server.lastPayload.device_id, server.lastPayload.device_id);
    check(
      'the device_id is the stable per-install UUID',
      server.lastPayload.device_id === getDeviceId(),
    );
    check(
      'a perpetual licence stores NO expiry date',
      settings.getSetting('license_expires') === '',
      `license_expires=${JSON.stringify(settings.getSetting('license_expires'))}`,
    );
    check('and is flagged as lifetime', settings.getSetting('license_lifetime') === '1');
  }

  // ---------------------------------------------------------------- 2
  section('a perpetual licence never blocks a sale, however far in the past');
  {
    // Expired in the past AND flagged lifetime: the flag must win, because the
    // server would never send both, but a stale settings row could.
    setSettings(settings, { license_lifetime: '1', license_expires: past, license_revoked: null });
    check(
      'ensureLicenseValidSync allows billing',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );
    await checkLicensePasses(licensing, settings, server => {
      // No network: a perpetual licence must not need it to be valid.
      globalThis.fetch = makeOfflineServer();
    }, 'checkLicense passes with the network down');
  }

  // ---------------------------------------------------------------- 3
  section('a dated licence still expires, with the 15-day grace period');
  {
    // 5 days past expiry -> inside grace, still allowed.
    setSettings(settings, {
      license_lifetime: '0',
      license_expires: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
      license_revoked: null,
      license_last_check: Date.now().toString(),
    });
    check(
      '5 days past expiry is inside the grace period',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );

    // 20 days past expiry -> grace over, blocked.
    setSettings(settings, { license_expires: new Date(Date.now() - 20 * 24 * HOUR).toISOString() });
    const msg = await throws(async () => licensing.ensureLicenseValidSync());
    check('20 days past expiry blocks the sale', !!msg && /expired/i.test(msg), msg || 'no error');

    // Still inside its date -> allowed.
    setSettings(settings, { license_expires: future });
    check(
      'a licence inside its date is allowed',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );
  }

  // ---------------------------------------------------------------- 4
  section('a server rejection is NOT swallowed as a network error');
  {
    // The regression: this used to be thrown inside the network try/catch.
    const server = makeServer({ revoked: 1, lifetime: 1 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, {
      license_key: 'TEST-KEY',
      shop_name: 'Test Shop',
      license_lifetime: null,
      license_revoked: null,
      license_last_check: 0,
    });
    const msg = await throws(() => licensing.checkLicense());
    check('checkLicense surfaces a revocation', !!msg && /revoked/i.test(msg), msg || 'no error');
    check(
      'and records it so the per-sale check can enforce it',
      settings.getSetting('license_revoked') === '1',
    );
    const saleMsg = await throws(async () => licensing.ensureLicenseValidSync());
    check(
      'a revoked perpetual licence blocks the next sale',
      !!saleMsg && /revoked/i.test(saleMsg),
      saleMsg || 'no error',
    );
  }

  // ---------------------------------------------------------------- 5
  section('an expired server response still blocks, even when offline-friendly');
  {
    const server = makeServer({ lifetime: 0, expires_at: past });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, { license_revoked: null, license_lifetime: null, license_last_check: 0 });
    const msg = await throws(() => licensing.checkLicense());
    check('checkLicense surfaces an expiry', !!msg && /expired/i.test(msg), msg || 'no error');
    // A network failure must still be tolerated.
    globalThis.fetch = makeOfflineServer();
    setSettings(settings, {
      license_key: 'TEST-KEY',
      license_lifetime: '0',
      license_expires: future,
      license_last_check: 0,
    });
    const offlineMsg = await throws(() => licensing.checkLicense());
    check('a genuine network failure is tolerated', offlineMsg === null, offlineMsg || 'no error');
  }

  // ---------------------------------------------------------------- 6
  section('re-activation clears a previous revocation');
  {
    const server = makeServer({ lifetime: 1, revoked: 0 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, { license_revoked: '1', license_last_check: 0 });
    await licensing.activateLicense('TEST-KEY');
    check('license_revoked is cleared', settings.getSetting('license_revoked') === '0');
    check(
      'and the shop can bill again',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );
  }

  // ---------------------------------------------------------------- 7
  section('the device limit is enforced across repeated validations');
  {
    const server = makeServer({ lifetime: 1, max_devices: 2 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, {
      license_key: 'TEST-KEY',
      shop_name: 'Test Shop',
      license_expires: '',
      license_lifetime: '1',
      license_revoked: null,
      license_last_check: 0,
    });
    // Simulate two other PCs having activated first.
    server.row.activated_devices = JSON.stringify(['other-pc-1', 'other-pc-2']);
    const msg = await throws(() => licensing.checkLicense());
    check(
      'a third PC is refused when max_devices is 2',
      !!msg && /device limit/i.test(msg),
      msg || 'no error',
    );
    server.row.max_devices = 5;
    check(
      'and is accepted once the limit allows it',
      (await throws(() => licensing.checkLicense())) === null,
    );
    check(
      'the device was recorded by the server',
      JSON.parse(server.row.activated_devices).includes(getDeviceId()),
    );
  }

  globalThis.fetch = realFetch;
  return { checks, failures };
}

/** Small helper so section 2 can assert an async call passes. */
async function checkLicensePasses(licensing, settings, setupFetch, name) {
  setupFetch();
  const msg = await throws(() => licensing.checkLicense());
  check(name, msg === null, msg || 'no error');
}

run()
  .then(({ checks, failures }) => {
    console.log(`\n${failures === 0 ? 'ALL LICENSING CHECKS PASSED' : 'LICENSING CHECKS FAILED'}`);
    console.log(`${checks - failures}/${checks} passed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('SUITE ERROR:', e);
    process.exit(1);
  });