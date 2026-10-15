// run-web-smoke.mjs — boots the REAL web build in a real browser (Electron/Chromium)
// and proves the renderer actually RUNS, not just that it bundles.
//
// Two modes:
//   node scripts/run-web-smoke.mjs                     # local: wrangler TestHarness
//   ROKAR_SMOKE_BASE=https://… node scripts/run-web-smoke.mjs   # live deployment
//
// The wrangler TestHarness is in-process (no HTTP port), so local mode starts a
// tiny Node proxy in front of `worker.fetch` and points Electron at it. Both modes
// sign up a shop, seed the shared web session, load /app and assert the desktop app
// mounted, restored its session through /api/rpc, and served real data.
//
// Run a full `npm run build` first, and run it where a GUI is available.
import { createTestHarness } from 'wrangler';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const liveBase = (process.env.ROKAR_SMOKE_BASE || '').replace(/\/$/, '');
const PORT = Number(process.env.ROKAR_SMOKE_PORT || 8791);

let BASE;
let harness = null;
let proxy = null;
let session = null;

// A unique name per run. Harmless locally (fresh in-process harness each time),
// but essential against a LIVE worker: the slug is what derives the shop's
// Durable Object, and a DO's SQLite storage outlives the ACCOUNTS row. Reusing a
// slug whose D1 row was deleted but whose DO still holds the old shop restores a
// session that no longer matches, so /app never leaves the login screen.
const SMOKE_SHOP_NAME = `Web Smoke Shop ${Date.now()}`;

async function signup(base) {
  const res = await fetch(base + '/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopName: SMOKE_SHOP_NAME, username: 'admin', password: 'smoke-pass' }),
  });
  return res.json();
}

if (liveBase) {
  BASE = liveBase;
  session = await signup(BASE);
  if (!session.ok) {
    console.error('live signup failed', session);
    process.exit(1);
  }
  console.log(`[smoke] live target ${BASE} (shop=${session.shop.slug})`);
} else {
  BASE = `http://127.0.0.1:${PORT}`;

  harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: 'rokar-pos',
          compatibility_date: '2026-09-30',
          compatibility_flags: ['nodejs_compat'],
          main: './dist/index.js',
          d1_databases: [{ binding: 'ACCOUNTS', database_name: 'rokar-accounts' }],
          durable_objects: { bindings: [{ name: 'SHOP', class_name: 'ShopObject' }] },
          migrations: [{ tag: 'v1', new_sqlite_classes: ['ShopObject'] }],
          assets: { directory: './web-dist', binding: 'ASSETS' },
        },
      },
    ],
  });
  await harness.listen();
  const worker = harness.getWorker('rokar-pos');

  session = await (async () => {
    const res = await worker.fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopName: SMOKE_SHOP_NAME, username: 'admin', password: 'smoke-pass' }),
    });
    return res.json();
  })();
  if (!session.ok) {
    console.error('signup failed', session);
    await harness.close();
    process.exit(1);
  }

  // Expose the in-process worker over a real TCP port so a browser can reach it.
  proxy = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      const resp = await worker.fetch(BASE + req.url, { method: req.method, headers, body });
      const out = {};
      resp.headers.forEach((v, k) => {
        out[k] = v;
      });
      res.writeHead(resp.status, out);
      res.end(Buffer.from(await resp.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e && e.stack ? e.stack : e));
    }
  });
  await new Promise((resolve) => proxy.listen(PORT, '127.0.0.1', resolve));
  console.log(`[smoke] proxy on ${BASE} (shop=${session.shop.slug})`);
}

// Warm the shop's Durable Object before the browser loads /app. A brand-new shop
// runs its whole SQLite migration set (~51 migrations) on the FIRST request that
// opens its DO, and that can outlast the smoke's post-restore wait — against a
// live worker it intermittently left the shell on the splash/login while the DO
// caught up, so `appShell (login bypassed)` failed even though every direct
// window.api call worked. One authenticated RPC here means /app sees a shop whose
// schema is already built, so the check is deterministic instead of timing-lucky.
async function warmupShop() {
  const deadline = Date.now() + 90000;
  let last = '';
  for (;;) {
    try {
      const res = await fetch(BASE + '/api/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ channel: 'auth:currentUser', args: [] }),
      });
      const body = await res.json();
      if (body && body.ok) {
        console.log('[smoke] shop warm (DO migrated)');
        return;
      }
      last = JSON.stringify(body);
    } catch (e) {
      last = String(e && e.message ? e.message : e);
    }
    if (Date.now() > deadline) {
      console.error('shop warmup failed:', last);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
await warmupShop();

const electronPath = require('electron');
const child = spawn(electronPath, [path.join(root, 'scripts', 'web-smoke-main.cjs')], {
  env: {
    ...process.env,
    ROKAR_WEB_URL: BASE,
    ROKAR_SHOP_SLUG: session.shop.slug,
    ROKAR_WEB_TOKEN: session.token,
    ROKAR_WEB_USER: JSON.stringify(session.user),
    ROKAR_WEB_SHOP: JSON.stringify(session.shop),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => {
  output += d;
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  output += d;
});

child.on('exit', async (code) => {
  if (proxy) await new Promise((r) => proxy.close(r));
  if (harness) await harness.close();
  const pass = /SMOKE_RESULT: PASS/.test(output);
  console.log(pass ? `\nWeb app smoke: PASS (electron exit ${code})` : `\nWeb app smoke: FAIL (electron exit ${code})`);
  if (session?.shop?.slug) console.log(`smoke shop slug: ${session.shop.slug}`);
  process.exit(pass ? 0 : 1);
});
