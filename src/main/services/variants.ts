import { getDb } from '../db';
import { logError } from '../logger';

export interface VariantAttributeRow {
  id: number;
  name: string;
  sort_order: number;
}

export interface VariantAttributeValueRow {
  id: number;
  attribute_id: number;
  value: string;
  sort_order: number;
}

export interface ProductVariantRow {
  id: number;
  product_id: number;
  variant_name: string;
  sku: string | null;
  barcode: string | null;
  mrp: number;
  sale_price: number;
  purchase_price: number;
  stock_qty: number;
  low_stock_threshold: number;
  weight: number;
  image_url: string | null;
  attributes_json: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── Attributes ──

export function listAttributes(): VariantAttributeRow[] {
  try {
    return getDb().prepare(`SELECT * FROM variant_attributes ORDER BY sort_order, name`).all() as unknown as VariantAttributeRow[];
  } catch (e) { logError('listAttributes', e); return []; }
}

export function getAttributeValues(attributeId: number): VariantAttributeValueRow[] {
  try {
    return getDb().prepare(`SELECT * FROM variant_attribute_values WHERE attribute_id = ? ORDER BY sort_order, value`).all(attributeId) as unknown as VariantAttributeValueRow[];
  } catch (e) { logError('getAttributeValues', e); return []; }
}

export function createAttribute(name: string): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const exists = db.prepare(`SELECT id FROM variant_attributes WHERE name = ?`).get(name);
    if (exists) return { ok: false, message: 'Attribute already exists' };
    const r = db.prepare(`INSERT INTO variant_attributes (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM variant_attributes))`).run(name);
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (e) { logError('createAttribute', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export function addAttributeValue(attributeId: number, value: string): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const exists = db.prepare(`SELECT id FROM variant_attribute_values WHERE attribute_id = ? AND value = ?`).get(attributeId, value);
    if (exists) return { ok: false, message: 'Value already exists' };
    const r = db.prepare(`INSERT INTO variant_attribute_values (attribute_id, value, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM variant_attribute_values WHERE attribute_id = ?))`).run(attributeId, value, attributeId);
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (e) { logError('addAttributeValue', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export function deleteAttribute(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM variant_attributes WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteAttribute', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export function deleteAttributeValue(id: number): { ok: boolean; message?: string } {
  try {
    getDb().prepare(`DELETE FROM variant_attribute_values WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) { logError('deleteAttributeValue', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

// ── Product Variants ──

export function listVariantsForProduct(productId: number): ProductVariantRow[] {
  try {
    return getDb().prepare(`SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, variant_name`).all(productId) as unknown as ProductVariantRow[];
  } catch (e) { logError('listVariantsForProduct', e); return []; }
}

export function findVariantByBarcode(barcode: string): ProductVariantRow | null {
  try {
    return getDb().prepare(`SELECT * FROM product_variants WHERE barcode = ? AND is_active = 1`).get(barcode) as unknown as ProductVariantRow | null;
  } catch (e) { logError('findVariantByBarcode', e); return null; }
}

export function getVariant(id: number): ProductVariantRow | null {
  try {
    return getDb().prepare(`SELECT * FROM product_variants WHERE id = ?`).get(id) as unknown as ProductVariantRow | null;
  } catch (e) { logError('getVariant', e); return null; }
}

export function createVariant(input: {
  product_id: number;
  variant_name: string;
  sku?: string;
  barcode?: string;
  mrp?: number;
  sale_price?: number;
  purchase_price?: number;
  stock_qty?: number;
  low_stock_threshold?: number;
  weight?: number;
  image_url?: string;
  attributes?: Record<string, string>;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    if (input.barcode) {
      const exists = db.prepare(`SELECT id FROM product_variants WHERE barcode = ?`).get(input.barcode);
      if (exists) return { ok: false, message: 'Barcode already exists' };
    }
    const r = db.prepare(`
      INSERT INTO product_variants (product_id, variant_name, sku, barcode, mrp, sale_price, purchase_price, stock_qty, low_stock_threshold, weight, image_url, attributes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.product_id, input.variant_name, input.sku || null, input.barcode || null,
      input.mrp ?? 0, input.sale_price ?? 0, input.purchase_price ?? 0,
      input.stock_qty ?? 0, input.low_stock_threshold ?? 0, input.weight ?? 0,
      input.image_url || null, JSON.stringify(input.attributes || {})
    );
    // Mark product as having variants
    db.prepare(`UPDATE products SET has_variants = 1, updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`).run(input.product_id);
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (e) { logError('createVariant', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export function updateVariant(id: number, input: Partial<{
  variant_name: string;
  sku: string;
  barcode: string;
  mrp: number;
  sale_price: number;
  purchase_price: number;
  stock_qty: number;
  low_stock_threshold: number;
  weight: number;
  image_url: string;
  attributes: Record<string, string>;
  is_active: boolean;
  sort_order: number;
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const fields: string[] = [];
    const vals: any[] = [];
    const map: Record<string, string> = {
      variant_name: 'variant_name', sku: 'sku', barcode: 'barcode',
      mrp: 'mrp', sale_price: 'sale_price', purchase_price: 'purchase_price',
      stock_qty: 'stock_qty', low_stock_threshold: 'low_stock_threshold',
      weight: 'weight', image_url: 'image_url',
    };
    for (const [k, col] of Object.entries(map)) {
      if (input[k as keyof typeof input] !== undefined) {
        fields.push(`${col} = ?`); vals.push(input[k as keyof typeof input]);
      }
    }
    if (input.attributes !== undefined) { fields.push(`attributes_json = ?`); vals.push(JSON.stringify(input.attributes)); }
    if (input.is_active !== undefined) { fields.push(`is_active = ?`); vals.push(input.is_active ? 1 : 0); }
    if (input.sort_order !== undefined) { fields.push(`sort_order = ?`); vals.push(input.sort_order); }

    if (fields.length === 0) return { ok: true };
    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`);
    vals.push(id);
    db.prepare(`UPDATE product_variants SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) { logError('updateVariant', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export function deleteVariant(id: number): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const v = db.prepare(`SELECT product_id FROM product_variants WHERE id = ?`).get(id) as any;
    if (!v) return { ok: false, message: 'Variant not found' };
    db.prepare(`UPDATE product_variants SET is_active = 0, updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`).run(id);
    // If no more variants, clear has_variants flag
    const remaining = db.prepare(`SELECT COUNT(*) as c FROM product_variants WHERE product_id = ? AND is_active = 1`).get(v.product_id) as any;
    if (remaining.c === 0) {
      db.prepare(`UPDATE products SET has_variants = 0 WHERE id = ?`).run(v.product_id);
    }
    return { ok: true };
  } catch (e) { logError('deleteVariant', e); return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/**
 * Auto-generate all combinations of selected attribute values for a product.
 * Example: colors=[Red,Blue] × sizes=[S,M,L] → 6 variants.
 * Each gets unique barcode by appending suffix to base barcode.
 */
export function autoGenerateVariants(input: {
  product_id: number;
  base_barcode?: string;
  base_sku?: string;
  sale_price: number;
  mrp?: number;
  purchase_price?: number;
  initial_stock?: number;
  attribute_value_ids: number[][]; // e.g. [[1,2,3],[4,5,6]] → 3 colors × 3 sizes
}): { ok: boolean; count?: number; message?: string } {
  try {
    const db = getDb();
    if (!input.attribute_value_ids || input.attribute_value_ids.length === 0) {
      return { ok: false, message: 'Select at least one attribute value' };
    }

    // Load all attribute values with their attribute name
    const allIds = input.attribute_value_ids.flat();
    const placeholders = allIds.map(() => '?').join(',');
    const valueRows = db.prepare(`
      SELECT vav.id, vav.value, va.name as attr_name
      FROM variant_attribute_values vav
      JOIN variant_attributes va ON va.id = vav.attribute_id
      WHERE vav.id IN (${placeholders})
    `).all(...allIds) as Array<{ id: number; value: string; attr_name: string }>;

    const byId = new Map(valueRows.map((r) => [r.id, r]));

    // Cartesian product
    const combos: Array<Array<{ id: number; value: string; attr_name: string }>> = [[]];
    for (const group of input.attribute_value_ids) {
      const next: typeof combos = [];
      for (const combo of combos) {
        for (const id of group) {
          const row = byId.get(id);
          if (row) next.push([...combo, row]);
        }
      }
      combos.splice(0, combos.length, ...next);
    }

    db.exec('BEGIN');
    let count = 0;
    try {
      const ins = db.prepare(`
        INSERT INTO product_variants (product_id, variant_name, sku, barcode, mrp, sale_price, purchase_price, stock_qty, attributes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const initialStock = input.initial_stock ?? 0;
      for (const combo of combos) {
        const variantName = combo.map((c) => `${c.attr_name}: ${c.value}`).join(' | ');
        const attrMap: Record<string, string> = {};
        combo.forEach((c) => { attrMap[c.attr_name] = c.value; });

        // Generate barcode by appending checksum-like suffix
        const barcode = input.base_barcode
          ? `${input.base_barcode}-${combo.map((c) => c.value.substring(0, 2).toUpperCase()).join('')}`
          : null;
        const sku = input.base_sku
          ? `${input.base_sku}-${combo.map((c) => c.value.substring(0, 2).toUpperCase()).join('')}`
          : null;

        try {
          ins.run(
            input.product_id, variantName, sku, barcode,
            input.mrp ?? input.sale_price, input.sale_price, input.purchase_price ?? 0,
            initialStock, JSON.stringify(attrMap)
          );
          count++;
        } catch {
          // Skip duplicates (barcode collision)
        }
      }
      db.prepare(`UPDATE products SET has_variants = 1, updated_at = datetime('now', 'utc') || 'Z' WHERE id = ?`).run(input.product_id);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    return { ok: true, count };
  } catch (e) {
    logError('autoGenerateVariants', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Parse variant_name or attributes_json into a map.
 */
export function parseAttributes(v: ProductVariantRow): Record<string, string> {
  if (v.attributes_json) {
    try { return JSON.parse(v.attributes_json); } catch { /* fallthrough */ }
  }
  // Fallback: try to parse "Color: Red | Size: XL"
  const result: Record<string, string> = {};
  if (v.variant_name && v.variant_name.includes('|')) {
    for (const part of v.variant_name.split('|')) {
      const [k, val] = part.split(':').map((s) => s.trim());
      if (k && val) result[k] = val;
    }
  }
  return result;
}

export const variantsService = {
  listAttributes,
  getAttributeValues,
  createAttribute,
  addAttributeValue,
  deleteAttribute,
  deleteAttributeValue,
  listVariantsForProduct,
  findVariantByBarcode,
  getVariant,
  createVariant,
  updateVariant,
  deleteVariant,
  autoGenerateVariants,
  parseAttributes,
};
