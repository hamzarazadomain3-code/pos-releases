// ShopObject — one Durable Object per shop, backed by DO SQLite.
//
// Each instance runs the FULL real 50-migration POS schema (lazily, once), then
// serves two internal HTTP routes called by the `ACCOUNTS` D1 front door:
//
//   POST /bootstrap  { username, password, shopName? }
//     Fresh-shop plumbing: rename the seeded `admin` owner row to the signup
//     username (updateUser deliberately has no username field), set the signup
//     password through the real `auth.updateUser` under an owner session, and
//     store `shop_name`. Runs atomically inside `transactionSync`.
//
//   POST /rpc  { channel, args, sessionUser? }
//     Runs one dispatch channel with the POS user session supplied by the web
//     session, inside `transactionSync` so a service throw rolls back and becomes
//     `{ ok:false, error }`.
//
// The module-level webDb/session singletons are set for each fetch and cleared in
// `finally`, so a failed/aborted DO can never leak state across requests.

import { SqliteCompat } from './sqlite-compat';
import { setWebDb, runMigrations } from './web-db';
import { dispatch, ensureDispatchInit } from './dispatch';
import { json } from './http';
import * as auth from '../../src/main/services/auth';
import * as settings from '../../src/main/services/settings';
import type { Env } from './env';

interface BootstrapBody {
  username?: unknown;
  password?: unknown;
  shopName?: unknown;
}

interface RpcBody {
  channel?: unknown;
  args?: unknown;
  sessionUser?: unknown;
}

export class ShopObject {
  private dbPromise: Promise<SqliteCompat> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  /** Lazily run all migrations once per DO instance (async, NOT in transactionSync). */
  private ensureDb(): Promise<SqliteCompat> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = new SqliteCompat(this.ctx.storage);
        setWebDb(db);
        await runMigrations(db);
        return db;
      })();
    }
    return this.dbPromise;
  }

  async fetch(request: Request): Promise<Response> {
    const db = await this.ensureDb();
    setWebDb(db);
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/bootstrap') {
        return this.handleBootstrap(db, request);
      }
      if (request.method === 'POST' && url.pathname === '/rpc') {
        return this.handleRpc(db, request);
      }
      return json({ ok: false, error: 'Not found' }, 404);
    } finally {
      setWebDb(null);
    }
  }

  private async handleBootstrap(db: SqliteCompat, request: Request): Promise<Response> {
    let body: BootstrapBody;
    try {
      body = (await request.json()) as BootstrapBody;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : '';

    if (!username || !password) {
      return json({ ok: false, error: 'username and password are required' }, 400);
    }

    // Migration 011 seeds admin(admin123, owner) only-if-missing; migration 007
    // promoted the seeded user to owner. This is the fresh-shop owner row.
    const admin = db
      .prepare("SELECT id, username, role FROM users WHERE username = 'admin' AND role = 'owner' ORDER BY id LIMIT 1")
      .get() as { id: number; username: string; role: string } | undefined;
    if (!admin) {
      return json({ ok: false, error: 'Seeded admin owner not found' }, 500);
    }

    try {
      const adminUserId = this.ctx.storage.transactionSync(() => {
        setWebDb(db);
        auth.setSessionUser(admin.id);
        try {
          // updateUser has no username field (desktop account rows are immutable
          // usernames); this one direct UPDATE is the fresh-shop rename only.
          if (username !== 'admin') {
            db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, admin.id);
          }
          auth.updateUser(admin.id, { password });
          if (shopName) settings.setSetting('shop_name', shopName);
        } finally {
          auth.setSessionUser(null);
        }
        return admin.id;
      });
      return json({ ok: true, adminUserId });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  private async handleRpc(db: SqliteCompat, request: Request): Promise<Response> {
    let body: RpcBody;
    try {
      body = (await request.json()) as RpcBody;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.channel !== 'string' || body.channel.length === 0) {
      return json({ ok: false, error: 'channel is required' }, 400);
    }
    const sessionUser = typeof body.sessionUser === 'number' ? body.sessionUser : null;

    ensureDispatchInit();
    try {
      let data: unknown = this.ctx.storage.transactionSync(() => {
        setWebDb(db);
        return dispatch(body.channel as string, Array.isArray(body.args) ? body.args : [], sessionUser);
      });
      // Async handlers (licensing, printing, export, backup, mail) return a Promise.
      // Await it after the transaction commits so the JSON body holds the value.
      if (data && typeof (data as { then?: unknown }).then === 'function') {
        data = await (data as Promise<unknown>);
      }
      return json({ ok: true, data });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }
}