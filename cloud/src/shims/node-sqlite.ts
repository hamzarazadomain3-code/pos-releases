// node:sqlite shim — only `backup.ts` imports `DatabaseSync` (to swap the DB file
// on restore). Web shops live in a Durable Object's SQLite, so a restore-by-file
// cannot work; the class exists so the module bundles and the channel fails
// cleanly at call time.
export class DatabaseSync {
  constructor(_path?: string) {}
  exec(_sql: string): void {}
  prepare(_sql: string): any {
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
    };
  }
  close(): void {}
}
export default { DatabaseSync };
