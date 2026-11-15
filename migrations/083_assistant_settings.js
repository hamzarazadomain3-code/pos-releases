/**
 * Migration 083 — the assistant's settings.
 *
 * The in-app assistant is OFF by default, so an existing install notices
 * nothing until the owner turns it on. Every key is additive and idempotent
 * (INSERT OR IGNORE), so re-running the migration never changes a value the
 * owner has already set.
 *
 *   assistant_enabled            0            — the kill switch
 *   assistant_roles              owner,manager— who may use the assistant
 *   assistant_model              (a model id)— a SETTING, changeable in the UI
 *   assistant_daily_budget_usd   1            — the daily spend cap
 *   assistant_data_level         aggregates   — how much shop data may leave
 *   assistant_language           auto         — en / ur / roman / auto
 *   assistant_actions_enabled    0            — read & guide only
 *   assistant_proactive_enabled  0            — no proactive insights
 *
 * The API key is NOT seeded: it is a secret, the owner pastes it into
 * Settings → Assistant, and it is masked everywhere it could be read.
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return !!row;
  };
  if (!hasTable('admin_settings')) return;

  const insertSetting = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)');

  const settings = [
    ['assistant_enabled', '0'],
    ['assistant_roles', 'owner,manager'],
    ['assistant_model', 'claude-sonnet-4-5'],
    ['assistant_daily_budget_usd', '1'],
    ['assistant_data_level', 'aggregates'],
    ['assistant_language', 'auto'],
    ['assistant_actions_enabled', '0'],
    ['assistant_proactive_enabled', '0'],
  ];

  for (const [key, value] of settings) insertSetting.run(key, value);

  console.log('[migration 083] Added the assistant settings (the assistant stays OFF)');
};

exports.down = function () {
  // Non-destructive; the settings are managed from Settings → Assistant.
};
