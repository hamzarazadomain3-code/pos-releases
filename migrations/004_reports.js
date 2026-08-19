exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      amount REAL NOT NULL,
      expense_date TEXT DEFAULT (date('now','localtime')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
  `);

  const cols = db.prepare("PRAGMA table_info(customers)").all();
  if (!cols.some((c) => c.name === 'credit_limit')) {
    db.exec('ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0');
  }
};

exports.down = async (db) => {
  db.exec(`
    DROP TABLE IF EXISTS expenses;
  `);
};