/**
 * Shared negative-stock policy logic.
 *
 * Both Billing and Quick Sale use the same rules for:
 *   - Checking if a sale would make stock negative
 *   - Determining the policy (yes / warn / no) from settings
 *   - Applying max_negative_qty cap (from settings)
 *   - Warning toast logic
 *
 * The setting `allow_negative_stock` is stored in the Shop Profile (`settings`
 * table) as:
 *   'yes'  = allow negative stock silently
 *   'warn' = allow but warn once per session
 *   'no'   = block sales that would make stock negative
 *
 * The setting `max_negative_qty` (same `settings` table, seeded to '0' by
 * migration 072) caps how negative stock can go.
 *   0 = no cap (unlimited negative)
 *   >0 = max absolute negative value allowed
 */
import type { Product } from './types';

export type NegativeStockPolicy = 'yes' | 'warn' | 'no';

/**
 * Parse the `allow_negative_stock` setting value.
 * Defaults to 'warn' for any unrecognized value.
 */
export function parseNegativeStockPolicy(raw: string | null | undefined): NegativeStockPolicy {
  if (raw === 'yes' || raw === 'no') return raw;
  return 'warn';
}

/**
 * Check if a quantity change would violate the negative stock policy.
 *
 * @param product - The product being sold
 * @param qtyToSell - The quantity being sold (positive number)
 * @param policy - The current negative stock policy
 * @param maxNegativeQty - Optional max negative qty cap from settings (0 = no cap)
 * @returns { allowed: boolean; warning: string | null; blocked: boolean }
 *   - allowed: true if the sale can proceed
 *   - warning: message to show if policy is 'warn' and would go negative
 *   - blocked: true if policy is 'no' and would go negative (or cap exceeded)
 */
export function checkNegativeStock(
  product: Pick<Product, 'stock_qty'>,
  qtyToSell: number,
  policy: NegativeStockPolicy,
  maxNegativeQty: number
): { allowed: boolean; warning: string | null; blocked: boolean } {
  const currentStock = product.stock_qty ?? 0;
  const projected = currentStock - qtyToSell;

  // If stock stays non-negative, always allowed
  if (projected >= 0) {
    return { allowed: true, warning: null, blocked: false };
  }

  // Policy 'yes' allows negative stock silently
  if (policy === 'yes') {
    // Check max_negative_qty cap
    if (maxNegativeQty > 0 && Math.abs(projected) > maxNegativeQty) {
      return {
        allowed: false,
        warning: null,
        blocked: true,
      };
    }
    return { allowed: true, warning: null, blocked: false };
  }

  // Policy 'warn' allows but shows a warning once
  if (policy === 'warn') {
    if (maxNegativeQty > 0 && Math.abs(projected) > maxNegativeQty) {
      return {
        allowed: false,
        warning: null,
        blocked: true,
      };
    }
    return {
      allowed: true,
      warning: `Sale would make stock negative: ${currentStock} - ${qtyToSell} = ${projected}`,
      blocked: false,
    };
  }

  // Policy 'no' blocks negative stock
  if (policy === 'no') {
    return {
      allowed: false,
      warning: `Cannot sell: would make stock negative (${currentStock} - ${qtyToSell} = ${projected})`,
      blocked: true,
    };
  }

  // Fallback (should not happen with parseNegativeStockPolicy)
  return { allowed: true, warning: null, blocked: false };
}

/**
 * Check if a scale item sale would violate the negative stock policy.
 */
export function checkNegativeStockScale(
  product: Pick<Product, 'stock_qty'>,
  scaleWeightKg: number,
  policy: NegativeStockPolicy,
  maxNegativeQty: number
): { allowed: boolean; warning: string | null; blocked: boolean } {
  return checkNegativeStock(product, scaleWeightKg, policy, maxNegativeQty);
}