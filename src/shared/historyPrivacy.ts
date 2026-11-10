/**
 * Snapshot privacy for cashier-facing Sales History detail.
 *
 * History snapshots are written by the sale/hold path and may contain the
 * product's `cost_price` or a computed profit. A cashier may see their own
 * event's customer/line/price data, never the shop's cost or margin.
 */
const BLOCKED_KEYS = new Set([
  'cost',
  'cost_price',
  'costprice',
  'unit_cost',
  'purchase_price',
  'profit',
  'profit_amount',
  'profit_pct',
  'margin',
  'margin_pct',
  'gross_profit',
]);

function blocked(key: string): boolean {
  return BLOCKED_KEYS.has(key.toLowerCase());
}

/** Deep-clone a snapshot, dropping every cost/profit/margin key. */
export function stripCostFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCostFields);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (blocked(key)) continue;
    out[key] = stripCostFields(child);
  }
  return out;
}
