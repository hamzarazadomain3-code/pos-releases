import { getDb } from '../db';
import { logError } from '../logger';

/**
 * FIFO Stock Engine — allocates quantities from oldest batches first
 */
export interface FIFOAllocation {
  product_batch_id: number;
  batch_number: string;
  allocated_qty: number;
  unit_cost: number;
}

export function isFIFOEnabled(): boolean {
  try {
    const val = getDb().prepare(`SELECT value FROM settings WHERE key = 'fifo_enabled'`).get() as any;
    return val?.value !== 'false';
  } catch { return true; }
}

export function isFIFOStrict(): boolean {
  try {
    const val = getDb().prepare(`SELECT value FROM settings WHERE key = 'fifo_strict_mode'`).get() as any;
    return val?.value === 'true';
  } catch { return false; }
}

/**
 * Get available FIFO batches for a product (oldest first)
 */
export function getAvailableBatches(productId: number): Array<{
  id: number;
  batch_number: string;
  available_qty: number;
  unit_cost: number;
  expiry_date: string | null;
}> {
  try {
    return getDb().prepare(`
      SELECT pb.id, pb.batch_number,
             (pb.quantity_received - COALESCE(
               (SELECT SUM(allocated_qty) FROM fifo_allocations WHERE product_batch_id = pb.id), 0
             )) as available_qty,
             pb.cost_price as unit_cost,
             pb.expiry_date
      FROM product_batches pb
      WHERE pb.product_id = ? AND pb.quantity_received > 0
      ORDER BY pb.received_date ASC, pb.id ASC
    `).all(productId) as any[];
  } catch (e) { logError('getAvailableBatches', e); return []; }
}

/**
 * Allocate quantity using FIFO — returns allocations and total cost
 */
export function allocateFIFO(productId: number, qtyNeeded: number): {
  allocations: FIFOAllocation[];
  totalCost: number;
  fullyAllocated: boolean;
} {
  const db = getDb();
  if (!isFIFOEnabled()) {
    // Fallback: use product's average cost
    const p = db.prepare(`SELECT cost_price FROM products WHERE id = ?`).get(productId) as any;
    return {
      allocations: [{ product_batch_id: 0, batch_number: 'N/A', allocated_qty: qtyNeeded, unit_cost: p?.cost_price || 0 }],
      totalCost: qtyNeeded * (p?.cost_price || 0),
      fullyAllocated: true,
    };
  }

  const batches = getAvailableBatches(productId);
  const allocations: FIFOAllocation[] = [];
  let remaining = qtyNeeded;
  let totalCost = 0;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.available_qty);
    if (take <= 0) continue;

    allocations.push({
      product_batch_id: batch.id,
      batch_number: batch.batch_number,
      allocated_qty: take,
      unit_cost: batch.unit_cost,
    });
    totalCost += take * batch.unit_cost;
    remaining -= take;
  }

  return { allocations, totalCost, fullyAllocated: remaining <= 0 };
}

/**
 * Commit FIFO allocations for a sale item
 */
export function commitFIFOAllocations(saleItemId: number, allocations: FIFOAllocation[]): boolean {
  try {
    const db = getDb();
    const ins = db.prepare(`
      INSERT INTO fifo_allocations (sale_item_id, product_batch_id, allocated_qty, unit_cost)
      VALUES (?, ?, ?, ?)
    `);
    for (const a of allocations) {
      ins.run(saleItemId, a.product_batch_id, a.allocated_qty, a.unit_cost);
    }
    return true;
  } catch (e) { logError('commitFIFOAllocations', e); return false; }
}

/**
 * Release FIFO allocations (on sale void/return)
 */
export function releaseFIFOAllocations(saleItemId: number): boolean {
  try {
    getDb().prepare(`DELETE FROM fifo_allocations WHERE sale_item_id = ?`).run(saleItemId);
    return true;
  } catch (e) { logError('releaseFIFOAllocations', e); return false; }
}

/**
 * Get FIFO cost for a sale item (for profitability)
 */
export function getFIFOCostForSaleItem(saleItemId: number): { totalCost: number; avgCost: number } {
  try {
    const rows = getDb().prepare(`
      SELECT allocated_qty, unit_cost
      FROM fifo_allocations
      WHERE sale_item_id = ?
    `).all(saleItemId) as { allocated_qty: number; unit_cost: number }[];

    let totalQty = 0, totalCost = 0;
    for (const r of rows) {
      totalQty += r.allocated_qty;
      totalCost += r.allocated_qty * r.unit_cost;
    }
    return { totalCost, avgCost: totalQty > 0 ? totalCost / totalQty : 0 };
  } catch { return { totalCost: 0, avgCost: 0 }; }
}

/**
 * Get batch-wise stock report with FIFO valuation
 */
export function getFIFOStockReport(productId?: number): Array<{
  product_id: number;
  product_name: string;
  batch_id: number;
  batch_number: string;
  total_qty: number;
  available_qty: number;
  unit_cost: number;
  total_value: number;
}> {
  try {
    let sql = `
      SELECT p.id as product_id, p.name as product_name,
             pb.id as batch_id, pb.batch_number,
             pb.quantity_received as total_qty,
             (pb.quantity_received - COALESCE(
               (SELECT SUM(allocated_qty) FROM fifo_allocations WHERE product_batch_id = pb.id), 0
             )) as available_qty,
             pb.cost_price as unit_cost,
             (pb.quantity_received - COALESCE(
               (SELECT SUM(allocated_qty) FROM fifo_allocations WHERE product_batch_id = pb.id), 0
             )) * pb.cost_price as total_value
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.quantity_received > 0
    `;
    const params: any[] = [];
    if (productId) { sql += ` AND p.id = ?`; params.push(productId); }
    sql += ` ORDER BY p.name, pb.received_date, pb.id`;
    return getDb().prepare(sql).all(...params) as any[];
  } catch (e) { logError('getFIFOStockReport', e); return []; }
}

export const fifoEngine = {
  isEnabled: isFIFOEnabled,
  isStrict: isFIFOStrict,
  getAvailableBatches,
  allocateFIFO,
  commitFIFOAllocations,
  releaseFIFOAllocations,
  getFIFOCostForSaleItem,
  getFIFOStockReport,
};