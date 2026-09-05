/**
 * Migration 037 — Party Credit Limits (v2.4.0)
 *
 * Adds:
 *   - credit_limits column on customers (max allowed outstanding balance)
 *   - block_on_exceed column (boolean: stop sale when limit reached)
 *   - warning_threshold_pct (e.g. 80% = warn at 80% of limit)
 *   - customers.credit_used cached value for fast lookup
 *   - customers.credit_available cached value
 *   - credit_limit_history table (track changes for audit)
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. Extend customers with credit limit fields ──
  if (hasTable('customers')) {
    const cols = {
      credit_limit: 'REAL DEFAULT 0',           // 0 = no limit
      block_on_exceed: 'INTEGER DEFAULT 0',     // 1 = block sale when balance > limit
      warning_threshold_pct: 'REAL DEFAULT 80', // warn at X% of limit
      credit_rating: "TEXT DEFAULT 'A'",        // A/B/C/D (auto-assigned by history)
      last_payment_date: 'TEXT',
      last_payment_amount: 'REAL DEFAULT 0',
      avg_payment_days: 'REAL DEFAULT 0',       // rolling avg days to pay
      total_credit_sales: 'REAL DEFAULT 0',
    };
    for (const [c, def] of Object.entries(cols)) {
      if (!hasColumn('customers', c)) {
        db.exec(`ALTER TABLE customers ADD COLUMN ${c} ${def}`);
      }
    }
  }

  // ── 2. credit_limit_history (audit trail of changes) ──
  if (!hasTable('credit_limit_history')) {
    db.exec(`
      CREATE TABLE credit_limit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        old_limit REAL,
        new_limit REAL,
        old_block_flag INTEGER,
        new_block_flag INTEGER,
        reason TEXT,
        changed_by INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (changed_by) REFERENCES users(id)
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_hist_customer ON credit_limit_history(customer_id, created_at)');

  // ── 3. Extend suppliers with credit limit too (BILLTEN parity: parties) ──
  if (hasTable('suppliers')) {
    const cols = {
      credit_limit: 'REAL DEFAULT 0',
      block_on_exceed: 'INTEGER DEFAULT 0',
      warning_threshold_pct: 'REAL DEFAULT 80',
    };
    for (const [c, def] of Object.entries(cols)) {
      if (!hasColumn('suppliers', c)) {
        db.exec(`ALTER TABLE suppliers ADD COLUMN ${c} ${def}`);
      }
    }
  }

  // ── 4. settings defaults ──
  const defaults = [
    ['credit_limit_default', '0'],
    ['credit_limit_default_block', 'false'],
    ['credit_limit_warning_pct', '80'],
  ];
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) insSet.run(k, v);
};

exports.down = function (db) {
  // SQLite cannot drop columns easily; we leave columns in place
  db.exec('DROP TABLE IF EXISTS credit_limit_history');
  db.exec("DELETE FROM settings WHERE key LIKE 'credit_limit_%'");
};
