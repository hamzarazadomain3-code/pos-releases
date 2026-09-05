/**
 * Migration 036 — Product Variants (v2.4.0)
 *
 * Adds:
 *   - product_variants table (color/size combinations with unique barcode, price)
 *   - product_variant_attributes (color and size lookup tables)
 *   - Auto-generation helper: select colors × sizes → create all combos
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. variant_attributes (lookup: "Color", "Size", "Fabric") ──
  if (!hasTable('variant_attributes')) {
    db.exec(`
      CREATE TABLE variant_attributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,        -- e.g. "Color", "Size"
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z')
      )
    `);
  }

  // ── 2. variant_attribute_values (e.g. "Red", "XL") ──
  if (!hasTable('variant_attribute_values')) {
    db.exec(`
      CREATE TABLE variant_attribute_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attribute_id INTEGER NOT NULL,
        value TEXT NOT NULL,              -- e.g. "Red", "XL"
        sort_order INTEGER DEFAULT 0,
        UNIQUE(attribute_id, value),
        FOREIGN KEY (attribute_id) REFERENCES variant_attributes(id) ON DELETE CASCADE
      )
    `);
  }

  // ── 3. product_variants (the actual variant rows) ──
  if (!hasTable('product_variants')) {
    db.exec(`
      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        variant_name TEXT NOT NULL,       -- e.g. "Red - XL"
        sku TEXT,
        barcode TEXT UNIQUE,
        mrp REAL DEFAULT 0,
        sale_price REAL DEFAULT 0,
        purchase_price REAL DEFAULT 0,
        stock_qty REAL DEFAULT 0,
        low_stock_threshold REAL DEFAULT 0,
        weight REAL DEFAULT 0,
        image_url TEXT,
        attributes_json TEXT,             -- e.g. {"Color":"Red","Size":"XL"}
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        updated_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id, is_active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_variant_values_attr ON variant_attribute_values(attribute_id)');

  // ── 4. Extend products with has_variants flag ──
  if (hasTable('products') && !hasColumn('products', 'has_variants')) {
    db.exec(`ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0`);
  }

  // ── 5. Seed common attribute sets ──
  const attrCount = db.prepare('SELECT COUNT(*) as c FROM variant_attributes').get().c;
  if (attrCount === 0) {
    const insAttr = db.prepare('INSERT INTO variant_attributes (name, sort_order) VALUES (?, ?)');
    const insVal = db.prepare('INSERT INTO variant_attribute_values (attribute_id, value, sort_order) VALUES (?, ?, ?)');

    const colorId = insAttr.run('Color', 1).lastInsertRowid;
    const colors = ['Red', 'Blue', 'Green', 'Black', 'White', 'Yellow', 'Pink', 'Grey'];
    colors.forEach((c, i) => insVal.run(colorId, c, i));

    const sizeId = insAttr.run('Size', 2).lastInsertRowid;
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    sizes.forEach((s, i) => insVal.run(sizeId, s, i));

    const fabricId = insAttr.run('Fabric', 3).lastInsertRowid;
    ['Cotton', 'Polyester', 'Silk', 'Linen', 'Lawn'].forEach((f, i) => insVal.run(fabricId, f, i));
  }
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS product_variants');
  db.exec('DROP TABLE IF EXISTS variant_attribute_values');
  db.exec('DROP TABLE IF EXISTS variant_attributes');
  // has_variants column not dropped (SQLite limitation)
};
