/**
 * Migration 086 — the assistant's pending actions.
 *
 * The assistant never changes anything by itself: a write tool only PROPOSES
 * an action, and the action waits here until the owner confirms it. The table
 * lives in the app's own database so a confirmation survives a restart, and so
 * the owner can always see what is waiting.
 *
 * Additive and idempotent — an existing install is untouched until the
 * assistant proposes something.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? true : false;

  if (!hasTable('assistant_pending_actions')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_pending_actions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tool          TEXT NOT NULL,
        args_json     TEXT NOT NULL,
        preview_json  TEXT,
        risk          TEXT NOT NULL DEFAULT 'write',
        reason        TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    TEXT NOT NULL,
        created_by    INTEGER,
        username      TEXT,
        expires_at    TEXT,
        confirmed_at  TEXT,
        result_json   TEXT,
        error         TEXT
      )
    `);
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_assistant_pending_status ON assistant_pending_actions (status)'
    );
  }

  console.log('[migration 086] Added the assistant_pending_actions table');
};

exports.down = function () {
  // Non-destructive; the waiting actions are the shop's own records.
};
