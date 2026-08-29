/**
 * Test script for Admin Panel features
 * Run: node scripts/test_admin_panel.js
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const TEST_DB = path.join(__dirname, '..', 'test_admin_panel.db');

// Clean up any previous test DB
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('=== ShopKeeper POS — Admin Panel Test Suite ===\n');

// Initialize database with migrations
const db = new DatabaseSync(TEST_DB);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Run migration 025 directly (skip others since we're testing isolated)
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

// Manually create prerequisite tables that migration 025 depends on
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    pin TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'test', 'owner');

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    start_cash REAL DEFAULT 0,
    end_cash REAL,
    expected_cash REAL,
    variance REAL,
    forced INTEGER DEFAULT 0,
    notes TEXT,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL,
    customer_id INTEGER,
    user_id INTEGER,
    shift_id INTEGER,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'completed',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    amount REAL DEFAULT 0,
    reference TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  );

  CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    reason TEXT,
    refund_amount REAL DEFAULT 0,
    refund_mode TEXT DEFAULT 'cash',
    restock INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  );

  CREATE TABLE IF NOT EXISTS cash_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL DEFAULT 0,
    reason TEXT,
    mode TEXT DEFAULT 'cash',
    user_id INTEGER,
    shift_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    cost_price REAL DEFAULT 0,
    sale_price REAL DEFAULT 0,
    stock_qty REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    balance REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Now run migration 025
const migration = require('../migrations/025_admin_panel.js');
try {
  migration.up(db);
  console.log('[Migration 025] ✓ Applied successfully\n');
} catch (e) {
  console.log(`[Migration 025] ✗ FAILED: ${e.message}\n`);
  process.exit(1);
}

// ═══════════════════════════════════════
// Test 1: Tables created
// ═══════════════════════════════════════
console.log('[1] Database Tables');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cash_drawer_sessions', 'shortcuts', 'feature_toggles', 'admin_roles', 'admin_role_permissions', 'admin_settings')").all();
assert(tables.length === 6, `All 6 new tables created (found ${tables.length})`);

// ═══════════════════════════════════════
// Test 2: Shortcuts seeded
// ═══════════════════════════════════════
console.log('\n[2] Shortcuts');
const shortcuts = db.prepare('SELECT * FROM shortcuts').all();
assert(shortcuts.length === 20, `20 shortcuts seeded (found ${shortcuts.length})`);
const f2 = db.prepare('SELECT * FROM shortcuts WHERE action = ?').get('new_sale');
assert(f2 && f2.shortcut_key === 'F2', `F2 mapped to new_sale`);
const ctrlS = db.prepare('SELECT * FROM shortcuts WHERE action = ?').get('save');
assert(ctrlS && ctrlS.shortcut_key === 'Ctrl+S', `Ctrl+S mapped to save`);

// ═══════════════════════════════════════
// Test 3: Feature toggles seeded
// ═══════════════════════════════════════
console.log('\n[3] Feature Toggles');
const features = db.prepare('SELECT * FROM feature_toggles').all();
assert(features.length === 20, `20 features seeded (found ${features.length})`);
const waFeature = db.prepare('SELECT * FROM feature_toggles WHERE feature_name = ?').get('whatsapp_alerts');
assert(waFeature && waFeature.is_enabled === 1, `WhatsApp alerts enabled by default`);
const smsFeature = db.prepare('SELECT * FROM feature_toggles WHERE feature_name = ?').get('sms_notifications');
assert(smsFeature && smsFeature.is_enabled === 0, `SMS notifications disabled by default`);

// ═══════════════════════════════════════
// Test 4: Roles seeded
// ═══════════════════════════════════════
console.log('\n[4] Admin Roles');
const roles = db.prepare('SELECT * FROM admin_roles').all();
assert(roles.length === 4, `4 system roles seeded (found ${roles.length})`);
const superAdmin = db.prepare('SELECT * FROM admin_roles WHERE name = ?').get('super_admin');
assert(superAdmin && superAdmin.is_system_role === 1, `Super Admin is system role`);
const cashierRole = db.prepare('SELECT * FROM admin_roles WHERE name = ?').get('cashier');
assert(cashierRole && cashierRole.is_system_role === 1, `Cashier is system role`);

// ═══════════════════════════════════════
// Test 5: Permissions seeded
// ═══════════════════════════════════════
console.log('\n[5] Role Permissions');
const allPerms = db.prepare('SELECT * FROM admin_role_permissions').all();
assert(allPerms.length > 0, `Permissions seeded (found ${allPerms.length})`);
const superAdminPerms = db.prepare('SELECT * FROM admin_role_permissions WHERE role_id = ? AND is_allowed = 1').all(superAdmin.id);
assert(superAdminPerms.length === 20, `Super Admin has all 20 permissions (found ${superAdminPerms.length})`);
const cashierPerms = db.prepare('SELECT * FROM admin_role_permissions WHERE role_id = ? AND is_allowed = 1').all(cashierRole.id);
assert(cashierPerms.length === 3, `Cashier has 3 permissions (found ${cashierPerms.length})`);

// ═══════════════════════════════════════
// Test 6: Admin settings seeded
// ═══════════════════════════════════════
console.log('\n[6] Admin Settings');
const settings = db.prepare('SELECT * FROM admin_settings').all();
assert(settings.length === 90, `90 admin settings seeded (found ${settings.length})`);
const currencySetting = db.prepare('SELECT * FROM admin_settings WHERE key = ?').get('currency_symbol');
assert(currencySetting && currencySetting.value === 'Rs', `Currency symbol = Rs`);
const themeSetting = db.prepare('SELECT * FROM admin_settings WHERE key = ?').get('theme');
assert(themeSetting && themeSetting.value === 'light', `Theme = light`);

// ═══════════════════════════════════════
// Test 7: Cash Drawer session
// ═══════════════════════════════════════
console.log('\n[7] Cash Drawer Session');
const shift = db.prepare('INSERT INTO shifts (user_id, start_cash) VALUES (1, 5000)').run();
const shiftId = Number(shift.lastInsertRowid);

const drawer = db.prepare('INSERT INTO cash_drawer_sessions (shift_id, opening_cash, opened_by) VALUES (?, ?, ?)').run(shiftId, 5000, 1);
const drawerId = Number(drawer.lastInsertRowid);
assert(drawerId > 0, `Cash drawer session created (id=${drawerId})`);

// Simulate some sales
db.prepare('INSERT INTO sales (invoice_no, shift_id, total_amount, status) VALUES (?, ?, ?, ?)').run('INV-1001', shiftId, 1500, 'completed');
db.prepare('INSERT INTO payments (sale_id, mode, amount) VALUES (?, ?, ?)').run(1, 'cash', 1000);
db.prepare('INSERT INTO payments (sale_id, mode, amount) VALUES (?, ?, ?)').run(1, 'card', 500);

// Check breakdown
const cashSales = db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND LOWER(p.mode) = 'cash'`).get(shiftId);
assert(cashSales.t === 1000, `Cash sales = 1000 (got ${cashSales.t})`);
const cardSales = db.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND LOWER(p.mode) = 'card'`).get(shiftId);
assert(cardSales.t === 500, `Card sales = 500 (got ${cardSales.t})`);

// Close drawer
db.prepare(`UPDATE cash_drawer_sessions SET closing_cash = ?, closing_time = CURRENT_TIMESTAMP, closed_by = ?, variance = ? WHERE id = ?`).run(5500, 1, 0, drawerId);
const closedDrawer = db.prepare('SELECT * FROM cash_drawer_sessions WHERE id = ?').get(drawerId);
assert(closedDrawer.closing_cash === 5500, `Closing cash = 5500`);
assert(closedDrawer.variance === 0, `Variance = 0`);

// ═══════════════════════════════════════
// Test 8: Activity log
// ═══════════════════════════════════════
console.log('\n[8] Activity Log');
db.prepare('INSERT INTO activity_log (user_id, action, entity, details) VALUES (?, ?, ?, ?)').run(1, 'cash_drawer_opened', 'cash_drawer', 'shift=1 opening=5000');
db.prepare('INSERT INTO activity_log (user_id, action, entity, details) VALUES (?, ?, ?, ?)').run(1, 'cash_drawer_closed', 'cash_drawer', 'closing=5500 expected=5500 variance=0');
const logs = db.prepare('SELECT * FROM activity_log WHERE action LIKE ?').all('cash_drawer%');
assert(logs.length === 2, `Cash drawer activity logged (found ${logs.length})`);

// ═══════════════════════════════════════
// Test 9: Idempotent migration
// ═══════════════════════════════════════
console.log('\n[9] Idempotent Migration');
try {
  migration.up(db);
  console.log('  ✓ Re-running migration did not throw');
  passed++;
} catch (e) {
  console.log(`  ✗ Re-running migration threw: ${e.message}`);
  failed++;
}

// Cleanup
db.close();
fs.unlinkSync(TEST_DB);

console.log(`\n══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════`);

process.exit(failed > 0 ? 1 : 0);
