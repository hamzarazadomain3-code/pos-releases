/**
 * Phase 0 item 0.15 — the password policy.
 *
 * The shop owner can set these rules in Admin → Security, and the app read
 * them — but only the LENGTH was ever enforced. A shop that switched
 * "require numbers" on still accepted `password`.
 *
 * This module is the ONE place the rules are applied, so the screen, the
 * service and the test can never disagree. It is pure (no DB, no Electron) so
 * it can be unit-tested directly.
 */

export interface PasswordPolicy {
  min_password_length: number;
  require_uppercase: boolean;
  require_numbers: boolean;
  require_special_chars: boolean;
}

/** The shipped defaults: a shop is protected from day one. */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_password_length: 8,
  require_uppercase: true,
  require_numbers: true,
  require_special_chars: false,
};

/** The characters the policy calls "special". */
const SPECIAL_CHARS = /[^A-Za-z0-9]/;

export interface PasswordCheck {
  ok: boolean;
  /** The first problem, in the shop's own words. Empty when `ok`. */
  message: string;
}

/**
 * Check one password against the policy.
 *
 * A PIN is NOT a password: a cashier's 4-digit PIN must stay 4 digits, so the
 * caller passes `isPin` and the complexity rules are skipped (the length rule
 * for a PIN is handled by its own 4-10 digit check).
 */
export function checkPassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  isPin = false
): PasswordCheck {
  const value = String(password ?? '');
  if (!value) return { ok: false, message: 'Password is required' };

  // A PIN is not a password: a cashier's 4-digit PIN must stay 4 digits, so
  // the complexity rules (and the password length rule) do not apply — the
  // caller enforces the PIN's own 4-10 digit format.
  if (isPin) return { ok: true, message: '' };

  const minLength = Math.max(1, Number(policy.min_password_length) || DEFAULT_PASSWORD_POLICY.min_password_length);
  if (value.length < minLength) {
    return { ok: false, message: `Password must be at least ${minLength} characters` };
  }

  if (policy.require_uppercase && !/[A-Z]/.test(value)) {
    return { ok: false, message: 'Password must contain an uppercase letter' };
  }
  if (policy.require_numbers && !/[0-9]/.test(value)) {
    return { ok: false, message: 'Password must contain a number' };
  }
  if (policy.require_special_chars && !SPECIAL_CHARS.test(value)) {
    return { ok: false, message: 'Password must contain a special character' };
  }
  return { ok: true, message: '' };
}
