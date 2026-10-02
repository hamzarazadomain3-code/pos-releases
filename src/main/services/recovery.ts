import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SUPPORT_KEY_HEX } from '../generated/supportKey';
import { getDb } from '../db';
import { can, hashSecret, getUser } from './auth';
import { logActivity } from './activity';

/**
 * Password recovery — two independent paths:
 *
 *   A) Self-service : the owner sets a security question + answer. "Forgot
 *                    password?" on the login screen asks the question and, if
 *                    correct, allows a new password to be set immediately.
 *
 *   B) Support      : a developer-held HMAC key proves support identity over
 *                    the phone. Bound to this installation's device UUID and
 *                    single-use (see support_recovery_codes).
 *
 * IMPORTANT — why the answer uses a different salt than passwords: passwords are
 * hashed with scryptSync(secret, 'pos-salt', 64), a single app-wide salt.
 * Reusing that for recovery answers would make the two hash domains
 * interchangeable, so an answer hash could be presented as a password hash.
 * A distinct salt keeps the domains separate.
 */
const ANSWER_SALT = 'pos-recovery-salt';

/**
 * Support-recovery HMAC key. Injected at build time from ROKAR_SUPPORT_KEY via
 * scripts/gen-support-key.js — it is deliberately NOT in this source file,
 * because this repository is PUBLIC and a committed key would let anyone mint
 * a valid recovery code for any shop. The generated module is gitignored.
 *
 * Note the key is still extractable from a built app.asar by anyone who unpacks
 * the installer, so Option B is deterrence, not cryptography. Real protection
 * requires the key on the license server, which would make recovery online-only.
 * See RECOVERY_CODE_SPEC.md.
 */
const SUPPORT_KEY: Buffer = Buffer.from(SUPPORT_KEY_HEX, 'hex');

/** False when no build secret was injected — Support Recovery is then unavailable. */
export const SUPPORT_RECOVERY_ENABLED = SUPPORT_KEY.length === 32;

const MASTER_CODE_PREFIX = 'rokar-master';
const SUPPORT_CODE_PREFIX = 'rokar-recover-v1';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

const CODE_LENGTH = 8;

export const MIN_PASSWORD_LENGTH = 4;

export interface RecoveryStatus {
  hasSecurityQuestion: boolean;
  question: string | null;
  deviceId: string;
}

export interface RecoveryResult {
  ok: boolean;
  message?: string;
  /** True when the input matched the owner recovery code rather than the answer. */
  viaCode?: boolean;
}

interface UserRecoveryRow {
  id: number;
  username: string;
  active: number;
  security_question: string | null;
  security_answer_hash: string | null;
}

// ═══════════════════════════════════════════
//  NORMALISATION / HASHING
// ═══════════════════════════════════════════

/**
 * Security answers are free text typed by a human, so they are compared case- and
 * whitespace-insensitively ("Karachi  Colony" == "karachi colony"). The same
 * function MUST be used when storing and when verifying.
 */
export function normalizeAnswer(answer: string): string {
  return answer.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashAnswer(answer: string): string {
  return scryptSync(normalizeAnswer(answer), ANSWER_SALT, 64).toString('hex');
}

/** Constant-time compare of two hex digests. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Constant-time compare of two codes. Refuses empty inputs: two empty strings are
 * "equal", and a user who types "!!!!" would normalise to "" and could otherwise
 * match an unset/blank expected code.
 */
function safeEqualCode(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ═══════════════════════════════════════════
//  DEVICE ID + SYSTEM-MANAGED SETTINGS
// ═══════════════════════════════════════════

function readSystemSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeSystemSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(key, value);
}

export function getDeviceId(): string {
  const existing = readSystemSetting('device_uuid');
  if (existing) return existing;
  // Defensive: a restored or imported database may predate migration 049.
  const generated = randomUUID();
  writeSystemSetting('device_uuid', generated);
  return generated;
}

/**
 * Per-install salt for the owner recovery code. Kept separate from device_uuid so
 * "Regenerate code" can rotate it at runtime.
 */
function getRecoverySalt(): string {
  const existing = readSystemSetting('recovery_salt');
  if (existing) return existing;
  const generated = randomBytes(16).toString('hex');
  writeSystemSetting('recovery_salt', generated);
  return generated;
}

/** Rotating the salt invalidates every previously issued recovery code. Owner-gated. */
export function rotateRecoverySalt(): string {
  if (!can('owner')) throw new Error('Only the owner can rotate the recovery code');
  getDb()
    .prepare("UPDATE admin_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'recovery_salt'")
    .run(randomBytes(16).toString('hex'));
  logActivity('recovery_code_rotated', 'admin_settings', null, 'Owner recovery code regenerated');
  return ownerRecoveryCode();
}

/**
 * Lowest-id active owner. Chosen over a hardcoded 'admin' lookup so recovery keeps
 * working if the owner account was renamed or deleted and another owner promoted.
 */
export function getOwnerUsername(): string | null {
  const row = getDb()
    .prepare("SELECT username FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1")
    .get() as { username: string } | undefined;
  return row?.username ?? null;
}

// ═══════════════════════════════════════════
//  CODES
// ═══════════════════════════════════════════

// Crockford base32 — excludes I, L, O and U so codes survive being read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function normalizeDeviceId(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function normalizeCode(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** First 5 digest bytes as a 40-bit big-endian integer, then 8 base32 chars, MSB first. */
function encodeCode(digest: Buffer): string {
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + digest[i];
  let chars = '';
  for (let i = 7; i >= 0; i--) chars += ALPHABET[(n >>> (5 * i)) & 31];
  return chars;
}

function formatCode(chars: string): string {
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/**
 * Monotonic counter of successful support recoveries on this installation.
 *
 * Without it the code would be deterministic (device + owner always produce the
 * same code), so "single-use" would really mean "usable exactly once ever" and a
 * shop could never be helped twice. The client displays the current value and the
 * developer mints the code for that number; each success bumps it, so every code
 * is genuinely single-use and the next one is well-defined.
 */
function getSupportEpoch(): number {
  const raw = readSystemSetting('support_epoch');
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function bumpSupportEpoch(): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES ('support_epoch', ?, datetime('now','utc'))"
    )
    .run(String(getSupportEpoch() + 1));
}

/**
 * Support recovery code — the reference implementation.
 *
 *   code = HMAC-SHA256(SECRET, "rokar-recover-v1|" + deviceId + "|" + owner + "|" + epoch)
 *   first 5 digest bytes -> 40-bit big-endian integer
 *   -> 8 Crockford base32 chars, displayed as "XXXX-XXXX"
 *
 * Deliberately contains no timestamp: the device clock may be wrong. One-time use
 * comes from the epoch (bumped on every success) plus the support_recovery_codes
 * ledger. tools/recovery-code-cli.js mirrors this exactly.
 */
export function computeSupportCode(deviceId: string, ownerUsername: string, epoch: number): string {
  // `Number(epoch) || 0` (not Math.trunc(epoch)) so a NaN/garbage epoch yields 0
  // rather than "NaN" in the message — this must stay in lockstep with
  // tools/recovery-code-cli.js or generated codes stop matching.
  const n = Math.max(0, Math.trunc(Number(epoch) || 0));
  const message = `${SUPPORT_CODE_PREFIX}|${normalizeDeviceId(deviceId)}|${ownerUsername.trim()}|${n}`;
  return formatCode(encodeCode(createHmac('sha256', SUPPORT_KEY).update(message, 'utf8').digest()));
}

/**
 * Owner recovery code from Option A — the "write this down" code. Derived, never
 * stored, so no plaintext master code sits in the database.
 */
export function ownerRecoveryCode(): string {
  const owner = getOwnerUsername();
  if (!owner) return '';
  const message = `${MASTER_CODE_PREFIX}|${normalizeDeviceId(getDeviceId())}|${owner}`;
  const digest = createHmac('sha256', getRecoverySalt()).update(message, 'utf8').digest();
  return formatCode(encodeCode(digest));
}

// ═══════════════════════════════════════════
//  LOCKOUT  (persisted, so an app restart cannot clear it)
// ═══════════════════════════════════════════

function lockExpiry(key: string): Date | null {
  const row = getDb().prepare('SELECT locked_until FROM recovery_lockout WHERE key = ?').get(key) as
    | { locked_until: string | null }
    | undefined;
  if (!row?.locked_until) return null;
  // SQLite's datetime('now','utc') yields "YYYY-MM-DD HH:MM:SS" with no zone.
  const raw = row.locked_until.trim();
  const until = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return null;
  return until;
}

function recordFailure(key: string): void {
  const db = getDb();
  const row = db.prepare('SELECT fails FROM recovery_lockout WHERE key = ?').get(key) as
    | { fails: number }
    | undefined;
  const fails = (row?.fails ?? 0) + 1;
  if (fails >= MAX_ATTEMPTS) {
    db.prepare(
      "INSERT OR REPLACE INTO recovery_lockout (key, fails, locked_until, updated_at) VALUES (?, 0, datetime('now','utc',?), datetime('now','utc'))"
    ).run(key, `+${LOCKOUT_MINUTES} minutes`);
  } else {
    db.prepare(
      "INSERT OR REPLACE INTO recovery_lockout (key, fails, locked_until, updated_at) VALUES (?, ?, NULL, datetime('now','utc'))"
    ).run(key, fails);
  }
}

function clearFailures(key: string): void {
  getDb().prepare('DELETE FROM recovery_lockout WHERE key = ?').run(key);
}

function lockoutMessage(key: string): string | null {
  const until = lockExpiry(key);
  if (!until) return null;
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

// ═══════════════════════════════════════════
//  OPTION A — SECURITY QUESTION
// ═══════════════════════════════════════════

export function getRecoveryStatus(userId: number): RecoveryStatus {
  const row = getDb()
    .prepare('SELECT security_question, security_answer_hash FROM users WHERE id = ?')
    .get(userId) as { security_question: string | null; security_answer_hash: string | null } | undefined;
  return {
    hasSecurityQuestion: Boolean(row?.security_question && row?.security_answer_hash),
    question: row?.security_question ?? null,
    deviceId: getDeviceId(),
  };
}

export function setSecurityQuestion(userId: number, question: string, answer: string): RecoveryStatus {
  if (!can('owner')) throw new Error('Only the owner can set a recovery question');
  if (!getUser(userId)) throw new Error('User not found');
  const q = question.trim();
  if (!q) throw new Error('Security question is required');
  if (q.length > 200) throw new Error('Security question is too long');
  if (!normalizeAnswer(answer)) throw new Error('Security answer is required');

  getDb()
    .prepare('UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?')
    .run(q, hashAnswer(answer), userId);
  clearFailures('answer');
  logActivity('security_question_set', 'user', userId, `question="${q}"`);
  return getRecoveryStatus(userId);
}

export function clearSecurityQuestion(userId: number): RecoveryStatus {
  if (!can('owner')) throw new Error('Only the owner can clear a recovery question');
  getDb().prepare('UPDATE users SET security_question = NULL, security_answer_hash = NULL WHERE id = ?').run(userId);
  logActivity('security_question_cleared', 'user', userId, null);
  return getRecoveryStatus(userId);
}

/** Returns the stored question for the recovery screen. Never returns the answer. */
export function getRecoveryQuestion(username: string): { hasRecovery: boolean; question: string | null } {
  const row = getDb()
    .prepare('SELECT security_question, security_answer_hash, active FROM users WHERE username = ?')
    .get(username.trim()) as Pick<UserRecoveryRow, 'security_question' | 'security_answer_hash' | 'active'> | undefined;
  if (!row || row.active !== 1) return { hasRecovery: false, question: null };
  const hasRecovery = Boolean(row.security_question && row.security_answer_hash);
  return { hasRecovery, question: hasRecovery ? row.security_question : null };
}

/**
 * Verifies the security answer OR the owner recovery code. Either one opens the
 * "set new password" step.
 */
export function verifySecurityAnswer(username: string, input: string): RecoveryResult {
  const key = 'answer';
  const locked = lockoutMessage(key);
  if (locked) return { ok: false, message: locked };

  const user = getDb()
    .prepare('SELECT id, username, active, security_question, security_answer_hash FROM users WHERE username = ?')
    .get(username.trim()) as UserRecoveryRow | undefined;
  if (!user || user.active !== 1) {
    recordFailure(key);
    return { ok: false, message: 'Incorrect answer' };
  }
  if (!user.security_question || !user.security_answer_hash) {
    return { ok: false, message: 'No recovery question has been set for this account' };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    recordFailure(key);
    return { ok: false, message: 'Incorrect answer' };
  }

  const master = ownerRecoveryCode();
  if (master && safeEqualCode(normalizeCode(trimmed), normalizeCode(master))) {
    clearFailures(key);
    logActivity('password_recovery_verified', 'user', user.id, 'via recovery code');
    return { ok: true, viaCode: true };
  }

  if (safeEqualHex(hashAnswer(trimmed), user.security_answer_hash)) {
    clearFailures(key);
    logActivity('password_recovery_verified', 'user', user.id, 'via security answer');
    return { ok: true, viaCode: false };
  }

  recordFailure(key);
  return { ok: false, message: 'Incorrect answer' };
}

// ═══════════════════════════════════════════
//  OPTION B — SUPPORT RECOVERY
// ═══════════════════════════════════════════

export function getSupportInfo(): {
  deviceId: string;
  ownerUsername: string | null;
  epoch: number;
  enabled: boolean;
} {
  return {
    deviceId: getDeviceId(),
    ownerUsername: getOwnerUsername(),
    epoch: getSupportEpoch(),
    enabled: SUPPORT_RECOVERY_ENABLED,
  };
}

/**
 * Accepts a developer-generated code and consumes it. The code is bound to this
 * installation's device UUID, the current owner and the current request number, so
 * a code issued for one shop cannot unlock another and cannot be replayed. On
 * success the request number is bumped and the code's HMAC recorded, so the next
 * code is always a different one.
 */
export function verifySupportCode(code: string): RecoveryResult {
  const key = 'support';
  // A build with no injected secret cannot verify anything. Say so plainly instead
  // of rejecting every code as "invalid", which would send the developer hunting
  // for a typo in a code that could never have been right.
  if (!SUPPORT_RECOVERY_ENABLED) {
    return { ok: false, message: 'Support Recovery is not enabled in this build' };
  }
  const locked = lockoutMessage(key);
  if (locked) return { ok: false, message: locked };

  const owner = getOwnerUsername();
  if (!owner) return { ok: false, message: 'No active owner account found' };

  const normalized = normalizeCode(code);
  if (normalized.length !== CODE_LENGTH) {
    recordFailure(key);
    return { ok: false, message: 'Invalid recovery code' };
  }

  const db = getDb();
  const deviceId = getDeviceId();
  const epoch = getSupportEpoch();
  const expected = normalizeCode(computeSupportCode(deviceId, owner, epoch));
  const fingerprint = createHmac('sha256', SUPPORT_KEY).update(expected, 'utf8').digest('hex');

  if (db.prepare('SELECT id FROM support_recovery_codes WHERE code_hash = ?').get(fingerprint)) {
    return { ok: false, message: 'This recovery code has already been used' };
  }

  if (!safeEqualCode(normalized, expected)) {
    recordFailure(key);
    return { ok: false, message: 'Invalid recovery code' };
  }

  db.prepare('INSERT INTO support_recovery_codes (code_hash, device_id, used_at) VALUES (?, ?, ?)').run(
    fingerprint,
    deviceId,
    new Date().toISOString()
  );
  bumpSupportEpoch();
  clearFailures(key);
  logActivity('support_recovery_used', 'user', null, `device=${deviceId} epoch=${epoch}`);
  return { ok: true };
}

// ═══════════════════════════════════════════
//  PASSWORD RESET  (shared by both paths)
// ═══════════════════════════════════════════

/**
 * Not gated on the session role on purpose — there is no session yet. It is only
 * reachable after verifySecurityAnswer() or verifySupportCode() has succeeded.
 */
export function setRecoveredPassword(username: string, newPassword: string): { ok: boolean; message?: string } {
  const db = getDb();
  const target = username.trim()
    ? (db.prepare('SELECT id, username, active FROM users WHERE username = ?').get(username.trim()) as
        | { id: number; username: string; active: number }
        | undefined)
    : (db.prepare("SELECT id, username, active FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1").get() as
        | { id: number; username: string; active: number }
        | undefined);

  if (!target) return { ok: false, message: 'User not found' };
  if (target.active !== 1) return { ok: false, message: 'This account is disabled' };
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashSecret(newPassword), target.id);
  clearFailures('answer');
  clearFailures('support');
  logActivity('password_reset_recovery', 'user', target.id, `username=${target.username}`);
  return { ok: true };
}