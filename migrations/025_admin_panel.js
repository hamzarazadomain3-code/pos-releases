/**
 * Migration 025 — Admin Control Panel + Cash Drawer Sessions
 *
 * Adds schema for:
 *   - Cash drawer sessions (open/close tracking with variance)
 *   - Keyboard shortcuts (customizable per-action)
 *   - Feature toggles (enable/disable system features)
 *   - Admin roles & permissions (role-based access control)
 *   - Admin settings (key-value store for admin panel config)
 *
 * Seeds default shortcuts, features, roles, and settings.
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return !!row;
  };

  // ── 1. Cash drawer sessions ──
  if (!hasTable('cash_drawer_sessions')) {
    db.exec(`
      CREATE TABLE cash_drawer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        opening_cash REAL DEFAULT 0,
        opening_time TEXT DEFAULT (datetime('now', 'utc') || 'Z'),
        opened_by INTEGER NOT NULL,
        closing_cash REAL,
        closing_time TEXT,
        closed_by INTEGER,
        variance REAL DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (shift_id) REFERENCES shifts(id),
        FOREIGN KEY (opened_by) REFERENCES users(id),
        FOREIGN KEY (closed_by) REFERENCES users(id)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_drawer_shift ON cash_drawer_sessions(shift_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_drawer_opened ON cash_drawer_sessions(opened_by)');
  }

  // ── 2. Keyboard shortcuts ──
  if (!hasTable('shortcuts')) {
    db.exec(`
      CREATE TABLE shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT UNIQUE NOT NULL,
        shortcut_key TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── 3. Feature toggles ──
  if (!hasTable('feature_toggles')) {
    db.exec(`
      CREATE TABLE feature_toggles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_name TEXT UNIQUE NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        description TEXT,
        updated_by INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )
    `);
  }

  // ── 4. Admin roles ──
  if (!hasTable('admin_roles')) {
    db.exec(`
      CREATE TABLE admin_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_system_role INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── 5. Admin role permissions ──
  if (!hasTable('admin_role_permissions')) {
    db.exec(`
      CREATE TABLE admin_role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER NOT NULL,
        permission_name TEXT NOT NULL,
        is_allowed INTEGER DEFAULT 1,
        FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
        UNIQUE(role_id, permission_name)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_role_perms_role ON admin_role_permissions(role_id)');
  }

  // ── 6. Admin settings (key-value) ──
  if (!hasTable('admin_settings')) {
    db.exec(`
      CREATE TABLE admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ── Seed default shortcuts ──
  const shortcuts = [
    ['new_sale', 'F2', 'Open new sale / focus search bar'],
    ['new_product', 'F5', 'Quick add new product'],
    ['new_customer', 'F9', 'Quick add new customer'],
    ['cash_drawer', 'F12', 'Open cash drawer modal'],
    ['save', 'Ctrl+S', 'Save current form'],
    ['print', 'Ctrl+P', 'Print receipt / report'],
    ['quit', 'Ctrl+Q', 'Quit application'],
    ['search', 'Ctrl+F', 'Focus search bar'],
    ['reports', 'Ctrl+R', 'Open reports page'],
    ['logout', 'Ctrl+L', 'Logout current user'],
    ['settings', 'Alt+S', 'Open settings page'],
    ['admin_panel', 'Alt+A', 'Open admin panel'],
    ['duplicate_sale', 'Shift+F2', 'Duplicate last sale'],
    ['bulk_product', 'Shift+F5', 'Bulk product add'],
    ['permanent_delete', 'Shift+Delete', 'Permanently delete selected item'],
    ['open_shift', 'Ctrl+O', 'Open new shift'],
    ['close_shift', 'Ctrl+Shift+C', 'Close current shift'],
    ['new_return', 'Ctrl+Shift+R', 'Process a return'],
    ['hold_bill', 'Ctrl+H', 'Hold current bill'],
    ['recall_bill', 'Ctrl+Shift+H', 'Recall held bill'],
  ];
  const insertShortcut = db.prepare('INSERT OR IGNORE INTO shortcuts (action, shortcut_key, description) VALUES (?, ?, ?)');
  for (const [action, key, desc] of shortcuts) {
    insertShortcut.run(action, key, desc);
  }

  // ── Seed default features ──
  const features = [
    ['whatsapp_alerts', 1, 'WhatsApp receipt and alert delivery'],
    ['sms_notifications', 0, 'SMS notification delivery via gateway'],
    ['email_notifications', 0, 'Email notification delivery'],
    ['barcode_scanning', 1, 'Barcode scanner input support'],
    ['wholesale_mode', 1, 'Wholesale pricing and mode toggle'],
    ['udhaar_system', 1, 'Customer credit (udhaar) management'],
    ['quotations', 1, 'Quotation creation and management'],
    ['reports', 1, 'Sales, inventory, and financial reports'],
    ['audits', 1, 'Stock audit sessions'],
    ['promotions', 1, 'Discount and promotion campaigns'],
    ['cash_drawer', 1, 'Cash drawer session tracking'],
    ['multi_branch', 0, 'Multi-branch sync and management'],
    ['purchases', 1, 'Purchase order management'],
    ['returns', 1, 'Sales returns and refunds'],
    ['expenses', 1, 'Business expense tracking'],
    ['product_batches', 1, 'Batch tracking for products'],
    ['scale_barcode', 1, 'BayLan label scale barcode support'],
    ['auto_backup', 1, 'Automatic daily database backup'],
    ['price_floor', 1, 'Minimum price enforcement on sales'],
    ['profitability_reports', 1, 'Product profitability analysis'],
  ];
  const insertFeature = db.prepare('INSERT OR IGNORE INTO feature_toggles (feature_name, is_enabled, description) VALUES (?, ?, ?)');
  for (const [name, enabled, desc] of features) {
    insertFeature.run(name, enabled, desc);
  }

  // ── Seed default admin roles ──
  const roles = [
    ['super_admin', 'Full access to everything. Can manage users, settings, and all features.', 1],
    ['manager', 'Can view reports, manage staff, configure alerts. Cannot change core settings.', 1],
    ['cashier', 'Can only do billing. Can view own sales. Cannot access settings.', 1],
    ['inventory_manager', 'Can manage stock and do audits. Cannot access billing.', 1],
  ];
  const insertRole = db.prepare('INSERT OR IGNORE INTO admin_roles (name, description, is_system_role) VALUES (?, ?, ?)');
  for (const [name, desc, sys] of roles) {
    insertRole.run(name, desc, sys);
  }

  // ── Seed default permissions for each role ──
  const allPermissions = [
    'view_reports', 'create_users', 'edit_products', 'view_sales',
    'manage_alerts', 'access_settings', 'print_labels', 'manage_shifts',
    'process_returns', 'manage_promotions', 'manage_purchases', 'manage_udhaar',
    'manage_audits', 'access_admin_panel', 'manage_roles', 'view_activity_log',
    'backup_restore', 'manage_expenses', 'manage_categories', 'export_data',
  ];

  const getRoleId = (name) => {
    const row = db.prepare('SELECT id FROM admin_roles WHERE name = ?').get(name);
    return row ? row.id : null;
  };
  const insertPerm = db.prepare('INSERT OR IGNORE INTO admin_role_permissions (role_id, permission_name, is_allowed) VALUES (?, ?, ?)');

  // super_admin: all permissions
  const superAdminId = getRoleId('super_admin');
  if (superAdminId) {
    for (const p of allPermissions) {
      insertPerm.run(superAdminId, p, 1);
    }
  }

  // manager: most except admin_panel, manage_roles, backup_restore
  const managerId = getRoleId('manager');
  if (managerId) {
    const managerExcluded = ['access_admin_panel', 'manage_roles', 'backup_restore'];
    for (const p of allPermissions) {
      insertPerm.run(managerId, p, managerExcluded.includes(p) ? 0 : 1);
    }
  }

  // cashier: only billing-related
  const cashierId = getRoleId('cashier');
  if (cashierId) {
    const cashierAllowed = ['view_sales', 'process_returns', 'print_labels'];
    for (const p of allPermissions) {
      insertPerm.run(cashierId, p, cashierAllowed.includes(p) ? 1 : 0);
    }
  }

  // inventory_manager: inventory-related only
  const invMgrId = getRoleId('inventory_manager');
  if (invMgrId) {
    const invAllowed = ['edit_products', 'manage_audits', 'manage_categories', 'print_labels', 'view_reports', 'export_data'];
    for (const p of allPermissions) {
      insertPerm.run(invMgrId, p, invAllowed.includes(p) ? 1 : 0);
    }
  }

  // ── Seed default admin settings ──
  const adminSettings = [
    // Billing
    ['receipt_width', '80mm'],
    ['receipt_font_size', '12'],
    ['auto_print_receipt', 'false'],
    ['round_off_total', 'true'],
    ['default_payment_mode', 'Cash'],
    ['require_customer', 'false'],
    ['allow_negative_stock', 'false'],
    ['invoice_prefix', 'INV-'],
    ['invoice_start_number', '1001'],
    ['max_discount_percent', '50'],
    ['discount_require_password_above', '20'],
    // Inventory
    ['auto_generate_sku', 'true'],
    ['sku_prefix', 'SKU-'],
    ['stock_valuation_method', 'FIFO'],
    ['expiry_alert_days', '30'],
    ['barcode_format', 'CODE128'],
    ['auto_generate_barcode', 'true'],
    ['scanner_buffer_gap', '150'],
    // Customer
    ['udhaar_enabled', 'true'],
    ['default_credit_limit', '50000'],
    ['max_credit_limit', '500000'],
    ['udhaar_interest_rate', '0'],
    ['payment_due_days', '30'],
    ['loyalty_enabled', 'false'],
    ['points_per_rupee', '1'],
    // Reports
    ['daily_report_time', '22:00'],
    ['weekly_report_day', 'Monday'],
    ['monthly_report_date', '1'],
    ['report_send_email', 'false'],
    ['report_send_whatsapp', 'false'],
    // Alerts
    ['low_stock_alert_enabled', 'true'],
    ['low_stock_threshold', '10'],
    ['expiry_alert_enabled', 'true'],
    ['udhaar_reminder_enabled', 'true'],
    ['udhaar_reminder_time', '07:00'],
    ['high_discount_alert_threshold', '20'],
    ['login_alert_enabled', 'true'],
    // Security
    ['min_password_length', '8'],
    ['require_uppercase', 'true'],
    ['require_numbers', 'true'],
    ['require_special_chars', 'false'],
    ['password_expiry_days', '90'],
    ['session_timeout_minutes', '30'],
    ['allow_remember_me', 'true'],
    ['two_factor_enabled', 'false'],
    ['two_factor_method', 'email'],
    // Theme
    ['theme', 'light'],
    ['primary_color', '#2563eb'],
    ['font_size', 'normal'],
    ['language', 'en'],
    ['date_format', 'DD/MM/YYYY'],
    ['time_format', '12h'],
    ['currency_symbol', 'Rs'],
    ['decimal_places', '2'],
    // Backup
    ['auto_backup_enabled', 'true'],
    ['auto_backup_interval', 'daily'],
    ['backup_time', '02:00'],
    ['backup_retention_days', '30'],
    ['encrypt_backup', 'false'],
    // Shift
    ['default_opening_cash', '5000'],
    ['variance_tolerance', '100'],
    ['require_shift_approval', 'false'],
    // Tax
    ['default_tax_rate', '0'],
    ['tax_inclusive', 'false'],
    ['gst_number', ''],
    // Business
    ['wholesale_margin_percent', '15'],
    ['minimum_profit_margin', '5'],
    ['markup_percent', '25'],
    // Receipt
    ['receipt_header_text', 'Thank you for shopping with us!'],
    ['receipt_footer_text', 'Come again soon!'],
    ['show_tax_on_receipt', 'true'],
    ['show_discount_breakdown', 'true'],
    ['show_payment_method', 'true'],
    ['show_cashier_name', 'true'],
    // Barcode
    ['barcode_prefix', ''],
    ['allow_duplicate_barcodes', 'false'],
    ['barcode_sticker_size', '38x25'],
    // Customer
    ['udhaar_reminder_frequency', 'weekly'],
    ['auto_email_reminder', 'false'],
    ['auto_sms_reminder', 'false'],
    ['suspend_udhaar_if_overdue', 'false'],
    // Dashboard
    ['dashboard_refresh_interval', '300'],
    ['default_date_range', 'month'],
    // System
    ['debug_mode', 'false'],
    ['log_level', 'info'],
    ['api_rate_limit', '100'],
    ['receipt_width_mm', '80'],
    ['compounding_tax', 'false'],
    ['default_opening_cash_override', 'false'],
    ['price_change_log', 'true'],
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of adminSettings) {
    insertSetting.run(k, v);
  }
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS admin_role_permissions');
  db.exec('DROP TABLE IF EXISTS admin_roles');
  db.exec('DROP TABLE IF EXISTS feature_toggles');
  db.exec('DROP TABLE IF EXISTS shortcuts');
  db.exec('DROP TABLE IF EXISTS admin_settings');
  db.exec('DROP TABLE IF EXISTS cash_drawer_sessions');
};
