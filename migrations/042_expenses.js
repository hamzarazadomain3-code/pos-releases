/**
 * Migration 042 — Expense Module (v2.5.0)
 *
 * Adds:
 *   - expense_categories table
 *   - expenses table with attachment support
 *   - Recurring expenses support
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. expense_categories ──
  if (!hasTable('expense_categories')) {
    db.exec(`
      CREATE TABLE expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        color TEXT DEFAULT '#6B7280',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── 2. expenses ──
  if (!hasTable('expenses')) {
    db.exec(`
      CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL,
        expense_date DATE NOT NULL,
        attachment_path TEXT,
        is_recurring INTEGER DEFAULT 0,
        recurrence_type TEXT,
        recurrence_end DATE,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES expense_categories(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  } else {
    const ensureCol = (t, c, def) => { if (!hasColumn(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
    ensureCol('expenses', 'category_id', 'INTEGER NOT NULL DEFAULT 1');
    ensureCol('expenses', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
    ensureCol('expenses', 'description', 'TEXT');
    ensureCol('expenses', 'attachment_path', 'TEXT');
    ensureCol('expenses', 'is_recurring', 'INTEGER DEFAULT 0');
    ensureCol('expenses', 'recurrence_type', 'TEXT');
    ensureCol('expenses', 'recurrence_end', 'DATE');
    ensureCol('expenses', 'status', 'TEXT DEFAULT \'active\'');
    ensureCol('expenses', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status)');

  // ── 3. Seed default categories ──
  const defaults = [
    ['Rent', 'Shop/Office rent', '#EF4444'],
    ['Utilities', 'Electricity, water, gas', '#F97316'],
    ['Salaries', 'Staff salaries', '#8B5CF6'],
    ['Marketing', 'Advertising, promotions', '#06B6D4'],
    ['Maintenance', 'Repairs, upkeep', '#84CC16'],
    ['Office Supplies', 'Stationery, consumables', '#6366F1'],
    ['Transport', 'Fuel, vehicle costs', '#F43F5E'],
    ['Other', 'Miscellaneous expenses', '#6B7280'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO expense_categories (name, description, color) VALUES (?, ?, ?)');
  for (const [name, desc, color] of defaults) ins.run(name, desc, color);
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS expenses');
  db.exec('DROP TABLE IF EXISTS expense_categories');
};