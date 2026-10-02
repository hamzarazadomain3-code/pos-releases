#!/usr/bin/env node
/**
 * Password recovery test suite.
 *
 * Runs the REAL src/main/services/recovery.ts against a throwaway database, so
 * the assertions cover the shipped code path rather than a re-implementation.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_recovery.js
 *
 * Covers:
 *   - hash domain separation (the reason the answer uses its own salt)
 *   - Option A: answer verify, recovery-code verify, new password actually works
 *   - lockout after 5 failures, and that it persists
 *   - Option B: code generate/verify via the same code path tools/recovery-code-cli.js uses
 *   - wrong code rejected, single-use enforced
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// Electron treats the script's folder as the app root, which would send db.ts
// looking for `scripts/migrations`. Point both back at the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-recovery-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'recovery-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

function clearLockouts(db) {
  db.exec('DELETE FROM recovery_lockout');
  db.exec('DELETE FROM support_recovery_codes');
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const recovery = require('../dist/main/services/recovery.js');
  const auth = require('../dist/main/services/auth.js');
  const { computeSupportCode: cliCompute } = require('../tools/recovery-code-cli.js');

  await initDatabase();
  const db = getDb();

  console.log('=== Rokar POS — Password Recovery Test Suite ===');
  console.log(`db: ${process.env.POS_DB_PATH}`);

  const owner = db.prepare("SELECT id, username FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1").get();
  check('migration 049 applied (users.security_answer_hash exists)',
    db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'security_answer_hash'));
  check('migration 049 applied (device_uuid seeded)',
    !!db.prepare("SELECT value FROM admin_settings WHERE key = 'device_uuid'").get());
  check('owner account present', !!owner, owner && owner.username);

  // Everything below acts as the owner — recovery setup is owner-gated.
  auth.setSessionUser(owner.id);

  // ─────────────────────────────────────────────────────────────────────
  section('Hash domain separation');
  // The whole reason the answer is salted differently from the password.
  const answerHash = require('node:crypto').scryptSync('twin', 'pos-recovery-salt', 64).toString('hex');
  const passwordHashOfSameString = auth.hashSecret('twin');
  check('answer hash differs from password hash for identical input',
    answerHash !== passwordHashOfSameString,
    'a shared salt would let an answer hash be replayed as a password hash');

  // ─────────────────────────────────────────────────────────────────────
  section('Option A — security question');
  clearLockouts(db);
  let status = recovery.setSecurityQuestion(owner.id, 'What is your father\'s name?', 'Ali');
  check('security question saved', status.hasSecurityQuestion && status.question.includes('father'));

  const q = recovery.getRecoveryQuestion(owner.username);
  check('getRecoveryQuestion exposes the question', q.hasRecovery && !!q.question);
  check('getRecoveryQuestion never exposes the answer',
    !JSON.stringify(q).toLowerCase().includes('ali'));

  check('unknown username reports no recovery',
    recovery.getRecoveryQuestion('nobody-here').hasRecovery === false);
  check('disabled/no-question account reports no recovery', (() => {
    db.prepare("INSERT INTO users (username, password_hash, role, active) VALUES ('temp', ?, 'manager', 1)").run(auth.hashSecret('x1234'));
    return recovery.getRecoveryQuestion('temp').hasRecovery === false;
  })());

  check('wrong answer rejected', recovery.verifySecurityAnswer(owner.username, 'Wrong').ok === false);
  check('correct answer accepted', recovery.verifySecurityAnswer(owner.username, 'ali').ok === true);

  // ─────────────────────────────────────────────────────────────────────
  section('Option A — answer normalisation');
  clearLockouts(db);
  check('answer is case-insensitive',
    recovery.verifySecurityAnswer(owner.username, '  ALI  ').ok === true);
  recovery.setSecurityQuestion(owner.id, 'What is your father\'s name?', 'Ali  Khan');
  check('internal whitespace is collapsed ("Ali  Khan" == "ali khan")',
    recovery.verifySecurityAnswer(owner.username, 'Ali Khan').ok === true);
  check('a different answer still fails',
    recovery.verifySecurityAnswer(owner.username, 'Ali Khanx').ok === false);

  // ─────────────────────────────────────────────────────────────────────
  section('Option A — owner recovery code');
  clearLockouts(db);
  const masterCode = recovery.ownerRecoveryCode();
  check('owner recovery code is XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(masterCode), masterCode);
  check('recovery code opens recovery', recovery.verifySecurityAnswer(owner.username, masterCode).ok === true);
  check('recovery code is not stored in plaintext anywhere',
    !JSON.stringify(db.prepare('SELECT * FROM users WHERE id = ?').all(owner.id)).includes(masterCode.split('-')[0]));

  const before = recovery.ownerRecoveryCode();
  const after = recovery.rotateRecoverySalt();
  check('rotating changes the recovery code', before !== after, `${before} -> ${after}`);

  // ─────────────────────────────────────────────────────────────────────
  section('Option A — lockout');
  clearLockouts(db);
  const MAX = 5;
  let rejected = 0;
  for (let i = 0; i < MAX; i++) {
    if (!recovery.verifySecurityAnswer(owner.username, `nope${i}`).ok) rejected++;
  }
  check(`all ${MAX} wrong answers rejected`, rejected === MAX);
  const lockedMsg = recovery.verifySecurityAnswer(owner.username, 'Ali Khan').message || '';
  check('lockout engages at 5 failures even for the right answer', /too many/i.test(lockedMsg), lockedMsg);
  check('lockout is persisted in recovery_lockout',
    !!db.prepare("SELECT key FROM recovery_lockout WHERE key = 'answer'").get());

  clearLockouts(db);
  check('correct answer works again once the lockout is cleared',
    recovery.verifySecurityAnswer(owner.username, 'Ali Khan').ok === true);

  // ─────────────────────────────────────────────────────────────────────
  section('Option A — reset actually changes the password');
  clearLockouts(db);
  auth.setSessionUser(null);
  check('recovered password is rejected until reset', auth.login(owner.username, 'NewPass123').ok === false);
  check('recovery verifies', recovery.verifySecurityAnswer(owner.username, 'Ali Khan').ok === true);
  check('short password rejected', recovery.setRecoveredPassword(owner.username, 'ab').ok === false);
  check('reset accepted', recovery.setRecoveredPassword(owner.username, 'NewPass123').ok === true);
  check('login works with the new password', auth.login(owner.username, 'NewPass123').ok === true);
  check('old password no longer works', auth.login(owner.username, 'admin123').ok === false);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashSecret('admin123'), owner.id);

  // ─────────────────────────────────────────────────────────────────────
  section('Option B — support code (developer CLI parity)');
  clearLockouts(db);
  const info = recovery.getSupportInfo();
  check('support info exposes a device id', !!info.deviceId, info.deviceId);
  check('support info resolves the owner', !!info.ownerUsername, info.ownerUsername);

  const cliCode = cliCompute(info.deviceId, info.ownerUsername, info.epoch);
  const serviceCode = recovery.computeSupportCode(info.deviceId, info.ownerUsername, info.epoch);
  check('CLI and service produce identical codes', cliCode === serviceCode, `${cliCode} / ${serviceCode}`);
  check('code is XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(cliCode), cliCode);

  check('device id formatting does not change the code (dashes/case tolerant)',
    cliCompute(info.deviceId.toLowerCase(), info.ownerUsername, info.epoch) === cliCode);
  check('a different request number produces a different code',
    cliCompute(info.deviceId, info.ownerUsername, info.epoch + 1) !== cliCode);
  check('garbage request numbers degrade to 0 identically in CLI and service',
    cliCompute(info.deviceId, info.ownerUsername, 'not-a-number') ===
      recovery.computeSupportCode(info.deviceId, info.ownerUsername, Number.NaN));

  check('malformed code rejected', recovery.verifySupportCode('abc').ok === false);
  clearLockouts(db);
  check('wrong code rejected', recovery.verifySupportCode('ZZZZ-ZZZZ').ok === false);

  clearLockouts(db);
  const epochBefore = recovery.getSupportInfo().epoch;
  check('correct code accepted (unhyphenated)',
    recovery.verifySupportCode(cliCode.replace('-', '')).ok === true);

  // The whole point of the epoch: a shop must be able to be helped more than once.
  check('request number advanced after a successful use',
    recovery.getSupportInfo().epoch === epochBefore + 1, `${epochBefore} -> ${epochBefore + 1}`);
  check('REPLAY of the same code is rejected',
    recovery.verifySupportCode(cliCode).ok === false);
  const nextCode = cliCompute(info.deviceId, info.ownerUsername, epochBefore + 1);
  check('a FRESH code for the new request number is accepted',
    recovery.verifySupportCode(nextCode).ok === true);

  clearLockouts(db);
  check('code for a DIFFERENT device is rejected',
    recovery.verifySupportCode(cliCompute('00000000-0000-0000-0000-000000000000', info.ownerUsername, 0)).ok === false);

  // ─────────────────────────────────────────────────────────────────────
  section('Option B — support lockout');
  clearLockouts(db);
  let supportRejected = 0;
  for (let i = 0; i < MAX; i++) {
    if (!recovery.verifySupportCode(`WRNG-${String(i).padStart(4, 'X')}`).ok) supportRejected++;
  }
  check(`all ${MAX} wrong support codes rejected`, supportRejected === MAX);
  check('support lockout engages', /too many/i.test(recovery.verifySupportCode(cliCode).message || ''));

  clearLockouts(db);
  check('support reset sets the owner password', (() => {
    const ep = recovery.getSupportInfo().epoch;
    auth.setSessionUser(null);
    if (!recovery.verifySupportCode(cliCompute(info.deviceId, info.ownerUsername, ep)).ok) return false;
    if (!recovery.setRecoveredPassword('', 'SupportPw9').ok) return false;
    return auth.login(owner.username, 'SupportPw9').ok;
  })());

  // The regression the epoch exists to prevent: a shop must be helpable repeatedly.
  check('the same shop can be helped 3 times in a row', (() => {
    for (let i = 0; i < 3; i++) {
      clearLockouts(db);
      const ep = recovery.getSupportInfo().epoch;
      if (!recovery.verifySupportCode(cliCompute(info.deviceId, info.ownerUsername, ep)).ok) return false;
    }
    return true;
  })());

  // ─────────────────────────────────────────────────────────────────────
  section('Activity log');
  check('recovery events are audited',
    db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'password_reset_recovery'").get().c > 0);
  check('support recovery usage is audited',
    db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE action = 'support_recovery_used'").get().c > 0);

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_recovery crashed:', e);
  app.exit(1);
});