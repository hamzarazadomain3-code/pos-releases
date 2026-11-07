/**
 * Pure rules for the Admin Panel <-> Shop Profile settings bridge.
 *
 * The Admin Panel historically owned a second copy of settings that the shop
 * profile also owned. `applyProfileOverrides()` made reads agree, but a
 * "Save All" could still write the stale admin copy back over the canonical
 * value — most visibly, `allow_negative_stock` was shown as a boolean, so a
 * profile value of "warn" rendered as "off" and saving overwrote it with "no".
 *
 * These helpers keep the decision testable without Electron:
 *   - the profile owns the four canonical keys;
 *   - `allow_negative_stock` is not an admin control at all;
 *   - a batch write only writes keys the screen actually changed.
 */

export type SettingsMap = Record<string, string>;

/** Admin keys whose canonical value lives in `settings` (the Shop Profile). */
export const ADMIN_PROFILE_MIRROR: Record<string, string> = {
  currency_symbol: 'currency',
  receipt_footer_text: 'receipt_footer',
  payment_due_days: 'default_credit_days',
};

/**
 * Keys that must never be written through the Admin Panel. Negative-stock mode
 * has three values (yes / warn / no) and is edited in Settings → Billing; the
 * old boolean toggle could only express two of them.
 */
export const ADMIN_NON_WRITABLE_KEYS = new Set(['allow_negative_stock']);

export interface AdminBatchPlan {
  writes: SettingsMap;
  mirrors: { target: string; value: string }[];
  skipped: string[];
}

/**
 * Build the Admin Panel read model: raw `admin_settings` rows overlaid with the
 * canonical profile values. `allow_negative_stock` is deliberately absent so no
 * toggle can be rendered for it.
 */
export function overlayAdminSettings(raw: SettingsMap, profile: SettingsMap): SettingsMap {
  const map: SettingsMap = { ...raw };
  for (const [adminKey, profileKey] of Object.entries(ADMIN_PROFILE_MIRROR)) {
    const value = profile[profileKey];
    if (value !== undefined) map[adminKey] = value;
  }
  // Three-state value; the admin panel has no control for it.
  delete map.allow_negative_stock;
  return map;
}

/**
 * Decide what a "Save All" should actually write.
 *
 * - Non-writable keys are skipped unconditionally.
 * - A key whose value still equals what the screen loaded is skipped, so a
 *   stale hidden field cannot overwrite a canonical value behind the user's
 *   back.
 * - A key already equal to the stored raw value is skipped as a no-op.
 */
export function planAdminBatch(
  raw: SettingsMap,
  loaded: SettingsMap,
  incoming: SettingsMap
): AdminBatchPlan {
  const plan: AdminBatchPlan = { writes: {}, mirrors: [], skipped: [] };

  for (const [key, value] of Object.entries(incoming)) {
    if (ADMIN_NON_WRITABLE_KEYS.has(key)) {
      plan.skipped.push(key);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(loaded, key) && loaded[key] === value) {
      plan.skipped.push(key);
      continue;
    }
    if (raw[key] === value) {
      plan.skipped.push(key);
      continue;
    }

    plan.writes[key] = value;
    const target = ADMIN_PROFILE_MIRROR[key];
    if (target) plan.mirrors.push({ target, value });
  }

  return plan;
}
