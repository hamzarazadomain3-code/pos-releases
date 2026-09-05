/**
 * Migration 041 — Salesman Commission Tracking (v2.5.0)
 *
 * Adds:
 *   - commission_rules table: flexible commission rules (percent/fixed, per product/category)
 *   - salesman_commissions table: tracks commissions per sale
 *   - Extends users with is_salesman, commission_rate defaults
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. commission_rules ──
  if (!hasTable('commission_rules')) {
    db.exec(`
      CREATE TABLE commission_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,              -- 'percent' | 'fixed'
        value REAL NOT NULL,             -- percent (5.0) or fixed amount (50.0)
        scope TEXT NOT NULL,             -- 'global' | 'category' | 'product'
        category_id INTEGER,
        product_id INTEGER,
        min_qty INTEGER DEFAULT 1,
        max_qty INTEGER,
        min_amount REAL,
        max_amount REAL,
        start_date DATE,
        end_date DATE,
        is_active INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,       -- higher = applied first
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_comm_rules_scope ON commission_rules(scope, is_active)');

  // ── 2. salesman_commissions ──
  if (!hasTable('salesman_commissions')) {
    db.exec(`
      CREATE TABLE salesman_commissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        sale_item_id INTEGER,
        salesman_id INTEGER NOT NULL,
        rule_id INTEGER,
        commission_amount REAL NOT NULL,
        base_amount REAL NOT NULL,
        commission_type TEXT NOT NULL,    -- 'percent' | 'fixed'
        commission_rate REAL NOT NULL,
        status TEXT DEFAULT 'pending',    -- 'pending' | 'approved' | 'paid' | 'cancelled'
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME,
        approved_by INTEGER,
        paid_at DATETIME,
        paid_by INTEGER,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE SET NULL,
        FOREIGN KEY (salesman_id) REFERENCES users(id),
        FOREIGN KEY (rule_id) REFERENCES commission_rules(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_comm_sale ON salesman_commissions(sale_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_comm_salesman ON salesman_commissions(salesman_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_comm_status ON salesman_commissions(status)');

  // ── 3. Extend users ──
  if (hasTable('users') && !hasColumn('users', 'is_salesman')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_salesman INTEGER DEFAULT 0`);
  }
  if (hasTable('users') && !hasColumn('users', 'commission_rate')) {
    db.exec(`ALTER TABLE users ADD COLUMN commission_rate REAL DEFAULT 0`);
  }

  // ── 4. Settings ──
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ins.run('commission_enabled', 'true');
  ins.run('commission_auto_approve', 'false');
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS salesman_commissions');
  db.exec('DROP TABLE IF EXISTS commission_rules');
  // Columns not dropped (SQLite limitation)
  db.exec("DELETE FROM settings WHERE key IN ('commission_enabled','commission_auto_approve')");
};