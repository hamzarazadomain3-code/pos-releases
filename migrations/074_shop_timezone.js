/**
 * PHASE 3d fix-up Item 5 — shop timezone.
 *
 * Adds the optional `shop_timezone` setting (default 'Asia/Karachi') so local
 * day boundaries are computed with Intl instead of a hard-coded +05:00.
 * Additive and idempotent.
 */
exports.up = async (db) => {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('shop_timezone', 'Asia/Karachi')").run();
};

exports.down = async (db) => {
  db.prepare("DELETE FROM settings WHERE key = 'shop_timezone'").run();
};