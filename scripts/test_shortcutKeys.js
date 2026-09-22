// Mirror of src/renderer/src/utils/shortcutKeys.ts — keep both in sync.
// Verifies the modifier canonicalization used by the billing keyboard handler.

const MODIFIER_ORDER = ['alt', 'ctrl', 'shift'];
const MOD = (x) => MODIFIER_ORDER.includes(x);

function keyFromEvent(e) {
  if (e.key === ' ') return 'space';
  if (e.key.length > 1) return e.key.toLowerCase();
  if (/^[A-Za-z0-9]$/.test(e.key)) return e.key.toLowerCase();
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return e.key.toLowerCase();
}

function normalizeStoredKey(key) {
  const parts = String(key ?? '').split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const mods = parts.filter((p) => MOD(p));
  const rest = parts.filter((p) => !MOD(p));
  return [...MODIFIER_ORDER.filter((m) => mods.includes(m)), ...rest].join('+');
}

function eventCombo(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(keyFromEvent(e));
  return parts.join('+');
}

function matchesShortcut(stored, e) {
  return normalizeStoredKey(stored) === eventCombo(e);
}

const eq = (label, stored, event, expected) => {
  const got = matchesShortcut(stored, event);
  if (got !== expected) {
    console.error(`FAIL ${label}: stored="${stored}" combo="${eventCombo(event)}" expected match=${expected}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${label}: "${stored}" vs "${eventCombo(event)}" -> ${got}`);
  }
};

// ── Previously-broken multi-modifier combos ──
eq('Alt+A opens admin', 'Alt+A', { key: 'a', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, code: 'KeyA' }, true);
eq('Alt+A wrong modifier', 'Alt+A', { key: 'a', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyA' }, false);
eq('Ctrl+Shift+C closes shift', 'Ctrl+Shift+C', { key: 'c', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyC' }, true);
eq('Ctrl+Shift+C without shift', 'Ctrl+Shift+C', { key: 'c', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyC' }, false);
eq('Shift+F2 duplicate last sale', 'Shift+F2', { key: 'F2', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, code: 'F2' }, true);
eq('Ctrl+Shift+H recall held', 'Ctrl+Shift+H', { key: 'h', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyH' }, true);
eq('Alt+S settings', 'Alt+S', { key: 's', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, code: 'KeyS' }, true);
eq('Ctrl+H hold bill', 'Ctrl+H', { key: 'h', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyH' }, true);

// ── Single modifier / plain keys ──
eq('Ctrl+F focus search', 'Ctrl+F', { key: 'f', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyF' }, true);
eq('plain F2 (billing hardcoded)', 'F2', { key: 'F2', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'F2' }, true);
eq('plain f9 without storing F9', 'F9', { key: 'F9', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'F9' }, true);
eq('Ctrl+D cash drawer', 'Ctrl+D', { key: 'd', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyD' }, true);
eq('Ctrl+D wrong key', 'Ctrl+D', { key: 'q', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyQ' }, false);
eq('Meta folded to ctrl', 'Ctrl+Q', { key: 'q', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true, code: 'KeyQ' }, true);
eq('Shift+Delete', 'Shift+Delete', { key: 'Delete', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, code: 'Delete' }, true);
eq('Enter key (scanner)', 'Enter', { key: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'Enter' }, true);

// ── Modifier ordering tolerance ──
const orderCombo = eventCombo({ key: 'c', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyC' });
if (normalizeStoredKey('Shift+Ctrl+C') !== orderCombo) {
  console.error(`FAIL ordering: "Shift+Ctrl+C" -> "${normalizeStoredKey('Shift+Ctrl+C')}" vs "${orderCombo}"`);
  process.exitCode = 1;
} else {
  console.log(`ok   ordering: "Shift+Ctrl+C" normalizes to "${orderCombo}"`);
}

// ── Punctuation via e.code fallback (Ctrl+Shift+4) ──
eq('Ctrl+Shift+4 via code', 'Ctrl+Shift+4', { key: '$', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'Digit4' }, true);

if (!process.exitCode) console.log('\nAll shortcut matcher checks passed.');