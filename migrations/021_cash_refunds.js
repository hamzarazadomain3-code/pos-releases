exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      reason TEXT,
      mode TEXT NOT NULL DEFAULT 'cash',
      user_id INTEGER,
      shift_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cash_refunds_shift ON cash_refunds(shift_id);
    CREATE INDEX IF NOT EXISTS idx_cash_refunds_created ON cash_refunds(created_at);
  `);
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS cash_refunds;
  `);
};