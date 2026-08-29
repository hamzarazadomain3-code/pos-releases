import { getDb } from '../db';
import { can, getSessionUserId } from './auth';
import { logActivity } from './activity';
import { scryptSync } from 'node:crypto';
import fs from 'node:fs';
import { getDbPath } from '../db';

// ═══════════════════════════════════════════
//  SHORTCUTS
// ═══════════════════════════════════════════

export interface ShortcutRow {
  id: number;
  action: string;
  shortcut_key: string;
  description: string | null;
  is_active: number;
  updated_at: string;
}

export function getAllShortcuts(): ShortcutRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM shortcuts ORDER BY action').all() as unknown as ShortcutRow[];
}

export function updateShortcut(action: string, newKey: string): ShortcutRow {
  if (!can('owner')) throw new Error('Only the owner can change shortcuts');
  const db = getDb();

  const existing = db.prepare('SELECT id FROM shortcuts WHERE shortcut_key = ? AND action != ? AND is_active = 1').get(newKey, action) as { id: number } | undefined;
  if (existing) {
    throw new Error(`Shortcut "${newKey}" is already assigned to another action`);
  }

  db.prepare('UPDATE shortcuts SET shortcut_key = ?, updated_at = CURRENT_TIMESTAMP WHERE action = ?').run(newKey, action);
  logActivity('shortcut_updated', 'shortcut', null, `action=${action} key=${newKey}`);
  return db.prepare('SELECT * FROM shortcuts WHERE action = ?').get(action) as unknown as ShortcutRow;
}

export function resetShortcuts(): void {
  if (!can('owner')) throw new Error('Only the owner can reset shortcuts');
  const db = getDb();
  const defaults: [string, string][] = [
    ['new_sale', 'F2'],
    ['new_product', 'F5'],
    ['new_customer', 'F9'],
    ['cash_drawer', 'F12'],
    ['save', 'Ctrl+S'],
    ['print', 'Ctrl+P'],
    ['quit', 'Ctrl+Q'],
    ['search', 'Ctrl+F'],
    ['reports', 'Ctrl+R'],
    ['logout', 'Ctrl+L'],
    ['settings', 'Alt+S'],
    ['admin_panel', 'Alt+A'],
    ['duplicate_sale', 'Shift+F2'],
    ['bulk_product', 'Shift+F5'],
    ['permanent_delete', 'Shift+Delete'],
    ['open_shift', 'Ctrl+O'],
    ['close_shift', 'Ctrl+Shift+C'],
    ['new_return', 'Ctrl+Shift+R'],
    ['hold_bill', 'Ctrl+H'],
    ['recall_bill', 'Ctrl+Shift+H'],
  ];
  const stmt = db.prepare('UPDATE shortcuts SET shortcut_key = ?, updated_at = CURRENT_TIMESTAMP WHERE action = ?');
  for (const [action, key] of defaults) {
    stmt.run(key, action);
  }
  logActivity('shortcuts_reset', 'shortcut', null, 'All shortcuts reset to defaults');
}

// ═══════════════════════════════════════════
//  FEATURE TOGGLES
// ═══════════════════════════════════════════

export interface FeatureToggleRow {
  id: number;
  feature_name: string;
  is_enabled: number;
  description: string | null;
  updated_by: number | null;
  updated_at: string;
}

export function getAllFeatures(): FeatureToggleRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM feature_toggles ORDER BY feature_name').all() as unknown as FeatureToggleRow[];
}

export function toggleFeature(featureName: string): FeatureToggleRow {
  if (!can('owner')) throw new Error('Only the owner can toggle features');
  const db = getDb();
  const uid = getSessionUserId() ?? 1;

  const current = db.prepare('SELECT is_enabled FROM feature_toggles WHERE feature_name = ?').get(featureName) as { is_enabled: number } | undefined;
  if (!current) throw new Error(`Feature "${featureName}" not found`);

  const newVal = current.is_enabled ? 0 : 1;
  db.prepare('UPDATE feature_toggles SET is_enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE feature_name = ?')
    .run(newVal, uid, featureName);

  logActivity('feature_toggled', 'feature', null, `feature=${featureName} enabled=${newVal}`);
  return db.prepare('SELECT * FROM feature_toggles WHERE feature_name = ?').get(featureName) as unknown as FeatureToggleRow;
}

export function isFeatureEnabled(featureName: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT is_enabled FROM feature_toggles WHERE feature_name = ?').get(featureName) as { is_enabled: number } | undefined;
  return row ? row.is_enabled === 1 : false;
}

// ═══════════════════════════════════════════
//  ROLES & PERMISSIONS
// ═══════════════════════════════════════════

export interface AdminRole {
  id: number;
  name: string;
  description: string | null;
  is_system_role: number;
  created_at: string;
}

export interface RolePermission {
  id: number;
  role_id: number;
  permission_name: string;
  is_allowed: number;
}

export function getAllRoles(): AdminRole[] {
  const db = getDb();
  return db.prepare('SELECT * FROM admin_roles ORDER BY id').all() as unknown as AdminRole[];
}

export function createRole(name: string, description?: string): AdminRole {
  if (!can('owner')) throw new Error('Only the owner can create roles');
  if (!name?.trim()) throw new Error('Role name is required');
  const db = getDb();
  const info = db.prepare('INSERT INTO admin_roles (name, description) VALUES (?, ?)').run(name.trim(), description?.trim() || null);
  logActivity('role_created', 'role', Number(info.lastInsertRowid), `name=${name}`);
  return db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as AdminRole;
}

export function updateRole(id: number, data: { name?: string; description?: string }): AdminRole {
  if (!can('owner')) throw new Error('Only the owner can update roles');
  const db = getDb();
  const role = db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(id) as AdminRole | undefined;
  if (!role) throw new Error('Role not found');

  const name = data.name?.trim() || role.name;
  const desc = data.description !== undefined ? (data.description?.trim() || null) : role.description;

  db.prepare('UPDATE admin_roles SET name = ?, description = ? WHERE id = ?').run(name, desc, id);
  logActivity('role_updated', 'role', id, `name=${name}`);
  return db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(id) as unknown as AdminRole;
}

export function deleteRole(id: number): boolean {
  if (!can('owner')) throw new Error('Only the owner can delete roles');
  const db = getDb();
  const role = db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(id) as AdminRole | undefined;
  if (!role) throw new Error('Role not found');
  if (role.is_system_role) throw new Error('Cannot delete system roles');

  db.prepare('DELETE FROM admin_role_permissions WHERE role_id = ?').run(id);
  db.prepare('DELETE FROM admin_roles WHERE id = ?').run(id);
  logActivity('role_deleted', 'role', id, `name=${role.name}`);
  return true;
}

export function getRolePermissions(roleId: number): RolePermission[] {
  const db = getDb();
  return db.prepare('SELECT * FROM admin_role_permissions WHERE role_id = ? ORDER BY permission_name').all(roleId) as unknown as RolePermission[];
}

export function setRolePermissions(roleId: number, permissions: { permission_name: string; is_allowed: boolean }[]): void {
  if (!can('owner')) throw new Error('Only the owner can set permissions');
  const db = getDb();
  const role = db.prepare('SELECT * FROM admin_roles WHERE id = ?').get(roleId) as AdminRole | undefined;
  if (!role) throw new Error('Role not found');

  const del = db.prepare('DELETE FROM admin_role_permissions WHERE role_id = ?');
  const ins = db.prepare('INSERT INTO admin_role_permissions (role_id, permission_name, is_allowed) VALUES (?, ?, ?)');

  del.run(roleId);
  for (const p of permissions) {
    ins.run(roleId, p.permission_name, p.is_allowed ? 1 : 0);
  }
  logActivity('role_permissions_updated', 'role', roleId, `permissions=${permissions.length}`);
}

// ═══════════════════════════════════════════
//  ADMIN SETTINGS
// ═══════════════════════════════════════════

export interface AdminSettingsMap {
  [key: string]: string;
}

export function getAllAdminSettings(): AdminSettingsMap {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM admin_settings').all() as unknown as { key: string; value: string }[];
  const map: AdminSettingsMap = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export function getAdminSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAdminSetting(key: string, value: string): void {
  if (!can('owner')) throw new Error('Only the owner can change admin settings');
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
}

export function setAdminSettingsBatch(settings: Record<string, string>): void {
  if (!can('owner')) throw new Error('Only the owner can change admin settings');
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  for (const [k, v] of Object.entries(settings)) {
    stmt.run(k, v);
  }
}

export function resetAdminSettings(): void {
  if (!can('owner')) throw new Error('Only the owner can reset admin settings');
  const db = getDb();
  db.prepare('DELETE FROM admin_settings').run();
  logActivity('admin_settings_reset', 'admin_settings', null, 'All admin settings reset');
}

// ═══════════════════════════════════════════
//  ACTIVITY LOG (enhanced)
// ═══════════════════════════════════════════

export interface ActivityLogEntry {
  id: number;
  user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  created_at: string;
  username: string | null;
}

export interface ActivityFilters {
  from?: string;
  to?: string;
  user_id?: number;
  action?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listActivityLogs(filters: ActivityFilters = {}): { rows: ActivityLogEntry[]; total: number } {
  const db = getDb();
  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (filters.from) { where += ' AND a.created_at >= ?'; params.push(filters.from); }
  if (filters.to) { where += ' AND a.created_at <= ?'; params.push(filters.to + ' 23:59:59'); }
  if (filters.user_id) { where += ' AND a.user_id = ?'; params.push(filters.user_id); }
  if (filters.action) { where += ' AND a.action = ?'; params.push(filters.action); }

  const countRow = db.prepare(`SELECT COUNT(*) AS t FROM activity_log a ${where}`).get(...params) as { t: number };
  const rows = db.prepare(
    `SELECT a.*, u.username FROM activity_log a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
  ).all(...params, filters.limit ?? 100, filters.offset ?? 0) as unknown as ActivityLogEntry[];

  return { rows, total: countRow.t };
}

export function clearOldActivityLogs(retentionDays: number): number {
  if (!can('owner')) throw new Error('Only the owner can clear activity logs');
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const result = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);
  logActivity('activity_logs_cleared', 'activity_log', null, `retention=${retentionDays} days`);
  return Number(result.changes);
}

// ═══════════════════════════════════════════
//  USER MANAGEMENT (enhanced)
// ═══════════════════════════════════════════

export interface AdminUserRow {
  id: number;
  username: string;
  role: string;
  active: number;
  created_at: string;
  last_login?: string | null;
}

export function listAllUsers(): AdminUserRow[] {
  if (!can('owner')) throw new Error('Only the owner can list users');
  const db = getDb();
  return db.prepare(
    `SELECT u.id, u.username, u.role, u.active, u.created_at,
            (SELECT MAX(created_at) FROM activity_log WHERE user_id = u.id AND action = 'login') AS last_login
     FROM users u ORDER BY u.id`
  ).all() as unknown as AdminUserRow[];
}

export function resetUserPassword(userId: number, newPassword: string): boolean {
  if (!can('owner')) throw new Error('Only the owner can reset passwords');
  if (!newPassword || newPassword.length < 4) throw new Error('Password must be at least 4 characters');
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: number } | undefined;
  if (!user) throw new Error('User not found');

  const hash = scryptSync(newPassword, 'pos-salt', 64).toString('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  logActivity('password_reset', 'user', userId, `user_id=${userId}`);
  return true;
}

// ═══════════════════════════════════════════
//  SYSTEM HEALTH
// ═══════════════════════════════════════════

export interface SystemHealth {
  total_users: number;
  active_users: number;
  total_products: number;
  total_sales: number;
  total_customers: number;
  db_size_bytes: number;
  db_path: string;
  uptime_seconds: number;
}

const appStartTime = Date.now();

export function getSystemHealth(): SystemHealth {
  const db = getDb();
  const totalUsers = (db.prepare('SELECT COUNT(*) AS t FROM users').get() as { t: number }).t;
  const activeUsers = (db.prepare('SELECT COUNT(*) AS t FROM users WHERE active = 1').get() as { t: number }).t;
  const totalProducts = (db.prepare('SELECT COUNT(*) AS t FROM products').get() as { t: number }).t;
  const totalSales = (db.prepare('SELECT COUNT(*) AS t FROM sales').get() as { t: number }).t;
  const totalCustomers = (db.prepare('SELECT COUNT(*) AS t FROM customers').get() as { t: number }).t;

  let dbSize = 0;
  let dbPath = '';
  try {
    dbPath = getDbPath();
    dbSize = fs.statSync(dbPath).size;
  } catch { /* ignore */ }

  return {
    total_users: totalUsers,
    active_users: activeUsers,
    total_products: totalProducts,
    total_sales: totalSales,
    total_customers: totalCustomers,
    db_size_bytes: dbSize,
    db_path: dbPath,
    uptime_seconds: Math.floor((Date.now() - appStartTime) / 1000),
  };
}
