exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };
  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };

  // 1. PLU code for BayLan RLS1100 label-scale integration.
  //    (The scale's 6-digit PLU can live here OR in the product barcode/SKU field.)
  if (hasTable('products') && !hasColumn('products', 'plu_code')) {
    db.exec('ALTER TABLE products ADD COLUMN plu_code TEXT DEFAULT NULL');
  }
  if (hasTable('products') && !hasColumn('products', 'whatsapp_notify')) {
    db.exec('ALTER TABLE products ADD COLUMN whatsapp_notify INTEGER DEFAULT 1');
  }

  // 2. Receipt customization settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const defaults = [
    ['shop_name', 'Al Baghdad Sweets & Bakers'],
    ['shop_phone', '03001234567'],
    ['shop_address', 'Faqirwali, Haroonabad, Chishtian, Dharanwala'],
    ['shop_website', 'www.albagdad.com'],
    ['facebook_page', 'https://facebook.com/albaghdadsweets'],
    ['show_logo', '1'],
    ['paper_width', '80'],
    ['tax_id', ''],
    ['custom_footer', 'Shukrya! Aap ka Pasandeedah Dukan'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO receipt_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) ins.run(k, v);

  // 3. Daily reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date DATE UNIQUE,
      total_sales REAL DEFAULT 0,
      total_bills INTEGER DEFAULT 0,
      avg_bill REAL DEFAULT 0,
      top_products JSON DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Hourly sales tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS hourly_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour_date DATETIME UNIQUE,
      amount REAL DEFAULT 0,
      bill_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

exports.down = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };
  if (hasColumn('products', 'plu_code')) {
    db.exec('ALTER TABLE products DROP COLUMN plu_code');
  }
  if (hasColumn('products', 'whatsapp_notify')) {
    db.exec('ALTER TABLE products DROP COLUMN whatsapp_notify');
  }
  db.exec('DROP TABLE IF EXISTS receipt_settings');
  db.exec('DROP TABLE IF EXISTS daily_reports');
  db.exec('DROP TABLE IF EXISTS hourly_sales');
};