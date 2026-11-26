# PLAN — Rokar POS (master-prompt run, Phase 0 → 5)

Created: **2026-11-26** · Baseline: **v2.32.0** · Branch: `main` @ `3461923`
Owner-facing language: the shop is a live bakery POS; data safety and billing
come before everything else.

## 0. Why this file exists, and what changed since the prompt was written

The master prompt says the app shows **2.22.0** and asks for `docs/PLAN.md`
before any work. The app is actually **2.32.0**: `PROGRESS.md` and `REPORT.md`
record every run since then (Run 13, sidebar, web app, assistant, bill amend,
purchase enhance, calendar), and several Phase 0 items were fixed in those
runs. Re-implementing them would be a regression risk.

This plan therefore:
1. maps the real code, and
2. marks every Phase 0 item as **already shipped (with evidence)**, **partial**,
   or **missing**, so the remaining work is done once and every claim has a test.

`PROGRESS.md` stays the run ledger; this file is the plan; `DECISIONS.md`
records every judgement call.

## 1. Architecture map

### Processes and entry points
- **Main process** — `src/main/main.ts` (window, menu, scheduler, updater,
  single-instance lock, quit rules). The DB is opened by `src/main/db.ts`
  (`getDb()`, `node:sqlite` `DatabaseSync`) and `initDatabase()` runs migrations.
- **Preload** — `src/preload/preload.ts` exposes the typed `window.api` bridge
  (`invoke('module:action', …)`). It is the only renderer → main surface.
- **Renderer** — `src/renderer/src` (React 18 + Vite): `pages/*` (Billing,
  Dashboard, Inventory, Purchases, Reports, Settings, AdminPanel, Udhaar,
  Returns, Audits, Shifts, Promotions, Commissions, Transfers, Users,
  Quotations, CustomReports, LabelStudio, ReceiptDesigner, InvoiceDesigner,
  Branches, Expenses, FIFOStockReport, QuickSaleGrid, BarcodeGenerator…),
  `components/*` (Modal, DateInput/calendar, KeyboardInput, filters, pagination),
  `i18n/{en,ur}.json`.
- **Shared** — `src/shared/*` (pure, imported by both processes): sales history
  + business-day range, cart maths, dashboard maths, date parsing, calendar
  grid, purchase maths, receipt design, shortcuts.
- **Cloud** — `cloud/` (Cloudflare Worker + web build of the same renderer);
  `cloud/web/electron-browser.ts` answers desktop-only channels in a browser.
- **Migrations** — `migrations/0XX_*.js` (root folder, 88 files; latest
  `090_purchase_orders_enhance.js`), idempotent `PRAGMA table_info()` guards,
  run by `src/main/db.ts`.
- **Tests** — `scripts/test_*.{js,cjs}` + npm scripts in `package.json`.
  Electron UI suites boot the real built renderer against a throwaway DB via
  `POS_DB_PATH`; pure suites import `dist/shared/*` or `dist/main/services/*`.
- **Release** — electron-builder → GitHub `pos-releases`; a pre-push hook
  deploys the Cloudflare Worker; the marketing site (`E:\antigravty\rokar-site`)
  deploys through Vercel's Git integration.

### Data and money
- SQLite; money columns are **REAL** today (e.g. `sale_items.unit_price`,
  `line_total`, `sales.total_amount`). There is a shared currency formatter in
  `src/renderer/src/utils/currency.ts` and rounding in the services. A full
  integer-paisa migration is a data-risk project of its own (see `DECISIONS.md`
  D3) and is **not** part of Phase 0.
- `sale_items` columns (migration 001): `sale_id, product_id, qty, unit_price,
  discount, tax_rate, line_total` — **there is no `price` column**.

### IPC and services
- **383** `ipcMain.handle(...)` registrations in `src/main/ipc.ts`, all raw
  (no shared error wrapper — see item 0.2).
- Service singletons in `src/main/services/`: `sales.ts`, `returns.ts`,
  `shifts.ts`, `inventory.ts`, `reports.ts`, `profitability.ts`,
  `inventoryReports.ts`, `salesHistory.ts` (business ranges), `settings.ts`,
  `alerts`, `backup`, `printing`, `receiptTemplates`, `license`/`licensing`,
  `recovery`, `purchaseImport`, `purchases`, `billAmendments`, `commissions`,
  `promotions`, `assistant/*`, `whatsapp-gateway.ts`.
- Renderer pages call `window.api.<module>.<action>`; the preload maps it to
  `'<module>:<action>'`; `ipc.ts` maps it to the service.

## 2. Where each Phase 0 problem lives

| # | Problem | Primary code |
|---|---|---|
| 0.1 | `no such column: si.price` | `src/main/services/profitability.ts`, `inventoryReports.ts`; regression in `scripts/test_audit_fixes.js` |
| 0.2 | raw IPC errors to the user | `src/main/ipc.ts` (383 handlers), `src/preload/preload.ts`, renderer toasts |
| 0.3 | UTC vs Asia/Karachi | `src/shared/salesHistory.ts` (`resolveBusinessRange`), `reports.ts`, `returns.ts`, Dashboard/Daily Closing/Drawer, `utils/dateUtils.ts` |
| 0.4 | numbers disagree across screens | `src/main/services/salesHistory.ts`, `reports.ts`, `src/shared/dashboardMath.ts`, Dashboard/Reports/Daily Closing/Drawer |
| 0.5 | shift labels, two open shifts, average bill | `src/main/services/shifts.ts`, `src/renderer/src/pages/Shifts.tsx`, drawer components |
| 0.6 | mojibake / tofu | source strings (`reports.ts`, `Inventory.tsx`), DB text, i18n, emoji icons |
| 0.7 | negative stock sold | `src/main/services/sales.ts:144`, `inventory.ts`, `scripts/test_negative_stock.js` |
| 0.8 | one setting in several places | `src/main/services/settings.ts`, `pages/Settings.tsx`, `pages/AdminPanel*` |
| 0.9 | below-cost + expired sales | `src/main/services/sales.ts:114-115` (floor), expiry check (missing), `scripts/test_belowCost.cjs` |
| 0.10 | receipt columns / totals | `src/main/services/receiptTemplates.ts`, `receiptDesigner.ts`; `scripts/print_smoke.js`, `scripts/receipt_design_check.js` |
| 0.11 | mixed date formats | `src/renderer/src/components/DateInput.tsx`, `src/shared/calendarGrid.ts`, `utils/dateUtils.ts`; `test:dateparse`, `test:calendar`, `test:dateCalendarUi` |
| 0.12 | abandoned audits, empty complete, pagination | `src/renderer/src/pages/Audits.tsx`, audit service; `scripts/test_audit_fixes.js` |
| 0.13 | duplicate alerts | `src/main/services/alertService.ts`; `scripts/test_alerts.cjs` |
| 0.14 | empty-cart checkout label, PO dropdown, duplicate rows, minimized card | `Billing.tsx`, `PurchaseOrderModal.tsx`, `styles.css` |
| 0.15 | secrets, licence, recovery, password policy | `src/main/services/settings.ts` (SMTP), `licensing.ts`, `recovery.ts`, `pages/AdminPanel`, `pages/Users.tsx` |

## 3. Phase 0 status (as found on 2026-11-26)

Statuses are evidence-based. “Shipped” means the code and a permanent test
already exist from an earlier run; it is re-run before being called DONE for
this run.

| # | Status | Evidence found | Remaining work |
|---|---|---|---|
| 0.1 | **DONE (verified this run)** | no `si.price` anywhere; `profitability.ts` uses `si.unit_price` (89/151/182/216/219/268), `inventoryReports.ts` (180/199/315/321/330/402); `test:audit` 48/48 includes *“sale_items has unit_price, not price”* + *“profitability + inventory reports use unit_price”*; `test_inventoryReports` 12/12 (revenue 150, COGS 90, GP 60); IPC chain `preload.ts:369-377 → ipc.ts:992-1002 → service` complete | optional: an Electron test that clicks every Reports tab (service + chain are already proven) |
| 0.2 | **MISSING** | no `errorId`/`friendly`/wrapper; all 383 handlers raw; renderer surfaces `err.message` | central wrapper + error id + EN/UR messages + file log |
| 0.3 | PARTIAL | `resolveBusinessRange` in `shared/salesHistory.ts`, wired into `reports.ts`/`returns.ts`; `test:businessDay` 13/13; date formatter + DateInput shipped | audit Dashboard / Daily Closing / Drawer + every date display; one conversion point |
| 0.4 | PARTIAL | shared `salesHistory` summary/list/counts used by reports/returns; Dashboard uses its own `dashboardMath` + API | one summary service for sales/returns/payable/receivable/cash + a cross-screen equality test on seeded data |
| 0.5 | PARTIAL | one open shift enforced (`shifts.ts:28-32`); drawer/shift screens exist | >24 h warning + Force Close with reason; “today” = business day; average bill = total / bills |
| 0.6 | **MISSING (confirmed this run)** | literal mojibake in `src/main/services/reports.ts` (80, 333, 352, 585, 995, 1012, 1026, 1055), `src/renderer/src/pages/Inventory.tsx` (776, 794, 848, 851, …), `scripts/phase_b_counts.js:41` | fix source to real UTF-8 (`—`, `•`); add a permanent scan test; inspect DB text and repair with a backup + migration only if corrupted |
| 0.7 | PARTIAL | `sales.ts:144` reads `allow_negative_stock`; `scripts/test_negative_stock.js` exists | prove the rule is enforced in ONE server-side place for every sale path; add the repair report |
| 0.8 | PARTIAL | one `settings.ts`; Settings/AdminPanel UIs exist | audit the 10 duplicated keys, migrate conflicts (newest explicit wins, log), remove duplicate controls |
| 0.9 | PARTIAL | price floor enforced (`sales.ts:114-115`) + `test:belowCost`; **no expiry check in the sale path** | block expired sales; manager PIN override + audit log; product-save warning |
| 0.10 | Shipped (re-run pending) | fixed-width roll tables + `test:print` (138) + `test:receipt` (68) | re-run; no change unless a test fails |
| 0.11 | Shipped (re-run pending) | calendar DateInput + `shared/calendarGrid.ts` + `test:dateparse`/`test:calendar`/`test:dateCalendarUi` | re-run; audit remaining raw ISO displays |
| 0.12 | PARTIAL | audit cancel + activity log (`test_audit_fixes` B3); history pagination in `Audits.tsx` | friendly “nothing counted” validation; discard/delete unfinished audits in the UI |
| 0.13 | Shipped (re-run pending) | `alertService` + `test_alerts.cjs`; inventory suite asserts “Alert dedup: existing alert detected” | re-run; verify auto-resolve on condition clear |
| 0.14 | UNVERIFIED | UI code only | reproduce each of the four UI defects; fix + UI test where practical |
| 0.15 | PARTIAL | secret masking at the IPC boundary (A5, `test:audit`); perpetual licence + device checks (`test:licensing` 19) | **no `safeStorage` usage found** → encrypt SMTP/app passwords; signed offline licence token; password-policy defaults; remove developer hotkey docs |

Known debt not in the prompt table: money is stored as REAL (see D3).

## 4. Item 0.1 — root cause, fix, proof (this run)

**Root cause (historical):** report queries referenced `si.price`, but
`sale_items` only has `unit_price` (migration 001). SQLite throws
`no such column: si.price`, so Profitability and Inventory ▸ Monthly tabs died.

**Fix in the tree:** the A6 fix replaced every `si.price` with `si.unit_price`
(`profitability.ts`, `inventoryReports.ts`). `grep -R "si.price"` → **0 hits**
in `src/`.

**Proof run this session** (saved under `E:\temp\proof\`):
- `npm run build:main` → exit 0 (`p0_build_main.txt`)
- `npm run test:audit` → **48 passed, 0 failed**, including the two schema
  assertions (`p0_0.1_audit.txt`)
- `node scripts/test_inventoryReports.js` → **12 passed, 0 failed**, including
  profitability revenue/COGS/GP and daily inventory (`p0_0.1_inventoryReports.txt`)
- `node scripts/test_reports_db.js` → exit 0 (query schema on a sample DB)
- IPC chain verified statically: `preload.ts:369-377` →
  `ipc.ts:992-1002` → `profitability.ts`.

**Honest gap:** there is no Electron test that clicks *every* Profitability and
Inventory tab. The queries and the IPC chain are proven; the tab rendering is
not. This is the optional follow-up for 0.1 and is listed as such rather than
claimed.

## 5. Execution order for the rest of Phase 0

The master prompt says **“do not skip ahead”**, so the default order is the
table order:

**0.2 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7 → 0.8 → 0.9 → 0.10 → 0.11 → 0.12 → 0.13
→ 0.14 → 0.15.**

0.6 (mojibake) is the smallest, most visible fix; it is pulled forward **only
if the owner approves**, otherwise it is done in its table slot.

Every item: root cause (1–3 lines) → smallest fix → regression test → one
`CHANGELOG.md` line → `docs/PHASE0_REPORT.md` evidence.

## 6. Verification protocol (every item)

- `npm run typecheck` (main + renderer), `npm run build`.
- The item's regression suite + the nearest existing suites.
- Billing smoke test from the master prompt (drawer, discount+tax, weight,
  wholesale, split payment, udhaar, hold/resume, return+restock, below-cost +
  expired block, close drawer, cross-screen number equality, backup/restore,
  kill mid-sale).
- Proofs in `E:\temp\proof\p0_<item>_*.txt`; DONE only with real output.

## 7. Risks and constraints

- **Live shop data.** No destructive migration; backups before any DB change;
  migrations tested on a populated copy (`npm run check:migrations`).
- **Uncommitted user files.** `scripts/seed_demo.js` (modified) and five stray
  untracked scripts are the owner's/agent's work — never staged or edited.
- **Money as REAL.** Rounding is centralised where it exists; a schema-wide
  paisa migration is deferred (D3).
- **Timezone.** Store UTC, display Asia/Karachi (setting `clock_timezone`);
  never use `new Date(iso).toISOString().slice(0,10)` for “today”.
- **No new dependencies** without a `DECISIONS.md` entry.
