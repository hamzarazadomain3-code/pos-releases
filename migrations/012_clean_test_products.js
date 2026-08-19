exports.up = function (db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM products WHERE name = 'Audit Item A'").get();
    const count = row ? row.c : 0;
    if (count > 0) {
      const tables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
      );
      const deleteByProduct = (table) => {
        if (tables.has(table)) {
          db.prepare(
            "DELETE FROM " + table + " WHERE product_id IN (SELECT id FROM products WHERE name = 'Audit Item A')"
          ).run();
        }
      };
      deleteByProduct('audit_items');
      deleteByProduct('purchase_price_history');
      deleteByProduct('return_items');
      deleteByProduct('sale_items');
      deleteByProduct('stock_movements');
      deleteByProduct('purchase_items');
      db.prepare("DELETE FROM products WHERE name = 'Audit Item A'").run();
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

exports.down = function () {};