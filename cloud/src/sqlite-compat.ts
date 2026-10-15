// sqlite-compat — a thin adapter that makes a Durable Object's `ctx.storage.sql`
// (SqlStorage) look like the `node:sqlite` `DatabaseSync` surface the real
// `src/main/services/*` code and the 50 real migrations expect.
//
// The desktop app runs its POS schema in `node:sqlite::DatabaseSync`; a ShopObject
// runs the *same* code inside `ctx.storage.transactionSync` with this adapter so
// the real services/migrations run as-is — adapted only via esbuild aliases.
//
// Proven semantics (covered end-to-end by scripts/run-tests.mjs):
//   - get/all  -> exec(sql, ...params).toArray()  (first row / all rows)
//   - run      -> exec the SQL, then a follow-up `SELECT changes() AS c,
//                 last_insert_rowid() AS id` (exact, including inside transactionSync).
//   - exec     -> silently no-ops standalone transaction-control statements
//                 (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE — the real transaction is
//                 `transactionSync`, so service-level BEGIN/COMMIT are redundant)
//                 and `PRAGMA journal_mode` (throws SQLITE_AUTH in DO SQLite).
//                 Everything else passes through unchanged, including
//                 `PRAGMA foreign_keys = OFF` (DO silently accepts it; FK stays ON,
//                 which matches the desktop default).

export type CompatRow = Record<string, unknown>;

export interface CompatRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** Coerce values the desktop services never produce but SqlStorage rejects. */
function coerceParam(value: unknown): string | number | null | ArrayBuffer {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value as string | number | null | ArrayBuffer;
}

// Matches a *single* transaction-control statement (whole string, trailing `;`
// and whitespace tolerated). Multi-statement strings (eg. migration 031's
// CREATE TRIGGER body) never match and pass straight through.
const TRANSACTION_ONLY =
  /^\s*(?:begin(?:\s+(?:transaction|deferred|immediate|exclusive))?|commit|end|rollback(?:\s+to(?:\s+savepoint)?\s+\S+)?|savepoint\s+\S+|release\s+\S+|abort)\s*;?\s*$/i;

// `PRAGMA journal_mode...` throws SQLITE_AUTH inside DO SQLite; harmless here.
const JOURNAL_MODE_PRAGMA = /^\s*PRAGMA\s+journal_mode\b[\s\S]*;?\s*$/i;

export class CompatStatement {
  constructor(
    private readonly storage: SqlStorage,
    private readonly sqlText: string
  ) {}

  get(...params: unknown[]): CompatRow | undefined {
    const rows = this.storage
      .exec(this.sqlText, ...params.map(coerceParam))
      .toArray();
    return rows.length > 0 ? (rows[0] as CompatRow) : undefined;
  }

  all(...params: unknown[]): CompatRow[] {
    return this.storage.exec(this.sqlText, ...params.map(coerceParam)).toArray() as CompatRow[];
  }

  run(...params: unknown[]): CompatRunResult {
    this.storage.exec(this.sqlText, ...params.map(coerceParam));
    const row =
      (this.storage
        .exec('SELECT changes() AS c, last_insert_rowid() AS id')
        .toArray()[0] as CompatRow | undefined) ?? {};
    return { changes: Number(row.c ?? 0), lastInsertRowid: Number(row.id ?? 0) };
  }
}

export class SqliteCompat {
  constructor(private readonly storage: DurableObjectStorage) {}

  prepare(sqlText: string): CompatStatement {
    return new CompatStatement(this.storage.sql, sqlText);
  }

  exec(sqlText: string): void {
    const trimmed = sqlText.trim();
    if (!trimmed) return;
    if (TRANSACTION_ONLY.test(trimmed)) return;
    if (JOURNAL_MODE_PRAGMA.test(trimmed)) return;
    this.storage.sql.exec(trimmed);
  }
}