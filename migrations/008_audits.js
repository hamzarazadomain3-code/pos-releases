exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      total_items INTEGER NOT NULL DEFAULT 0,
      total_variance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      system_qty REAL NOT NULL,
      counted_qty REAL,
      variance REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (audit_id) REFERENCES audits(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
    CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON audit_items(audit_id);
  `);
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS audit_items;
    DROP TABLE IF EXISTS audits;
  `);
};