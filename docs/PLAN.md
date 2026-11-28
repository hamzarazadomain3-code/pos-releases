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

---

# Phase 2 — the receipt designer + the template library (2026-11-27)

Baseline `v2.32.0` (`main` @ `04c2b71`). The phase report is
`docs/PHASE2_REPORT.md`; the proofs are in `E:\temp\proof\p2_*`.

## 10. Phase 2 scope

The prompt's Phase 2 is the **receipt designer** — the screen where the shop
decides what its receipt looks like — and the **template library** that lets
the owner keep more than one design (a compact 80 mm roll for the counter, a
detailed invoice for the month end, a return slip).

**The scope was read from the code, not guessed.** `AGENTS.md` carries a
"Receipt Designer (phases 2–3)" section and `docs/PHASE1_REPORT.md` §6 names
the phase; the master's own Phase 2 wording is not in the repo, so the phase
was defined by the promises the shipped code makes.

## 11. Phase 2 status (as run)

**Phase 2 needed NO new code** — the designer, the library, the migrations,
the IPC surface and the permanent suites were already in the tree. The phase
was therefore a **verification** phase: every promise was checked against the
real code and re-run.

| # | The promise | Status | How it is proven |
|---|---|---|---|
| 2.1 | the design is **opt-in** — an install that never touches it prints byte-identical receipts | **DONE (verified)** | `receipt_design_enabled = 'false'` (migration 055) + the print-path check |
| 2.2 | the **first apply is a visual no-op** | **DONE (verified)** | `defaultReceiptDesign()` reproduces the shipped section order |
| 2.3 | **one model, two processes** | **DONE (verified)** | `src/shared/receiptDesign.ts` is imported by the renderer AND the main process |
| 2.4 | the **preview and the paper agree** | **DONE (verified)** | one builder (`buildDesignedReceiptAsync`) serves both |
| 2.5 | the **money is printed once** | **DONE (verified)** | "NET TOTAL prints the currency exactly once"; no prefix in the item cells |
| 2.6 | the **58 mm roll drops the DISC column** (the DISCOUNT totals row stays) | **DONE (verified)** | the 58 mm layout audit |
| 2.7 | the **library**: 8 built-ins, **no default**, branch beats global, junk dropped, export → import round-trips | **DONE (verified)** | the library checks |
| 2.8 | **nothing escapes the printable width** (80 mm AND 58 mm) | **DONE (verified)** | the layout audit (the same audit `test:print` runs) |

**The phase: `npm run test:receiptdesigner` 73/73 and `npm run test:receipt`
68/68 — every one of the eight promises is carried by a check.**

### What Phase 2 did NOT do (and why)
- **It changed no source file.** The code was already correct and guarded;
  writing new code would have been churn on a live shop's receipt path.
- **It did not choose the shop's default template.** The library ships with
  **no** default on purpose (D23) — that is the owner's decision.
- **It did not judge the printer driver.** Darkness, heat and the
  auto-cutter are the driver's business; the **test print** button prints the
  sample bill for the owner to hold against the roll.

---

# Phase 3 — the purchase-order screen (2026-11-27)

Baseline `v2.32.0` (`main` @ `04c2b71`). The phase report is
`docs/PHASE3_REPORT.md`; the proofs are in `E:\temp\proof\p3_*`.

## 12. Phase 3 scope

The prompt's Phase 3 is the **purchase-order screen hardening**. The items
were **found in the code** (an explore pass over the purchase service, the
import path, the inventory service and the three renderer surfaces), not
guessed from the prompt's wording.

## 13. Phase 3 status (as run)

| # | Item | Status | The defect that was fixed | Proof |
|---|---|---|---|---|
| 3.1 | the catalog carried no units / no last cost | **DONE (new)** | the modal never asked for the units, and enriched only the LOW-stock products | `test:purchaseOrderUi` + `test:purchaseOrderHardening` |
| 3.2 | Backspace deleted the row | **DONE (new)** | the delete handler ignored where the key came from | `test:purchaseOrderUi` (4 checks) |
| 3.3 | a receipt was addressed to a PRODUCT | **DONE (new)** | the requested qty was applied to EVERY line of the product — the stock was received twice | `test:purchaseOrderHardening` |
| 3.4 | an import could be undone after the receipt | **DONE (new)** | the undo took the stock back off the shelf | `test:purchaseOrderHardening` |
| 3.5 | the permission lived only in the sidebar | **DONE (new)** | the IPC handlers accepted any signed-in user | `test:purchaseOrderHardening` (5 checks) |
| 3.6 | the service accepted money the screen refused | **DONE (new)** | the freight / discount / tax / paid-now rules were screen-only | `test:purchaseOrderHardening` + `test:purchaseEnhance` |
| 3.7 | a received order could still be cancelled | **DONE (new)** | the cancel action never looked at what was received | `test:purchaseOrderHardening` |
| 3.8 | the legacy `quantity_received` read as 0 | **DONE (new)** | the new column exists and holds 0, so `COALESCE` read 0 for the old rows | `test:purchaseOrderHardening` + migration `091` |
| 3.9 | the order belonged to no branch / was never updated | **DONE (new)** | `branch_id` was never written; `updated_at` never moved | `test:purchaseOrderHardening` |
| 3.10 | the receipt note leaked between the orders | **DONE (new)** | the note state was not cleared when another order opened | `test:purchaseOrderUi` |
| 3.11 | the screen was hard-coded English | **DONE (new)** | the whole Purchases surface ignored the i18n files | `test:purchaseOrderUi` + the en/ur key-parity check |
| 3.12 | two lines of one product shared a batch number | **DONE (new)** | the batch number came from the product id + a timestamp | `test:purchaseOrderHardening` |

**The whole phase: `npm run test:purchaseOrderHardening` 60/60 and
`npm run test:purchaseOrderUi` 81/81.**

### Three rules that moved into one place
- the **PO money rules** — `validatePo()` in `src/shared/purchaseCalc.ts`
  (the screen and the service call the same function) — D26.
- the **received counter** — `RECEIVED_QTY_SQL` in
  `src/main/services/purchases.ts` (one SQL fragment for every read) — D27.
- **"a batch number IS a batch"** — `inventory.addToBatch()` — D28.

### What Phase 3 did NOT do (and why)
- **A per-permission flag for the purchases** — the code reads the manager
  rank, the same rank the sidebar used (D24). The gap is named in the report.
- **The duplicate-product rule at the service layer** — it stays a screen
  rule, because a service line may legitimately be split by batch (D25).
- **Money as integer paisa** — still deferred (D3).

---

# Phase 4 — the printer pipeline (2026-11-27)

Baseline `v2.32.0` (`main` @ `51a9096`). The phase report is
`docs/PHASE4_REPORT.md`; the proofs are in `E:\temp\proof\p4_*`.

## 14. Phase 4 scope

The prompt's Phase 4 is the **printer pipeline** — the path a receipt takes
from the sale screen to the roll in the shop's printer. The phase-4 printing
features (the preview window, the reprints, the copies, the cut margin, the
drawer kick, the system-default printer) were already in the tree from the
earlier runs; the items below were **found in the code** (an explore pass
over `printService.ts`, `printing.ts`, the IPC layer and the printer
settings screen), not guessed.

## 15. Phase 4 status (as run)

| # | Item | Status | The defect that was fixed | Proof |
|---|---|---|---|---|
| 4.1 | the preview window's Print button was a DIFFERENT print | **DONE (new)** | it called the low-level engine, so the cash drawer never popped and "Reprint last receipt" went back to the PREVIOUS sale | `test:printPipeline` |
| 4.2 | the printer-resolution policy could not be tested | **DONE (new)** | it was a private, DB-reading function — the one function that decides whether the receipt lands on the right device was untestable | `test:printPipeline` (10 checks) |
| 4.3 | the after-print behaviour was in the wrong place | **DONE (new)** | it lived in one call site, not in the print — every other path silently skipped it | `test:printPipeline` (7 checks) |
| 4.4 | the printer settings screen was hard-coded English | **DONE (new)** | `Settings.tsx` had no `useTranslation` at all — the one screen where an Urdu shop sets up its printer | `test:printPipeline` (the en/ur parity) |
| 4.5 | the preview toolbar was hard-coded English | **DONE (new)** | the toolbar is injected by the main process, which cannot read the renderer's i18n files | `test:printPipeline` (the source checks) |
| 4.6 | the receipt template's fit warning | **CHECKED (no change)** | the designed path correctly returns no template warning — the design is resolved FOR the printed paper | the report §2 |
| 4.7 | the settings clamps | **CHECKED + PINNED** | the empty-value case (`Number('') === 0`) would turn the 4mm cut-margin default into no feed | `test:printPipeline` (13 checks) |
| 4.8 | the run's own permanent guards were broken | **DONE (fix)** | the Phase 0 password policy made `test:billAmend`, `test:billAmendItems` and `test:billAmendUi` crash on their stale fixture passwords — found by the 102-suite final battery | the three suites re-run green |
| 4.9 | the "Print Test Page" button threw before it printed | **DONE (new)** | the screen passed `'receipt'` — not a paper key — into `PAPER_SPECS`, so `spec.widthMm` threw; and the A4 sheet always went to the thermal printer | `test:printPipeline` (11 checks) |
| 4.10 | the configured label stock was not the page that printed | **DONE (new)** | the resolver accepted three sizes and fell back to `38x25` for the other five the engine knows | `test:printPipeline` (10 checks) |
| 4.11 | an A5 purchase order went to the till's thermal printer | **DONE (new)** | `paper === 'a4' ? 'invoice' : 'receipt'` — A5 is sheet media | `test:printPipeline` (4 checks) |
| 4.12 | the udhaar entry slip was always 80mm | **DONE (new)** | the roll was hard-coded — a 58mm shop got a slip that does not fit its roll | `test:printPipeline` (4 checks) |
| 4.13 | the Settings panel said "Width: undefined" | **DONE (new)** | the backend sends `paper` + `contentMm`; the renderer asked for a `width` field that never existed | `test:printPipeline` (4 checks) |
| 4.14 | a preview without its toolbar was reported as a success | **DONE (new)** | the injection error was only logged; and the print notes were glued onto a success message the till threw away | `test:printPipeline` (5 checks) |
| 4.15 | the forced "set a new owner password" screen raced the app shell | **DONE (new)** | the flag was fetched AFTER `setUser()`, so the screen arrived a tick late and sat on top of every dialog — `test:ui` went 28/30 | `test:printPipeline` (5 checks) + `test:ui` 30/30 |
| 4.16 | only the receipt + invoice previews spoke the shop's language | **DONE (new)** | the label, purchase-order and statement previews sent no labels | `test:printPipeline` (15 checks) |
| 4.17 | a suite was reading the UTC day instead of the shop's business day | **DONE (fix)** | `test:billAmend` asked for `toISOString().slice(0,10)` — between midnight and 05:00 in Karachi that is yesterday, while the dashboard asks for the business day — the suite went 88/89 at 00:47 | `test:billAmend` 89/89 ALL PASSED |

**The whole phase: `npm run test:printPipeline` 112/112, plus the 15-suite
regression battery (`E:\temp\proof\p4_regr_summary.txt`).**

### The rules that moved into one place
- the **printer resolution** — `resolvePrintTarget()` in
  `src/main/services/printService.ts` (a pure, exported rule) — D32.
- the **after-print behaviour** — `afterPrintActions()` /
  `runAfterPrint()` in the same file (one rule for the direct print, the
  preview and the reprint) — D33.
- the **printer slot of a paper** — `printerKeyForPaper()` (a roll → the
  receipt printer, a sheet → the invoice printer) — D37.
- the **paper of a calibration sheet** — `resolveCalibrationPaper()` — D38.
- the **label stock** — `resolveLabelSize()` (every size the engine knows) —
  D39.
- the **notes of a print** — `PrintResult.warnings` (data, not a glued-on
  string) — D40.
- the **business day** — `currentBusinessDate()` in
  `src/shared/salesHistory.ts` (a suite must never ask for the UTC day) —
  D43.

### What Phase 4 did NOT do (and why)
- **The WhatsApp receipt is still a plain-text document** — sending the
  designed receipt means sending an image or a PDF instead of text, which
  changes what the customer receives (named in the report's risks).
- **The preview window's title is still English** — it is pinned by the spec.
- **The rest of the Settings page and the whole Receipt Designer screen are
  still English** — named surfaces, not accidents; they are the next i18n
  surfaces.
- **The currency policy does not reach every printed document** — an owner
  decision (which symbol / position / decimals), and it changes the
  documents themselves.
- **The Receipt Designer still only designs the receipt** — making it cover
  the invoice, the purchase order, the statement and the credit slip is a
  large feature, not a defect fix.
- **The legacy receipt-template selector is still shown** (and is ignored by
  the printer on a fresh install) — hiding it or wiring it into the library
  is a UX decision that changes two screens.
- **A silent print that times out may open a second dialog** — it touches
  the print queue's timing.
- **Money as integer paisa** — still deferred (D3).

## 16. Phase 5 scope

The prompt's Phase 5 is the **release + the owner checklist + the deploy**. It
does not add features; it **proves the tree, writes what only the owner can
check, and ships it**:

1. the **final battery** — every `test:*` / `check:*` script in
   `package.json` (102 suites) plus the typecheck, each with its own saved
   output, judged by a rule that reads the suite's OWN pass/fail markers;
2. the **owner checklist** — the things no automated test can prove (a real
   printer, a real till, a real customer's money) plus the owner's open
   decisions;
3. the **release notes + the manual test checklist**, both stale;
4. the **desktop release** — the version bump, the installer, the portable
   build, a published GitHub release with a correct `latest.yml` and the
   version-less alias;
5. the **deploy** — the push (the push hook redeploys the Cloudflare Worker)
   and the marketing site.

## 17. Phase 5 status (as run)

| # | Item | Status | What was done | Proof |
|---|---|---|---|---|
| 5.1 | the final battery | **DONE** | every `test:*` / `check:*` script in `package.json` (102) + the typecheck = **103 suites, 103 GREEN**, each with its own saved output | `E:\temp\proof\final_summary.txt` + `final_<suite>.txt` |
| 5.2 | the verdict rule | **DONE (fix)** | the runner's first rule was case-insensitive and unanchored, so two **PASS** lines were read as failures (`test:ipcError`, `test:recovery`); the rule is now strict, and the saved outputs were re-judged from the evidence — every one of the 57 lines in all 103 outputs that mentions a failure was read by hand | `E:\temp\proof\rejudge_final.ps1`, `final_summary_v1_loose_rule.txt` |
| 5.3 | the owner checklist | **DONE** | `docs/OWNER_CHECKLIST.md` — 9 sections + the 11 owner decisions | `docs/OWNER_CHECKLIST.md` |
| 5.4 | the manual test checklist | **DONE (replace)** | it still described v1.5.0; the new file is the v2.33.0 smoke test and points at the owner checklist | `MANUAL_TEST_CHECKLIST.md` |
| 5.5 | the release notes | **DONE (replace)** | it still carried v2.15.1; the new file is the v2.33.0 notes | `RELEASE_NOTES.md` |
| 5.6 | the version bump | **DONE** | `2.32.0` → **2.33.0** (`package.json`; `package-lock.json`'s version field was still `2.21.0`) + the `AGENTS.md` version line | `git log` |
| 5.7 | the desktop release | **DONE** | the NSIS installer + the portable build, published with a `latest.yml` rebuilt from the installer's OWN bytes, the blockmap and the version-less alias | `E:\temp\proof\release_v2.33.0.txt`, `verify_release_v2.33.0.txt` |
| 5.8 | the deploy | **DONE** | the push to `main` (the hook redeploys the Worker) + the site updated to 2.33.0 | `E:\temp\proof\cloud_worker_deploy_v2.33.0.txt`, `vercel_site_v2.33.0.txt` |
| 5.9 | the Worker deploy was broken by Phase 0's credential vault | **DONE (fix)** | the Worker bundles the REAL desktop `src/main/ipc.ts`, so `electron` is aliased to `cloud/src/shims/electron-server.ts`; Phase 0's `secretVault.ts` imports `safeStorage`, which the shim did not export - esbuild refused to bundle and the deploy died. No suite built the Worker, so the 103-suite battery could not see it | `cloud/src/shims/electron-server.ts` (`safeStorage`, `powerMonitor`), `scripts/test_cloudShim.cjs` (13 checks) + `npm run test:cloudShim` |

### The rule that Phase 5 added
- **a suite's verdict comes from the suite's OWN output** — a pass marker AND
  the absence of a failure marker, both **case sensitive and anchored**. A
  suite is never called green on the exit code alone (Electron's stderr banner
  makes Windows report a non-zero exit for a green suite) and never called red
  because a PASS line happened to contain the word "failed".
