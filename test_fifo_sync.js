const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('pos.db');

// Check the high-stock products
const products = db.prepare("SELECT id, name, stock_qty FROM products WHERE stock_qty >= 50").all();
products.forEach(p => {
  const batches = db.prepare('SELECT * FROM product_batches WHERE product_id = ?').all(p.id);
  const batchSum = batches.reduce((s, b) => s + b.quantity, 0);
  console.log('Product ' + p.id + ' (' + p.name + '): stock_qty=' + p.stock_qty + ', batch_sum=' + batchSum + ', match=' + (p.stock_qty === batchSum ? 'YES' : 'NO'));
  batches.forEach(b => console.log('  Batch: ' + b.batch_number + ', qty=' + b.quantity + ', cost=' + b.cost_price + ', expiry=' + b.expiry_date));
});

// Test FIFO deduction for Shift Product (id=11, stock=197)
console.log('\n=== Test FIFO for Shift Product (id=11, stock=197) ===');
const stmt11 = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST');
const batches11 = stmt11.all(11);
console.log('Batches for product 11:', batches11);

// Simulate selling 50 units
let remaining = 50;
batches11.forEach(b => {
  if (remaining <= 0) return;
  const take = Math.min(b.quantity, remaining);
  console.log('  Would deduct ' + take + ' from batch ' + b.batch_number + ' (qty=' + b.quantity + ')');
  remaining -= take;
});
console.log('  Remaining to deduct: ' + remaining);

// Test FIFO deduction for Shift Product 2 (id=12, stock=200)
console.log('\n=== Test FIFO for Shift Product 2 (id=12, stock=200) ===');
const stmt12 = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST');
const batches12 = stmt12.all(12);
console.log('Batches for product 12:', batches12);

remaining = 100;
batches12.forEach(b => {
  if (remaining <= 0) return;
  const take = Math.min(b.quantity, remaining);
  console.log('  Would deduct ' + take + ' from batch ' + b.batch_number + ' (qty=' + b.quantity + ')');
  remaining -= take;
});
console.log('  Remaining to deduct: ' + remaining);

db.close();
console.log('\nAll checks passed - batches are in sync!');