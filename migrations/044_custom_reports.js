/**
 * Migration 043 — Custom Report Builder (v2.5.0)
 *
 * Adds:
 *   - custom_reports table: user-defined report definitions
 *   - report_schedules table: scheduled report generation
 */
exports.up = function (db) {
  const hasTable = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

  // ── 1. custom_reports ──
  if (!hasTable('custom_reports')) {
    db.exec(`
      CREATE TABLE custom_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        base_table TEXT NOT NULL,           -- 'sales' | 'sale_items' | 'products' | 'customers' | 'purchases' | 'expenses'
        columns_json TEXT NOT NULL,         -- selected columns with aliases
        filters_json TEXT,                  -- WHERE conditions
        group_by_json TEXT,                 -- GROUP BY columns
        order_by_json TEXT,                 -- ORDER BY columns
        limit_rows INTEGER,
        is_public INTEGER DEFAULT 0,        -- available to all users
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_custom_reports_user ON custom_reports(created_by)');

  // ── 2. report_schedules ──
  if (!hasTable('report_schedules')) {
    db.exec(`
      CREATE TABLE report_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        frequency TEXT NOT NULL,            -- 'daily' | 'weekly' | 'monthly'
        day_of_week INTEGER,                -- 0-6 (Sunday=0) for weekly
        day_of_month INTEGER,               -- 1-31 for monthly
        time_of_day TEXT NOT NULL,          -- 'HH:MM' 24h format
        format TEXT DEFAULT 'xlsx',         -- 'xlsx' | 'csv' | 'pdf'
        recipients_json TEXT,               -- array of emails/users
        is_active INTEGER DEFAULT 1,
        last_run DATETIME,
        next_run DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES custom_reports(id) ON DELETE CASCADE
      )
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_report_schedules_next ON report_schedules(next_run, is_active)');
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS report_schedules');
  db.exec('DROP TABLE IF EXISTS custom_reports');
};