/**
 * Migration 049 — Password recovery (self-service + support fallback)
 *
 * 1. Adds an optional security question/answer to `users`. The answer is stored
 *    as a scrypt hash under a DIFFERENT salt than passwords ('pos-recovery-salt'
 *    vs 'pos-salt'), so an answer hash can never be replayed as a password hash.
 * 2. `recovery_lockout` persists failed-attempt counters and lock expiry so an
 *    app restart cannot be used to bypass the lockout.
 * 3. `support_recovery_codes` is the single-use ledger for developer recovery
 *    codes. Only the code's HMAC is stored, never the code itself.
 * 4. `device_uuid` is generated once per installation. `INSERT OR IGNORE` keeps
 *    it stable across re-installs and restores from backup.
 */
const crypto = require('crypto');

exports.up = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all();

  if (!cols.some((c) => c.name === 'security_question')) {
    db.exec('ALTER TABLE users ADD COLUMN security_question TEXT');
  }
  if (!cols.some((c) => c.name === 'security_answer_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN security_answer_hash TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_lockout (
      key TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS support_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL,
      device_id TEXT NOT NULL,
      used_at TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (hasTable('admin_settings')) {
    db.prepare('INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
      'device_uuid',
      crypto.randomUUID()
    );
    // Counter of successful support recoveries. Each success bumps it so every
    // issued code is genuinely single-use and the next one is well-defined.
    db.prepare('INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
      'support_epoch',
      '0'
    );
  }
};

exports.down = function (db) {
  db.exec('DROP TABLE IF EXISTS support_recovery_codes');
  db.exec('DROP TABLE IF EXISTS recovery_lockout');
};