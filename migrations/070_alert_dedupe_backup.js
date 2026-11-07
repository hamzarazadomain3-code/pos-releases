exports.up = function (db) {
  const hasTable = (t) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(t).length > 0;
  if (!hasTable('alert_log')) {
    console.log('[migration 070] alert_log table does not exist, skipping');
    return;
  }

  // Backup alert_log to alert_log_backup
  console.log('[migration 070] Backing up alert_log to alert_log_backup...');
  db.exec("DROP TABLE IF EXISTS alert_log_backup");
  db.exec("CREATE TABLE alert_log_backup AS SELECT * FROM alert_log");
  const backupCount = db.prepare("SELECT COUNT(*) as c FROM alert_log_backup").get().c;
  console.log(`[migration 070] Backup created with ${backupCount} rows`);

  // Verify backup count matches original
  const originalCount = db.prepare("SELECT COUNT(*) as c FROM alert_log").get().c;
  if (backupCount !== originalCount) {
    console.log(`[migration 070] WARNING: backup count (${backupCount}) != original count (${originalCount})`);
  }

  // Dedupe: keep newest row per (alert_type, product_id) for product alerts
  // and per (alert_type, supplier_id) for supplier-only alerts
  console.log('[migration 070] Deduplicating alert_log...');
  const beforeCount = db.prepare("SELECT COUNT(*) as c FROM alert_log").get().c;

  // Product-scoped alerts: keep newest per (alert_type, product_id)
  db.exec(`
    DELETE FROM alert_log
    WHERE product_id IS NOT NULL
      AND id NOT IN (
        SELECT MAX(id)
        FROM alert_log
        WHERE product_id IS NOT NULL
        GROUP BY alert_type, product_id
      )
  `);

  // Supplier-only alerts (product_id IS NULL): keep newest per (alert_type, supplier_id)
  db.exec(`
    DELETE FROM alert_log
    WHERE product_id IS NULL
      AND id NOT IN (
        SELECT MAX(id)
        FROM alert_log
        WHERE product_id IS NULL
        GROUP BY alert_type, supplier_id
      )
  `);

  const afterCount = db.prepare("SELECT COUNT(*) as c FROM alert_log").get().c;
  const removed = beforeCount - afterCount;
  console.log(`[migration 070] Dedupe complete: ${beforeCount} -> ${afterCount} rows (removed ${removed} duplicates)`);
};

exports.down = function () {
  // No automatic down - backup table alert_log_backup remains
  console.log('[migration 070] Down: alert_log_backup retained for manual restore if needed');
};