/**
 * Migration 046 — Add is_default column to bank_accounts
 *
 * Adds is_default column to track the default bank account for transfers.
 */
exports.up = function (db) {
  const hasColumn = (table, col) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  };

  if (!hasColumn('bank_accounts', 'is_default')) {
    db.exec('ALTER TABLE bank_accounts ADD COLUMN is_default INTEGER DEFAULT 0');

    // Set the first bank account as default (or the one in settings)
    const defaultId = db.prepare("SELECT value FROM settings WHERE key = 'default_bank_account_id'").get();
    if (defaultId) {
      db.prepare('UPDATE bank_accounts SET is_default = 1 WHERE id = ?').run(defaultId.value);
    } else {
      // Fallback: set first account as default
      const first = db.prepare('SELECT id FROM bank_accounts ORDER BY id LIMIT 1').get();
      if (first) {
        db.prepare('UPDATE bank_accounts SET is_default = 1 WHERE id = ?').run(first.id);
      }
    }
  }
};

exports.down = function (db) {
  // SQLite doesn't support DROP COLUMN easily
};