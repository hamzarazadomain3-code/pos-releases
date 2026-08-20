const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const tmpDb = path.join(require('os').tmpdir(), 'mig024_test.db');
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

const db = new DatabaseSync(tmpDb);

// Apply all migrations up to 023
const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();

for (const mig of migrations) {
  const migration = require(path.join(migrationsDir, mig));
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    migration.up(db);
    console.log('  ✓', mig);
  } catch (e) {
    console.error('  ✗', mig, e.message);
  }
}

// Verify new columns
const check = (table, col) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
};

console.log('\n=== Column verification ===');
console.log('suppliers.email:', check('suppliers', 'email'));
console.log('suppliers.is_active:', check('suppliers', 'is_active'));
console.log('suppliers.average_rate:', check('suppliers', 'average_rate'));
console.log('purchase_orders.delivery_date:', check('purchase_orders', 'delivery_date'));
console.log('purchase_orders.notes:', check('purchase_orders', 'notes'));
console.log('purchase_items.quantity_received:', check('purchase_items', 'quantity_received'));
console.log('purchase_items.total_cost:', check('purchase_items', 'total_cost'));
console.log('purchase_items.unit_name:', check('purchase_items', 'unit_name'));
console.log('products.min_stock_level:', check('products', 'min_stock_level'));
console.log('products.reorder_qty:', check('products', 'reorder_qty'));
console.log('products.last_supplier_id:', check('products', 'last_supplier_id'));

// Verify new tables
const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
console.log('\n=== Table verification ===');
console.log('inventory_snapshots:', hasTable('inventory_snapshots'));
console.log('product_profitability:', hasTable('product_profitability'));
console.log('alert_log:', hasTable('alert_log'));

// Verify indexes
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all();
console.log('\n=== New indexes ===');
indexes.forEach(i => console.log('  ', i.name));

// Verify settings
const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('expiry_warning_days', 'low_stock_warning_days', 'slow_mover_days', 'low_profit_threshold')").all();
console.log('\n=== Default settings ===');
settings.forEach(s => console.log('  ', s.key, '=', s.value));

// Insert a product and backfill test
db.prepare('INSERT INTO products (sku, barcode, name, category_id, unit_id, cost_price, sale_price, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('SKU001', '10001', 'Biscuits', 1, 1, 10, 50, 100, 20);
const prod = db.prepare('SELECT * FROM products WHERE id = 1').get();
console.log('\n=== Backfill test ===');
console.log('Product min_stock_level (should be 20 from low_stock_threshold):', prod.min_stock_level);

db.close();
fs.unlinkSync(tmpDb);
console.log('\nMigration 024 verification complete.');
