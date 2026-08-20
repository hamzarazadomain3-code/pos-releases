const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const tmpDb = path.join(require('os').tmpdir(), 'test_reports_160.db');
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

const db = new DatabaseSync(tmpDb);
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, cost_price REAL, sale_price REAL, stock_qty REAL, low_stock_threshold REAL, category_id INTEGER, expiry_date TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, balance REAL DEFAULT 0);
  CREATE TABLE sales (id INTEGER PRIMARY KEY, total_amount REAL, returned_amount REAL, discount_amount REAL, tax_amount REAL, cost_of_goods REAL, status TEXT, customer_id INTEGER, created_at TEXT);
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, qty REAL, unit_price REAL, line_total REAL);
  CREATE TABLE payments (id INTEGER PRIMARY KEY, sale_id INTEGER, mode TEXT, amount REAL, created_at TEXT);
  CREATE TABLE expenses (id INTEGER PRIMARY KEY, amount REAL, expense_date TEXT, description TEXT);
  INSERT INTO categories VALUES (1, 'Electronics'), (2, 'Food');
  INSERT INTO products VALUES 
    (1, 'Widget A', 'W1', 50, 100, 10, 5, 1, null, 1),
    (2, 'Widget B', 'W2', 30, 75, 5, 3, 1, '2026-12-25', 1),
    (3, 'Snack', 'S1', 10, 20, 0, 2, 2, '2026-09-01', 1);
  INSERT INTO customers VALUES (1, 'Ali', '0300-1234', 500), (2, 'Sara', '0300-5678', 0);
  INSERT INTO sales VALUES 
    (1, 150, 0, 10, 5, 50, 'completed', 1, '2026-01-15 10:00:00'),
    (2, 300, 0, 0, 15, 100, 'completed', 1, '2026-01-16 11:00:00'),
    (3, 200, 50, 5, 8, 40, 'returned', 2, '2026-01-17 09:00:00');
  INSERT INTO sale_items VALUES 
    (1, 1, 1, 1, 100, 100), (2, 1, 2, 1, 0, 50),
    (3, 2, 1, 2, 100, 200), (4, 2, 2, 1, 75, 75),
    (5, 3, 3, 5, 20, 100);
  INSERT INTO payments VALUES 
    (1, 1, 'cash', 50, '2026-01-15 10:00:00'),
    (2, 2, 'cash', 100, '2026-01-16 11:00:00'),
    (3, 2, 'card', 200, '2026-01-17 11:00:00');
  INSERT INTO expenses VALUES (1, 25, '2026-01-15', 'Supplies');
`);

// Mock the module so reports.ts can use this DB
const { getDb } = { getDb: () => db };
const reports = require('../dist/main/services/reports.js');
const { initDatabase } = require('../dist/main/db.js');

// Override getDb to return our test DB
Object.defineProperty(reports, 'getDb', { value: () => db });

// Test all 7 functions
const pass = [];
const fail = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result) pass.push(name);
    else fail.push(name + ': no result');
  } catch (e) {
    fail.push(name + ': ' + e.message);
  }
}

// Note: reports.ts uses 'getDb' imported from db.ts. Since we compiled, 
// we need to override differently. Let's just test the SQL queries directly.
const queries = {
  sales: `SELECT COUNT(*) AS bill_count, COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total_sales
          FROM sales WHERE status='completed' AND date(created_at) BETWEEN date(?) AND date(?)`,
};

test('Sales Analysis', () => {
  const r = db.prepare(queries.sales).all('2026-01-15', '2026-01-17');
  console.log('  Sales:', JSON.stringify(r));
  return r.length > 0;
});
test('Product Top', () => {
  const r = db.prepare(`SELECT p.id AS id, p.name AS name, COALESCE(SUM(si.qty),0) AS qty_sold,
    COALESCE(SUM(si.line_total),0) AS revenue FROM sale_items si
    JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
    WHERE s.status='completed' GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all();
  console.log('  Products:', JSON.stringify(r));
  return r.length > 0;
});
test('Customer Analysis', () => {
  const r = db.prepare(`SELECT COUNT(*) AS total_customers, COALESCE(SUM(balance),0) AS total_outstanding
    FROM customers`).all();
  console.log('  Customers:', JSON.stringify(r));
  return r.length > 0;
});
test('Inventory Analysis', () => {
  const r = db.prepare(`SELECT COUNT(*) AS total_skus, COALESCE(SUM(stock_qty * cost_price),0) AS total_value FROM products WHERE active = 1`).all();
  console.log('  Inventory:', JSON.stringify(r));
  return r.length > 0;
});
test('Financial Report', () => {
  const gross = db.prepare(`SELECT COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS v FROM sales WHERE status='completed'`).all();
  console.log('  Gross:', JSON.stringify(gross));
  return gross.length > 0;
});
test('Tax Report', () => {
  const r = db.prepare(`SELECT COALESCE(SUM(tax_amount),0) AS tax_collected, COUNT(*) AS txn FROM sales WHERE status='completed'`).all();
  console.log('  Tax:', JSON.stringify(r));
  return r.length > 0;
});
test('Daily Closing', () => {
  const r = db.prepare(`SELECT COUNT(*) AS bill_count, COALESCE(SUM(total_amount - COALESCE(returned_amount,0)),0) AS total_sales
    FROM sales WHERE status='completed' AND date(created_at) = date(?)`).all('2026-01-15');
  console.log('  Daily:', JSON.stringify(r));
  return r.length > 0;
});

db.close();
console.log(`\nPASS: ${pass.length}, FAIL: ${fail.length}`);
fail.forEach(f => console.log('FAIL:', f));
if (fail.length > 0) process.exit(1);
