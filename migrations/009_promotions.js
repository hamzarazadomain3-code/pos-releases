exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      product_id INTEGER,
      category_id INTEGER,
      discount_value REAL NOT NULL DEFAULT 0,
      buy_qty INTEGER NOT NULL DEFAULT 1,
      free_qty INTEGER NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(active);
  `);

  const itemCols = db.prepare('PRAGMA table_info(sale_items)').all();
  if (!itemCols.some((c) => c.name === 'promo_id')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN promo_id INTEGER');
  }
  if (!itemCols.some((c) => c.name === 'promo_name')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN promo_name TEXT');
  }
};

exports.down = async (db) => {
  db.exec('DROP TABLE IF EXISTS promotions');
};