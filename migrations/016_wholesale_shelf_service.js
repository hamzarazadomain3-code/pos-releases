exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  if (hasColumn('products', 'wholesale_price')) {
    /* column exists */
  } else {
    db.exec('ALTER TABLE products ADD COLUMN wholesale_price REAL DEFAULT NULL');
  }

  if (hasColumn('products', 'shelf_location')) {
    /* column exists */
  } else {
    db.exec('ALTER TABLE products ADD COLUMN shelf_location TEXT DEFAULT NULL');
  }

  if (hasColumn('sales', 'service_charge')) {
    /* column exists */
  } else {
    db.exec('ALTER TABLE sales ADD COLUMN service_charge REAL DEFAULT 0');
  }

  if (hasColumn('sales', 'service_charge_type')) {
    /* column exists */
  } else {
    db.exec("ALTER TABLE sales ADD COLUMN service_charge_type TEXT DEFAULT 'amount'");
  }

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('price_floor_enabled', '1');
  insertSetting.run('cashier_price_lock', '1');
};

exports.down = function () {};
