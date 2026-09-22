const MODIFIER_ORDER = ['alt', 'ctrl', 'shift'] as const;

type KeyEventLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export function keyFromEvent(e: { key: string; code?: string }): string {
  if (e.key === ' ') return 'space';
  if (e.key.length > 1) return e.key.toLowerCase();
  if (/^[A-Za-z0-9]$/.test(e.key)) return e.key.toLowerCase();
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return e.key.toLowerCase();
}

export function normalizeStoredKey(key: string): string {
  const parts = String(key ?? '')
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const mods = parts.filter((p) => (MODIFIER_ORDER as readonly string[]).includes(p));
  const rest = parts.filter((p) => !(MODIFIER_ORDER as readonly string[]).includes(p));
  const ordered = MODIFIER_ORDER.filter((m) => mods.includes(m));
  return [...ordered, ...rest].join('+');
}

export function eventCombo(e: KeyEventLike): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(keyFromEvent(e));
  return parts.join('+');
}

export function matchesShortcut(stored: string, e: KeyEventLike): boolean {
  return normalizeStoredKey(stored) === eventCombo(e);
}

export function shortcutKeyParts(combo: string): { actionKey: string; modifiers: string[] } {
  const parts = normalizeStoredKey(combo).split('+');
  return {
    modifiers: parts.filter((p) => (MODIFIER_ORDER as readonly string[]).includes(p)),
    actionKey: parts.filter((p) => !(MODIFIER_ORDER as readonly string[]).includes(p)).join('+'),
  };
}