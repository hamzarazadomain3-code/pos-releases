exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  if (hasColumn('sales', 'price_overridden')) {
    // column already exists
  } else {
    db.exec('ALTER TABLE sales ADD COLUMN price_overridden INTEGER DEFAULT 0');
  }
};

exports.down = function () {};
