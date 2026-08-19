exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      reason TEXT,
      refund_amount REAL NOT NULL,
      refund_mode TEXT NOT NULL DEFAULT 'cash',
      restock INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY (return_id) REFERENCES returns(id),
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
    CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
  `);

  const saleCols = db.prepare('PRAGMA table_info(sales)').all();
  if (!saleCols.some((c) => c.name === 'returned_amount')) {
    db.exec('ALTER TABLE sales ADD COLUMN returned_amount REAL DEFAULT 0');
  }
  const itemCols = db.prepare('PRAGMA table_info(sale_items)').all();
  if (!itemCols.some((c) => c.name === 'returned_qty')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN returned_qty REAL DEFAULT 0');
  }
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS return_items;
    DROP TABLE IF EXISTS returns;
  `);
};