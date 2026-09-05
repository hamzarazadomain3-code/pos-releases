/**
 * Migration 035 — Invoice Template Designer (v2.4.0)
 *
 * Adds:
 *   - invoice_templates table (multiple templates per type)
 *   - Default templates seeded for sale, purchase, quotation, payment, return
 *   - JSON config for layout (paper size, margins, sections visibility, bold fields)
 *   - Per-shop template selection
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. invoice_templates ──
  if (!hasTable('invoice_templates')) {
    db.exec(`
      CREATE TABLE invoice_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,           -- sale | purchase | quotation | payment | return
        paper_size TEXT DEFAULT 'a4', -- a4 | a5 | thermal58 | thermal80
        orientation TEXT DEFAULT 'portrait',
        margin_top REAL DEFAULT 10,
        margin_bottom REAL DEFAULT 10,
        margin_left REAL DEFAULT 10,
        margin_right REAL DEFAULT 10,
        config_json TEXT NOT NULL,    -- JSON: sections, fields, fonts, colors, logos
        is_default INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        updated_at TEXT DEFAULT (datetime('now', 'utc') || 'Z')
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_tpl_type ON invoice_templates(type, is_default)');

  // ── 2. Seed default templates ──
  const hasAny = db.prepare('SELECT COUNT(*) as c FROM invoice_templates').get().c > 0;
  if (!hasAny) {
    const ins = db.prepare(`
      INSERT INTO invoice_templates (name, type, paper_size, orientation, margin_top, margin_bottom, margin_left, margin_right, config_json, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Default SALE template (A4)
    const saleA4 = {
      showLogo: true,
      showShopName: true,
      showShopAddress: true,
      showShopPhone: true,
      showInvoiceNo: true,
      showDate: true,
      showCustomer: true,
      showItemsTable: true,
      showTotals: true,
      showPaymentInfo: true,
      showFooter: true,
      boldInvoiceNo: true,
      boldTotal: true,
      boldGrandTotal: true,
      fontSize: 12,
      primaryColor: '#DC3545',
      footerText: 'Thank you for your business!',
      headerLines: [],
    };

    // Default SALE template (Thermal 80mm)
    const saleThermal = { ...saleA4, fontSize: 10 };

    // Default QUOTATION template
    const quotation = { ...saleA4, footerText: 'This is a quotation. Prices valid until the date mentioned above.' };

    // Default PURCHASE template
    const purchase = { ...saleA4 };

    // Default PAYMENT template
    const payment = {
      ...saleA4,
      showItemsTable: false,
      footerText: 'Payment received with thanks.',
    };

    // Default RETURN template
    const returnTpl = { ...saleA4, footerText: 'Return processed. Refund as per policy.' };

    const seeds = [
      ['Default Sale Invoice (A4)',     'sale',      'a4',         'portrait', 10, 10, 10, 10, JSON.stringify(saleA4), 1],
      ['Default Sale Invoice (Thermal)', 'sale',      'thermal80',  'portrait', 5,  5,  5,  5,  JSON.stringify(saleThermal), 0],
      ['Default Quotation',              'quotation', 'a4',         'portrait', 10, 10, 10, 10, JSON.stringify(quotation), 1],
      ['Default Purchase Order',         'purchase',  'a4',         'portrait', 10, 10, 10, 10, JSON.stringify(purchase), 1],
      ['Default Payment Receipt',        'payment',   'thermal80',  'portrait', 5,  5,  5,  5,  JSON.stringify(payment), 1],
      ['Default Return Invoice',         'return',    'a4',         'portrait', 10, 10, 10, 10, JSON.stringify(returnTpl), 1],
    ];

    for (const row of seeds) ins.run(...row);
  }

  // ── 3. settings ──
  const defaults = [
    ['default_sale_template_id', ''],
    ['default_quotation_template_id', ''],
    ['default_purchase_template_id', ''],
    ['default_payment_template_id', ''],
    ['default_return_template_id', ''],
    ['invoice_show_logo', 'true'],
    ['invoice_show_signature', 'true'],
  ];
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) insSet.run(k, v);
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS invoice_templates');
  db.exec("DELETE FROM settings WHERE key LIKE 'default_%_template_id' OR key LIKE 'invoice_show_%'");
};
