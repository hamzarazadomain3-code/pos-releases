# Rokar POS — Cloud foundation (`cloud/`)

The web/SaaS half of Rokar POS for **rokarpos.co.uk**. The desktop app in
`../src` stays completely untouched; this folder is a Cloudflare Workers worker
that reuses the desktop's *code* almost as-is through esbuild aliases.

## Architecture

```
                        ┌──────────────────────────────────────────┐
 browser → /api/* ──►   │  Worker (dist/index.js, prebundled)       │
                        │                                          │
                        │  accounts.ts  (D1 "ACCOUNTS")            │
                        │   · shops        slug PK, plan,           │
                        │     trial_ends_at, status, created_at     │
                        │   · web_sessions token PK, shop_slug,     │
                        │     user_id, username, expires_at         │
                        │                                          │
                        │  └─► SHOP.get(slug) ──►  ShopObject (DO)  │
                        │      one SQLite-backed DO per shop:       │
                        │      · runs all 50 real migrations        │
                        │      · serves /bootstrap + /rpc           │
                        └──────────────────────────────────────────┘
```

- **One D1 `ACCOUNTS` DB** (created on demand) for the multi-tenant registry.
- **One `ShopObject` Durable Object per shop**, named by its slug, backed by DO
  SQLite. It runs the **real** `migrations/001..050` against a thin
  `sqlite-compat` adapter over `ctx.storage.sql`, and dispatches the **entire real
  desktop IPC surface** — the unchanged `src/main/ipc.ts` (288 channels) plus
  `licensing.registerIpc()` — inside `ctx.storage.transactionSync`. Every
  `/api/rpc` call is therefore the *same handler, with the same return shape,* as on
  the desktop; server-side `electron`/`node`/native-lib shims (`src/shims/*`) let
  that code bundle, and a desktop-only feature fails only if it is actually called.

The desktop offline app (`src/`, `appId: com.shopkeeper.pos`) is never edited,
bundled, or deployed here — it keeps working as-is, including
`Ctrl+Shift+Alt+R` recovery.

## How the real code runs on Workers

esbuild applies a table of source-mapping "overlays" at bundle time
(`scripts/build.mjs`). The two the POS database and crypto depend on:

| Import | Bundled as | Why |
| --- | --- | --- |
| `../db` (from real services) | `src/web-db.ts` | the real `db.ts` persists a file via `node:sqlite` + scans a folder with `require`. `web-db.ts` mirrors its `getDb()` singleton and `runMigrations`, iterating code-generated `MIGRATIONS` from the real migration files. |
| `crypto` / `node:crypto` | `src/crypto-shim.ts` | byte-compatible `scryptSync` from noble-hashes at node's default `{N:16384,r:8,p:1}`, plus `timingSafeEqual`, `randomBytes`, `randomUUID`, `createHmac`. |

Everything else the desktop **main process** imports is aliased to a shim under
`src/shims/` — `electron` (the server-side IPC registry), `electron-updater`,
`logger`, `supportKey`, `fs`/`os`/`path`/`child_process`, `node:sqlite`,
`nodemailer`, `xlsx`, `bwip-js`, `pdfkit`, `whatsapp-web.js`, `qrcode`, `./licensing`
— and `@desktop/ipc` / `@desktop/licensing` resolve the real IPC + licensing modules
(treated as opaque to `tsc`, so cloud typechecking never follows the desktop graph).

`dist/index.js` is a self-contained ESM bundle (no `node:` imports left); that is
why `wrangler.toml` points `main` at the prebuilt file and every npm script
builds first. Wrangler/miniflare's own bundler can't apply these aliases.

The whole RPC runs inside `transactionSync`, so a real service throw rolls the
POS database back and becomes `{ ok:false, error }`. The module-level web-db /
session singletons are set per request and cleared in `finally` — a failed DO
can never leak state.

## Deploying

Requires a Cloudflare account (already logged in on this machine — `wrangler
whoami` shows it). One-time setup, then the normal flow:

```powershell
# 1. Create the D1 database (once) and note its database_id:
wrangler d1 create rokar-accounts

# 2. Paste that database_id into wrangler.toml under [[d1_databases]].
#    (It is a placeholder until then. `npm test` works fine with the
#    placeholder because local miniflare doesn't consult D1 remotely.)

# 3. Validate the deploy locally, then push:
npm run build
wrangler deploy --dry-run      # proves the bundle + config are deployable
npm run deploy                 # build + wrangler deploy
```

The worker is named `rokar-pos`. No routes/zones are touched; pointing
rokarpos.co.uk at it (custom domain or a route) is a separate, explicit step.

## Web dashboard

The same worker serves a dependency-free single-page dashboard at `GET /` (assets
at `/app.js`, `/style.css`). It signs up / signs in through the JSON API and shows
real service data: Overview (shop, plan, signed-in user, product count), Inventory
(add / adjust / delete products), Users (add / delete, owner-only), Activity log,
and Settings (owner-gated). Trial messaging is neutral and the owner-only
`/api/activate` button flips the trial to active. No mock data or pricing claims
anywhere.

The dashboard is bundled into the worker by `scripts/build.mjs` (codegen →
`src/generated-web.ts`), so the deploy stays a single file.

## The real desktop app at `/app`

`/` is the lite dashboard; `/app` is the **actual desktop application** — the real
React renderer from `src/renderer`, unedited. It is built by Vite
(`web/vite.config.mjs` → `web-dist/app`, uploaded as Cloudflare static assets and
served under `/app` by the `[assets]` binding in `wrangler.toml`):

- `web/electron-browser.ts` is a 1:1 browser stand-in for the `electron` module, so
  the **unmodified** `src/preload/preload.ts` runs and installs `window.api` exactly
  as on the desktop.
- `ipcRenderer.invoke(channel, …)` becomes a `POST /api/rpc` carrying the web
  session's bearer token, so every `window.api.*` call runs the identical desktop
  handler in the shop's DO.
- `auth:login` / `auth:logout` / `auth:refreshSession` / `app:*` / `updater:*` are the
  only channels handled in the browser (there is no Electron main process).
- `admin:shortcuts:getAll` is answered with **one** rewrite: while `save_print` still
  holds its seeded `Ctrl+Shift+S`, the browser build serves `Ctrl+Alt+S` instead. A
  browser can never receive `Ctrl+Shift+S` (Edge claims it for "Web capture", Firefox
  for "Take screenshot") — the `keydown` never reaches the page — so the billing
  handler's `Ctrl+Alt+…` path (it excludes Alt from the hard-coded chords) runs the
  same save+print action and the footer hint stays truthful. An owner's own binding is
  never rewritten.
- Sign-in uses the same shop credentials as the desktop; the shop is taken from
  `?shop=<slug>` (the dashboard's **Open POS** button links there).
- `?page=<nav>` deep-links into a specific desktop page (e.g. `?page=dashboard`).
  The shell holds its page in React state (default `billing`) and has no URL routing,
  so the overlay clicks the matching sidebar item once the sidebar renders — the
  dashboard's **Open POS** button uses `page=dashboard` so a fresh account lands on
  the shop overview instead of the empty "no open shift" Billing screen. A `cashier`
  has no Dashboard item, so it no-ops and stays on Billing.

The web config pins the same `manualChunks` as the desktop build on purpose: without
the pins rollup regroups the lazy page chunks and can hoist a `const` past a
top-level use across a circular import — a `Cannot access 'X' before initialization`
TDZ that only appears in a **browser**, never in the build.

`npm run smoke:web` proves it actually runs: it boots a shop, loads `/app` in a real
Electron/Chromium window and asserts the bridge installed, the session restored
through `/api/rpc`, a real channel returned data, and every lazy nav page chunk
executed (24 today). Prefix with `ROKAR_SMOKE_BASE=https://…` to run it against a
live deployment.

## Printing at `/app`

The desktop prints by driving a hidden Electron `BrowserWindow`
(`src/main/services/printService.ts`); a browser has no such window, so the cloud
prints through the browser's own dialog — while still reusing the desktop's
**document builders**, so the paper and layout are identical:

- Every document `printing:*` channel (`printSale` / `previewReceipt` /
  `printInvoice` / `previewInvoice` / `printLabel` / `printBarcodeLabel` /
  `printBarcodeBatch` / `previewBarcodeBatch` / `printBarcodeBatchWithOptions` /
  `printCalibrationLabel` / `printDrawerSummary` / `printTestSheet`) is intercepted
  in `web/electron-browser.ts` and answered by the worker's **`cloud:print`** channel
  (registered in `src/dispatch.ts` alongside `app:*`).
- `src/print-bridge.ts` maps each channel to the *same builder* the desktop handler
  uses (`buildReceiptJob`, `buildInvoiceJob`, `buildLabelJob`,
  `buildLabelStudioJob`, `buildDrawerSummaryHtml`, `buildCalibrationHtml`,
  `buildCalibrationLabelHtml`) through the opaque `@desktop/print*` specifiers
  (declared in `src/types/desktop-print.d.ts` so cloud `tsc` still never follows
  the desktop graph), and returns `{ ok, html, title }`.
- The bridge renders that HTML into a hidden same-origin `<iframe>` and calls the
  browser's `window.print()`. A document whose CSS already fixes a page size
  (A4/A5 invoice, calibration sheet) prints as-is; a roll document (thermal receipt,
  cash-drawer summary, labels) is **measured in the iframe** and gets a stamped
  `@page { size: <w>mm <h>mm }` — the browser's equivalent of the desktop's
  rendered-DOM height measurement.
- **Label barcodes are drawn client-side with jsbarcode** (already in the renderer
  bundle). A Worker has no rasteriser, so the `bwip-js` shim resolves to an empty
  image — and it must still *invoke* its callback, because `printDocs.toDataUrl()`
  only settles inside it (returning silently used to hang every label job forever).
  The bridge then fills each `.label .code` from the human-readable number the
  template already prints: EAN-13 when the text is a checksum-valid 13-digit code,
  Code 128 otherwise, mirroring `symbologyFor()`.
- Channels that need real hardware or local files are **refused with an honest
  message** instead of silently failing: `printing:openCashDrawer`,
  `printing:exportLabelBatchToPDF` / `...ToPNG`.
- Still desktop-only: report/label file export, `backup:run` / `backup:restore`,
  and the native open/save dialogs.

`npm test` covers this (`== web printing (cloud:print bridge) ==`): it builds the
receipt, invoice, label-batch and drawer-summary documents through the real
builders and asserts the drawer/export/unknown channels refuse cleanly.

## Endpoints

- `POST /api/signup` `{ shopName, username?, password }` — slugifies +
  de-duplicates the shop name, bootstraps the shop's DO (renames the seeded
  `admin` owner to `username` when it differs, sets the password through the real
  `auth.updateUser` under an owner session, stores `shop_name`), persists the
  shop row (plan `trial`, `trial_ends_at` = now + 7 days), returns a 30-day web
  session token.
- `POST /api/login` `{ shop, username, password }` — verifies through the real
  `auth:login` service, issues a web session token. **Allowed regardless of trial
  status.**
- `POST /api/rpc` `Authorization: Bearer <token>` `{ channel, args }` — resolves
  the web session to a POS user id, enforces the trial gate (402
  `trial_expired`), forwards to the shop's DO with `sessionUser`.
- `POST /api/activate` `Authorization: Bearer <token>` — owner-gated: verifies
  through the shop's DO that the session's POS user is an owner, then flips the
  account from `trial` to `active` (clears `trial_ends_at`).
- `GET /api/health`.
- `GET /` (and `/app.js`, `/style.css`) — the lite web dashboard.
- `GET /app` and `/app/*` — the **real desktop renderer** and its assets, served
  from the `[assets]` static binding (uploaded by `npm run deploy`).

## Trial / pricing truthfulness

- Signups start on a **7-day trial** (`plan='trial'`, `trial_ends_at`). Once the
  window passes, *authenticated* `/api/rpc` returns `402 { ok:false,
  error:'trial_expired' }` with neutral, honest messaging; login stays possible.
- The shop **owner** can then activate via `POST /api/activate` (403 for anyone
  else) — manual activation only, no pricing logic in the worker.
- The flat **Rs 599/month** web price is **website marketing only** — never
  hardcoded or claimed by this worker.
- No fabricated data anywhere: everything the API returns is produced by the real
  services/migrations.

## Commands (from `cloud/`)

```powershell
npm run build         # worker bundle (esbuild) + web app (Vite), then re-fix workerd DLLs
npm run build:worker  # just the worker bundle + migration/web codegen
npm run build:web     # just the Vite build of the desktop renderer (web-dist/app)
npm run typecheck     # worker build + tsc (cloud code + real service signatures via shims)
npm test              # build + local end-to-end suite (wrangler TestHarness)
npm run smoke:web     # boot /app in a real Electron/Chromium window and assert it runs
npm run dev           # build + local dev server
npm run deploy        # build + deploy (worker + the /app assets)
```

`npm run fix-workerd` (also part of `build`) copies the MSVC runtime DLLs
(`vcruntime140*`, `msvcp140*`, `concrt140.dll`) from the newest Edge Core install
under `C:\Program Files (x86)\Microsoft\EdgeCore` into
`node_modules\workerd\node_modules\@cloudflare\workerd-windows-64\bin`.
**Run it again after any `npm install`** — reinstalling `workerd` wipes the fix.

## Type story (cloud tsc never touches desktop typechecking)

`tsconfig.json` typechecks the cloud code plus only the real service files it
imports by relative path, through hand-written ambient shims
(`src/types/node-shim.d.ts`, `electron-shim.d.ts`). The real `src/main/ipc.ts` and
`src/main/licensing.ts` are pulled in through opaque virtual specifiers
(`@desktop/ipc`, `@desktop/licensing`) declared in `src/types/desktop-ipc.d.ts` and
resolved by esbuild at bundle time, so `tsc` never follows the desktop graph through
them. The code-generated `generated-migrations.ts` is `@ts-nocheck`'d. No
`@types/node`, no electron types; the real `tsconfig.main.json` in the app is
untouched.

## Files

- `src/accounts.ts` — D1 registry + signup/login/rpc/activate/health (the only
  async, web-native code).
- `src/shop-object.ts` — per-shop DO: migrations + bootstrap + rpc dispatch.
- `src/dispatch.ts` — the cloud IPC surface: registers and dispatches the real
  `src/main/ipc.ts` handlers (`@desktop/ipc`) and `@desktop/licensing`, plus the
  browser-owned `app:*` / `updater:*` / `cloud:print` channels.
- `src/print-bridge.ts` — web printing: maps each `printing:*` channel to the real
  desktop document builder and returns HTML for the browser to print (see
  "Printing at `/app`").
- `src/shims/*` — server-side `electron` / `node` / native-lib stand-ins
  (`fs`, `path`, `os`, `child_process`, `node:sqlite`, `nodemailer`, `xlsx`,
  `bwip-js`, `pdfkit`, `whatsapp-web.js`, `qrcode`, `electron-updater`, `licensing`)
  that let the real desktop services bundle on Workers.
- `src/web.ts` + `src/web/*` — the lite dashboard (served at `/`, bundled via
  codegen into `src/generated-web.ts`).
- `web/` + `scripts/build-web.mjs` — the Vite build of the real desktop renderer,
  served at `/app` (see above).
- `scripts/run-web-smoke.mjs` + `scripts/web-smoke-main.cjs` — the real-browser
  `/app` smoke test (`npm run smoke:web`).
- `src/sqlite-compat.ts` — DO `SqlStorage` → `node:sqlite`-shaped adapter.
- `src/crypto-shim.ts`, `src/web-db.ts` — esbuild alias targets.
- `scripts/build.mjs` — migration + web-asset codegen, `__APP_VERSION__` injection
  (from the desktop `package.json`, so `app:get-version` never goes stale) and the
  esbuild bundle.
- `scripts/run-tests.mjs` — end-to-end suite.
- `scripts/fix-workerd.mjs` — Windows VC++ DLL repair.