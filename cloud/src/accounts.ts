// accounts — the web front door: one D1 `ACCOUNTS` database holding every
// registered shop plus its web sessions. This is the only async, web-native code
// in the project; all POS logic lives in each shop's ShopObject.
//
//   POST /api/signup  { shopName, username?, password }
//     Creates (or finds) the shop's ShopObject, bootstraps it (rename owner +
//     set password + shop_name through the real services), persists the shop row
//     (slug PK, plan 'trial', trial_ends_at = now + 7d) and issues a web session
//     token (30 days).
//
//   POST /api/login  { shop, username, password }
//     Verifies the POS credentials via the real `auth:login` service in the
//     shop's ShopObject and issues a web session token. Allowed regardless of
//     trial status (trial enforcement lives in authenticated /api/rpc).
//
//   POST /api/rpc  (Authorization: Bearer <token>)  { channel, args }
//     Looks up the web session + shop, applies the trial gate (402 when an
//     active trial has ended — neutral, truthful messaging; activation is a
//     later milestone), forwards to the ShopObject with sessionUser = user_id.
//
//   GET /api/health

import type { Env } from './env';
import { json, readJson } from './http';

const TRIAL_DAYS = 7;
const SESSION_DAYS = 30;

interface ShopRow {
  slug: string;
  name: string;
  owner_username: string;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  created_at: string;
}

interface SessionRow {
  token: string;
  shop_slug: string;
  user_id: number;
  username: string;
  created_at: string;
  expires_at: string;
}

// The D1 schema is created on demand (per isolate), idempotently.
let schemaReady: Promise<void> | null = null;

function createSchema(env: Env): Promise<void> {
  return Promise.all([
    env.ACCOUNTS.prepare(
      `CREATE TABLE IF NOT EXISTS shops (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_username TEXT NOT NULL DEFAULT 'admin',
        plan TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'active',
        trial_ends_at TEXT,
        created_at TEXT NOT NULL
      )`
    ).run(),
    env.ACCOUNTS.prepare(
      `CREATE TABLE IF NOT EXISTS web_sessions (
        token TEXT PRIMARY KEY,
        shop_slug TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`
    ).run(),
  ]).then(() => undefined);
}

function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema(env).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'shop'
  );
}

async function uniqueSlug(env: Env, base: string): Promise<string> {
  const first = await env.ACCOUNTS.prepare('SELECT slug FROM shops WHERE slug = ?').bind(base).first();
  if (!first) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const row = await env.ACCOUNTS.prepare('SELECT slug FROM shops WHERE slug = ?').bind(candidate).first();
    if (!row) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function handleHealth(): Response {
  return json({ ok: true, service: 'rokar-pos', version: '0.1.0' });
}

export async function handleSignup(env: Env, request: Request): Promise<Response> {
  await ensureSchema(env);
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Invalid JSON body' }, 400);
  }

  const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : '';
  const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : 'admin';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!shopName) return json({ ok: false, error: 'shopName is required' }, 400);
  if (password.length < 4) return json({ ok: false, error: 'Password must be at least 4 characters' }, 400);

  const slug = await uniqueSlug(env, slugify(shopName));

  // Boot the shop first (runs migrations + bootstrap) so we never persist an
  // accounts row for a shop that could not actually initialise.
  const stub = env.SHOP.get(env.SHOP.idFromName(slug));
  const bootstrapRes = await stub.fetch('https://shop/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, shopName }),
  });
  const bootstrap = (await bootstrapRes.json()) as { ok?: boolean; adminUserId?: number; error?: string };
  if (!bootstrap.ok) {
    return json({ ok: false, error: bootstrap.error || 'Failed to initialise shop' }, 500);
  }

  const trialEndsAt = isoDaysFromNow(TRIAL_DAYS);
  const nowIso = new Date().toISOString();
  await env.ACCOUNTS.prepare(
    `INSERT INTO shops (slug, name, owner_username, plan, status, trial_ends_at, created_at)
     VALUES (?, ?, ?, 'trial', 'active', ?, ?)`
  )
    .bind(slug, shopName, username, trialEndsAt, nowIso)
    .run();

  const token = crypto.randomUUID();
  await env.ACCOUNTS.prepare(
    `INSERT INTO web_sessions (token, shop_slug, user_id, username, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(token, slug, bootstrap.adminUserId ?? 1, username, nowIso, isoDaysFromNow(SESSION_DAYS))
    .run();

  return json(
    {
      ok: true,
      token,
      shop: { slug, name: shopName, plan: 'trial', trial_ends_at: trialEndsAt },
      user: { id: bootstrap.adminUserId ?? 1, username },
    },
    201
  );
}

/**
 * Resolve the bearer web session into its shop row, or return an error response.
 * Shared by /api/rpc and /api/activate.
 */
async function lookupSession(
  env: Env,
  request: Request
): Promise<{ session: SessionRow; shop: ShopRow } | { response: Response }> {
  const authHeader = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)/i.exec(authHeader);
  if (!match) return { response: json({ ok: false, error: 'Missing bearer token' }, 401) };
  const token = match[1];

  const session = (await env.ACCOUNTS.prepare('SELECT * FROM web_sessions WHERE token = ?').bind(token).first()) as
    | SessionRow
    | null;
  if (!session) return { response: json({ ok: false, error: 'Invalid session' }, 401) };
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return { response: json({ ok: false, error: 'Session expired' }, 401) };
  }

  const shop = (await env.ACCOUNTS.prepare('SELECT * FROM shops WHERE slug = ?').bind(session.shop_slug).first()) as
    | ShopRow
    | null;
  if (!shop) return { response: json({ ok: false, error: 'Shop not found' }, 404) };
  return { session, shop };
}

export async function handleLogin(env: Env, request: Request): Promise<Response> {
  await ensureSchema(env);
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Invalid JSON body' }, 400);
  }

  const shopSlug = typeof body.shop === 'string' ? body.shop.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!shopSlug || !username || !password) {
    return json({ ok: false, error: 'shop, username and password are required' }, 400);
  }

  const shop = (await env.ACCOUNTS.prepare('SELECT * FROM shops WHERE slug = ?').bind(shopSlug).first()) as
    | ShopRow
    | null;
  if (!shop) return json({ ok: false, error: 'Shop not found' }, 404);

  // Credentials verify against the real POS service in the shop's DO. No trial
  // gate here: login stays possible so users can see an honest "trial ended".
  const stub = env.SHOP.get(env.SHOP.idFromName(shopSlug));
  const rpcRes = await stub.fetch('https://shop/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'auth:login', args: [username, password], sessionUser: null }),
  });
  const rpc = (await rpcRes.json()) as { ok?: boolean; data?: { ok?: boolean; user?: { id: number; username: string; role: string; active: number }; message?: string }; error?: string };
  const data = rpc.ok ? rpc.data : undefined;
  if (!data || !data.ok || !data.user) {
    return json({ ok: false, error: data?.message || rpc.error || 'Invalid username or password' }, 401);
  }

  const token = crypto.randomUUID();
  await env.ACCOUNTS.prepare(
    `INSERT INTO web_sessions (token, shop_slug, user_id, username, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(token, shopSlug, data.user.id, data.user.username, new Date().toISOString(), isoDaysFromNow(SESSION_DAYS))
    .run();

  return json({
    ok: true,
    token,
    user: data.user,
    shop: { slug: shop.slug, name: shop.name, plan: shop.plan, trial_ends_at: shop.trial_ends_at },
  });
}

export async function handleRpc(env: Env, request: Request): Promise<Response> {
  await ensureSchema(env);
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Invalid JSON body' }, 400);
  }

  const looked = await lookupSession(env, request);
  if ('response' in looked) return looked.response;
  const { session, shop } = looked;

  // Trial gate — honest, neutral. Manual activation (allowing a shop owner to
  // switch to an activated plan via POST /api/activate) is implemented below;
  // the Rs 599/month marketing claim lives only in future website copy, never here.
  if (shop.plan === 'trial' && shop.trial_ends_at && new Date(shop.trial_ends_at).getTime() < Date.now()) {
    return json({ ok: false, error: 'trial_expired' }, 402);
  }

  const channel = typeof body.channel === 'string' ? body.channel : '';
  const args = Array.isArray(body.args) ? body.args : [];
  if (!channel) return json({ ok: false, error: 'channel is required' }, 400);

  const stub = env.SHOP.get(env.SHOP.idFromName(session.shop_slug));
  const rpcRes = await stub.fetch('https://shop/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel, args, sessionUser: session.user_id }),
  });
  const rpc = (await rpcRes.json()) as { ok?: boolean; data?: unknown; error?: string };
  if (rpc.ok) return json({ ok: true, data: rpc.data });
  return json({ ok: false, error: rpc.error || 'Request failed' }, 500);
}

/**
 * Manual activation: the shop OWNER (verified through the shop's DO) flips the
 * account from `trial` to `active`, which clears the trial-expiry 402 gate.
 * Neutral and truthful — no pricing claims, no fake entitlements.
 */
export async function handleActivate(env: Env, request: Request): Promise<Response> {
  await ensureSchema(env);
  const looked = await lookupSession(env, request);
  if ('response' in looked) return looked.response;
  const { session, shop } = looked;

  // Owner-only: the web session maps to a POS user; ask the shop's own DO what
  // role that user actually has (so a rotated/deleted user can never activate).
  const stub = env.SHOP.get(env.SHOP.idFromName(session.shop_slug));
  const rpcRes = await stub.fetch('https://shop/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'auth:currentUser', args: [], sessionUser: session.user_id }),
  });
  const rpc = (await rpcRes.json()) as { ok?: boolean; data?: { role?: string } | null; error?: string };
  if (!rpc.ok || !rpc.data || rpc.data.role !== 'owner') {
    return json({ ok: false, error: 'Only the owner can activate this account' }, 403);
  }

  await env.ACCOUNTS.prepare("UPDATE shops SET plan = 'active', trial_ends_at = NULL WHERE slug = ?")
    .bind(session.shop_slug)
    .run();

  return json({
    ok: true,
    shop: { slug: shop.slug, name: shop.name, plan: 'active', trial_ends_at: null },
  });
}