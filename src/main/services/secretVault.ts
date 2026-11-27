import { safeStorage } from 'electron';
import { getDb } from '../db';

/**
 * Phase 0 item 0.15 — the credential vault.
 *
 * The SMTP / SMS / WhatsApp credentials are *passwords*: before this they sat
 * in `admin_settings` as plain text, so anyone who could copy the database
 * file (a backup, a support bundle, a stolen laptop) could read the shop's
 * mail password.
 *
 * The rules:
 *   - a credential is stored as `enc:v1:<base64>` — the OS key store (Windows
 *     DPAPI through Electron's `safeStorage`) does the encryption, so the
 *     value can only be read by this Windows user on this machine;
 *   - the marker prefix means an OLD plain-text value is migrated in place the
 *     first time it is read, so no shop has to re-enter anything;
 *   - a value that cannot be decrypted (another machine, a restored backup on
 *     a different PC) is NEVER silently passed through as plain text — the
 *     caller gets an empty string and the shop is told to re-enter it;
 *   - the vault never logs the secret, not even in an error message.
 */

export const VAULT_PREFIX = 'enc:v1:';

/** The credential keys that live in `admin_settings` and must be encrypted. */
export const VAULT_ADMIN_KEYS = [
  'email_smtp_pass',
  'sms_api_key',
  'sms_api_secret',
  'whatsapp_api_token',
  'whatsapp_token',
] as const;

const VAULT_KEY_SET = new Set<string>(VAULT_ADMIN_KEYS);

export function isVaultKey(key: string): boolean {
  return VAULT_KEY_SET.has(key);
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(VAULT_PREFIX);
}

/** True when the OS key store is usable (Windows DPAPI, macOS Keychain…). */
export function vaultAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt one credential. An already-encrypted value is returned unchanged so
 * a double-save cannot double-encrypt it.
 *
 * When the machine has NO key store (a rare Linux box without a keyring, or a
 * portable copy started before the user profile is ready) the value is stored
 * as it is rather than blocking the shop — the owner is warned once in the
 * activity log instead. On Windows (the shipped platform) the key store is
 * always there.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncryptedValue(plain)) return plain;
  if (!vaultAvailable()) {
    warnOnce('no key store on this computer — the credential is stored as plain text');
    return plain;
  }
  const encrypted = safeStorage.encryptString(plain);
  return VAULT_PREFIX + Buffer.from(encrypted).toString('base64');
}

/** One warning per session, never containing the secret. */
let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  try {
    // eslint-disable-next-line no-console
    console.warn(`[secretVault] ${message}`);
  } catch {
    /* ignore */
  }
}

/**
 * Decrypt one stored credential.
 *
 * - a plain-text (legacy) value is returned as-is AND migrated to the vault;
 * - an encrypted value is decrypted; a decryption failure returns '' (the
 *   shop must re-enter the password) and never the cipher text.
 */
export function decryptSecret(stored: string | null | undefined, key?: string): string {
  if (!stored) return '';
  if (!isEncryptedValue(stored)) {
    // Legacy plain text: migrate it now so the next restart is protected.
    if (key) {
      try {
        migrateLegacySecret(key, stored);
      } catch {
        /* migration is best effort — the value still works this session */
      }
    }
    return stored;
  }
  try {
    const raw = Buffer.from(stored.slice(VAULT_PREFIX.length), 'base64');
    return safeStorage.decryptString(raw);
  } catch {
    // Wrong machine / different Windows user / corrupt blob.
    return '';
  }
}

/** Rewrite one legacy plain-text credential into the encrypted form. */
function migrateLegacySecret(key: string, plain: string): void {
  if (!plain || !vaultAvailable()) return;
  try {
    const encrypted = encryptSecret(plain);
    const db = getDb();
    db.prepare(
      'UPDATE admin_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?'
    ).run(encrypted, key, plain);
  } catch {
    /* best effort */
  }
}

/**
 * Read one credential for use by the main process.
 * Returns '' when the key is missing or cannot be decrypted.
 */
export function getSecretSetting(key: string): string {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row?.value) return '';
    return decryptSecret(row.value, key);
  } catch {
    return '';
  }
}

/** True when the key is set to something (plain or encrypted). */
export function hasSecretSetting(key: string): boolean {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return !!row?.value;
  } catch {
    return false;
  }
}
