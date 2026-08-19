exports.up = function (db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const names = [
      'Test Product',
      'Test Product 2',
      'Billing Test',
      'Purchase Product',
      'Return Product',
      'Audit Item A',
      'Audit Item B',
      'Promo A',
      'Promo B',
      'Promo C',
      'Promo D',
      'Shift Product',
      'Shift Product 2',
      'Promo Cat'
    ];
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const placeholders = names.map(() => '?').join(', ');
    const row = db.prepare(
      'SELECT COUNT(*) as c FROM products WHERE name IN (' + placeholders + ')'
    ).get(...names);
    const count = row ? row.c : 0;
    if (count > 0) {
      const deleteByProduct = (table) => {
        if (tables.has(table)) {
          db.prepare(
            'DELETE FROM ' + table + ' WHERE product_id IN (SELECT id FROM products WHERE name IN (' + placeholders + '))'
          ).run(...names);
        }
      };
      deleteByProduct('audit_items');
      deleteByProduct('purchase_price_history');
      deleteByProduct('return_items');
      deleteByProduct('sale_items');
      deleteByProduct('stock_movements');
      deleteByProduct('purchase_items');
      db.prepare('DELETE FROM products WHERE name IN (' + placeholders + ')').run(...names);
      db.prepare('DELETE FROM categories WHERE name = ?').run('Promo Cat');
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

exports.down = function () {};