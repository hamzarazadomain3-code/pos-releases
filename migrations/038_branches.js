/**
 * Migration 038 — Multi-Branch Support (v2.4.0)
 *
 * Adds:
 *   - branches table (for multi-store operations)
 *   - branch_id on major transaction tables
 *   - default_branch_id in settings
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  if (!hasTable('branches')) {
    db.exec(`
      CREATE TABLE branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        email TEXT,
        is_active INTEGER DEFAULT 1,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Add branch_id to key tables (schema evolution)
  const tablesWithBranch = [
    'sales', 'sale_items', 'payments', 'purchase_orders', 'purchase_items',
    'shifts', 'stock_movements', 'activity_log'
  ];
  for (const tbl of tablesWithBranch) {
    if (hasTable(tbl) && !hasColumn(tbl, 'branch_id')) {
      // SQLite doesn't support subquery in DEFAULT for ALTER TABLE
      // Add column without default, then update
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN branch_id INTEGER`);
      // Update with default branch id
      const defaultBranch = db.prepare(`SELECT id FROM branches WHERE is_default = 1 LIMIT 1`).get();
      if (defaultBranch) {
        db.exec(`UPDATE ${tbl} SET branch_id = ${defaultBranch.id} WHERE branch_id IS NULL`);
      }
    }
  }

  // Set has_variants on products (if not already done)
  if (hasTable('products') && !hasColumn('products', 'has_variants')) {
    db.exec(`ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0`);
  }

  // Add permitencias on customers (for credit) if not exist
  if (hasTable('customers') && !hasColumn('customers', 'block_on_exceed')) {
    db.exec(`ALTER TABLE customers ADD COLUMN block_on_exceed INTEGER DEFAULT 0`);
  }
  if (hasTable('customers') && !hasColumn('customers', 'credit_limit')) {
    db.exec(`ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0`);
  }

  // Seed first branch as default
  const defaultExists = db.prepare(`SELECT id FROM branches WHERE is_default = 1 LIMIT 1`).get();
  if (!defaultExists) {
    db.exec(`
      INSERT INTO branches (name, address, is_default, is_active)
      VALUES ('Main Shop', 'Shop Address', 1, 1)
    `);
  }

  // Settings for current branch
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insSetting.run('default_branch_id', '1');
  insSetting.run('current_branch_id', '1');
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS branches');
  const tables = ['sales', 'sale_items', 'payments', 'purchase_orders', 'purchase_items', 'shifts', 'stock_movements', 'activity_log'];
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`); // SQLite has issues dropping columns; skip for now
  }
};