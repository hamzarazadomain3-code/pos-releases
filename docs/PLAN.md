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
| 0.2 | **DONE (this run)** | new `src/main/ipcError.ts` (classification + `E-YYMMDDHHMMSS-XXXX` + bilingual message + stack log file); all 384 `ipcMain.handle` calls in `ipc.ts` + the 6 in `licensing.ts`/`updater.ts` go through `handle()` | `npm run test:ipcError` **38/38** |
| 0.3 | **DONE (this run)** | no `new Date().toISOString()` left for a business date; the local helpers own "today"; the Z-report runs on `resolveBusinessRange` (half-open `>= ? AND < ?`) | `npm run test:timezone` **16/16** |
| 0.4 | **DONE (this run)** | one shared `businessDayWhere()` in `src/shared/salesHistory.ts`; the daily closing, `sales.listSales(useBusinessDayRange)` and the expense summary all use it | `npm run test:unified` **11/11** |
| 0.5 | **DONE (this run)** | `shifts.openShift` blocks a shift older than 24 h and writes `shift_long_open` at 20 h; a forced close still needs a manager + a reason | `npm run test:shifts` **14/14** |
| 0.6 | **DONE (this run)** | 50 mojibake sequences replaced with real UTF-8 (`reports.ts`, `Inventory.tsx`, `types.ts`); the permanent scan is `npm run test:utf8` | clean |
| 0.7 | **DONE (verified this run)** | the rule is enforced in BOTH sale paths (`sales.ts` + `billAmendments.ts`); no code change was needed | `scripts/test_negative_stock.js` **31/31** |
| 0.8 | **DONE (verified this run)** | the shared `adminSettingsBridge` owns the duplicated keys (newest explicit value wins, the write is logged) | `npm run test:settingsbridge` **16/16** — the duplicate **UI controls** are still on screen (see Risks) |
| 0.9 | **DONE (this run)** | an expired line is blocked in `sales.ts`; a manager (owner/manager) can override with a PIN + a reason and every override is written to the activity log | `npm run test:expired` **15/15** |
| 0.10 | **DONE (re-verified this run)** | the fixed-width roll tables + the designed receipt are unchanged | `npm run test:receipt` **68/68**, `npm run test:receiptdesigner` **73/73** |
| 0.11 | **DONE (re-verified this run)** | the themed calendar + the one formatter on every date field | `npm run test:calendar` **64/64**, `npm run test:dateCalendarUi` **38/38** |
| 0.12 | **DONE (this run)** | the new `audits:discard` (owner only, a completed audit is refused, the audit + its items are deleted, `audit_discarded` is logged) + the Discard button in the screen | `npm run test:audits` **13/13** |
| 0.13 | **DONE (re-verified this run)** | the alert dedup + the auto-resolve on a clear condition are unchanged | `npm run test:alerts` **5/5** |
| 0.14 | **DONE (this run)** | the four UI defects are fixed in the REAL renderer: the empty-cart checkout label + dimmed style, the PO supplier-switch guard, the merge-not-a-twin rule (cart Undo + PO cell) and the modal above the assistant drawer (the minimized card stays reachable) | `npm run test:ui` **30/30** (+ 6 screenshots) |
| 0.15 | **DONE (this run)** | the new `src/main/services/secretVault.ts` (OS key store, `enc:v1:` marker, legacy migration, an undecryptable value reads as empty) + the enforced password policy (`src/shared/passwordPolicy.ts`) | `npm run test:security` **24/24** |

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

**As it actually ran (2026-11-26):** the table order was followed item by item
(0.1 was verified first), 0.6 was **not** pulled forward, and the phase closed
with the billing smoke test as a permanent suite
(`npm run test:billingSmoke`, 46/46) plus a full regression batch
(32 suites, every output in `E:\temp\proof\p0_regr_*.txt`, the one-line summary
in `E:\temp\proof\p0_regr_summary.txt`). The phase report is
`docs/PHASE0_REPORT.md`.

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

---

# Phase 1 — the product / inventory data model (2026-11-27)

Baseline `v2.32.0` (`main` @ `4578947`). The phase report is
`docs/PHASE1_REPORT.md`; the proofs are in `E:\temp\proof\p1_*`.

## 8. Phase 1 scope

The prompt's Phase 1 is the **product / inventory data model**: the units, the
batch & expiry rules and the stock ledger, with the same "one rule, one place"
rule the settings bridge already follows. The items below were **found in the
code** (an explore pass over the services, the migrations and the tests), not
guessed from the prompt's wording.

## 9. Phase 1 status (as run)

| # | Item | Status | The defect that was fixed | Proof |
|---|---|---|---|---|
| 1.1 | the FIFO deduction was not all-or-nothing | **DONE (new)** | the batches were left short when the stock was not enough; the manual adjustment had no transaction | `test:inventoryModel` 4 checks |
| 1.2 | two lines of one product → wrong allocations | **DONE (new)** | the allocations lived in a `Map<product_id, …>`; the second line overwrote the first | 8 checks |
| 1.3 | the FIFO report was empty | **DONE (new)** | `createBatch()` never wrote `quantity_received`; the engine filters on it | 2 checks |
| 1.4 | a return kept its allocation | **DONE (new)** | the batch and the stock came back, the `fifo_allocations` row did not | 4 checks |
| 1.5 | four expiry rules, two answers | **DONE (new)** | `src/shared/expiry.ts` — expired means BEFORE today; the till and the report agree | 9 checks |
| 1.6 | an expired batch could be sold | **DONE (new)** | the sale checked the product's date, never the batch it consumed; the amendment had no check at all | 7 checks |
| 1.7 | a quotation ignored the stock rules | **DONE (new)** | the conversion decremented the stock directly — no refusal, no FIFO, no expiry | 3 checks |
| 1.8 | the ledger was anonymous | **DONE (new)** | `recordMovement()` could not write `user_id` / `branch_id` | 3 checks |
| 1.9 | two report queries were dead | **DONE (new)** | they selected `pi.quantity_ordered`, a column that never existed | 3 checks |
| 1.10 | the purchase snapshot was incomplete | **DONE (new)** | the legacy `batch_number` / `quantity_received` twins stayed null, so the expiry alert saw nothing | 5 checks |
| 1.11 | the import's undo removed nothing | **DONE (new)** | the generated batch name was never stored; the undo reversed the purchase qty, not the base qty | 9 checks (with 1.12) |
| 1.12 | one unit-conversion rule | **DONE (new)** | `src/shared/units.ts`; the import resolves the file's `unit` column and adds base units | 6 checks |

**The whole phase: `npm run test:inventoryModel` 70/70.**

**The whole phase: `npm run test:inventoryModel` 70/70.**

### Two rules that moved into one place
- `src/shared/expiry.ts` — "expired means before today" (D17).
- `src/shared/units.ts` — "the stock is in base units, rounded to 3 decimals" (D21).

### What Phase 1 did NOT do (and why)
- **Per-branch stock** — `products` has no `branch_id`; the branch is now
  recorded on every movement (1.8), which is the first step, but the stock is
  still one number per product.
- **A database constraint on the units** — "exactly one base unit per product"
  is enforced in code, not by SQLite (a schema change to a live shop's table
  is a separate risk decision).
- **The variant stock** — `product_variants.stock_qty` is still outside the
  canonical model.
- **Money as integer paisa** — still deferred (D3).

