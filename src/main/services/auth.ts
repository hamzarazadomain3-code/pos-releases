import { scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';

const SALT = 'pos-salt';

export type UserRole = 'owner' | 'manager' | 'cashier';

export interface UserRow {
  id: number;
  username: string;
  role: UserRole;
  active: number;
  created_at?: string;
}

interface UserRecord extends UserRow {
  password_hash: string;
  pin: string | null;
}

const RANK: Record<UserRole, number> = { cashier: 1, manager: 2, owner: 3 };

let sessionUserId: number | null = null;

export function hashSecret(secret: string): string {
  return scryptSync(secret, SALT, 64).toString('hex');
}

function secretMatches(storedHash: string, secret: string): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = scryptSync(secret, SALT, 64);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function getUser(id: number): UserRecord | null {
  return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRecord | undefined) ?? null;
}

export function setSessionUser(id: number | null): void {
  sessionUserId = id;
}

export function getSessionUserId(): number | null {
  return sessionUserId;
}

export function currentUser(): UserRow | null {
  if (sessionUserId === null) return null;
  const u = getUser(sessionUserId);
  if (!u) {
    sessionUserId = null;
    return null;
  }
  return { id: u.id, username: u.username, role: u.role, active: u.active, created_at: u.created_at };
}

export function can(required: UserRole): boolean {
  const u = currentUser();
  if (!u) return false;
  return RANK[u.role] >= RANK[required];
}

export function verifyCredentials(username: string, password: string): boolean {
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as
    | UserRecord
    | undefined;
  if (!user) return false;
  if (user.active !== 1) return false;
  return secretMatches(user.password_hash, password);
}

export function login(username: string, password: string): { ok: boolean; user?: UserRow | null; message?: string } {
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as
    | UserRecord
    | undefined;
  if (!user || user.active !== 1) return { ok: false, message: 'Invalid username or password' };
  if (!secretMatches(user.password_hash, password)) return { ok: false, message: 'Invalid username or password' };
  sessionUserId = user.id;
  return { ok: true, user: { id: user.id, username: user.username, role: user.role, active: user.active } };
}

export function loginWithPin(pin: string): { ok: boolean; user?: UserRow | null; message?: string } {
  const users = getDb().prepare('SELECT * FROM users WHERE pin IS NOT NULL AND active = 1').all() as unknown as UserRecord[];
  const user = users.find((u) => secretMatches(u.pin!, pin));
  if (!user) return { ok: false, message: 'Invalid PIN' };
  sessionUserId = user.id;
  return { ok: true, user: { id: user.id, username: user.username, role: user.role, active: user.active } };
}

export function logout(): void {
  sessionUserId = null;
}

export function refreshSession(): UserRow | null {
  return currentUser();
}

export function verifyForUser(userId: number, secret: string): boolean {
  const user = getUser(userId);
  if (!user || user.active !== 1) return false;
  if (secretMatches(user.password_hash, secret)) return true;
  if (user.pin && secretMatches(user.pin, secret)) return true;
  return false;
}

export function defaultPasswordActive(): boolean {
  const admin = getDb()
    .prepare("SELECT id, username, password_hash, role FROM users WHERE username = 'admin' AND role = 'owner'")
    .get() as { id: number; username: string; password_hash: string; role: string } | undefined;
  if (!admin) return false;
  return secretMatches(admin.password_hash, 'admin123');
}

export function listUsers(): UserRow[] {
  return (getDb()
    .prepare('SELECT id, username, role, active, created_at FROM users ORDER BY id')
    .all() as unknown as UserRow[]);
}

export function createUser(input: { username: string; password?: string; pin?: string; role: UserRole }): UserRow {
  if (!can('owner')) throw new Error('Only the owner can manage users');
  const username = input.username.trim();
  if (!username) throw new Error('Username required');
  if (!input.password && !input.pin) throw new Error('Set a password or PIN');
  if (input.role === 'cashier' && !input.pin) throw new Error('Cashier accounts need a PIN for fast login');
  if (input.pin && !/^\d{4,10}$/.test(input.pin.trim())) throw new Error('PIN must be 4-10 digits');
  if (input.password && input.password.length < 4) throw new Error('Password must be at least 4 characters');
  const db = getDb();
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO users (username, password_hash, role, pin) VALUES (?, ?, ?, ?)'
      )
      .run(
        username,
        hashSecret(input.password ?? input.pin!),
        input.role,
        input.pin ? hashSecret(input.pin) : null
      );
    db.exec('COMMIT');
    return { id: Number(info.lastInsertRowid), username, role: input.role, active: 1 };
  } catch (e) {
    db.exec('ROLLBACK');
    if (String(e).includes('UNIQUE')) throw new Error('Username already exists');
    throw e;
  }
}

export function updateUser(id: number, input: { password?: string; pin?: string; role?: UserRole; active?: boolean }): UserRow {
  if (!can('owner')) throw new Error('Only the owner can manage users');
  const user = getUser(id);
  if (!user) throw new Error('User not found');
  if (input.pin !== undefined && input.pin !== '' && !/^\d{4,10}$/.test(input.pin.trim()))
    throw new Error('PIN must be 4-10 digits');
  if (input.password !== undefined && input.password !== '' && input.password.length < 4)
    throw new Error('Password must be at least 4 characters');

  const db = getDb();
  db.exec('BEGIN');
  try {
    if (input.role && input.role !== user.role) {
      const demotingOwner = user.role === 'owner' && RANK[input.role] < RANK.owner;
      const owners = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND active = 1").get() as { c: number };
      if (demotingOwner && owners.c <= 1) throw new Error('Cannot demote the last owner');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(input.role, id);
    }
    if (input.active !== undefined && input.active !== (user.active === 1)) {
      if (!input.active && user.role === 'owner') {
        const owners = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND active = 1").get() as { c: number };
        if (owners.c <= 1) throw new Error('Cannot deactivate the last owner');
      }
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(input.active ? 1 : 0, id);
    }
    if (input.password !== undefined && input.password !== '') {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashSecret(input.password), id);
    }
    if (input.pin !== undefined) {
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(input.pin === '' ? null : hashSecret(input.pin), id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const updated = getUser(id)!;
  return { id: updated.id, username: updated.username, role: updated.role, active: updated.active, created_at: updated.created_at };
}

export function deleteUser(id: number): boolean {
  if (!can('owner')) throw new Error('Only the owner can manage users');
  if (id === sessionUserId) throw new Error('Cannot delete your own account');
  const user = getUser(id);
  if (!user) throw new Error('User not found');
  if (user.role === 'owner') throw new Error('Owner accounts cannot be deleted — demote them first');
  const db = getDb();
  const openShift = db.prepare('SELECT id FROM shifts WHERE user_id = ? AND closed_at IS NULL').get(id);
  if (openShift) {
    throw new Error('Close this user\'s open shift before deleting them');
  }
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE sales SET user_id = 1 WHERE user_id = ?').run(id);
    db.prepare('UPDATE shifts SET user_id = 1 WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}