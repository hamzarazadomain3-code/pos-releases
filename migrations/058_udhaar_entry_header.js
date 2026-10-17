/**
 * Migration 058 — manual Udhaar entry header.
 *
 * A manual "Udhaar (items)" entry is a `customer_transactions` row (so it drives
 * the balance and the ledger exactly like a credit sale does) plus its
 * `udhaar_items` lines (migration 057). The money row has nowhere to keep the
 * entry-level fields the Add dialog collects — note, reference no. and the
 * Deduct-stock toggle — and duplicating them onto every line would let two lines
 * of one entry disagree.
 *
 * So this is a tiny header table keyed by the ledger row it explains.
 * `direction` is NOT stored: it is simply the sign of `amount` (a debit is money
 * the customer owes, a credit is money the shop owes back), so there is exactly
 * one source of truth for it.
 *
 * Additive: an existing shop has no rows here, and every read is a LEFT JOIN.
 */
exports.up = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS udhaar_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      note TEXT,
      reference TEXT,
      deduct_stock INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (transaction_id) REFERENCES customer_transactions(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_udhaar_entries_tx ON udhaar_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_udhaar_entries_customer ON udhaar_entries(customer_id);
  `);
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS udhaar_entries');
};
