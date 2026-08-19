import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

let dbInstance: DatabaseSync | null = null;
let dbPathValue: string | null = null;

interface MigrationRow {
  name: string;
}

async function runMigrations(db: DatabaseSync): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as unknown as MigrationRow[]).map((r) => r.name)
  );

  const migrationsDir = app && app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : (app && app.getAppPath ? path.join(app.getAppPath(), 'migrations') : path.join(process.cwd(), 'migrations'));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const migration = require(path.join(migrationsDir, file));
    try {
      await migration.up(db);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
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

  await runMigrations(db);
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