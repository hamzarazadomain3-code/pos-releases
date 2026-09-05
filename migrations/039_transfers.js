/**
 * Migration 039 — Party-to-Party & Bank-to-Bank Transfers (v2.4.0)
 *
 * Adds:
 *   - party_transfers table (customer-to-customer or customer-to-supplier)
 *   - bank_accounts table for bank-to-bank transfers
 *   - bank_transfers table
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);

  // ── Party Transfers ──
  if (!hasTable('party_transfers')) {
    db.exec(`
      CREATE TABLE party_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_party_id INTEGER NOT NULL,
        from_party_type TEXT DEFAULT 'customer', -- customer | supplier
        to_party_id INTEGER NOT NULL,
        to_party_type TEXT DEFAULT 'customer',
        amount REAL NOT NULL,
        reference TEXT,
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_party_id) REFERENCES customers(id),
        FOREIGN KEY (to_party_id) REFERENCES customers(id)
      )
    `);
  }

  // ── Bank Accounts ──
  if (!hasTable('bank_accounts')) {
    db.exec(`
      CREATE TABLE bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bank_name TEXT,
        account_number TEXT,
        iban TEXT,
        branch TEXT,
        currency TEXT DEFAULT 'PKR',
        current_balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── Bank Transfers ──
  if (!hasTable('bank_transfers')) {
    db.exec(`
      CREATE TABLE bank_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_account_id INTEGER NOT NULL,
        to_account_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        reference TEXT,
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_account_id) REFERENCES bank_accounts(id),
        FOREIGN KEY (to_account_id) REFERENCES bank_accounts(id)
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_party_transfers_from ON party_transfers(from_party_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_party_transfers_to ON party_transfers(to_party_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bank_transfers_from ON bank_transfers(from_account_id, created_at)');

  // Settings for default payment methods
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insSetting.run('party_transfer_enabled', 'true');
  insSetting.run('bank_transfer_enabled', 'true');

  // Seed a default bank account
  const hasBank = db.prepare('SELECT COUNT(*) as c FROM bank_accounts').get().c > 0;
  if (!hasBank) {
    db.exec(`
      INSERT INTO bank_accounts (name, bank_name, account_number, is_active)
      VALUES ('Main Account', 'Default Bank', '000000000000000', 1)
    `);
    insSetting.run('default_bank_account_id', '1');
  }
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS bank_transfers');
  db.exec('DROP TABLE IF EXISTS bank_accounts');
  db.exec('DROP TABLE IF EXISTS party_transfers');
  db.exec("DELETE FROM settings WHERE key IN ('party_transfer_enabled', 'bank_transfer_enabled', 'default_bank_account_id')");
};