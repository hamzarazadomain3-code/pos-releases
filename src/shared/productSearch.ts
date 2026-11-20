/**
 * Pure product search — single source of truth for ranking products by query.
 *
 * Used by:
 *   - Billing.tsx product search dropdown
 *   - QuickSaleGrid.tsx product search
 *   - Any other screen that needs product search
 *
 * Ranking (highest first):
 *   1. Exact code (sku) or barcode match
 *   2. Code/barcode starts with query
 *   3. Name starts with query
 *   4. Name contains query
 *   5. Code/barcode contains query
 *
 * Case-insensitive, trims spaces, Urdu names work, null-safe.
 */

import type { Product } from './types';

export interface ScoredProduct {
  product: Product;
  score: number; // higher = better match
  matchType: 'exact' | 'prefix_code' | 'prefix_name' | 'contains_name' | 'contains_code';
}

/**
 * Normalize a string for comparison: trim, lowercase, handle null/undefined.
 */
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Score a single product against the query.
 * Returns score (higher = better) and match type for tie-breaking.
 */
function scoreProduct(product: Product, query: string): ScoredProduct {
  const q = norm(query);
  const name = norm(product.name);
  const sku = norm(product.sku);
  const barcode = norm(product.barcode);

  // 1. Exact code/barcode match
  if (sku === q && sku.length > 0) {
    return { product, score: 1000, matchType: 'exact' };
  }
  if (barcode === q && barcode.length > 0) {
    return { product, score: 1000, matchType: 'exact' };
  }

  // 2. Code/barcode starts with query
  if (sku.startsWith(q) && sku.length > 0) {
    return { product, score: 900 - q.length, matchType: 'prefix_code' };
  }
  if (barcode.startsWith(q) && barcode.length > 0) {
    return { product, score: 900 - q.length, matchType: 'prefix_code' };
  }

  // 3. Name starts with query
  if (name.startsWith(q) && name.length > 0) {
    return { product, score: 800 - q.length, matchType: 'prefix_name' };
  }

  // 4. Name contains query
  if (name.includes(q) && name.length > 0) {
    return { product, score: 700 - q.length, matchType: 'contains_name' };
  }

  // 5. Code/barcode contains query
  if (sku.includes(q) && sku.length > 0) {
    return { product, score: 600 - q.length, matchType: 'contains_code' };
  }
  if (barcode.includes(q) && barcode.length > 0) {
    return { product, score: 600 - q.length, matchType: 'contains_code' };
  }

  // No match
  return { product, score: 0, matchType: 'contains_name' };
}

/**
 * Match and rank products by query.
 *
 * @param products - Array of Product objects to search
 * @param query - Search string (trimmed, case-insensitive)
 * @param limit - Maximum results to return (default 40)
 * @returns Ranked array of products (best matches first)
 */
export function matchProducts(
  products: Product[],
  query: string,
  limit = 40
): Product[] {
  const trimmed = query.trim();
  if (!trimmed) return products.slice(0, limit);

  const scored = products
    .map((p) => scoreProduct(p, trimmed))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.product);
}

/**
 * Check if query exactly matches a product's sku or barcode.
 * Used for immediate Enter selection.
 */
export function findExactCodeMatch(products: Product[], query: string): Product | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return products.find((p) => norm(p.sku) === q || norm(p.barcode) === q);
}

/**
 * Get display code for a product (sku preferred, then barcode).
 * Treats empty string as absent.
 */
export function getProductCode(product: Product): string | null {
  const sku = product.sku?.trim();
  if (sku && sku.length > 0) return sku;
  const barcode = product.barcode?.trim();
  if (barcode && barcode.length > 0) return barcode;
  return null;
}