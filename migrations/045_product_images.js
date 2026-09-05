exports.up = function (db) {
  const cols = db.prepare("PRAGMA table_info(products)").all();
  const hasImage = cols.some(c => c.name === 'image');
  if (!hasImage) {
    db.exec("ALTER TABLE products ADD COLUMN image TEXT");
  }
};

exports.down = function (db) {
  // SQLite doesn't support DROP COLUMN easily
};
