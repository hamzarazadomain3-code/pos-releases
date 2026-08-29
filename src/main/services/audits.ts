import { getDb } from '../db';
import { can, getSessionUserId } from './auth';
import { adjustStock } from './inventory';
import { logActivity } from './activity';
import type { AuditCountInput, AuditItemRow, AuditRow } from '../../shared/types';

function requireAuditAccess(): void {
  if (!can('manager')) throw new Error('Only the owner or manager can manage audits');
}

type AuditFull = AuditRow & { items: AuditItemRow[] };

export function createAudit(): AuditFull {
  requireAuditAccess();
  const db = getDb();
  db.exec('BEGIN');
  try {
    const info = db
      .prepare('INSERT INTO audits (user_id, status) VALUES (?, ?)')
      .run(getSessionUserId() ?? 1, 'in_progress');
    const auditId = Number(info.lastInsertRowid);
    const products = db
      .prepare('SELECT id, stock_qty FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE')
      .all() as { id: number; stock_qty: number }[];
    const ins = db.prepare(
      'INSERT INTO audit_items (audit_id, product_id, system_qty) VALUES (?, ?, ?)'
    );
    for (const p of products) ins.run(auditId, p.id, p.stock_qty);
    db.exec('COMMIT');
    const audit = getAudit(auditId);
    if (!audit) throw new Error('Failed to create audit');
    logActivity('audit_started', 'audit', auditId, `items=${products.length}`);
    return audit;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getAudit(id: number): AuditFull | null {
  requireAuditAccess();
  const db = getDb();
  const a = db
    .prepare(
      `SELECT a.*, u.username
       FROM audits a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`
    )
    .get(id) as unknown as AuditRow | undefined;
  if (!a) return null;
  const items = db
    .prepare(
      `SELECT i.*, p.name AS product_name, p.barcode, c.name AS category_name, u.symbol AS unit_symbol
       FROM audit_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE i.audit_id = ?
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(id) as unknown as AuditItemRow[];
  return { ...a, items };
}

export function listAudits(): AuditRow[] {
  return listAuditsPaginated(1, 500).rows;
}

export function listAuditsPaginated(
  page = 1,
  pageSize = 50,
  from?: string,
  to?: string,
  userId?: number,
  status?: 'in_progress' | 'completed'
): { rows: AuditRow[]; total: number } {
  requireAuditAccess();
  const db = getDb();
  let sql = `
    SELECT a.*, u.username,
      (SELECT COALESCE(SUM(CASE WHEN variance > 0 THEN variance ELSE 0 END), 0)
       FROM audit_items WHERE audit_id = a.id) AS overage,
      (SELECT COALESCE(SUM(CASE WHEN variance < 0 THEN variance ELSE 0 END), 0)
       FROM audit_items WHERE audit_id = a.id) AS shortage
    FROM audits a LEFT JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  if (from) {
    sql += ' AND date(a.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(a.created_at) <= date(?)';
    params.push(to);
  }
  if (userId) {
    sql += ' AND a.user_id = ?';
    params.push(userId);
  }
  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY a.id DESC';
  
  // Count total
  const countSql = sql.replace(/SELECT a\.\*, u\.username,[\s\S]*?FROM audits/, 'SELECT COUNT(*) as total FROM audits');
  const totalResult = db.prepare(countSql).get(...params) as { total: number };
  const total = totalResult.total;
  
  // Add pagination
  sql += ' LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);
  
  const rows = db.prepare(sql).all(...params) as unknown as AuditRow[];
  return { rows, total };
}

export function saveCounts(auditId: number, counts: AuditCountInput[]): boolean {
  requireAuditAccess();
  const db = getDb();
  const audit = getAudit(auditId);
  if (!audit) throw new Error('Audit not found');
  if (audit.status !== 'in_progress') throw new Error('This audit is already completed');

  const itemIds = new Set(audit.items.map((i) => i.product_id));
  const upd = db.prepare(
    'UPDATE audit_items SET counted_qty = ?, variance = ? WHERE audit_id = ? AND product_id = ?'
  );
  db.exec('BEGIN');
  try {
    for (const c of counts) {
      if (!itemIds.has(c.product_id)) throw new Error(`Product #${c.product_id} is not part of this audit`);
      if (c.counted_qty < 0) throw new Error('Counted quantity cannot be negative');
      const item = audit.items.find((i) => i.product_id === c.product_id)!;
      const variance = c.counted_qty - item.system_qty;
      upd.run(c.counted_qty, variance, auditId, c.product_id);
    }
    db.exec('COMMIT');
    logActivity('audit_saved', 'audit', auditId, `counts=${counts.length}`);
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function completeAudit(auditId: number): AuditFull {
  requireAuditAccess();
  const db = getDb();
  const audit = getAudit(auditId);
  if (!audit) throw new Error('Audit not found');
  if (audit.status !== 'in_progress') throw new Error('This audit is already completed');
  const counted = audit.items.filter((i) => i.counted_qty !== null);
  if (!counted.length) throw new Error('No items counted — nothing to complete');

  db.exec('BEGIN');
  try {
    let totalVariance = 0;
    let overage = 0;
    let shortage = 0;
    for (const item of counted) {
      const change = item.counted_qty! - item.system_qty;
      totalVariance += change;
      if (change > 0) overage += change;
      if (change < 0) shortage += change;
      if (change !== 0) {
        adjustStock(item.product_id, change, 'Stock Audit Adjustment', 'audit', auditId);
      }
      db.prepare(
        'UPDATE audit_items SET variance = ? WHERE audit_id = ? AND product_id = ?'
      ).run(change, auditId, item.product_id);
    }
    const completedAt = new Date().toISOString();
    db.prepare(
      `UPDATE audits SET status = 'completed', total_items = ?, total_variance = ?, completed_at = ?
       WHERE id = ?`
    ).run(counted.length, totalVariance, completedAt, auditId);
    db.exec('COMMIT');
    logActivity(
      'audit_completed',
      'audit',
      auditId,
      `items=${counted.length} | overage=${overage} | shortage=${shortage}`
    );
    const done = getAudit(auditId);
    if (!done) throw new Error('Failed to load completed audit');
    return done;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}