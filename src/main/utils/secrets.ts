/**
 * Secret masking for values that cross the IPC boundary.
 *
 * The renderer only needs to know *that* a secret is set, never the secret
 * itself. Main-process services still read the real values straight from the
 * database, so masking happens here and only here.
 *
 * Writes are symmetric: if the renderer sends the mask back (it does — both
 * settings screens save every loaded key), the handler treats it as "unchanged"
 * instead of overwriting the stored secret with dots.
 */
export const SECRET_MASK = '••••••••';

/** Keys in the Shop Profile (`settings`) that must never reach the renderer. */
export const SECRET_SETTING_KEYS = new Set(['license_key']);

/** Keys in `admin_settings` that must never reach the renderer. */
export const SECRET_ADMIN_KEYS = new Set([
  'email_smtp_pass',
  'sms_api_key',
  'sms_api_secret',
  'whatsapp_api_token',
  'whatsapp_token',
  'license_key',
]);

export function isMaskedSecret(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value === SECRET_MASK || value === '********' || value === '**********')
  );
}

export function maskSecrets(
  map: Record<string, string>,
  keys: Set<string>
): Record<string, string> {
  const safe = { ...map };
  for (const key of keys) {
    if (typeof safe[key] === 'string' && safe[key] !== '') safe[key] = SECRET_MASK;
  }
  return safe;
}
