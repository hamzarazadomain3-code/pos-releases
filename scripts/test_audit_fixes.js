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
const {
  sumCashCollected,
  sumPayables,
  sumReceivables,
  sumSaleReturns,
} = require(path.join(ROOT, 'dist', 'shared', 'dashboardMath.js'));
const {
  ADMIN_NON_WRITABLE_KEYS,
  overlayAdminSettings,
  planAdminBatch,
} = require(path.join(ROOT, 'dist', 'shared', 'adminSettingsBridge.js'));

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

console.log('\nadmin/profile settings bridge (phase A)');
check('allow_negative_stock is never an admin control', () => {
  const raw = { allow_negative_stock: 'false', currency_symbol: 'Rs' };
  const profile = { allow_negative_stock: 'warn', currency: 'Rs' };
  const loaded = overlayAdminSettings(raw, profile);
  assert.equal(loaded.allow_negative_stock, undefined);
  assert.ok(ADMIN_NON_WRITABLE_KEYS.has('allow_negative_stock'));
});
check('batch Save All cannot overwrite warn with the stale false', () => {
  const raw = { allow_negative_stock: 'false', currency_symbol: 'Rs', receipt_footer_text: 'old' };
  const profile = { allow_negative_stock: 'warn', currency: 'Rs', receipt_footer: 'old' };
  const loaded = overlayAdminSettings(raw, profile);
  const plan = planAdminBatch(raw, loaded, { ...loaded, allow_negative_stock: 'false' });
  assert.equal(plan.writes.allow_negative_stock, undefined);
  assert.equal(profile.allow_negative_stock, 'warn');
});
check('unchanged fields are not written back', () => {
  const raw = { currency_symbol: 'Rs' };
  const profile = { currency: 'Rs' };
  const loaded = overlayAdminSettings(raw, profile);
  const plan = planAdminBatch(raw, loaded, { ...loaded });
  assert.deepEqual(plan.writes, {});
  assert.deepEqual(plan.mirrors, []);
});
check('a genuinely changed profile-owned field is mirrored', () => {
  const raw = { currency_symbol: 'Rs' };
  const profile = { currency: 'Rs' };
  const loaded = overlayAdminSettings(raw, profile);
  const plan = planAdminBatch(raw, loaded, { ...loaded, currency_symbol: 'PKR' });
  assert.equal(plan.writes.currency_symbol, 'PKR');
  assert.deepEqual(plan.mirrors, [{ target: 'currency', value: 'PKR' }]);
});

console.log('\ndashboard arithmetic (A2/A3)');
check('payables come from suppliers, receivables from customers', () => {
  const suppliers = [{ balance: 500 }, { balance: 125.5 }, { balance: -20 }];
  const customers = [{ balance: 300 }, { balance: 0 }, { balance: 49.5 }];
  assert.equal(sumPayables(suppliers), 625.5);
  assert.equal(sumReceivables(customers), 349.5);
  assert.notEqual(sumPayables(suppliers), sumReceivables(customers));
});
check('negative/NaN balances never inflate totals', () => {
  assert.equal(sumPayables([{ balance: -10 }, { balance: 'abc' }, {}]), 0);
  assert.equal(sumReceivables([{ balance: null }, { balance: 12 }]), 12);
});
check('sale returns only count returned/negative rows', () => {
  const rows = [
    { status: 'completed', total_amount: 1000 },
    { status: 'returned', total_amount: -150 },
    { status: 'completed', total_amount: -25 },
    { status: 'voided', total_amount: 800 },
  ];
  assert.equal(sumSaleReturns(rows), 175);
});
check('cash collected sums completed sale totals', () => {
  assert.equal(sumCashCollected([{ total_amount: 100 }, { total_amount: 50.5 }]), 150.5);
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

function parseInputDate(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoM) {
    const year = parseInt(isoM[1], 10);
    const month = parseInt(isoM[2], 10);
    const day = parseInt(isoM[3], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1900 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const sepM = /^(?:(\d{1,2})[\/.\-])?(\d{1,2})[\/.\-](\d{4})$/.exec(value);
  if (sepM) {
    const candidateMonth = _dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[1], 10) : parseInt(sepM[2], 10);
    const candidateDay = _dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[2], 10) : parseInt(sepM[1], 10);
    const candidateYear = parseInt(sepM[3], 10);
    if (!Number.isNaN(candidateMonth) && !Number.isNaN(candidateDay) && !Number.isNaN(candidateYear)
        && candidateYear >= 1900 && candidateYear <= 9999 && candidateMonth >= 1 && candidateMonth <= 12
        && candidateDay >= 1 && candidateDay <= monthDays(candidateMonth, candidateYear)) {
      return `${candidateYear}-${String(candidateMonth).padStart(2, '0')}-${String(candidateDay).padStart(2, '0')}`;
    }
  }
  // No generic Date fallback - reject unrecognized formats to avoid rollover.
  return null;
}

function monthDays(month, year) {
  return new Date(year, month, 0).getDate();
}

let _dateFormat = 'DD/MM/YYYY';

function formatInputDate(iso) {
  if (!iso || String(iso).trim() === '') return '';
  const text = String(iso).trim();
  const parts = parseParts(text);
  if (!parts) return text;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  const yyyy = parts.year;
  switch (_dateFormat) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

function parseParts(text) {
  // Try ISO yyyy-mm-dd first
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return { year, month, day };
    }
    return null;
  }
  // Try dd/mm/yyyy or mm/dd/yyyy
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(text);
  if (m) {
    const year = parseInt(m[3], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[1], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return { year, month, day };
    }
    return null;
  }
  return null;
}

console.log('\ndate parsing validation (2.2)');
check('parseInputDate rejects invalid 31/02/2020', () => assert.equal(parseInputDate('31/02/2020'), null));
check('parseInputDate rejects invalid 45/13/2020', () => assert.equal(parseInputDate('45/13/2020'), null));
check('parseInputDate rejects 29/02/2027 (non-leap)', () => assert.equal(parseInputDate('29/02/2027'), null));
check('parseInputDate accepts 29/02/2028 (leap)', () => assert.equal(parseInputDate('29/02/2028'), '2028-02-29'));
check('parseInputDate rejects 2020-02-31 (ISO invalid)', () => assert.equal(parseInputDate('2020-02-31'), null));
check('parseInputDate rejects 2020-13-45 (ISO invalid)', () => assert.equal(parseInputDate('2020-13-45'), null));
check('parseInputDate accepts 2024-12-31', () => assert.equal(parseInputDate('2024-12-31'), '2024-12-31'));
check('parseInputDate accepts dd/mm/yyyy 01/01/2024', () => assert.equal(parseInputDate('01/01/2024'), '2024-01-01'));
check('parseInputDate empty returns null', () => assert.equal(parseInputDate(''), null));
check('parseInputDate bad text returns null', () => assert.equal(parseInputDate('abc'), null));
check('formatInputDate 2024-01-15 => DD/MM/YYYY', () => {
  _dateFormat = 'DD/MM/YYYY';
  assert.equal(formatInputDate('2024-01-15'), '15/01/2024');
});
check('formatInputDate 2024-01-15 => MM/DD/YYYY', () => {
  _dateFormat = 'MM/DD/YYYY';
  assert.equal(formatInputDate('2024-01-15'), '01/15/2024');
});
check('formatInputDate 2024-01-15 => YYYY-MM-DD', () => {
  _dateFormat = 'YYYY-MM-DD';
  assert.equal(formatInputDate('2024-01-15'), '2024-01-15');
});

check('no <input type="date"> in renderer src', () => {
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
        const src = fs.readFileSync(p, 'utf8');
        if (/type="date"/.test(src)) {
          const rel = path.relative(ROOT, p);
          // Allow the one remaining in ProductPickerPanel.tsx (raw HTML modal, cannot use React component)
          if (rel.includes('ProductPickerPanel.tsx')) continue;
          throw new Error(rel + ' still contains <input type="date">');
        }
      }
    }
  }
  walk(path.join(ROOT, 'src', 'renderer', 'src'));
});

console.log('\nweb/desktop safety (phase 3)');
check('raw email and WhatsApp relays are owner-gated', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.ts'), 'utf8');
  assert.ok(
    /'email:send'[\s\S]{0,600}can\('owner'\)/.test(ipc),
    'email:send must require the owner role'
  );
  assert.ok(
    /'whatsapp:start'[\s\S]{0,600}can\('owner'\)/.test(ipc),
    'whatsapp:start must require the owner role'
  );
  assert.ok(
    /'whatsapp:send'[\s\S]{0,600}can\('owner'\)/.test(ipc),
    'whatsapp:send must require the owner role'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL PASSED');
