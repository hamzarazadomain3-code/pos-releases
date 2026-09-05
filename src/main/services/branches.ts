import { getDb } from '../db';
import { logError } from '../logger';

export interface BranchRow {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface CreateBranchInput {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  is_active?: boolean;
}

function getSettings() {
  return getDb().prepare('SELECT * FROM settings').all() as any[];
}

export function listBranches(): BranchRow[] {
  try {
    return getDb().prepare(`
      SELECT * FROM branches ORDER BY is_default DESC, name
    `).all() as unknown as BranchRow[];
  } catch (e) {
    logError('listBranches', e);
    return [];
  }
}

export function getBranch(id: number): BranchRow | null {
  try {
    return getDb().prepare(`SELECT * FROM branches WHERE id = ?`).get(id) as unknown as BranchRow | null;
  } catch (e) {
    logError('getBranch', e);
    return null;
  }
}

export function getDefaultBranch(): BranchRow | null {
  try {
    return getDb().prepare(`SELECT * FROM branches WHERE is_default = 1 AND is_active = 1 LIMIT 1`).get() as unknown as BranchRow | null;
  } catch (e) {
    logError('getDefaultBranch', e);
    return null;
  }
}

export function createBranch(input: CreateBranchInput): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    if (input.is_active === false) {
      // no-op
    }
    // If this is the first branch, make it default
    const count = db.prepare(`SELECT COUNT(*) as c FROM branches`).get() as any;
    const isDefault = count.c === 0;

    const res = db.prepare(`
      INSERT INTO branches (name, address, phone, email, is_active, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      input.address || null,
      input.phone || null,
      input.email || null,
      input.is_active !== false ? 1 : 0,
      isDefault ? 1 : 0
    );
    const id = Number(res.lastInsertRowid);

    if (isDefault) {
      db.prepare(`UPDATE settings SET value = ? WHERE key = 'default_branch_id'`).run(String(id));
    }
    return { ok: true, id };
  } catch (e) {
    logError('createBranch', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function updateBranch(id: number, input: Partial<CreateBranchInput & { is_default?: boolean }>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = [];
    const vals: any[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); vals.push(input.name); }
    if (input.address !== undefined) { fields.push('address = ?'); vals.push(input.address); }
    if (input.phone !== undefined) { fields.push('phone = ?'); vals.push(input.phone); }
    if (input.email !== undefined) { fields.push('email = ?'); vals.push(input.email); }
    if (input.is_active !== undefined) { fields.push('is_active = ?'); vals.push(input.is_active ? 1 : 0); }
    if (input.is_default !== undefined) { fields.push('is_default = ?'); vals.push(input.is_default ? 1 : 0); }

    if (fields.length === 0) return { ok: true };

    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`);
    vals.push(id);

    db.prepare(`UPDATE branches SET ${fields.join(', ')} WHERE id = ?`).run(...vals);

    // Handle default branch change
    if (input.is_default === true) {
      db.prepare(`UPDATE branches SET is_default = 0 WHERE id != ?`).run(id);
      db.prepare(`UPDATE settings SET value = ? WHERE key = 'default_branch_id'`).run(String(id));
    }
    return { ok: true };
  } catch (e) {
    logError('updateBranch', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteBranch(id: number): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const b = db.prepare(`SELECT is_default FROM branches WHERE id = ?`).get(id) as any;
    if (!b) return { ok: false, message: 'Branch not found' };
    if (b.is_default) return { ok: false, message: 'Cannot delete default branch' };

    // Check for associated data
    const tables = ['sales', 'purchase_orders', 'shifts', 'stock_movements', 'activity_log'];
    for (const t of tables) {
      const cnt = db.prepare(`SELECT COUNT(*) as c FROM ${t} WHERE branch_id = ?`).get(id) as any;
      if (cnt.c > 0) return { ok: false, message: `Branch has data in ${t}, cannot delete` };
    }

    db.prepare(`DELETE FROM branches WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) {
    logError('deleteBranch', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function setCurrentBranch(branchId: number): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const b = db.prepare(`SELECT id FROM branches WHERE id = ? AND is_active = 1`).get(branchId);
    if (!b) return { ok: false, message: 'Branch not found or inactive' };
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'current_branch_id'`).run(String(branchId));
    return { ok: true };
  } catch (e) {
    logError('setCurrentBranch', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function getCurrentBranch(): BranchRow | null {
  try {
    const db = getDb();
    const setting = db.prepare(`SELECT value FROM settings WHERE key = 'current_branch_id'`).get() as any;
    if (!setting?.value) return getDefaultBranch();
    return db.prepare(`SELECT * FROM branches WHERE id = ? AND is_active = 1`).get(Number(setting.value)) as unknown as BranchRow | null;
  } catch (e) {
    logError('getCurrentBranch', e);
    return getDefaultBranch();
  }
}

export const branchesService = {
  list: listBranches,
  get: getBranch,
  getDefault: getDefaultBranch,
  create: createBranch,
  update: updateBranch,
  delete: deleteBranch,
  setCurrent: setCurrentBranch,
  getCurrent: getCurrentBranch,
};