/**
 * The sidebar footer — the small helpers it needs.
 *
 * The footer shows three things: who is signed in, the language toggle and
 * the collapse button. The rules that decide WHAT to show are pure and live
 * here, so they can be tested without a browser:
 *   - the language toggle always offers the OTHER language (one button, never
 *     two, and never "اردو" while the shop is already in Urdu);
 *   - the role label follows the ONE role list (`src/shared/roles.ts`);
 *   - the name in the user block is cleaned up, and the avatar carries at
 *     most two letters.
 */

import type { UserRole } from './types';

/** The two languages the app speaks. */
export type UiLanguage = 'en' | 'ur';

/**
 * The language the toggle switches TO.
 *
 * An unknown language is treated as English, so the toggle offers Urdu — the
 * button always does something sensible.
 */
export function languageToggleTarget(current: string | null | undefined): UiLanguage {
  return String(current ?? '').trim().toLowerCase() === 'ur' ? 'en' : 'ur';
}

/** The i18n key for the language the toggle switches to. */
export function languageToggleLabelKey(
  current: string | null | undefined
): 'sidebar.switchToEnglish' | 'sidebar.switchToUrdu' {
  return languageToggleTarget(current) === 'ur'
    ? 'sidebar.switchToUrdu'
    : 'sidebar.switchToEnglish';
}

/** The i18n key for a role — unknown roles get the generic "User". */
export function roleLabelKey(role: string | null | undefined): string {
  switch (String(role ?? '').trim().toLowerCase()) {
    case 'owner':
      return 'sidebar.roleOwner';
    case 'manager':
      return 'sidebar.roleManager';
    case 'cashier':
      return 'sidebar.roleCashier';
    default:
      return 'sidebar.roleUser';
  }
}

/** The role itself, normalised — '' when it is not a known role. */
export function knownRole(role: string | null | undefined): UserRole | '' {
  const r = String(role ?? '').trim().toLowerCase();
  return r === 'owner' || r === 'manager' || r === 'cashier' ? r : '';
}

/**
 * The name in the user block: trimmed, with the repeated spaces removed.
 * An empty name gives '' — the block then shows the role only.
 */
export function userDisplayName(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * The letters in the little avatar — at most two, from the first two words.
 * An empty name gives '?', never an empty circle.
 */
export function userInitials(name: string | null | undefined): string {
  const clean = userDisplayName(name);
  if (!clean) return '?';
  const words = clean.split(' ').filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '').join('');
  return letters || '?';
}
