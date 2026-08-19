exports.up = function (db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const has = (t) => tables.has(t);
    const count = (sql, ...args) => (db.prepare(sql).get(...args) || {}).c || 0;

    const TEST_CUSTOMERS = ['Ahmed', 'Udhaar Test', 'Return Customer', 'Return Udhaar Cust', 'Return Credit Cust'];
    const TEST_SUPPLIERS = ['Test Supplier'];
    const TEST_PROMOS = ['A 10% off', 'A 20% off', 'A 30% off', 'Buy2 Get1 Free', 'Cat Rs10 off', 'D Cat 10 off', 'D Prod 10 off', 'Expired Deal'];
    const TEST_PRODUCTS = ['Example Product A', 'Example Product B', 'juice', 'cake'];
    const TEST_CATEGORIES = ['Grocery', 'Beverages', 'bakery'];
    const CUTOFF = '2026-08-16 00:00:00';

    const ph = (n) => Array(n).fill('?').join(', ');

    const testCustomerIds = () =>
      (db.prepare(
        "SELECT id FROM customers WHERE (name = 'Ahmed' AND phone = '03001234567') OR name IN (" +
          ph(TEST_CUSTOMERS.length) + ') AND created_at < ?'
      ).all(...TEST_CUSTOMERS, CUTOFF).map((r) => r.id));
    const testSaleIds = () =>
      db.prepare("SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%'").all().map((r) => r.id);
    const testSupplierIds = () =>
      db.prepare("SELECT id FROM suppliers WHERE name IN (" + ph(TEST_SUPPLIERS.length) + ')').all(...TEST_SUPPLIERS).map((r) => r.id);

    if (has('customer_transactions') && count('SELECT COUNT(*) AS c FROM customer_transactions WHERE created_at < ?', CUTOFF) > 0) {
      db.prepare('DELETE FROM customer_transactions WHERE created_at < ?').run(CUTOFF);
    }

    if (has('payments') && count("SELECT COUNT(*) AS c FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')") > 0) {
      db.prepare("DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')").run();
    }

    if (has('sale_items') && count("SELECT COUNT(*) AS c FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')") > 0) {
      db.prepare("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')").run();
    }

    if (has('returns') && count("SELECT COUNT(*) AS c FROM returns WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')") > 0) {
      db.prepare("DELETE FROM returns WHERE sale_id IN (SELECT id FROM sales WHERE invoice_no LIKE 'INV-20260814-%')").run();
    }

    if (has('sales') && count("SELECT COUNT(*) AS c FROM sales WHERE invoice_no LIKE 'INV-20260814-%'") > 0) {
      db.prepare("DELETE FROM sales WHERE invoice_no LIKE 'INV-20260814-%'").run();
    }

    const customerIds = testCustomerIds();
    if (has('customers') && customerIds.length > 0) {
      db.prepare(
        "DELETE FROM customers WHERE (name = 'Ahmed' AND phone = '03001234567' AND created_at < ?) OR (name IN (" +
          ph(TEST_CUSTOMERS.length) + ') AND created_at < ?)'
      ).run(CUTOFF, ...TEST_CUSTOMERS, CUTOFF);
    }

    if (has('audit_items') && count('SELECT COUNT(*) AS c FROM audit_items WHERE audit_id IN (SELECT id FROM audits WHERE created_at < ?)', CUTOFF) > 0) {
      db.prepare('DELETE FROM audit_items WHERE audit_id IN (SELECT id FROM audits WHERE created_at < ?)').run(CUTOFF);
    }

    if (has('audits') && count('SELECT COUNT(*) AS c FROM audits WHERE created_at < ?', CUTOFF) > 0) {
      db.prepare('DELETE FROM audits WHERE created_at < ?').run(CUTOFF);
    }

    const supplierIds = testSupplierIds();
    if (supplierIds.length > 0) {
      if (has('purchase_orders') && count('SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id IN (' + ph(supplierIds.length) + ')', ...supplierIds) > 0) {
        db.prepare('DELETE FROM purchase_orders WHERE supplier_id IN (' + ph(supplierIds.length) + ')').run(...supplierIds);
      }
      if (has('supplier_transactions') && count('SELECT COUNT(*) AS c FROM supplier_transactions WHERE supplier_id IN (' + ph(supplierIds.length) + ')', ...supplierIds) > 0) {
        db.prepare('DELETE FROM supplier_transactions WHERE supplier_id IN (' + ph(supplierIds.length) + ')').run(...supplierIds);
      }
    }

    if (has('purchase_items') && count('SELECT COUNT(*) AS c FROM purchase_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE supplier_id IN (' + ph(supplierIds.length) + '))', ...supplierIds) > 0) {
      db.prepare('DELETE FROM purchase_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE supplier_id IN (' + ph(supplierIds.length) + '))').run(...supplierIds);
    }

    if (has('purchase_price_history') && count('SELECT COUNT(*) AS c FROM purchase_price_history WHERE created_at < ?', CUTOFF) > 0) {
      db.prepare('DELETE FROM purchase_price_history WHERE created_at < ?').run(CUTOFF);
    }

    if (has('suppliers') && count('SELECT COUNT(*) AS c FROM suppliers WHERE name IN (' + ph(TEST_SUPPLIERS.length) + ')', ...TEST_SUPPLIERS) > 0) {
      db.prepare('DELETE FROM suppliers WHERE name IN (' + ph(TEST_SUPPLIERS.length) + ')').run(...TEST_SUPPLIERS);
    }

    if (has('promotions') && count('SELECT COUNT(*) AS c FROM promotions WHERE name IN (' + ph(TEST_PROMOS.length) + ') AND created_at < ?', ...TEST_PROMOS, CUTOFF) > 0) {
      db.prepare('DELETE FROM promotions WHERE name IN (' + ph(TEST_PROMOS.length) + ') AND created_at < ?').run(...TEST_PROMOS, CUTOFF);
    }

    if (has('shifts') && count('SELECT COUNT(*) AS c FROM shifts WHERE opened_at < ?', CUTOFF) > 0) {
      db.prepare('DELETE FROM shifts WHERE opened_at < ?').run(CUTOFF);
    }

    const productIds = db
      .prepare('SELECT id FROM products WHERE created_at = ? AND name IN (' + ph(TEST_PRODUCTS.length) + ')')
      .all('2026-08-15 09:05:13', ...TEST_PRODUCTS)
      .map((r) => r.id);

    if (has('stock_movements') && productIds.length > 0 && count('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id IN (' + ph(productIds.length) + ')', ...productIds) > 0) {
      db.prepare('DELETE FROM stock_movements WHERE product_id IN (' + ph(productIds.length) + ')').run(...productIds);
    }

    if (has('stock_movements') && count('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id NOT IN (SELECT id FROM products)') > 0) {
      db.prepare('DELETE FROM stock_movements WHERE product_id NOT IN (SELECT id FROM products)').run();
    }

    if (has('products') && productIds.length > 0) {
      db.prepare('DELETE FROM products WHERE id IN (' + ph(productIds.length) + ')').run(...productIds);
    }

    if (has('categories') && count('SELECT COUNT(*) AS c FROM categories WHERE name IN (' + ph(TEST_CATEGORIES.length) + ') AND created_at < ?', ...TEST_CATEGORIES, CUTOFF) > 0) {
      db.prepare('DELETE FROM categories WHERE name IN (' + ph(TEST_CATEGORIES.length) + ') AND created_at < ?').run(...TEST_CATEGORIES, CUTOFF);
    }

    if (has('activity_log') && count('SELECT COUNT(*) AS c FROM activity_log WHERE created_at < ?', CUTOFF) > 0) {
      db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(CUTOFF);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

exports.down = function () {};
