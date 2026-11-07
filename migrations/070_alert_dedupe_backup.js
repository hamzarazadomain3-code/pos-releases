exports.up = function (db) {
  const hasTable = (t) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(t).length > 0;
  if (!hasTable('alert_log')) return;
  db.exec("CREATE TABLE IF NOT EXISTS alert_log_backup AS SELECT * FROM alert_log WHERE 0");
  try { db.exec("INSERT INTO alert_log_backup SELECT * FROM alert_log WHERE id NOT IN (SELECT id FROM alert_log_backup)"); } catch (e) {}
  try { db.exec("DELETE FROM alert_log WHERE id NOT IN (SELECT MAX(id) FROM alert_log GROUP BY alert_type, COALESCE(product_id,0), COALESCE(supplier_id,0))"); } catch (e) {}
};
exports.down = function () {};