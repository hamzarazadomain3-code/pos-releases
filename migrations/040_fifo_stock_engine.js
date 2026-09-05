/**
 * Migration 040 — FIFO Stock Engine (v2.5.0)
 *
 * Adds:
 *   - fifo_allocations table: tracks which batch quantities were allocated to which sale
 *   - Extends sale_items with batch_id for FIFO traceability
 *   - Settings for FIFO enable/disable
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. fifo_allocations table ──
  if (!hasTable('fifo_allocations')) {
    db.exec(`
      CREATE TABLE fifo_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_item_id INTEGER NOT NULL,
        product_batch_id INTEGER NOT NULL,
        allocated_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE,
        FOREIGN KEY (product_batch_id) REFERENCES product_batches(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_fifo_sale_item ON fifo_allocations(sale_item_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_fifo_batch ON fifo_allocations(product_batch_id)');

  // ── 2. Extend sale_items with batch_id for direct linkage ──
  if (hasTable('sale_items') && !hasColumn('sale_items', 'batch_id')) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN batch_id INTEGER`);
  }

  // ── 3. Settings ──
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ins.run('fifo_enabled', 'true');
  ins.run('fifo_strict_mode', 'false'); // if true, block sale when no batch available
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS fifo_allocations');
  db.exec("DELETE FROM settings WHERE key IN ('fifo_enabled','fifo_strict_mode')");
  // batch_id column not dropped (SQLite limitation)
};