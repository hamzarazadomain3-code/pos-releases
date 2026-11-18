/**
 * Migration 088 — the assistant's AUTO model.
 *
 * 083 seeded ONE model id (`claude-sonnet-4-5`) for every turn. The router can
 * now choose the model for the task (fast for a lookup, strong for analysis,
 * vision for a photo), so an install that still carries the SHIPPED seed is
 * moved to `auto`. That is the behaviour the owner asked for.
 *
 * A model the owner actually chose is NEVER touched: only the exact 083 seed
 * changes. The setting is owner-editable from Settings → Assistant, and an
 * empty value is treated as `auto` by the app as well.
 *
 * Idempotent: re-running finds `auto` and changes nothing.
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return !!row;
  };
  if (!hasTable('admin_settings')) return;

  const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'assistant_model'").get();
  if (row && String(row.value || '').trim() === 'claude-sonnet-4-5') {
    db.prepare("UPDATE admin_settings SET value = 'auto' WHERE key = 'assistant_model'").run();
    console.log('[migration 088] The assistant now chooses its model per task (auto)');
  }
};

exports.down = function () {
  // Non-destructive; the model is managed from Settings → Assistant.
};
