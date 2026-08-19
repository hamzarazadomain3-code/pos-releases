exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };

  // 1. Create product_units table
  if (!hasTable('product_units')) {
    db.exec(`
      CREATE TABLE product_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        level INTEGER NOT NULL,              -- 0 = base, 1 = first packaging, 2 = second packaging
        name TEXT NOT NULL,                   -- e.g., "Piece", "Box", "Carton", "Bottle", "Pet"
        quantity_in_base_units REAL NOT NULL, -- e.g., 1, 12, 288 (cumulative from base)
        barcode TEXT UNIQUE,                  -- barcode for scanning at this level
        price REAL,                           -- price when selling at this unit level
        is_base INTEGER NOT NULL DEFAULT 0,   -- exactly one per product
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `);
    db.exec(`CREATE INDEX idx_product_units_product ON product_units(product_id);`);
    db.exec(`CREATE UNIQUE INDEX idx_product_units_barcode ON product_units(barcode) WHERE barcode IS NOT NULL;`);
  }

  // 2. Migrate existing units_per_box/box_price/box_barcode data
  const products = db.prepare(`
    SELECT id, name, unit_id, units_per_box, box_barcode, box_price
    FROM products
    WHERE units_per_box IS NOT NULL AND units_per_box > 0
  `).all();

  for (const p of products) {
    // Check if already migrated (idempotent)
    const existing = db.prepare('SELECT 1 FROM product_units WHERE product_id = ? AND level = 0').get(p.id);
    if (existing) continue;

    // Get base unit name from unit_id or use 'Piece'
    let baseName = 'Piece';
    if (p.unit_id) {
      const unit = db.prepare('SELECT name FROM units WHERE id = ?').get(p.unit_id);
      if (unit) baseName = unit.name;
    }

    // Insert base unit (level 0)
    db.prepare(`
      INSERT INTO product_units (product_id, level, name, quantity_in_base_units, is_base)
      VALUES (?, 0, ?, 1, 1)
    `).run(p.id, baseName);

    // Insert box unit (level 1) if units_per_box > 0
    if (p.units_per_box && p.units_per_box > 0) {
      db.prepare(`
        INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
        VALUES (?, 1, 'Box', ?, ?, ?, 0)
      `).run(p.id, p.units_per_box, p.box_barcode, p.box_price);
    }
  }

  // 3. Create base unit for products without units_per_box but with unit_id
  const productsWithoutUnits = db.prepare(`
    SELECT p.id, u.name as unit_name
    FROM products p
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.id NOT IN (SELECT product_id FROM product_units)
      AND p.unit_id IS NOT NULL
  `).all();

  for (const p of productsWithoutUnits) {
    const baseName = p.unit_name || 'Piece';
    db.prepare(`
      INSERT INTO product_units (product_id, level, name, quantity_in_base_units, is_base)
      VALUES (?, 0, ?, 1, 1)
    `).run(p.id, baseName);
  }

  // 4. Handle products with neither units_per_box nor unit_id - give them default 'Piece'
  const productsNoUnit = db.prepare(`
    SELECT id FROM products
    WHERE id NOT IN (SELECT product_id FROM product_units)
  `).all();

  for (const p of productsNoUnit) {
    db.prepare(`
      INSERT INTO product_units (product_id, level, name, quantity_in_base_units, is_base)
      VALUES (?, 0, 'Piece', 1, 1)
    `).run(p.id);
  }
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS product_units');
};