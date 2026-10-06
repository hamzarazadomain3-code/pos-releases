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
    row: { revoked: 0, lifetime: 0, trial: 0, max_devices: 5, activated_devices: '[]', ...row },
    lastPayload: null,
    calls: 0,
  };
  state.handler = async (url, init) => {
    state.calls++;
    const payload = JSON.parse(init.body);
    state.lastPayload = payload;
    const r = state.row;
    // Mirrors server.js: `trial` is echoed on every response, including failures,
    // because the client needs it to tell a trial from a paid licence before it
    // decides whether to apply the grace period.
    const fail = (msg) => ({
      ok: false,
      msg,
      lifetime: Number(r.lifetime) === 1,
      trial: Number(r.trial) === 1,
    });
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
      trial: Number(r.trial) === 1,
      max_devices: r.max_devices,
    };
  };
  return state;
}

/**
 * Stub for POST /api/trial.
 *
 * Mirrors the one property that makes the trial honest: the start date is a property
 * of the DEVICE, not of the request, so asking again returns the original trial
 * rather than a fresh one. `state.startedAt` is set once and never moves, which is
 * exactly how license-server's `trial_devices` table behaves.
 */
function makeTrialServer(opts = {}) {
  // Computed before `state` exists: referencing state.startedAt inside its own
  // object literal is a TDZ error, which is exactly what happened the first time.
  const startedAt = opts.startedAt || new Date().toISOString();
  const state = {
    startedAt,
    requests: 0,
    // The window the server hands back. Defaults to the full trial from `startedAt`.
    serverExpiresAt:
      opts.serverExpiresAt ||
      new Date(new Date(startedAt).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    issuedKey: 'TRIAL-TEST_SHOP-ABCDEF0123456789',
    lastPayload: null,
  };
  state.handler = async (url, init) => {
    state.requests++;
    const payload = JSON.parse(init.body);
    state.lastPayload = payload;
    if (!payload.shop || !payload.device_id) return { ok: false, msg: 'shop and device_id required' };
    return {
      ok: true,
      key: state.issuedKey,
      trial_start: state.startedAt,
      expires: state.serverExpiresAt,
      days_total: 15,
      // Every request after the first is a reinstall, and gets the ORIGINAL date.
      reused: state.requests > 1,
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

  // ---------------------------------------------------------------- 8
  section('an install with no licence and no trial cannot bill (the hole the trial closes)');
  {
    // This is the state a fresh download lands in: no key, no expiry, no trial.
    // It used to sail straight through `if (!expiresStr) return; // assume OK`, so
    // an unlicensed shop rang up sales indefinitely for free.
    setSettings(settings, {
      license_key: null,
      license_expires: null,
      license_lifetime: null,
      license_revoked: null,
      license_trial: null,
      license_trial_started: null,
      license_trial_expires: null,
      license_trial_offline: null,
      license_last_check: 0,
    });
    const msg = await throws(async () => licensing.ensureLicenseValidSync());
    check('a sale is refused with no licence and no trial', !!msg, msg || 'no error');
    check(
      'and the message points at the trial or the key',
      !!msg && (/trial/i.test(msg) && /licence key|license key/i.test(msg)),
      msg || 'no error',
    );
  }

  // ---------------------------------------------------------------- 9
  section('a fresh install starts a trial on its own, with no setup step');
  {
    setSettings(settings, {
      license_key: null,
      license_expires: null,
      license_lifetime: null,
      license_revoked: null,
      license_trial: null,
      license_trial_started: null,
      license_trial_expires: null,
      license_trial_offline: null,
      shop_name: 'Test Shop',
      license_last_check: 0,
    });
    const trialSrv = makeTrialServer();
    globalThis.fetch = async (url, init) => ({ json: async () => trialSrv.handler(url, init) });

    const msg = await throws(() => licensing.checkLicense());
    check('the first run does NOT throw', msg === null, msg || 'no error');
    check('a trial was started', settings.getSetting('license_trial') === '1');
    check('the trial asked the server for a key', trialSrv.requests === 1, `${trialSrv.requests} requests`);
    check(
      'and sent the device id, which is what makes one-trial-per-device work',
      trialSrv.lastPayload?.device_id === getDeviceId(),
      trialSrv.lastPayload?.device_id,
    );
    check(
      'the server-issued trial key was stored',
      settings.getSetting('license_key') === trialSrv.issuedKey,
      settings.getSetting('license_key'),
    );
    check(
      'the countdown is anchored to the server, not a local guess',
      settings.getSetting('license_trial_offline') === '0',
    );
    check('and the trial can bill', (await throws(async () => licensing.ensureLicenseValidSync())) === null);

    const status = licensing.trialStatus();
    check('trialStatus reports a 15-day trial', status.totalDays === 15, String(status.totalDays));
    check(
      'with 15 days left on day one',
      status.daysLeft === 15,
      `daysLeft=${status.daysLeft}`,
    );
    check('and says it is server-anchored', status.serverAnchored === true);
  }

  // ---------------------------------------------------------------- 10
  section('a trial gets NO grace period (otherwise "15 days" would mean 30)');
  {
    // Expired one day ago. The paid path forgives this for another 15 days, so the
    // only thing that can catch it is the trial branch being consulted separately.
    setSettings(settings, {
      license_key: 'TRIAL-TEST_SHOP-ABCDEF0123456789',
      license_trial: '1',
      license_trial_offline: '0',
      license_trial_started: new Date(Date.now() - 16 * 24 * HOUR).toISOString(),
      license_trial_expires: new Date(Date.now() - 1 * 24 * HOUR).toISOString(),
      license_expires: new Date(Date.now() - 1 * 24 * HOUR).toISOString(),
      license_lifetime: '0',
      license_revoked: null,
      license_last_check: 0,
    });
    // Network down: proves the refusal is local, not just a server rejection.
    globalThis.fetch = makeOfflineServer();
    const msg = await throws(async () => licensing.ensureLicenseValidSync());
    check('a trial one day past its end blocks the sale', !!msg, msg || 'no error');
    check(
      'it is not softened by the 15-day grace a paid licence gets',
      !!msg && !/grace/i.test(msg),
      msg || 'no error',
    );
    check('and the countdown reads zero', licensing.trialDaysLeft() === 0);
  }

  // ---------------------------------------------------------------- 11
  section('reinstalling does not buy a second trial');
  {
    // The server remembers this device used its trial 20 days ago. A reinstall wipes
    // every local setting, so only the server can catch the reset.
    const trialSrv = makeTrialServer({ startedAt: new Date(Date.now() - 20 * 24 * HOUR).toISOString() });
    globalThis.fetch = async (url, init) => ({ json: async () => trialSrv.handler(url, init) });
    setSettings(settings, {
      license_key: null,
      license_expires: null,
      license_lifetime: null,
      license_revoked: null,
      license_trial: null,
      license_trial_started: null,
      license_trial_expires: null,
      license_trial_offline: null,
      shop_name: 'Test Shop',
      license_last_check: 0,
    });

    const msg = await throws(() => licensing.checkLicense());
    check('the reinstalled app is refused', !!msg, msg || 'no error');
    check(
      'the server-anchored date overrode the fresh local one',
      settings.getSetting('license_trial_expires') === trialSrv.serverExpiresAt,
      settings.getSetting('license_trial_expires'),
    );
    check(
      'and the sale is blocked too',
      !!(await throws(async () => licensing.ensureLicenseValidSync())),
    );
  }

  // ---------------------------------------------------------------- 12
  section('the server can shorten a trial but never lengthen one');
  {
    // Local estimate says 15 days from now; the server says it started 10 days ago.
    const trialSrv = makeTrialServer({ startedAt: new Date(Date.now() - 10 * 24 * HOUR).toISOString() });
    globalThis.fetch = async (url, init) => ({ json: async () => trialSrv.handler(url, init) });
    setSettings(settings, {
      license_key: null,
      license_trial: null,
      license_trial_started: null,
      license_trial_expires: null,
      license_trial_offline: null,
      license_lifetime: null,
      license_revoked: null,
      shop_name: 'Test Shop',
      license_last_check: 0,
    });
    await licensing.checkLicense();
    check(
      'the shorter server date wins',
      settings.getSetting('license_trial_expires') === trialSrv.serverExpiresAt,
      settings.getSetting('license_trial_expires'),
    );
    check('leaving 5 days, not 15', licensing.trialDaysLeft() === 5, `${licensing.trialDaysLeft()}`);

    // Now the reverse: a server that somehow claims MORE time must be ignored, or the
    // trial could be extended forever by a bad response.
    const greedy = makeTrialServer({
      startedAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
      serverExpiresAt: new Date(Date.now() + 45 * 24 * HOUR).toISOString(),
    });
    globalThis.fetch = async (url, init) => ({ json: async () => greedy.handler(url, init) });
    const localExpiry = new Date(Date.now() + 5 * 24 * HOUR).toISOString();
    setSettings(settings, {
      license_key: null,
      license_trial: '1',
      license_trial_offline: '1',
      license_trial_started: new Date(Date.now() - 10 * 24 * HOUR).toISOString(),
      license_trial_expires: localExpiry,
    });
    await licensing.checkLicense();
    check(
      'a longer server date is refused; the local countdown stands',
      settings.getSetting('license_trial_expires') === localExpiry,
      settings.getSetting('license_trial_expires'),
    );
  }

  // ---------------------------------------------------------------- 13
  section('an offline first run still gets its 15 days');
  {
    // A shop with no internet on install day must not be locked out of its own trial.
    globalThis.fetch = makeOfflineServer();
    setSettings(settings, {
      license_key: null,
      license_expires: null,
      license_lifetime: null,
      license_revoked: null,
      license_trial: null,
      license_trial_started: null,
      license_trial_expires: null,
      license_trial_offline: null,
      shop_name: 'Test Shop',
      license_last_check: 0,
    });
    const msg = await throws(() => licensing.checkLicense());
    check('no network does not throw at startup', msg === null, msg || 'no error');
    check('a local trial was written', settings.getSetting('license_trial') === '1');
    check(
      'and is flagged as not yet server-anchored',
      settings.getSetting('license_trial_offline') === '1',
    );
    check('the shop can bill during it', (await throws(async () => licensing.ensureLicenseValidSync())) === null);
    check('and the UI is told the countdown is unconfirmed', licensing.trialStatus().serverAnchored === false);

    // Once online, it registers and becomes anchored.
    const trialSrv = makeTrialServer();
    globalThis.fetch = async (url, init) => ({ json: async () => trialSrv.handler(url, init) });
    setSettings(settings, { license_last_check: 0 });
    await licensing.checkLicense();
    check('it anchors on the next online check', settings.getSetting('license_trial_offline') === '0');
    check('with the server key', settings.getSetting('license_key') === trialSrv.issuedKey);
  }

  // ---------------------------------------------------------------- 14
  section('buying a licence clears the trial, and a trial key stays a trial');
  {
    // The dangerous regression: a shop trials for 15 days, pays, and the stale
    // trial flag keeps blocking their sales forever.
    const server = makeServer({ lifetime: 1, revoked: 0, trial: 0 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, {
      license_trial: '1',
      license_trial_offline: '0',
      license_trial_started: new Date(Date.now() - 20 * 24 * HOUR).toISOString(),
      license_trial_expires: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
      license_lifetime: null,
      license_revoked: null,
      license_last_check: 0,
    });
    await licensing.activateLicense('TEST-KEY');
    check('the trial flag is cleared on a paid key', settings.getSetting('license_trial') === '0');
    check(
      'the stale trial expiry is cleared with it',
      settings.getSetting('license_trial_expires') === '',
      JSON.stringify(settings.getSetting('license_trial_expires')),
    );
    check(
      'so a paying shop is not blocked by an expired trial',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );
    check('and the trial banner is gone', licensing.trialStatus().isTrial === false);

    // And the reverse: a trial key must NOT pick up the paid grace period.
    const trialServer = makeServer({
      lifetime: 0,
      trial: 1,
      expires_at: new Date(Date.now() - 1 * 24 * HOUR).toISOString(),
    });
    globalThis.fetch = async (url, init) => ({ json: async () => trialServer.handler(url, init) });
    setSettings(settings, {
      license_key: null,
      license_trial: '0',
      license_trial_expires: '',
      license_lifetime: null,
      license_revoked: null,
      license_last_check: 0,
    });
    const msg = await throws(() => licensing.activateLicense('TEST-KEY'));
    check('activating an expired trial key is refused', !!msg, msg || 'no error');
  }

  // ---------------------------------------------------------------- 15
  section('a perpetual licence is unaffected by any of the trial machinery');
  {
    // Regression guard: the enforcement added in section 8 must not reach a paying
    // customer. A perpetual key stores an EMPTY expiry, which is exactly the shape
    // that used to look like "no licence" -- so if the new check were ordered before
    // the lifetime shortcut, every perpetual customer would be locked out.
    const server = makeServer({ lifetime: 1, revoked: 0, trial: 0 });
    globalThis.fetch = async (url, init) => ({ json: async () => server.handler(url, init) });
    setSettings(settings, {
      license_key: 'TEST-KEY',
      shop_name: 'Test Shop',
      license_expires: '',
      license_lifetime: '1',
      license_revoked: null,
      license_trial: null,
      license_trial_expires: null,
      license_last_check: 0,
    });
    check(
      'a perpetual licence with an empty expiry still bills',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
    );
    check('and is not reported as a trial', licensing.trialStatus().isTrial === false);

    // Same, but with a leftover trial flag -- a customer who trialled then bought.
    setSettings(settings, { license_trial: '1', license_trial_expires: '' });
    check(
      'the lifetime shortcut wins over a stale trial flag',
      (await throws(async () => licensing.ensureLicenseValidSync())) === null,
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