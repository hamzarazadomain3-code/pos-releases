/**
 * Migration 024 — Advanced Inventory Reports (v1.8.0)
 *
 * Adds schema for:
 *   - Daily inventory snapshots (for variance / shrinkage detection)
 *   - Product profitability cache (period-based profit/loss aggregation)
 *   - Alert log (smart alerts: low stock, expiry, low profit, slow movers)
 *
 * Extends existing tables with new analytical columns.
 * Uses hasColumn / hasTable guards so it is idempotent on existing databases.
 */
exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };
  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };

  // ── 1. Extend suppliers (migration 001 only has id, name, phone, address, created_at, balance)
  const supplierCols = {
    email: 'TEXT',
    city: 'TEXT',
    payment_terms: 'TEXT',           // cash, credit 7/14/30 days
    average_rate: 'REAL DEFAULT 0',
    reliability_score: 'REAL DEFAULT 5.0', // 1-5 stars
    total_orders: 'INTEGER DEFAULT 0',
    on_time_delivery_pct: 'REAL DEFAULT 100',
    is_active: 'INTEGER DEFAULT 1',
  };
  for (const [col, def] of Object.entries(supplierCols)) {
    if (hasTable('suppliers') && !hasColumn('suppliers', col)) {
      db.exec(`ALTER TABLE suppliers ADD COLUMN ${col} ${def}`);
    }
  }

  // ── 2. Extend purchase_orders (add delivery_date, notes, updated_at)
  const poCols = {
    delivery_date: 'DATETIME',
    notes: 'TEXT',
    updated_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  };
  for (const [col, def] of Object.entries(poCols)) {
    if (hasTable('purchase_orders') && !hasColumn('purchase_orders', col)) {
      db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${col} ${def}`);
    }
  }

  // ── 3. Extend purchase_items (add quantity_received, total_cost, unit_name)
  //    batch_number and expiry_date already exist from migration 018.
  const piCols = {
    quantity_received: 'REAL DEFAULT NULL',  // NULL = fully received (equals qty)
    total_cost: 'REAL DEFAULT 0',
    unit_name: 'TEXT',                        // e.g. "kg", "litre", "piece"
  };
  for (const [col, def] of Object.entries(piCols)) {
    if (hasTable('purchase_items') && !hasColumn('purchase_items', col)) {
      db.exec(`ALTER TABLE purchase_items ADD COLUMN ${col} ${def}`);
    }
  }

  // ── 4. Extend products (add min_stock_level, reorder_qty, last_supplier_id)
  //    low_stock_threshold already exists from migration 001.
  //    plu_code and whatsapp_notify already exist from migration 023.
  const pCols = {
    min_stock_level: 'REAL DEFAULT 0',
    reorder_qty: 'REAL DEFAULT NULL',
    last_supplier_id: 'INTEGER',
  };
  for (const [col, def] of Object.entries(pCols)) {
    if (hasTable('products') && !hasColumn('products', col)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${col} ${def}`);
    }
  }

  // Backfill min_stock_level from low_stock_threshold where not set
  db.exec(`
    UPDATE products
    SET min_stock_level = low_stock_threshold
    WHERE min_stock_level = 0 AND low_stock_threshold > 0
  `);

  // ── 5. New table: inventory_snapshots (daily opening/closing for variance detection)
  if (!hasTable('inventory_snapshots')) {
    db.exec(`
      CREATE TABLE inventory_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_date DATE NOT NULL,
        product_id INTEGER NOT NULL,
        opening_qty REAL DEFAULT 0,
        purchases_qty REAL DEFAULT 0,
        sales_qty REAL DEFAULT 0,
        closing_qty REAL DEFAULT 0,
        variance_qty REAL DEFAULT 0,
        variance_value REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(snapshot_date, product_id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_date ON inventory_snapshots(snapshot_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_product ON inventory_snapshots(product_id)');

  // ── 6. New table: product_profitability (cached period-based profit/loss)
  if (!hasTable('product_profitability')) {
    db.exec(`
      CREATE TABLE product_profitability (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        period_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly', 'quarterly'
        period_date DATE NOT NULL,
        units_sold REAL DEFAULT 0,
        cost_of_goods REAL DEFAULT 0,
        revenue REAL DEFAULT 0,
        gross_profit REAL DEFAULT 0,
        profit_margin_pct REAL DEFAULT 0,
        avg_cost REAL DEFAULT 0,
        avg_selling_price REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, period_type, period_date),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_profit_period ON product_profitability(period_type, period_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_profit_product ON product_profitability(product_id, period_type)');

  // ── 7. New table: alert_log (smart alerts)
  if (!hasTable('alert_log')) {
    db.exec(`
      CREATE TABLE alert_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL, -- low_stock, out_of_stock, expiry_soon, expired, low_profit, slow_mover
        product_id INTEGER,
        supplier_id INTEGER,
        severity TEXT NOT NULL, -- 'critical', 'warning', 'info'
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        action_taken TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_type ON alert_log(alert_type, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alert_log(is_read, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_product ON alert_log(product_id, created_at)');

  // ── 8. Settings defaults for advanced reports
  const settingsKeys = [
    ['expiry_warning_days', '30'],        // days before expiry to alert
    ['low_stock_warning_days', '7'],      // days of sales remaining at current rate
    ['slow_mover_days', '60'],            // no sales in X days = slow mover
    ['low_profit_threshold', '5'],        // profit margin % below which to warn
  ];
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of settingsKeys) {
    insSetting.run(k, v);
  }
};

exports.down = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };
  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };

  // Drop new tables
  db.exec('DROP TABLE IF EXISTS alert_log');
  db.exec('DROP TABLE IF EXISTS product_profitability');
  db.exec('DROP TABLE IF EXISTS inventory_snapshots');

  // Drop new columns from products
  if (hasColumn('products', 'last_supplier_id')) db.exec('ALTER TABLE products DROP COLUMN last_supplier_id');
  if (hasColumn('products', 'reorder_qty')) db.exec('ALTER TABLE products DROP COLUMN reorder_qty');
  if (hasColumn('products', 'min_stock_level')) db.exec('ALTER TABLE products DROP COLUMN min_stock_level');

  // Drop new columns from purchase_items
  if (hasColumn('purchase_items', 'unit_name')) db.exec('ALTER TABLE purchase_items DROP COLUMN unit_name');
  if (hasColumn('purchase_items', 'total_cost')) db.exec('ALTER TABLE purchase_items DROP COLUMN total_cost');
  if (hasColumn('purchase_items', 'quantity_received')) db.exec('ALTER TABLE purchase_items DROP COLUMN quantity_received');

  // Drop new columns from purchase_orders (reverse order)
  if (hasColumn('purchase_orders', 'updated_at')) db.exec('ALTER TABLE purchase_orders DROP COLUMN updated_at');
  if (hasColumn('purchase_orders', 'notes')) db.exec('ALTER TABLE purchase_orders DROP COLUMN notes');
  if (hasColumn('purchase_orders', 'delivery_date')) db.exec('ALTER TABLE purchase_orders DROP COLUMN delivery_date');

  // Drop new columns from suppliers (reverse order)
  if (hasColumn('suppliers', 'is_active')) db.exec('ALTER TABLE suppliers DROP COLUMN is_active');
  if (hasColumn('suppliers', 'on_time_delivery_pct')) db.exec('ALTER TABLE suppliers DROP COLUMN on_time_delivery_pct');
  if (hasColumn('suppliers', 'total_orders')) db.exec('ALTER TABLE suppliers DROP COLUMN total_orders');
  if (hasColumn('suppliers', 'reliability_score')) db.exec('ALTER TABLE suppliers DROP COLUMN reliability_score');
  if (hasColumn('suppliers', 'average_rate')) db.exec('ALTER TABLE suppliers DROP COLUMN average_rate');
  if (hasColumn('suppliers', 'payment_terms')) db.exec('ALTER TABLE suppliers DROP COLUMN payment_terms');
  if (hasColumn('suppliers', 'city')) db.exec('ALTER TABLE suppliers DROP COLUMN city');
  if (hasColumn('suppliers', 'email')) db.exec('ALTER TABLE suppliers DROP COLUMN email');

  // Clean up settings
  db.exec("DELETE FROM settings WHERE key IN ('expiry_warning_days', 'low_stock_warning_days', 'slow_mover_days', 'low_profit_threshold')");
};
