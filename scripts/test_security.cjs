#!/usr/bin/env node
/**
 * Phase 0 item 0.15 — credential vault + password policy.
 *
 * Two halves:
 *  1. the PASSWORD POLICY is pure (no DB), so it is checked directly:
 *     length, uppercase, numbers, special characters, and the PIN exemption;
 *  2. the CREDENTIAL VAULT needs Electron's `safeStorage` (the OS key store),
 *     so it runs inside Electron against a throwaway database:
 *       - a saved SMTP password is NOT stored as plain text;
 *       - it can be read back (decrypted) by the services;
 *       - a legacy plain-text value still works AND is migrated in place;
 *       - a value that cannot be decrypted (another machine) yields '' and
 *         never the cipher text.
 *
 * Run: npm run test:security
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-security-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'security-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const PASSWORD_PART = `
const { checkPassword, DEFAULT_PASSWORD_POLICY } = require(path.join(ROOT, 'dist', 'shared', 'passwordPolicy.js'));
`;

async function run() {
  const ROOT = path.resolve(__dirname, '..');

  // safeStorage needs a ready app (Windows DPAPI).
  if (typeof app.whenReady === 'function') {
    try {
      await app.whenReady();
    } catch {
      /* already ready */
    }
  }

  console.log('=== password policy (pure) ===');
  const { checkPassword, DEFAULT_PASSWORD_POLICY } = require(
    path.join(ROOT, 'dist', 'shared', 'passwordPolicy.js')
  );

  check(
    'defaults: 8 chars, uppercase, numbers, no special',
    DEFAULT_PASSWORD_POLICY.min_password_length === 8 &&
      DEFAULT_PASSWORD_POLICY.require_uppercase === true &&
      DEFAULT_PASSWORD_POLICY.require_numbers === true &&
      DEFAULT_PASSWORD_POLICY.require_special_chars === false,
    JSON.stringify(DEFAULT_PASSWORD_POLICY)
  );

  check('a good password passes', checkPassword('Rokar2026').ok);
  check(
    'too short is rejected',
    !checkPassword('Ab1').ok && checkPassword('Ab1').message.includes('at least'),
    checkPassword('Ab1').message
  );
  check(
    'no uppercase is rejected',
    !checkPassword('rokar2026').ok && checkPassword('rokar2026').message.includes('uppercase'),
    checkPassword('rokar2026').message
  );
  check(
    'no number is rejected',
    !checkPassword('RokarPOS').ok && checkPassword('RokarPOS').message.includes('number'),
    checkPassword('RokarPOS').message
  );
  check(
    'special char required when the policy says so',
    !checkPassword('Rokar2026', { ...DEFAULT_PASSWORD_POLICY, require_special_chars: true }).ok &&
      checkPassword('Rokar2026!', { ...DEFAULT_PASSWORD_POLICY, require_special_chars: true }).ok
  );
  check(
    'the rules can be relaxed by the owner',
    checkPassword('rokar', { min_password_length: 4, require_uppercase: false, require_numbers: false, require_special_chars: false }).ok
  );
  check(
    'a PIN is exempt from the complexity rules',
    checkPassword('1234', DEFAULT_PASSWORD_POLICY, true).ok
  );
  check('an empty password is rejected', !checkPassword('').ok);

  console.log('\n=== credential vault (Electron safeStorage) ===');
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const vault = require('../dist/main/services/secretVault.js');
  const admin = require('../dist/main/services/admin.js');
  const auth = require('../dist/main/services/auth.js');

  auth.setSessionUser(1); // seeded owner

  check('the vault knows its credential keys', vault.isVaultKey('email_smtp_pass') && vault.isVaultKey('sms_api_key'));
  check('a normal setting is not a vault key', !vault.isVaultKey('email_smtp_host'));

  const PLAIN = 'SuperSecretMailPass123';
  admin.setAdminSetting('email_smtp_pass', PLAIN);

  const rawRow = db
    .prepare("SELECT value FROM admin_settings WHERE key = 'email_smtp_pass'")
    .get();
  const stored = String(rawRow?.value ?? '');
  const vaultWorks = vault.vaultAvailable();
  console.log(`  (key store available: ${vaultWorks ? 'yes' : 'no'})`);
  if (vaultWorks) {
    check('the password is NOT stored as plain text', stored !== PLAIN, stored.slice(0, 12) + '…');
    check('the stored value carries the vault marker', vault.isEncryptedValue(stored), stored.slice(0, 10));
    check('the stored value does not contain the secret', !stored.includes(PLAIN));
  } else {
    // No key store on this machine: the shop must still be able to save and
    // use the password — the value stays readable.
    check('without a key store the value is still usable', stored === PLAIN, stored ? 'stored' : 'empty');
  }

  const readBack = vault.getSecretSetting('email_smtp_pass');
  check('the service reads the real password back', readBack === PLAIN, readBack ? 'decrypted' : 'empty');

  console.log('\n=== legacy plain-text value is migrated in place ===');
  db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'email_smtp_pass'").run('LegacyPlainPass123');
  const legacyRead = vault.getSecretSetting('email_smtp_pass');
  check('a legacy plain value still works', legacyRead === 'LegacyPlainPass123', legacyRead ? 'read' : 'empty');
  const afterRow = db
    .prepare("SELECT value FROM admin_settings WHERE key = 'email_smtp_pass'")
    .get();
  if (vaultWorks) {
    check(
      'the legacy value was migrated to the vault',
      vault.isEncryptedValue(String(afterRow?.value ?? '')),
      String(afterRow?.value ?? '').slice(0, 10)
    );
  } else {
    check(
      'without a key store the legacy value stays readable',
      String(afterRow?.value ?? '') === 'LegacyPlainPass123'
    );
  }
  check('the migrated value still decrypts', vault.getSecretSetting('email_smtp_pass') === 'LegacyPlainPass123');

  console.log('\n=== an unreadable blob yields nothing (never the cipher text) ===');
  db.prepare("UPDATE admin_settings SET value = ? WHERE key = 'email_smtp_pass'").run('enc:v1:bm90LXJlYWxseS1jaXBoZXItdGV4dA==');
  const broken = vault.getSecretSetting('email_smtp_pass');
  check('a corrupt ciphertext reads as empty', broken === '', JSON.stringify(broken));
  check('the cipher text is never returned', !broken.includes('bm90'));

  console.log('\n=== a missing key is empty, not an error ===');
  check('a missing credential reads as empty', vault.getSecretSetting('sms_api_key') === '');

  console.log('\n=== the password policy is enforced by the user service ===');
  const weak = throws(() =>
    auth.createUser({ username: 'weakuser', password: 'alllower', role: 'manager' })
  );
  check('a weak password is refused by createUser', !!weak && weak.includes('uppercase'), weak || 'no error');
  const strong = auth.createUser({ username: 'stronguser', password: 'Rokar2026', role: 'manager' });
  check('a strong password is accepted', strong.id > 0, `id ${strong.id}`);
  const weakUpdate = throws(() => auth.updateUser(strong.id, { password: 'short' }));
  check('a weak password is refused by updateUser', !!weakUpdate, weakUpdate || 'no error');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  }
  console.log('All security checks passed.');
  // Electron must be told to quit: without this the process stays alive and
  // the npm script never returns (the suite HANGS the build).
  app.exit(0);
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
