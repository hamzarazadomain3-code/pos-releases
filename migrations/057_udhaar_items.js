/**
 * Migration 057 — Udhaar / Khata item-level ledger.
 *
 * The Udhaar ledger has always been money-only: a sale records one
 * `customer_transactions` row (type 'sale') for the unpaid balance, and the
 * ledger shows that single amount. The Phase 1 requirement is that the ledger
 * shows WHAT was taken — a credit sale row must expand to its bill lines, and a
 * manual "Udhaar (items)" entry (Phase 2) must remember its own lines.
 *
 * Additive and safe:
 *   - `customers.credit_days`    — grace period before a credit is overdue. 0
 *                                  (the default) means "never overdue", so an
 *                                  existing shop sees no new "overdue" figures.
 *   - `udhaar_items`             — the item lines attached to a credit entry.
 *                                  A sale-backed line also carries its
 *                                  `sale_id`, so the "Items Taken" tab can be
 *                                  built by UNIONing sale lines with manual
 *                                  lines without backfilling anything.
 *   - `udhaar_item_catalog`      — barcode → item memory for the Phase 2
 *                                  scanner (created here, populated later).
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  if (hasTable('customers') && !hasColumn('customers', 'credit_days')) {
    db.exec('ALTER TABLE customers ADD COLUMN credit_days INTEGER DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS udhaar_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      transaction_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      invoice_no TEXT,
      barcode TEXT,
      name TEXT NOT NULL,
      unit TEXT,
      qty REAL NOT NULL DEFAULT 0,
      rate REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      batch TEXT,
      expiry TEXT,
      note TEXT,
      direction TEXT NOT NULL DEFAULT 'debit',
      deduct_stock INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (transaction_id) REFERENCES customer_transactions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_udhaar_items_customer ON udhaar_items(customer_id);
    CREATE INDEX IF NOT EXISTS idx_udhaar_items_transaction ON udhaar_items(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_udhaar_items_sale ON udhaar_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_udhaar_items_barcode ON udhaar_items(barcode);

    CREATE TABLE IF NOT EXISTS udhaar_item_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      unit TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

exports.down = function (db) {
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  db.exec('DROP TABLE IF EXISTS udhaar_items');
  db.exec('DROP TABLE IF EXISTS udhaar_item_catalog');
  if (hasColumn('customers', 'credit_days')) db.exec('ALTER TABLE customers DROP COLUMN credit_days');
};
