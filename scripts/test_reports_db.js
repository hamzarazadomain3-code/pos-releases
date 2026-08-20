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

console.log('DB created at:', tmpDb);
db.close();
console.log('Schema + sample data setup complete.');
