exports.up = function (db) {
  // Ensure consistent rounding for stock quantities (3 decimal places for KG precision)
  db.exec(`
    UPDATE products
    SET stock_qty = ROUND(stock_qty, 3)
    WHERE stock_qty != ROUND(stock_qty, 3);
  `);

  // Ensure batch quantities are rounded to 3 decimal places as well
  db.exec(`
    UPDATE product_batches
    SET quantity = ROUND(quantity, 3)
    WHERE quantity != ROUND(quantity, 3);
  `);

  // Clean up display_qty in sale_items (should be integer gram values)
  db.exec(`
    UPDATE sale_items
    SET display_qty = ROUND(display_qty)
    WHERE display_qty IS NOT NULL AND display_qty != ROUND(display_qty);
  `);
};

exports.down = function () {}