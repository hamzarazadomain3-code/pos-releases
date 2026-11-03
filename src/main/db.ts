import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

let dbInstance: DatabaseSync | null = null;
let dbPathValue: string | null = null;

interface MigrationRow {
  name: string;
}

/** How many pre-migration safety copies to keep. Oldest are pruned. */
export const MIGRATION_BACKUP_KEEP = 5;

function appVersion(): string {
  try {
    return (app && app.getVersion && app.getVersion()) || 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * Folder that holds the `pre-migration-*.db` safety copies. It sits next to the
 * database so a restored copy is always on the same volume (fast, no partial
 * copy across drives).
 */
export function migrationBackupDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'backups');
}

/** Resolve the migrations folder. `POS_MIGRATIONS_DIR` exists for tests. */
export function resolveMigrationsDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.POS_MIGRATIONS_DIR) return process.env.POS_MIGRATIONS_DIR;
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'migrations');
  if (app && app.getAppPath) return path.join(app.getAppPath(), 'migrations');
  return path.join(process.cwd(), 'migrations');
}

function migrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

function appliedMigrations(db: DatabaseSync): Set<string> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return new Set(
    (db.prepare('SELECT name FROM migrations').all() as unknown as MigrationRow[]).map((r) => r.name)
  );
}

/** Migration files that have not been recorded yet (sorted, deterministic). */
export function pendingMigrations(db: DatabaseSync, dir?: string): string[] {
  const migrationsDir = resolveMigrationsDir(dir);
  const applied = appliedMigrations(db);
  return migrationFiles(migrationsDir).filter((f) => !applied.has(f));
}

function pruneMigrationBackups(dir: string, keep: number): void {
  let files: Array<{ name: string; mtime: number }> = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('pre-migration-') && f.endsWith('.db'))
      .map((name) => {
        const full = path.join(dir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* file vanished between readdir and stat — ignore */
        }
        return { name, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }
  for (const entry of files.slice(Math.max(0, keep))) {
    try {
      fs.unlinkSync(path.join(dir, entry.name));
    } catch {
      /* best effort: a locked backup must not block startup */
    }
  }
}

/**
 * Copy the database before pending migrations run.
 *
 * `PRAGMA wal_checkpoint(TRUNCATE)` folds the WAL back into the main file first,
 * so a plain file copy is a complete, consistent snapshot (no need to also copy
 * `-wal`/`-shm`, and no risk of restoring a torn copy). Returns the backup path.
 */
export function backupBeforeMigrations(
  db: DatabaseSync,
  dbPath: string,
  version: string = appVersion(),
  when: Date = new Date()
): string {
  const dir = migrationBackupDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = when.toISOString().replace(/[:.]/g, '-');
  const safeVersion = String(version || 'dev').replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(dir, `pre-migration-${safeVersion}-${stamp}.db`);

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* not in WAL mode / busy: the file copy below is still the best snapshot */
  }

  fs.copyFileSync(dbPath, file);

  // Verify the copy is a readable SQLite database before trusting it.
  const probe = new DatabaseSync(file);
  try {
    probe.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } finally {
    probe.close();
  }

  pruneMigrationBackups(dir, MIGRATION_BACKUP_KEEP);
  return file;
}

/**
 * Put a pre-migration backup back in place. The caller must close the database
 * handle first. Any WAL/SHM sidecars are removed so SQLite cannot replay a
 * half-applied migration on top of the restored file.
 */
export function restoreDatabase(dbPath: string, backupFile: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* missing sidecar is fine */
    }
  }
  fs.copyFileSync(backupFile, dbPath);
}

/** Run every pending migration in `dir`. Returns the names that were applied. */
export async function runMigrations(db: DatabaseSync, dir?: string): Promise<string[]> {
  const migrationsDir = resolveMigrationsDir(dir);
  const applied = appliedMigrations(db);
  const done: string[] = [];

  for (const file of migrationFiles(migrationsDir)) {
    if (applied.has(file)) continue;
    const migration = require(path.join(migrationsDir, file));
    try {
      await migration.up(db);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    done.push(file);
  }
  return done;
}

export async function initDatabase(): Promise<void> {
  const dbPath =
    process.env.POS_DB_PATH ||
    (() => {
      const userDataPath = app.getPath('userData');
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      return path.join(userDataPath, 'pos.db');
    })();
  dbPathValue = dbPath;

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  let backupFile: string | null = null;
  const pending = pendingMigrations(db);
  if (pending.length > 0) {
    // Never migrate without a restorable copy. Abort startup if the backup
    // cannot be written; that is safer than a half-migrated shop database.
    try {
      backupFile = backupBeforeMigrations(db, dbPath);
    } catch (e) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      throw new Error(
        `Could not create a safety backup before migrations (${pending.join(', ')}): ${
          e instanceof Error ? e.message : String(e)
        }. Nothing was changed. Free some disk space and start Rokar POS again.`
      );
    }
  }

  try {
    await runMigrations(db);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    try {
      db.close();
    } catch {
      /* ignore */
    }

    let restored = false;
    let restoreError = '';
    if (backupFile) {
      try {
        restoreDatabase(dbPath, backupFile);
        restored = true;
      } catch (re) {
        restoreError = re instanceof Error ? re.message : String(re);
      }
    }

    const detail = restored
      ? `Your data was restored from the safety copy ${backupFile}. No sale or stock data was lost.`
      : backupFile
      ? `RESTORE FAILED (${restoreError}). The safety copy is at ${backupFile}; contact support before using the app.`
      : 'No pending migration backup existed; the database was not modified.';
    throw new Error(`${reason}. ${detail}`);
  }

  dbInstance = db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return dbInstance;
}

export function getDbPath(): string {
  if (!dbPathValue) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return dbPathValue;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {
      /* ignore close errors during teardown */
    }
    dbInstance = null;
  }
}
