/**
 * Migration 053 — label-facing product fields.
 *
 * Label Studio templates can reference `{weight}`, `{mfg}` and `{batch}` and
 * flag a product as loose/variable weight (the "±" on a produce label), but the
 * products table had nowhere to store any of it — the renderer read them via
 * `(product as any).mfg_date`, so they always printed empty.
 *
 * Four additive columns, all nullable/defaulted so existing rows and code are
 * unaffected:
 *   - net_weight  TEXT     — printed pack size, e.g. "100g", "500 ml"
 *   - is_loose    INTEGER  — loose / variable-weight item (shows the ± prefix)
 *   - mfg_date    TEXT     — manufacturing / batch date (ISO yyyy-mm-dd)
 *   - batch_no    TEXT     — human batch/lot code
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  if (!hasTable('products')) return;

  if (!hasColumn('products', 'net_weight')) {
    db.exec('ALTER TABLE products ADD COLUMN net_weight TEXT DEFAULT NULL');
  }
  if (!hasColumn('products', 'is_loose')) {
    db.exec('ALTER TABLE products ADD COLUMN is_loose INTEGER DEFAULT 0');
  }
  if (!hasColumn('products', 'mfg_date')) {
    db.exec('ALTER TABLE products ADD COLUMN mfg_date TEXT DEFAULT NULL');
  }
  if (!hasColumn('products', 'batch_no')) {
    db.exec('ALTER TABLE products ADD COLUMN batch_no TEXT DEFAULT NULL');
  }

  // Label printing reads these per print run; an index on the loose flag keeps
  // the "loose products only" label filter cheap on a large catalogue.
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_is_loose ON products(is_loose)');
};

exports.down = function (db) {
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  for (const col of ['net_weight', 'is_loose', 'mfg_date', 'batch_no']) {
    if (hasColumn('products', col)) db.exec(`ALTER TABLE products DROP COLUMN ${col}`);
  }
  db.exec('DROP INDEX IF EXISTS idx_products_is_loose');
};
