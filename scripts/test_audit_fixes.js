/**
 * Phase 2 audit regression tests.
 *
 * Pure Node — no Electron, no renderer. Covers the pieces that would fail
 * silently in production:
 *   - shared credit-period resolution (A10)
 *   - migration 067 idempotency + legacy `payment_due_days` adoption
 *   - secret masking at the IPC boundary (A5)
 *   - the `si.price` -> `si.unit_price` report-query fix (A6)
 *
 * Run: npm run test:audit
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const { resolveCreditDays, DEFAULT_CREDIT_DAYS } = require(
  path.join(ROOT, 'dist', 'shared', 'creditDays.js')
);
const {
  SECRET_MASK,
  SECRET_ADMIN_KEYS,
  SECRET_SETTING_KEYS,
  isMaskedSecret,
  maskSecrets,
} = require(path.join(ROOT, 'dist', 'main', 'utils', 'secrets.js'));

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err && err.message ? err.message : err}`);
  }
}

console.log('\ncredit-period resolution');
check('customer period wins', () => assert.equal(resolveCreditDays(15, 30), 15));
check('numeric string customer period', () => assert.equal(resolveCreditDays('7', 30), 7));
check('0 falls back to shop default', () => assert.equal(resolveCreditDays(0, 30), 30));
check('shop default 0 means never overdue', () => assert.equal(resolveCreditDays(0, 0), 0));
check('missing both uses 30', () => assert.equal(resolveCreditDays(null, null), DEFAULT_CREDIT_DAYS));
check('negative customer period falls back', () => assert.equal(resolveCreditDays(-5, 12), 12));
check('fractional values floor', () => assert.equal(resolveCreditDays(4.9, 30), 4));

console.log('\nmigration 067');
const migration = require(path.join(ROOT, 'migrations', '067_default_credit_days.js'));

function freshDb(withAdmin) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  if (withAdmin) {
    db.exec('CREATE TABLE admin_settings (key TEXT PRIMARY KEY, value TEXT)');
  }
  return db;
}

function value(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

check('adopts legacy payment_due_days', () => {
  const db = freshDb(true);
  db.prepare('INSERT INTO admin_settings (key, value) VALUES (?, ?)').run(
    'payment_due_days',
    '45'
  );
  migration.up(db);
  assert.equal(value(db, 'default_credit_days'), '45');
});

check('seeds 30 when no legacy value', () => {
  const db = freshDb(true);
  migration.up(db);
  assert.equal(value(db, 'default_credit_days'), '30');
});

check('second run never overwrites the owner value', () => {
  const db = freshDb(true);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'default_credit_days',
    '7'
  );
  migration.up(db);
  assert.equal(value(db, 'default_credit_days'), '7');
});

check('runs safely without a settings table', () => {
  const db = new DatabaseSync(':memory:');
  migration.up(db);
  assert.ok(true);
});

console.log('\nsecret masking');
check('admin secrets are masked', () => {
  const masked = maskSecrets(
    {
      email_smtp_pass: 'hunter2',
      sms_api_key: 'AC123',
      email_smtp_host: 'smtp.example.com',
    },
    SECRET_ADMIN_KEYS
  );
  assert.equal(masked.email_smtp_pass, SECRET_MASK);
  assert.equal(masked.sms_api_key, SECRET_MASK);
  assert.equal(masked.email_smtp_host, 'smtp.example.com');
});
check('shop license key is masked', () => {
  assert.equal(maskSecrets({ license_key: 'ROKAR-123' }, SECRET_SETTING_KEYS).license_key, SECRET_MASK);
});
check('empty secrets stay empty', () => {
  assert.equal(maskSecrets({ email_smtp_pass: '' }, SECRET_ADMIN_KEYS).email_smtp_pass, '');
});
check('mask round-trip is detected', () => {
  assert.equal(isMaskedSecret(SECRET_MASK), true);
  assert.equal(isMaskedSecret('********'), true);
  assert.equal(isMaskedSecret('real-secret'), false);
  assert.equal(isMaskedSecret(null), false);
});
check('masking does not mutate the input map', () => {
  const source = { email_smtp_pass: 'hunter2' };
  maskSecrets(source, SECRET_ADMIN_KEYS);
  assert.equal(source.email_smtp_pass, 'hunter2');
});

console.log('\nreport query schema (A6)');
check('sale_items has unit_price, not price', () => {
  const db = new DatabaseSync(path.join(ROOT, 'pos.db'), { readOnly: true });
  const cols = db
    .prepare('PRAGMA table_info(sale_items)')
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes('unit_price'), 'sale_items.unit_price must exist');
  assert.ok(!cols.includes('price'), 'sale_items.price must not exist');
});
check('profitability + inventory reports use unit_price', () => {
  for (const file of ['profitability.ts', 'inventoryReports.ts']) {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', file), 'utf8');
    assert.ok(!/si\.price\b/.test(source), `${file} still references si.price`);
    assert.ok(/si\.unit_price\b/.test(source), `${file} should reference si.unit_price`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL PASSED');
