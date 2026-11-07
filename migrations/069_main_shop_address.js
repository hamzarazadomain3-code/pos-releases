exports.up = function (db) {
  const hasTable = (t) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(t).length > 0;
  if (!hasTable('branches') || !hasTable('settings')) return;
  const addr = db.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
  const val = String(addr?.value || '').trim();
  if (!val || val.toLowerCase() === 'shop address') return;
  db.prepare("UPDATE branches SET address = ? WHERE is_default = 1 AND (address IS NULL OR TRIM(address) = '' OR LOWER(TRIM(address)) = 'shop address')").run(val);
};
exports.down = function () {};