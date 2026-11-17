/**
 * Migration 087 — the assistant's provider.
 *
 * The assistant can talk to more than one AI provider. It defaults to
 * `anthropic`, so an existing install changes NOTHING: the key, the model and
 * the behaviour stay exactly as they were.
 *
 *   assistant_provider   anthropic  — anthropic | nvidia
 *
 * `nvidia` is NVIDIA's integrate API (build.nvidia.com), which speaks the
 * OpenAI chat-completions shape; the key goes in the `Authorization: Bearer`
 * header instead of `x-api-key`.
 *
 * Additive and idempotent (INSERT OR IGNORE) — re-running the migration never
 * changes a value the owner has already set.
 */
exports.up = function (db) {
  const hasTable = (table) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return !!row;
  };
  if (!hasTable('admin_settings')) return;

  const insertSetting = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)');
  insertSetting.run('assistant_provider', 'anthropic');

  console.log('[migration 087] Added the assistant provider (the assistant stays on Anthropic)');
};

exports.down = function () {
  // Non-destructive; the provider is managed from Settings → Assistant.
};
