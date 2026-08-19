const { scryptSync } = require('node:crypto');

exports.up = async (db) => {
  db.exec(`
    ALTER TABLE sales ADD COLUMN notes TEXT;

    CREATE TABLE IF NOT EXISTS held_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'held',
      label TEXT,
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
  `);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('shop_name', 'My Shop');
  insertSetting.run('shop_address', '');
  insertSetting.run('shop_phone', '');
  insertSetting.run('receipt_footer', 'Thank you! Visit again');
  insertSetting.run('currency', 'Rs');

  const hash = scryptSync('admin123', 'pos-salt', 64).toString('hex');
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', ?, 'admin')"
  ).run(hash);
};

exports.down = async (db) => {
  db.exec(`
    ALTER TABLE sales DROP COLUMN notes;
    DROP TABLE IF EXISTS held_bills;
    DROP TABLE IF EXISTS settings;
  `);
};