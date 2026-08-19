exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      sale_id INTEGER,
      payment_id INTEGER,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cust_tx_customer ON customer_transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customers_balance ON customers(balance);
  `);
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS customer_transactions;
  `);
};