// web-db — owns the *single* "current database" for a bundle, mirroring the
// desktop `src/main/db.ts` module singleton.
//
// The desktop's real db.ts (which persists a file via node:sqlite and loads
// migrations from a folder with `require`) is never bundled into the cloud
// worker: esbuild aliases `../db` imports from the real services to this file.
// `runMigrations` mirrors the desktop runner 1:1 but iterates the code-generated
// `MIGRATIONS` table sourced from the real `migrations/*.js` files.

import type { SqliteCompat } from './sqlite-compat';
import { MIGRATIONS } from './generated-migrations';

export type { SqliteCompat } from './sqlite-compat';

let currentDb: SqliteCompat | null = null;

/** Set the shop database this isolate currently serves. Per-instance on the DO. */
export function setWebDb(db: SqliteCompat | null): void {
  currentDb = db;
}

/** `getDb()` used by the (electron-free, web) bundled service code. */
export function getDb(): SqliteCompat {
  if (!currentDb) throw new Error('Database not initialized. Call setWebDb first.');
  return currentDb;
}

// --- desktop `src/main/db.ts` surface that some bundled services import ---------
//
// `admin.ts` and `backup.ts` import these alongside getDb. Web shops live in a
// Durable Object's SQLite (never a file), so the path is nominal and the
// open/close helpers are inert — the ShopObject owns the connection lifecycle.

/** Nominal path; there is no file behind a web shop's database. */
export function getDbPath(): string {
  return 'shop.sqlite';
}

/** No-op: the Durable Object owns the connection for the life of the instance. */
export function closeDb(): void {
  currentDb = null;
}

/** No-op: the ShopObject already created and migrated the database. */
export function initDatabase(): void {}

/**
 * Mirrors desktop `runMigrations`: create the migrations table (by filename),
 * run every not-yet-applied migration's `up(db)`, then record it. Runs the up
 * functions sequentially. The ShopObject calls this lazily once per instance,
 * outside `transactionSync` (migrations manage their own multi-statement state
 * where needed and are idempotent via the table + guards).
 */
export async function runMigrations(db: SqliteCompat): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as unknown as { name: string }[]).map((r) => r.name)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.file)) continue;
    try {
      await migration.up(db);
    } catch (e) {
      throw new Error(`Migration ${migration.file} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.file);
  }
}