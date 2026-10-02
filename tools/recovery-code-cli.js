#!/usr/bin/env node
/**
 * Rokar POS — Support Recovery code generator (developer tool).
 *
 * Generates the one-time code a client types into
 * "Support Recovery" (Ctrl+Shift+Alt+R on the login screen).
 *
 * This file is NOT packaged into the shipped app — `build.files` in
 * package.json only includes dist/**, package.json and scripts/smoke.js.
 *
 * Usage:
 *   node tools/recovery-code-cli.js <device-id> [request-number] [owner-username]
 *   node tools/recovery-code-cli.js            (interactive)
 *
 * The client reads three values off their Support Recovery screen: the Device
 * ID, the Request number, and the Owner name. The request number increments each
 * time a code is used, so every code is single-use and the next one is always
 * well-defined. The owner username defaults to "admin" (created by migration 011).
 */
const crypto = require('node:crypto');

/**
 * The HMAC secret is read from ROKAR_SUPPORT_KEY (env var, or the repo's
 * gitignored .env file). It is deliberately NOT hardcoded here — this
 * repository is PUBLIC, and a committed key would let anyone mint a valid
 * recovery code for any shop.
 */
const fs = require('node:fs');
const path = require('node:path');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function resolveKeyHex() {
  return (
    process.env.ROKAR_SUPPORT_KEY ||
    readEnvFile(path.resolve(__dirname, '..', '.env')).ROKAR_SUPPORT_KEY ||
    ''
  )
    .trim()
    .toLowerCase();
}

/**
 * Resolved lazily and memoised: scripts/test_recovery.js requires this module
 * for parity checks, so a missing key must not exit the process at import time.
 */
let _key = null;
function supportKey() {
  if (_key) return _key;
  const hex = resolveKeyHex();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      'ROKAR_SUPPORT_KEY is missing or invalid. Add it to .env as 64 hex characters, e.g.\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  _key = Buffer.from(hex, 'hex');
  return _key;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

const normalizeDeviceId = (v) => String(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

function encodeCode(digest) {
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + digest[i];
  let chars = '';
  for (let i = 7; i >= 0; i--) chars += ALPHABET[(n >>> (5 * i)) & 31];
  return chars;
}

function computeSupportCode(deviceId, ownerUsername, epoch) {
  const n = Math.max(0, Math.trunc(Number(epoch) || 0));
  const message =
    `rokar-recover-v1|${normalizeDeviceId(deviceId)}|` + `${String(ownerUsername).trim()}|${n}`;
  const digest = crypto.createHmac('sha256', supportKey()).update(message, 'utf8').digest();
  const chars = encodeCode(digest);
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function prompt(question) {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  try {
    supportKey(); // fail fast with a readable message if the secret is missing
  } catch (e) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }

  let deviceId = process.argv[2];
  let epoch = process.argv[3];
  let owner = process.argv[4] || 'admin';

  if (!deviceId) {
    console.log('Rokar POS — Support Recovery code generator\n');
    deviceId = await prompt("Device ID (from the client's Support Recovery screen): ");
    if (!deviceId) {
      console.error('Device ID is required.');
      process.exit(1);
    }
    epoch = await prompt('Request number (also shown on their screen): ');
    owner = (await prompt('Owner username [admin]: ')) || 'admin';
  }

  if (epoch === undefined || epoch === '') epoch = '0';
  const code = computeSupportCode(deviceId, owner, epoch);

  console.log('\n  ────────────────────────────────────────');
  console.log(`  Device    : ${normalizeDeviceId(deviceId)}`);
  console.log(`  Owner     : ${owner}`);
  console.log(`  Request # : ${epoch}`);
  console.log(`  CODE      : ${code}`);
  console.log('  ────────────────────────────────────────');
  console.log('  Read the code to the client. It works ONCE only.');
  console.log('  After they use it, their Request number goes up by 1,');
  console.log('  so always read their current number before generating.\n');
}

// Only run the CLI when invoked directly — scripts/test_recovery.js requires
// this file for computeSupportCode() parity checks and must not be prompted.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { computeSupportCode, normalizeDeviceId, ALPHABET };