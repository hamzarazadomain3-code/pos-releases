/**
 * Migration 060 — Customer profile fields (Phase 3 of the Udhaar/Khata upgrade).
 *
 * The Add/Edit customer form grew from three fields (name, phone, opening
 * balance) into a tabbed profile — Basic / Contact / Identity & Tax / Credit /
 * Notes. Everything is additive and nullable, so an existing shop's customers
 * are untouched and every read is a plain `SELECT *` that simply gains columns.
 *
 * Two deliberate choices:
 *   - `status` is TEXT ('active' | 'inactive'), not a boolean. Deactivating is
 *     the supported way to retire a customer who has history; a hard delete is
 *     only allowed when there are no transactions or sales (see
 *     `customers.ts`). An existing row defaults to 'active'.
 *   - the credit "block / warn / allow" tri-state is `credit_action`, a NEW
 *     column, while `block_on_exceed` (migration 037) stays the flag the billing
 *     credit check reads. `saveCustomer()` writes both in step
 *     (block → block_on_exceed = 1) so billing keeps working unchanged, and
 *     `checkCredit()` additionally honours `credit_action = 'allow'` to silence
 *     the warning when the shop explicitly asked for no limit enforcement.
 *
 * `opening_balance_as_of` is the date the opening balance is "as of"; it is
 * stamped onto the `customer_transactions` row so the ledger reads correctly.
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  if (hasTable('customers')) {
    const cols = {
      // Basic
      urdu_name: 'TEXT',
      customer_type: "TEXT DEFAULT 'retail'", // retail | wholesale | medical | other
      business_name: 'TEXT',
      contact_person: 'TEXT',
      photo: 'TEXT', // data URL or path
      status: "TEXT DEFAULT 'active'", // active | inactive
      customer_code: 'TEXT',
      group_name: 'TEXT',
      tags: 'TEXT', // free comma-separated list
      // Contact
      phone_alt: 'TEXT',
      whatsapp: 'TEXT',
      email: 'TEXT',
      city: 'TEXT',
      area: 'TEXT',
      maps_link: 'TEXT',
      message_language: "TEXT DEFAULT 'en'", // en | ur
      // Identity & Tax
      cnic: 'TEXT',
      ntn: 'TEXT',
      drug_licence: 'TEXT',
      guarantor: 'TEXT',
      guarantor_phone: 'TEXT',
      // Credit
      price_level: "TEXT DEFAULT 'retail'", // retail | wholesale
      default_discount_pct: 'REAL DEFAULT 0',
      max_single_bill: 'REAL DEFAULT 0', // 0 = no cap
      credit_action: "TEXT DEFAULT 'warn'", // allow | warn | block
      opening_balance_as_of: 'TEXT',
      // Notes
      notes: 'TEXT',
      birthday: 'TEXT',
      anniversary: 'TEXT',
      reminder_freq: "TEXT DEFAULT 'none'", // none | weekly | monthly
    };
    for (const [c, def] of Object.entries(cols)) {
      if (!hasColumn('customers', c)) {
        db.exec(`ALTER TABLE customers ADD COLUMN ${c} ${def}`);
      }
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)');
    if (hasColumn('customers', 'phone')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)');
    }
  }
};

exports.down = function (db) {
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  db.exec('DROP INDEX IF EXISTS idx_customers_phone');
  db.exec('DROP INDEX IF EXISTS idx_customers_status');
  const cols = [
    'urdu_name', 'customer_type', 'business_name', 'contact_person', 'photo', 'status',
    'customer_code', 'group_name', 'tags', 'phone_alt', 'whatsapp', 'email', 'city', 'area',
    'maps_link', 'message_language', 'cnic', 'ntn', 'drug_licence', 'guarantor',
    'guarantor_phone', 'price_level', 'default_discount_pct', 'max_single_bill',
    'credit_action', 'opening_balance_as_of', 'notes', 'birthday', 'anniversary', 'reminder_freq',
  ];
  for (const c of cols) {
    if (hasColumn('customers', c)) {
      try {
        db.exec(`ALTER TABLE customers DROP COLUMN ${c}`);
      } catch {
        // Older SQLite without DROP COLUMN support: leave the column in place.
      }
    }
  }
};
