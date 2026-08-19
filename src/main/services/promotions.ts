import { getDb } from '../db';
import { can } from './auth';
import { logActivity } from './activity';
import type { PromotionInput, PromotionRow, ResolvedPromotion } from '../../shared/types';

function requireManager(): void {
  if (!can('manager')) throw new Error('Only the owner or manager can manage promotions');
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function listPromotions(): PromotionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, pr.name AS product_name, c.name AS category_name
       FROM promotions p
       LEFT JOIN products pr ON pr.id = p.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.active DESC, p.id DESC LIMIT 500`
    )
    .all() as unknown as PromotionRow[];
}

function activePromotions(): PromotionRow[] {
  const db = getDb();
  const t = today();
  return db
    .prepare(
      `SELECT p.*, pr.name AS product_name, c.name AS category_name
       FROM promotions p
       LEFT JOIN products pr ON pr.id = p.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1
         AND (p.start_date IS NULL OR p.start_date = '' OR p.start_date <= ?)
         AND (p.end_date IS NULL OR p.end_date = '' OR p.end_date >= ?)`
    )
    .all(t, t) as unknown as PromotionRow[];
}

function effectivePrice(
  promo: PromotionRow,
  price: number,
  qty: number
): { effective: number; saved: number } {
  if (promo.type === 'percent') {
    const saved = (price * promo.discount_value) / 100;
    return { effective: Math.max(0, price - saved), saved };
  }
  if (promo.type === 'fixed') {
    const saved = Math.min(promo.discount_value, price);
    return { effective: Math.max(0, price - saved), saved };
  }
  const bundle = promo.buy_qty + promo.free_qty;
  const fullBundles = Math.floor(qty / bundle);
  const freeUnits = fullBundles * promo.free_qty;
  const saved = freeUnits * price * (promo.discount_value / 100);
  return { effective: Math.max(0, (price * qty - saved) / qty), saved };
}

export function resolvePromotions(
  items: { product_id: number; qty: number; price: number }[]
): ResolvedPromotion[] {
  const db = getDb();
  const promos = activePromotions();
  const cats = db.prepare('SELECT id, category_id FROM products').all() as {
    id: number;
    category_id: number | null;
  }[];
  const catOf = new Map(cats.map((c) => [c.id, c.category_id]));

  return items.map((it) => {
    const pid = it.product_id;
    const catId = catOf.get(pid) ?? null;
    const candidates = promos.filter(
      (p) =>
        (p.scope === 'product' && p.product_id === pid) ||
        (p.scope === 'category' && p.category_id === catId)
    );
    if (!candidates.length) {
      return {
        product_id: pid,
        base_price: it.price,
        effective_price: it.price,
        saved: 0,
        promo_id: null,
        promo_name: null,
        promo_type: null,
      };
    }

    let best: { promo: PromotionRow; effective: number; saved: number } | null = null;
    for (const promo of candidates) {
      const calc = effectivePrice(promo, it.price, it.qty);
      const score = calc.effective;
      const better =
        !best ||
        score < best.effective - 1e-9 ||
        (Math.abs(score - best.effective) <= 1e-9 && promo.scope === 'product' && best.promo.scope !== 'product');
      if (better) best = { promo, effective: calc.effective, saved: calc.saved };
    }

    if (!best || best.saved <= 1e-9) {
      return {
        product_id: pid,
        base_price: it.price,
        effective_price: it.price,
        saved: 0,
        promo_id: null,
        promo_name: null,
        promo_type: null,
      };
    }

    return {
      product_id: pid,
      base_price: it.price,
      effective_price: best.effective,
      saved: best.saved,
      promo_id: best.promo.id,
      promo_name: best.promo.name,
      promo_type: best.promo.type,
    };
  });
}

export function createPromotion(input: PromotionInput): PromotionRow {
  requireManager();
  validatePromotion(input);
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO promotions (name, type, scope, product_id, category_id, discount_value, buy_qty, free_qty, start_date, end_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name.trim(),
      input.type,
      input.scope,
      input.product_id ?? null,
      input.category_id ?? null,
      input.discount_value,
      input.buy_qty ?? 1,
      input.free_qty ?? 0,
      input.start_date || null,
      input.end_date || null,
      input.active === false ? 0 : 1
    );
  const id = Number(info.lastInsertRowid);
  const promo = listPromotions().find((p) => p.id === id);
  if (!promo) throw new Error('Failed to create promotion');
  logActivity('promo_created', 'promotion', id, `${promo.name} | type=${promo.type} | scope=${promo.scope}`);
  return promo;
}

export function updatePromotion(id: number, input: PromotionInput): PromotionRow {
  requireManager();
  const existing = listPromotions().find((p) => p.id === id);
  if (!existing) throw new Error('Promotion not found');
  validatePromotion(input);
  const db = getDb();
  db.prepare(
    `UPDATE promotions SET
       name = ?, type = ?, scope = ?, product_id = ?, category_id = ?,
       discount_value = ?, buy_qty = ?, free_qty = ?, start_date = ?, end_date = ?, active = ?
     WHERE id = ?`
  ).run(
    input.name.trim(),
    input.type,
    input.scope,
    input.product_id ?? null,
    input.category_id ?? null,
    input.discount_value,
    input.buy_qty ?? 1,
    input.free_qty ?? 0,
    input.start_date || null,
    input.end_date || null,
    input.active === false ? 0 : 1,
    id
  );
  const promo = listPromotions().find((p) => p.id === id);
  if (!promo) throw new Error('Failed to update promotion');
  logActivity('promo_updated', 'promotion', id, `${promo.name} | type=${promo.type}`);
  return promo;
}

export function deletePromotion(id: number): boolean {
  requireManager();
  const db = getDb();
  const info = db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
  if (info.changes > 0) logActivity('promo_deleted', 'promotion', id);
  return info.changes > 0;
}

function validatePromotion(input: PromotionInput): void {
  if (!input.name || !input.name.trim()) throw new Error('Promotion name required');
  if (!['percent', 'fixed', 'bogo'].includes(input.type)) throw new Error('Invalid promotion type');
  if (!['product', 'category'].includes(input.scope)) throw new Error('Invalid promotion scope');
  if (input.scope === 'product' && !input.product_id) throw new Error('Select a product');
  if (input.scope === 'category' && !input.category_id) throw new Error('Select a category');
  if (input.type === 'bogo' && input.scope !== 'product')
    throw new Error('BOGO deals apply to a single product only');
  if (input.type === 'bogo') {
    if (!input.buy_qty || input.buy_qty < 1) throw new Error('Buy quantity must be at least 1');
    if (!input.free_qty || input.free_qty < 1) throw new Error('Free quantity must be at least 1');
    if (input.discount_value <= 0 || input.discount_value > 100)
      throw new Error('Free-item discount must be 1-100% (100 = free)');
  } else if (input.type === 'percent') {
    if (input.discount_value <= 0 || input.discount_value > 100)
      throw new Error('Percentage must be 1-100');
  } else {
    if (input.discount_value < 0) throw new Error('Discount amount cannot be negative');
  }
  if (input.start_date && input.end_date && input.end_date < input.start_date)
    throw new Error('End date must be on or after start date');
}