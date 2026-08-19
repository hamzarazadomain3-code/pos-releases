exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  // 1. Remember the sold unit on each sale item so the receipt can print
  //    e.g. "250 gram" instead of "0.25" (base-unit quantity stays in qty).
  if (!hasColumn('sale_items', 'unit_name')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN unit_name TEXT DEFAULT NULL');
  }
  if (!hasColumn('sale_items', 'display_qty')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN display_qty REAL DEFAULT NULL');
  }

  // 2. Backfill: every product whose base unit is Kilogram gets an automatic
  //    "Gram" selling unit (1 Gram = 0.001 Kilogram).
  const hasTable = (table) => {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    return !!row;
  };
  if (!hasTable('product_units')) {
    console.log('[022_grams] product_units missing — skipping Gram backfill');
    return;
  }

  const kgProducts = db.prepare(`
    SELECT p.id
    FROM products p
    LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base = 1
    LEFT JOIN units u ON u.id = p.unit_id
    WHERE LOWER(COALESCE(pu.name, u.name, '')) = 'kilogram'
  `).all();

  let added = 0;
  for (const p of kgProducts) {
    const hasGram = db.prepare(
      "SELECT 1 FROM product_units WHERE product_id = ? AND LOWER(name) = 'gram'"
    ).get(p.id);
    if (hasGram) continue;

    const maxLevel = db.prepare(
      'SELECT COALESCE(MAX(level), 0) AS m FROM product_units WHERE product_id = ?'
    ).get(p.id);
    db.prepare(
      `INSERT INTO product_units (product_id, level, name, quantity_in_base_units, barcode, price, is_base)
       VALUES (?, ?, 'Gram', 0.001, NULL, NULL, 0)`
    ).run(p.id, maxLevel.m + 1);
    added++;
  }
  console.log(`[022_grams] Backfilled Gram selling unit for ${added} Kilogram product(s)`);
};

exports.down = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };
  if (hasColumn('sale_items', 'unit_name')) {
    db.exec('ALTER TABLE sale_items DROP COLUMN unit_name');
  }
  if (hasColumn('sale_items', 'display_qty')) {
    db.exec('ALTER TABLE sale_items DROP COLUMN display_qty');
  }
};
