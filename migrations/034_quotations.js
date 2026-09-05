/**
 * Migration 034 — Quotation Module (v2.4.0)
 *
 * Adds:
 *   - quotations table (header)
 *   - quotation_items table (line items)
 *   - Convert quotation to sale with one click
 *   - Valid-until date enforcement
 *   - Status tracking (draft, sent, accepted, rejected, expired, converted)
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. quotations (header) ──
  if (!hasTable('quotations')) {
    db.exec(`
      CREATE TABLE quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_no TEXT UNIQUE NOT NULL,
        customer_id INTEGER,
        user_id INTEGER NOT NULL,
        shift_id INTEGER,
        valid_until DATE,
        status TEXT DEFAULT 'draft',   -- draft | sent | accepted | rejected | expired | converted
        subtotal REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        discount_pct REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        notes TEXT,
        terms TEXT,
        converted_sale_id INTEGER,
        converted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        updated_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (shift_id) REFERENCES shifts(id),
        FOREIGN KEY (converted_sale_id) REFERENCES sales(id)
      )
    `);
  }

  // ── 2. quotation_items (line items) ──
  if (!hasTable('quotation_items')) {
    db.exec(`
      CREATE TABLE quotation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        qty REAL NOT NULL,
        unit_price REAL NOT NULL,
        unit_cost REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        discount_pct REAL DEFAULT 0,
        tax_rate REAL DEFAULT 0,
        line_total REAL NOT NULL,
        FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_quotations_valid ON quotations(valid_until, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quotation_items(quotation_id)');

  // ── 3. settings defaults ──
  const defaults = [
    ['quotation_prefix', 'QT-'],
    ['quotation_valid_days', '7'],
    ['quotation_terms', '1. Prices valid until valid-until date.\n2. Goods once sold will not be taken back.\n3. Subject to local jurisdiction.'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) ins.run(k, v);
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS quotation_items');
  db.exec('DROP TABLE IF EXISTS quotations');
  db.exec("DELETE FROM settings WHERE key IN ('quotation_prefix','quotation_valid_days','quotation_terms')");
};
