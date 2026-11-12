/**
 * Pure function: should we jump to the qty field after adding a product?
 *
 * Rules:
 * - Only when the setting is enabled.
 * - Only for manual dropdown picks (source === 'dropdown').
 * - Never for scanner/barcode picks (source === 'scan').
 * - Scale items (isScale === true) still get focus — same qty/weight field.
 * - Works for products with units — focuses the same qty field.
 */
export interface QtyJumpDecision {
  shouldJump: boolean;
  reason: string;
}

export function shouldJumpToQty(params: {
  source: 'dropdown' | 'scan';
  enabled: boolean;
  isScale: boolean;
}): QtyJumpDecision {
  const { source, enabled, isScale } = params;
  if (!enabled) {
    return { shouldJump: false, reason: 'setting disabled' };
  }
  if (source === 'scan') {
    return { shouldJump: false, reason: 'scanner path — keep search focus' };
  }
  // source === 'dropdown' (manual pick via Enter or mouse click)
  return { shouldJump: true, reason: 'manual dropdown pick' };
}