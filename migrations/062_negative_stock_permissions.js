/**
 * Migration 062 — Phase 1 & 3 permissions
 *
 * Seeds the new named permissions for the super_admin role so they appear
 * pre-granted in Admin > Roles & Permissions:
 *
 *   - can_sell_negative_stock : override a "No" negative-stock policy
 *   - can_import_purchase     : import purchase orders from Excel/CSV
 *
 * Additive + idempotent: INSERT OR IGNORE, existing rows are never touched,
 * nothing is deleted.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;

  if (!hasTable('admin_role_permissions') || !hasTable('admin_roles')) return;

  const superAdmin = db.prepare("SELECT id FROM admin_roles WHERE name = 'super_admin'").get();
  if (!superAdmin) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO admin_role_permissions (role_id, permission_name, is_allowed) VALUES (?, ?, 1)'
  );
  for (const perm of ['can_sell_negative_stock', 'can_import_purchase']) {
    insert.run(superAdmin.id, perm);
  }
};

exports.down = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;
  if (!hasTable('admin_role_permissions')) return;
  db.prepare(
    "DELETE FROM admin_role_permissions WHERE permission_name IN ('can_sell_negative_stock', 'can_import_purchase')"
  ).run();
};
