#!/usr/bin/env node
/**
 * Shortcut-registry test (pure Node, no Electron).
 *
 * The registry in `src/shared/shortcuts.ts` is the single source of truth for
 * combos (it seeds the admin table AND generates the Billing footer/F1 hints).
 * This suite asserts the invariants that a "unified registry" must hold so the
 * two consumers can never disagree:
 *
 *   - unique ids, non-empty fields;
 *   - no two actions produce the same combo on the same screen (which would make
 *     lookups order-dependent) — a local core key may shadow a DB key, but two
 *     DB keys may not collide;
 *   - DB seed excludes the always-on globals and includes the new save_print;
 *   - resolveCombo precedence (admin > registry default > '');
 *   - isActionAllowedOn scoping (F5 cannot fire on Billing).
 *
 * Run: npm run test:shortcuts   (builds dist/shared first)
 */
const {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  resolveCombo,
  isActionAllowedOn,
  hintRows,
  defaultCombo,
} = require('../dist/shared/shortcuts.js');

let checks = 0;
let failures = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const norm = (s) =>
  String(s || '')
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+');

console.log('=== Shortcut registry ===');
check('registry is non-empty', SHORTCUT_ACTIONS.length > 0, `${SHORTCUT_ACTIONS.length} actions`);

// ── Field integrity + unique ids ─────────────────────────────────────────────
const ids = SHORTCUT_ACTIONS.map((a) => a.id);
check('every action has id/label/defaultKey/screens',
  SHORTCUT_ACTIONS.every((a) => a.id && a.label && a.defaultKey && Array.isArray(a.screens) && a.screens.length > 0));
check('action ids are unique', new Set(ids).size === ids.length,
  ids.filter((id, i) => ids.indexOf(id) !== i).join(',') || 'no duplicates');

// ── No duplicate combos on the same screen ───────────────────────────────────
const screens = [...new Set(SHORTCUT_ACTIONS.flatMap((a) => a.screens))];
let collisionReport = '';
for (const screen of screens) {
  const onScreen = SHORTCUT_ACTIONS.filter((a) => a.screens.includes(screen) || a.screens.includes('global'));
  const byCombo = new Map();
  for (const a of onScreen) {
    const combo = norm(a.defaultKey);
    if (!byCombo.has(combo)) byCombo.set(combo, []);
    byCombo.get(combo).push(a);
  }
  for (const [combo, list] of byCombo) {
    const dbBacked = list.filter((a) => a.dbBacked ?? !a.global);
    if (dbBacked.length > 1) collisionReport += `${screen}:${combo}=${dbBacked.map((a) => a.id).join('/')} `;
  }
}
check('no two DB-backed actions share a combo on one screen', collisionReport === '', collisionReport.trim());

// ── DB seed ──────────────────────────────────────────────────────────────────
check('DEFAULT_SHORTCUTS excludes the globals',
  !('command_palette' in DEFAULT_SHORTCUTS) && !('help' in DEFAULT_SHORTCUTS));
check('DEFAULT_SHORTCUTS excludes billing-local keys',
  !('billing_search' in DEFAULT_SHORTCUTS) && !('billing_hold' in DEFAULT_SHORTCUTS));
check('DEFAULT_SHORTCUTS includes save_print = Ctrl+Shift+S',
  DEFAULT_SHORTCUTS.save_print === 'Ctrl+Shift+S', DEFAULT_SHORTCUTS.save_print);
check('the agreed combos are unchanged',
  DEFAULT_SHORTCUTS.save === 'Ctrl+S' &&
  DEFAULT_SHORTCUTS.print === 'Ctrl+P' &&
  DEFAULT_SHORTCUTS.new_return === 'Ctrl+Shift+R',
  `save=${DEFAULT_SHORTCUTS.save} print=${DEFAULT_SHORTCUTS.print} return=${DEFAULT_SHORTCUTS.new_return}`);

// ── resolveCombo precedence ──────────────────────────────────────────────────
check('resolveCombo prefers the admin binding', resolveCombo('save', { save: 'Ctrl+Alt+S' }) === 'Ctrl+Alt+S');
check('resolveCombo falls back to the registry default', resolveCombo('save', {}) === 'Ctrl+S');
check('resolveCombo returns the local default for billing keys', resolveCombo('billing_search', {}) === 'F2');
check('resolveCombo returns "" for an unknown id', resolveCombo('does_not_exist', {}) === '');

// ── Screen scoping ───────────────────────────────────────────────────────────
check('new_product is NOT allowed on billing (F5 stays "New bill")', isActionAllowedOn('new_product', 'billing') === false);
check('new_product IS allowed on inventory', isActionAllowedOn('new_product', 'inventory') === true);
check('save is allowed on billing', isActionAllowedOn('save', 'billing') === true);
check('new_return is allowed on billing', isActionAllowedOn('new_return', 'billing') === true);
check('unknown ids are treated as global', isActionAllowedOn('made_up', 'billing') === true);

// ── Footer / F1 hint rows ────────────────────────────────────────────────────
const hints = hintRows('billing');
const hintIds = hints.map((h) => h.id);
check('billing hints include the core POS keys',
  ['billing_search', 'billing_new', 'billing_repeat', 'billing_express', 'billing_hold', 'billing_held'].every((id) => hintIds.includes(id)),
  hintIds.join(','));
check('billing hints include save / save+print / print / return',
  ['save', 'save_print', 'print', 'new_return'].every((id) => hintIds.includes(id)));
check('every hint row resolves to a non-empty combo',
  hints.every((h) => resolveCombo(h.id, {}) !== '' && h.short));
check('hint rows are only actions allowed on billing',
  hints.every((h) => isActionAllowedOn(h.id, 'billing')));

// ── Registry defaults for the buttons/keys the cashier uses ──────────────────
check('defaultCombo matches the registry table',
  defaultCombo('billing_held') === 'F12' && defaultCombo('help') === 'F1' && defaultCombo('command_palette') === 'Ctrl+K');

console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
