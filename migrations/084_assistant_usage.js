/**
 * Migration 084 — the assistant's daily usage.
 *
 * The daily budget must survive a restart (the owner sets a cap for the day;
 * the assistant must not be able to spend it again after the app restarts), so
 * the spend is kept in its own tiny table — one row per day.
 *
 * Additive and idempotent.
 */
exports.up = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_usage (
      day TEXT PRIMARY KEY,
      cost_usd REAL NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[migration 084] Added the assistant usage table (the daily budget)');
};

exports.down = function () {
  // Non-destructive; the usage rows are operational data.
};
