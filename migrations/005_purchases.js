exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      purchase_order_id INTEGER,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      purchase_order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_tx_supplier ON supplier_transactions(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON purchase_price_history(product_id);
  `);

  const cols = db.prepare('PRAGMA table_info(suppliers)').all();
  if (!cols.some((c) => c.name === 'balance')) {
    db.exec('ALTER TABLE suppliers ADD COLUMN balance REAL DEFAULT 0');
  }
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS purchase_price_history;
    DROP TABLE IF EXISTS supplier_transactions;
  `);
};