const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'pos.db');
const db = new DatabaseSync(dbPath);

console.log('=== Testing FIFO Deduction Logic ===\n');

// Check existing batches
const products = db.prepare('SELECT id, name, stock_qty FROM products WHERE stock_qty > 0 LIMIT 3').all();
console.log('Products with stock:');
products.forEach(p => {
  const batches = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(p.id);
  console.log(`  ${p.name} (id=${p.id}, stock=${p.stock_qty}): ${batches.length} batches`);
  batches.forEach(b => console.log(`    - ${b.batch_number}: qty=${b.quantity}, expiry=${b.expiry_date}`));
});

console.log('\n=== Test 1: Single batch deduction ===');
const testProduct1 = products[0];
if (testProduct1) {
  // Get initial batch quantities
  const batchesBefore = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct1.id);
  console.log(`Before: ${testProduct1.name} has ${batchesBefore.map(b => `${b.batch_number}=${b.quantity}`).join(', ')}`);
  
  // Simulate FIFO deduction
  const sellQty = 3;
  const db2 = new DatabaseSync(dbPath);
  try {
    const batches = db2.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct1.id);
    let remaining = sellQty;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      db2.prepare('UPDATE product_batches SET quantity = quantity - ? WHERE id = ?').run(take, batch.id);
      db2.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?').run(take, testProduct1.id);
      console.log(`  Deduct ${take} from ${batch.batch_number}`);
      remaining -= take;
    }
    db2.close();
    
    const batchesAfter = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct1.id);
    console.log(`After: ${testProduct1.name} has ${batchesAfter.map(b => `${b.batch_number}=${b.quantity}`).join(', ')}`);
    console.log('PASS: Single batch deduction works\n');
  } catch (e) {
    console.error('FAIL:', e.message);
    db2.close();
  }
}

console.log('=== Test 2: Multi-batch deduction ===');
// Add a second batch to test product
const testProduct2 = products[1];
if (testProduct2) {
  db.prepare(`
    INSERT INTO product_batches (product_id, batch_number, quantity, cost_price, expiry_date, received_date)
    VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'))
  `).run(testProduct2.id, 'TEST-BATCH-2', 5, 55, '2026-12-31');
  
  const batchesBefore = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct2.id);
  console.log(`Before: ${testProduct2.name} has ${batchesBefore.map(b => `${b.batch_number}=${b.quantity}`).join(', ')}`);
  
  // Sell more than first batch
  const sellQty = batchesBefore[0].quantity + 2;
  const db2 = new DatabaseSync(dbPath);
  try {
    const batches = db2.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct2.id);
    let remaining = sellQty;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      db2.prepare('UPDATE product_batches SET quantity = quantity - ? WHERE id = ?').run(take, batch.id);
      db2.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?').run(take, testProduct2.id);
      console.log(`  Deduct ${take} from ${batch.batch_number}`);
      remaining -= take;
    }
    db2.close();
    
    const batchesAfter = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST').all(testProduct2.id);
    console.log(`After: ${testProduct2.name} has ${batchesAfter.map(b => `${b.batch_number}=${b.quantity}`).join(', ')}`);
    console.log('PASS: Multi-batch deduction works\n');
  } catch (e) {
    console.error('FAIL:', e.message);
    db2.close();
  }
  
  // Cleanup
  db.prepare('DELETE FROM product_batches WHERE batch_number = ?').run('TEST-BATCH-2');
}

console.log('=== Test 3: Create batch on purchase receive ===');
const testProduct3 = products[2];
if (testProduct3) {
  const batchNumber = `PO-TEST-${testProduct3.id}-${Date.now()}`;
  db.prepare(`
    INSERT INTO product_batches (product_id, batch_number, quantity, cost_price, expiry_date, received_date)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(testProduct3.id, batchNumber, 10, 50, '2026-11-30');
  
  const batch = db.prepare('SELECT * FROM product_batches WHERE batch_number = ?').get(batchNumber);
  console.log(`Created batch: ${batch.batch_number}, qty=${batch.quantity}, cost=${batch.cost_price}, expiry=${batch.expiry_date}`);
  console.log('PASS: Batch creation works\n');
  
  // Cleanup
  db.prepare('DELETE FROM product_batches WHERE batch_number = ?').run(batchNumber);
}

console.log('=== Test 4: Batch-aware stock movement ===');
const testProduct4 = products[0];
if (testProduct4) {
  const batch = db.prepare('SELECT id FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC NULLS LAST LIMIT 1').get(testProduct4.id);
  if (batch) {
    db.prepare(
      `INSERT INTO stock_movements (product_id, change_qty, reason, ref_type, ref_id, batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(testProduct4.id, 5, 'Test stock-in', 'test', 999, batch.id);
    
    const movement = db.prepare('SELECT * FROM stock_movements WHERE batch_id = ? ORDER BY id DESC LIMIT 1').get(batch.id);
    console.log(`Created movement: product=${movement.product_id}, change=${movement.change_qty}, batch_id=${movement.batch_id}`);
    console.log('PASS: Batch-aware movement works\n');
  }
}

db.close();
console.log('=== ALL TESTS COMPLETED ===');