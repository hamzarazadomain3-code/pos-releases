exports.up = function (db) {
  const has = () =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .get() !== undefined;

  if (!has()) return;

  const count = (sql, ...args) => (db.prepare(sql).get(...args) || {}).c || 0;

  if (count("SELECT COUNT(*) AS c FROM settings WHERE key = 'shop_name' AND value = 'Smoke Shop'") > 0) {
    db.prepare("UPDATE settings SET value = 'My Shop' WHERE key = 'shop_name' AND value = 'Smoke Shop'").run();
  }

  if (count("SELECT COUNT(*) AS c FROM settings WHERE key = 'shop_logo'") > 0) {
    db.prepare("DELETE FROM settings WHERE key = 'shop_logo'").run();
  }

  if (count("SELECT COUNT(*) AS c FROM settings WHERE key IN ('license_key','license_expires','license_last_check')") > 0) {
    db.prepare("DELETE FROM settings WHERE key IN ('license_key','license_expires','license_last_check')").run();
  }
};

exports.down = function () {};
