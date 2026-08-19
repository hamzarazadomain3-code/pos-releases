exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };

  // 1. Create product_batches table
  if (!hasTable('product_batches')) {
    db.exec(`
      CREATE TABLE product_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        batch_number TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        cost_price REAL NOT NULL DEFAULT 0,
        expiry_date DATE,
        received_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `);
    db.exec(`CREATE INDEX idx_batches_product ON product_batches(product_id);`);
    db.exec(`CREATE INDEX idx_batches_expiry ON product_batches(expiry_date);`);
  }

  // 2. Add columns to products (without UNIQUE on box_barcode initially)
  if (!hasColumn('products', 'units_per_box')) {
    db.exec('ALTER TABLE products ADD COLUMN units_per_box REAL DEFAULT NULL');
  }
  if (!hasColumn('products', 'box_barcode')) {
    db.exec('ALTER TABLE products ADD COLUMN box_barcode TEXT DEFAULT NULL');
  }
  if (!hasColumn('products', 'box_price')) {
    db.exec('ALTER TABLE products ADD COLUMN box_price REAL DEFAULT NULL');
  }
  // Add unique index on box_barcode after column exists
  const boxBarcodeIndex = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_products_box_barcode'`).get();
  if (!boxBarcodeIndex) {
    db.exec(`CREATE UNIQUE INDEX idx_products_box_barcode ON products(box_barcode) WHERE box_barcode IS NOT NULL`);
  }

  // 3. Add columns to sale_items
  if (!hasColumn('sale_items', 'batch_id')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN batch_id INTEGER DEFAULT NULL');
  }
  if (!hasColumn('sale_items', 'box_qty')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN box_qty REAL DEFAULT NULL');
  }

  // 4. Add columns to purchase_items
  if (!hasColumn('purchase_items', 'batch_number')) {
    db.exec('ALTER TABLE purchase_items ADD COLUMN batch_number TEXT DEFAULT NULL');
  }
  if (!hasColumn('purchase_items', 'expiry_date')) {
    db.exec('ALTER TABLE purchase_items ADD COLUMN expiry_date DATE DEFAULT NULL');
  }

  // 5. Add column to stock_movements
  if (!hasColumn('stock_movements', 'batch_id')) {
    db.exec('ALTER TABLE stock_movements ADD COLUMN batch_id INTEGER DEFAULT NULL');
  }

  // 6. BACKFILL: Create legacy batches for existing products with stock
  const legacyProducts = db.prepare(`
    SELECT id, stock_qty, cost_price, expiry_date
    FROM products
    WHERE stock_qty > 0 OR expiry_date IS NOT NULL
  `).all();

  for (const p of legacyProducts) {
    // Check if batch already exists (idempotent)
    const existing = db.prepare('SELECT 1 FROM product_batches WHERE product_id = ? AND batch_number = ?').get(p.id, 'LEGACY-' + p.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO product_batches (product_id, batch_number, quantity, cost_price, expiry_date, received_date)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(p.id, 'LEGACY-' + p.id, p.stock_qty, p.cost_price, p.expiry_date);
    }
  }

  // 7. Settings for new features
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('batch_tracking_enabled', '1');
  insertSetting.run('box_selling_enabled', '1');
};

exports.down = function (db) {
  // Note: SQLite doesn't support DROP COLUMN easily, so we don't remove columns in down()
  db.exec('DROP TABLE IF EXISTS product_batches');
  db.exec('DROP INDEX IF EXISTS idx_products_box_barcode');
};