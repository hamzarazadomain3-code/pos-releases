/**
 * Migration 090 — the Purchase Order gets its header money, its statuses and
 * its unit snapshot.
 *
 * The Purchase Order screen must read the inventory master data LIVE, but the
 * order itself must keep a SNAPSHOT of what was ordered: if the shop changes
 * the pack size of a product tomorrow, the order that was created today must
 * still say "2 box = 24 pcs". That is why the multiplier, the base quantity
 * and the cost per base unit are stored ON THE LINE.
 *
 * Additive and idempotent:
 *   - every new column is added with the `PRAGMA table_info` guard, so
 *     re-running changes nothing and never drops a column,
 *   - the four settings are inserted with `INSERT OR IGNORE`, so an owner's
 *     own choice is never reset (`po_update_cost_price` keeps the shop's
 *     current behaviour: receiving an order updates the product's cost),
 *   - nothing is removed: the columns that already existed are REUSED, not
 *     duplicated (`delivery_date` is the expected delivery date,
 *     `reference_no` is the supplier invoice / ref no, `notes` is the order
 *     note, `status` carries the new statuses, `received_qty` is the partial
 *     receipt counter).
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? true : false;

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  const addColumn = (table, column, definition) => {
    if (!hasTable(table)) return;
    if (hasColumn(table, column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migration 090] Added ${table}.${column}`);
  };

  // ── 1. The order's header money ───────────────────────────────────────────
  //   subtotal / tax_total / discount_* / freight / paid_amount are the money
  //   the PO screen shows in its totals block. They are stored so the list and
  //   the printed order can show the same numbers without recomputing.
  addColumn('purchase_orders', 'subtotal', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'tax_total', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'discount_type', "TEXT DEFAULT 'amount'");
  addColumn('purchase_orders', 'discount_value', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'discount_amount', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'freight', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'paid_amount', 'REAL DEFAULT 0');
  addColumn('purchase_orders', 'payment_method', 'TEXT');
  addColumn('purchase_orders', 'cancel_reason', 'TEXT');

  // ── 2. The line's unit snapshot ───────────────────────────────────────────
  //   unit_multiplier = how many base units ONE purchase unit holds
  //   (1 = the piece / kg). base_qty and cost_per_base are the line in the
  //   unit the stock is actually kept in.
  addColumn('purchase_items', 'unit_multiplier', 'REAL DEFAULT 1');
  addColumn('purchase_items', 'base_qty', 'REAL DEFAULT 0');
  addColumn('purchase_items', 'cost_per_base', 'REAL DEFAULT 0');

  // ── 3. The supplier payment and the shift ─────────────────────────────────
  //   A "paid now" amount in CASH leaves the open shift's drawer, so the
  //   ledger row carries the shift it was paid from. The drawer and the shift
  //   summary read this column, so all three agree.
  addColumn('supplier_transactions', 'shift_id', 'INTEGER');

  if (hasTable('supplier_transactions')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_supplier_tx_shift ON supplier_transactions (shift_id)');
  }

  // ── 4. The PO settings ───────────────────────────────────────────────────
  //   They live in the SHOP PROFILE table (`settings`), because the Settings
  //   > Inventory/Purchases panel is the screen that edits them (it writes
  //   every key it holds). `INSERT OR IGNORE`: an owner who already chose a
  //   value keeps it.
  if (hasTable('settings')) {
    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('po_cost_change_warn_pct', '10');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('po_min_margin_pct', '0');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('po_auto_suggest_low_stock', '1');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('po_default_payment_method', 'cash');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('po_update_cost_price', '1');
    `);
  }
};

exports.down = function () {
  // Non-destructive: an order and its money are the shop's own records.
};
