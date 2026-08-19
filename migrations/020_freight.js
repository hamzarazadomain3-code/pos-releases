exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  if (!hasColumn('sales', 'freight')) {
    db.exec('ALTER TABLE sales ADD COLUMN freight REAL DEFAULT 0');
  }
};

exports.down = function () {};