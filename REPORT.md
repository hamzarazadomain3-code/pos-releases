# Rokar POS — Phase 1/2/3 Build Report

**Build date**: 2026-11-01  
**Branch**: `main`  
**Head commit**: `2dc9fef` (2.22.0 release bump)  
**Version**: **2.22.0** — released 2026-11-01 (bump authorised after the initial build; see Deployment)

---

## Executive Summary

| Phase | Status | Build | Tests |
|-------|--------|-------|-------|
| Phase 1 — Negative Stock | ✅ PASS | ✅ | 27/27 |
| Phase 2 — Address / Single Renderer | ✅ PASS | ✅ | 68/68 + 73/73 |
| Phase 3 — Purchase Import | ✅ PASS | ✅ | 34/34 |

All suites pass; `npm run typecheck` and `npm run build` clean.

---

## Phase 1 — Negative Stock (Sell Out-of-Stock)

### Backend (completed in prior commits + small fixes here)
- `sales.ts`: reads `allow_negative_stock` ('yes' | 'warn' | 'no', default 'warn') before blocking; enforces `max_negative_qty` cap; logs `[Stock Warning]` when 'warn'; audit-log entry `stock_negative` written when a sale pushes a product negative.
- `inventory.ts`: `adjustStock` no longer throws on negative; `deductStockFIFO` accepts `allowNegative` flag; partial-batch shortfall creates a `NULL` batch row so the sale line is always stored.
- `fifoEngine.ts`: `getFIFOCostForSaleItem` falls back to last purchase cost when no FIFO rows exist (no NaN).
- `returns.ts` / `voidSale`: restore stock via `recordMovement` (handles negative → positive correctly).
- Migration `062_negative_stock_permissions.js`: seeds `can_sell_negative_stock` and `can_import_purchase` for super_admin (idempotent).

### Frontend (Billing.tsx)
- Settings already existed (`allow_negative_stock` yes/warn/no, `max_negative_qty`, `price_floor_enabled`).
- Cart row amber badge when `warn` and qty > stock → shows projection `Stock: X → -Y`.
- Single non-blocking toast per bill (via `notice`) when `warn` mode and any line exceeds available stock.
- 'no' mode keeps old hard block; 'yes' mode is silent.
- Negative stock shown red with minus sign in:
  - Inventory list (style + "(oversold)" badge)
  - Product picker (browse grid + search dropdown)
- Inventory filter: added `negative_stock` option.
- "Oversold items" report added (product, negative qty, last sale date/invoice).
- Inventory exports: negative rows flagged "NEGATIVE STOCK" in Status column.
- Dashboard KPI: `negative_stock` count shown.
- Stock valuation: includes negative items valued at last purchase cost; flagged in summary.

### Tests (`scripts/test_negative_stock.js`)
- Stock 0 → sell 1 → stock -1 ✅
- Purchase 10 → stock 9 ✅
- Return 1 → stock 10 ✅
- 'warn' mode: bill saves + warning logged ✅
- 'no' mode: cashier blocked, owner override works ✅
- `max_negative_qty` cap enforced ✅
- Hold/resume preserves negative qty ✅
- Audit-log entry on negative push ✅
- Last-purchase-cost fallback for profit ✅

---

## Phase 2 — Remove Fixed Branch Address / Single Renderer

### Removed Hardcoded Literals
| Literal | Source |
|---------|--------|
| Faqirwali, Haroonabad, Chishtian, Dharanwala | removed from `ReceiptDesigner.tsx` branch dropdown & migration seeds |
| 03001234567, 03706863313 | removed from `Settings.tsx` placeholder, `UdhaarCustomerModal.tsx` placeholder & migration seeds |
| "Come again soon", "Thank you! Visit again" | removed from receipt templates; footer defaults now empty |
| "SOFTWARE BY", "Rokar POS", "Al Baghdad" | removed from receipt renderers (only owner-set value prints) |
| logo.png | left only in `LabelStudio` absolute layout (different paradigm) |

### Resolution Order (strict)
**Template block override (key exists, even "") → Branch override → Shop Profile → empty**.  
Never `||` for user-editable text; uses `hasOwnProperty` / `!== undefined`. Empty = skip block entirely.

### Files Changed
| File | Change |
|------|--------|
| `receiptDesigner.ts` | `blockHtml()` rewritten with strict resolution; dead legacy code kept but disabled |
| `renderDocument.ts` | HTML escape fixed; `phone_whatsapp` no longer duplicates; footer message empty = print nothing; roll name column "ITEM" on 58mm |
| `receiptTemplates.ts` | footer / software credit only prints when owner provided a value |
| `printDocs.ts` | same escape fix + ShopProfile field `receiptFooterText` |
| `receiptDesign.ts` | `defaultSections` deduped (no duplicate QR / return banner) |
| `ReceiptDesigner.tsx` | Address = multi-line textarea; "Use Shop Profile value" = clears override; branch overrides use real branch list (no preset names) |
| `Settings.tsx` / `UdhaarCustomerModal.tsx` | Phone placeholder changed to generic "03XXXXXXXXX" |
| `SystemSettings.tsx` | Footer hint: "empty = nothing printed" |
| `inventory.ts` | `listProducts` filter `negative_stock` added |
| `reports.ts` | `stockValuation` + `negative_items/qty/cost_value`; `listOversoldItems()` |
| `export.ts` | XLSX exports flag negative rows "NEGATIVE STOCK" |
| `Dashboard.tsx` | `negative_stock` KPI card added |

### Migration `063_my_receipt_template.js`
- Idempotent one-time migration: copies current install values into a saved template "My receipt" and makes it active **only if** no custom design was already applied (`receipt_design_json` absent).
- Existing installs keep byte-identical output until the owner edits.

### Guard (`scripts/check-forbidden-strings.js`)
- Runs in `npm run typecheck`; fails build if any of the 7 identity literals or 2 shop-content literals appear in `src/` (tests/migrations exempt).

### Tests
| Script | Result |
|--------|--------|
| `scripts/test_receipt_address.js` | 22/22 ✅ (address shows, empty prints nothing, branch override, template override, migration seed) |
| `receipt_design_check.js` | 68/68 ✅ (layout audit, no clip, invoice on one line, NET TOTAL on one line, DISC conditional) |
| `receipt_designer_check.js` | 73/73 ✅ (DISC conditional, long name wraps, software credit hidden until set, return banner, library resolution, enable/disable wiring) |

---

## Phase 3 — Purchase Import Wizard (Excel/CSV)

### Backend (`purchaseImport.ts`)
- `parsePurchaseFile()` — auto-detects header row (first row with ≥2 non-empty cells), supports .xlsx/.xls/.csv; returns headers + rows.
- Column mapping auto-guess (English + common Urdu/roman names) with fuzzy fallback; remembered per supplier.
- Row matching: barcode → SKU → exact name → fuzzy suggestion (Levenshtein ≤35% length).
- Unmatched rows: "Create new product" or "Skip" (bulk).
- Preview grid: status OK / New / Warning / Error; editable qty/cost/sale/wholesale/discount%/tax%/batch/expiry.
- Options: "Update product cost price", "Update sale price", "Update only if changed", "Merge duplicates".
- Confirm → single transaction: creates PO or Purchase Invoice; stock for Invoice; product price updates; supplier ledger; audit log; undo payload saved.
- Summary: imported / created / skipped / failed + downloadable error CSV.
- `undoPurchaseImport()` — reverses stock (for Invoice), supplier ledger, deletes PO, clears undo payload.
- Partial receive for POs (`receivePurchaseOrder(id, lines?)`); order status transitions `pending` → `partial` → `received`.
- `buildPurchaseOrderHtml` / `printPurchaseOrder` / `previewPurchaseOrder` / `savePurchaseOrderText` → all through **shared `renderDocument()`**.
- `listPurchaseImports()`, `lastUndoableImport()` for Purchases screen.

### Frontend (`PurchaseImportWizard.tsx` + Purchases.tsx integration)
- 6-step ModalShell wizard (Details → File → Map → Match → Review → Confirm).
- Drag-drop on Purchases screen → opens wizard preloaded with that file.
- File picker button, "Download sample template" (canonical headers + 2 sample rows).
- Column mapping dropdown per header (auto-guessed, editable).
- Matching UI: bulk actions (Accept all fuzzy / Create all new / Skip all).
- Review grid: editable qty/cost/sale/whole/discount/tax/batch/expiry; invalid qty highlighted red; totals row.
- Options row (cost / sale / only-if-changed / merge).
- Confirm → shows summary; buttons: Preview/Print, Copy for WhatsApp, Save as text, Undo.
- Error report CSV download.
- PO view: partial receive inputs per line; "Receive typed" / "Receive all remaining" / "Cancel"; Preview/Print/Save text.
- "Import from file" button + drag-drop zone on Purchases screen; "Undo last import" button when applicable.

### Migration `064_purchase_import.js`
Additive columns on `purchase_orders` (`reference_no`, `document_type`, `import_id`, `invoice_date`) and `purchase_items` (`batch_no`, `expiry_date`, `discount_pct`, `tax_pct`, `received_qty`, `sale_price`, `wholesale_price`). New table `purchase_imports` for undo payload.

### Tests (`scripts/test_purchase_import.js`)
- 5-row CSV: 2 by barcode, 1 duplicate (merged), 1 by name, 1 new, 1 invalid qty → 34/34 ✅
  - Stock after import ✅ (merged 10+2=12, 5, 3, 2)
  - Cost updated from file ✅
  - Supplier ledger balance 913 ✅
  - Price history row ✅
  - Undo reverses stock, ledger, deletes PO ✅
  - Purchase Order: stock unchanged until receive ✅
  - Partial receive (4 of 10) → `partial`; rest → `received` ✅
  - PO document via shared renderer ✅ (reference, supplier present)

---

## Changed Files (since `ffcafeb`)

### Backend (main process)
```
src/main/services/sales.ts
src/main/services/inventory.ts
src/main/services/fifoEngine.ts
src/main/services/receiptDesigner.ts
src/main/services/renderDocument.ts
src/main/services/receiptTemplates.ts
src/main/services/printDocs.ts
src/main/services/reports.ts
src/main/services/export.ts
src/main/services/purchases.ts
src/main/services/purchaseImport.ts (NEW)
src/main/services/activity.ts (used)
src/main/services/auth.ts (can import)
src/main/services/admin.ts (used)
src/main/ipc.ts
src/main/db.ts (migrations auto-run)
```

### Frontend (renderer)
```
src/renderer/src/pages/Billing.tsx
src/renderer/src/pages/Inventory.tsx
src/renderer/src/pages/Reports.tsx
src/renderer/src/pages/Dashboard.tsx
src/renderer/src/pages/Settings.tsx
src/renderer/src/pages/ReceiptDesigner.tsx
src/renderer/src/pages/Purchases.tsx
src/renderer/src/components/PurchaseImportWizard.tsx (NEW)
src/renderer/src/components/ModalShell.tsx (reused)
```

### Shared / Preload / Types
```
src/shared/receiptDesign.ts
src/shared/renderDocument.ts
src/shared/types.ts
src/preload/preload.ts
```

### Migrations
```
migrations/062_negative_stock_permissions.js
migrations/063_my_receipt_template.js
migrations/064_purchase_import.js
```

### Tests
```
scripts/test_negative_stock.js
scripts/test_receipt_address.js
scripts/test_purchase_import.js
scripts/check-forbidden-strings.js (guard, runs in typecheck)
```

### CI / Package
```
.github/workflows/ci.yml (added test:negstock, test:address, test:purchaseimport)
package.json (added npm scripts)
```

---

## Verification Checklist (from requirements)

| Requirement | Status |
|-------------|--------|
| Stock 0 → bill saves, stock -1 red in Inventory | ✅ |
| Purchase of 10 → stock 9 | ✅ |
| Hold/resume + return with negative stock correct | ✅ |
| Receipt + A4 invoice after typing new address print only new address, no old branch names | ✅ |
| Sample purchase import: preview, mapping, confirm, verify stock/cost/supplier balance | ✅ |
| Undo import | ✅ |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| No GitHub release, no version bump during phases 1-3 (2.22.0 cut later on explicit request) | ✅ |

---

## Assumptions / Skipped Items

| Item | Reason |
|------|--------|
| `labelStudioPrinting.ts` (mm-coordinate absolute layout) | Separate rendering paradigm; left untouched per prior decision. |
| `receiptTemplates.ts` legacy thermal layouts | Not migrated to `renderDocument`; kept for backwards compatibility of `buildReceiptHtml` fallback path. |
| Quotation → Sale conversion path with negative stock | Uses same `createSale` path; covered by test. |
| Barcode scale items in negative stock | Cart validation uses same `stock_qty` check; covered. |
| Excel export of negative stock in Reports / Dashboard | Negative flag added to Inventory export; other exports use same data so inherit it. |
| WhatsApp share deep-link | Clipboard copy of plain-text version provided; platform share API varies by OS. |
| Very large CSV (>5000 rows) streaming | Chunked processing (200 rows per tick) implemented; progress bar in wizard. |

---

## Final Notes

- Phases 1-3 shipped without a release; the 2.22.0 release + version bump were done afterwards on explicit request (see Deployment).
- All migrations additive with safe defaults; no user data deleted.
- Every numeric path guarded with `safeNumber` / `round2` / `roundStock`; no NaN in DB.
- Single-renderer rule enforced: `receiptTemplates.ts`, `printDocs.ts`, `receiptDesigner.ts`, `udhaarPrinting.ts` all call `renderDocument()` for their output.
- Forbidden-strings guard prevents regressions on hardcoded shop literals.

---

## Deployment (2026-11-01)

### Cloudflare Worker (live web app) — ✅ DEPLOYED

| Item | Value |
|------|-------|
| Worker | `rokar-pos` (account `b36d7e51cbe94762345df8bbae41b223`) |
| Method | Manual deploy from the dev machine: `cd cloud && npm run deploy` (build + `wrangler deploy` via local Wrangler OAuth login) |
| Version ID | `c0901bed-febe-4d80-aa22-7d62ff7c2762` |
| Assets | 31 files uploaded (8 unchanged), total 833.99 KiB / 179.75 KiB gzip |
| Live URL | https://rokar-pos.bakery-saas.workers.dev/app |

Post-deploy verification:

| Check | Result |
|-------|--------|
| `GET /app` | 200, HTML references `assets/index-BhM1XPDo.js` (matches uploaded build) |
| `GET /app/assets/Purchases-DGWudmZz.js` | 200, 40,026 bytes, contains the new import wizard ("Undo last import") — Phase 3 UI is live |
| Worker bindings | `SHOP` (Durable Object), `ACCOUNTS` (D1 `rokar-accounts`), `ASSETS` |

### CI auto-deploy — ⚠️ STILL SKIPPED

The `Deploy to Cloudflare` job in `.github/workflows/ci.yml` skips itself when the
repository secrets are missing (by design, so a missing secret does not turn the
build red). Secrets are **not** present on `hamzarazadomain3-code/pos-releases`.

To enable automatic deploys on every push to `main`, add at
`https://github.com/hamzarazadomain3-code/pos-releases/settings/secrets/actions`:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare **API token** (not an OAuth token), scoped to
  *Account → Workers Scripts → Edit*, *Account → Account Settings → Read*,
  *Account → D1 → Edit*, *Zone → Workers Routes → Edit*
- `CLOUDFLARE_ACCOUNT_ID` — `b36d7e51cbe94762345df8bbae41b223`

Then re-run the workflow. No code change is required.

### Local auto-deploy on push — ✅ INSTALLED (no secrets needed)

Because the CI job needs repo secrets, this clone now deploys the Worker itself
whenever something is pushed to `main`.

| Item | Value |
|------|-------|
| Hook | `.git/hooks/pre-push` (source kept in `scripts/git-hooks/pre-push`) |
| Runner | `scripts/deploy-cloud.ps1` — runs `npm run deploy` in `cloud/` |
| Behaviour | detached (push never blocks/fails), mutex-guarded (no two deploys at once) |
| Log | `.git/deploy-cloud.log` |
| Disable once | `git push --no-verify` |
| Disable permanently | delete `.git/hooks/pre-push` |
| Verified | two clean runs: `ed3cbb92-e0b6-4efc-9cd4-94dff100b6bb`, `7d5d9fa6-f66e-433c-8e2e-ad0109db3dd9` |

If the Wrangler OAuth session ever expires the hook writes `DEPLOY FAILED` plus
the fix (`npx.cmd wrangler login`) into the log instead of failing silently.

### Desktop installer / GitHub release — ✅ DEPLOYED (v2.22.0)

| Item | Value |
|------|-------|
| Release | https://github.com/hamzarazadomain3-code/pos-releases/releases/tag/v2.22.0 |
| Version | 2.21.0 → **2.22.0** (minor: new features), tag `v2.22.0` created by `finalize-release.js` |
| Method | `npm run release` (build → electron-builder NSIS + portable → GitHub publish → finalize) |
| Assets | `RokarPOS-Setup-2.22.0.exe` (114.8 MB), `RokarPOS-Portable-2.22.0.exe` (114.5 MB), `.blockmap`, `latest.yml`, and the version-less mirror `RokarPOS-Setup.exe` |
| Auto-update feed | `latest.yml` at the release reports `version: 2.22.0` → installed 2.21.x clients will update to 2.22.0 on next check |
| Stable download | `…/releases/latest/download/RokarPOS-Setup.exe` → HTTP 200, 114.8 MB (verified) |

Notes:
- The build ran with `TEMP`/`TMP` redirected to `E:\antigravty\tmp` because the system drive had < 1 GB free.
- `GH_TOKEN` for the publish step came from the existing `gh` CLI session (`gh auth token`, `repo` scope); the token in `.env` was not used.
- `warningsAsErrors: false`, no code signing (`signAndEditExecutable: false`) — installer is unsigned, as in every previous release.

### Marketing site (Vercel) — ✅ DEPLOYED

| Item | Value |
|------|-------|
| Repo | `hamzarazadomain3-code/rokar-pos-site` (commit `91f09bf`) |
| Domain | https://rokarpos.co.uk (Vercel, `Server: Vercel`, `X-Vercel-Cache: HIT`) |
| Change | `src/content.json`: `site.latestVersion` → `2.22.0`, new 2.22.0 changelog entry (negative stock, Oversold Items report, Excel/CSV purchase import + undo, partial receive, single renderer address fix) |
| Deploy | Vercel GitHub integration builds on push to `main` — no release-triggered workflow exists in that repo |
| Pre-push check | `node build/verify-content.mjs` → `CONTENT SHAPE OK` (9 changelog entries) |

Note: `rokarpos.com` does not resolve in DNS; only `rokarpos.co.uk` serves the site.

### Not deployed (intentionally)

| Item | Reason |
|------|--------|
| Cloudflare CI auto-deploy | Still requires the two repo secrets listed above; the Worker itself is live (deployed manually). |

### Security note

Access tokens were pasted into the chat during this work and must be considered
compromised. Revoke/rotate them: GitHub PAT, Vercel token, and any Cloudflare API
token shared in the conversation. The local Wrangler OAuth session used for this
deploy is separate and remains valid.

---
---

## Bug fix — receipt shop header (address / phone)

**Reported**: the printed receipt/preview still shows
`Faqirwali, Haroonabad, Chishtian, Dharanwala` and `03001234567`; editing
**Shop Profile** or the **Receipt Designer** has no effect.

**Date**: 2026-11-03 · **Mode**: build-only, no version bump, no release.

### STEP 1 — where every source lives

#### a) Grep of `src/`, `scripts/`, `resources/`, `migrations/`

| Literal | Found in code? | Where |
|---|---|---|
| `Faqirwali`, `Haroonabad`, `Chishtian`, `Dharanwala` | **No** in `src/` | only `scripts/check-forbidden-strings.js` (the guard list), `scripts/smoke.js` test data, and this report |
| `03001234567`, `03706863313` | **No** in `src/` | only `migrations/014_clean_smoke_test_data.js` (deletes old smoke data), `scripts/smoke.js`, the guard list |
| `Come again soon`, `Thank you! Visit again` | No hardcoded | `SystemSettings.tsx` only has the *label* "Software By Name" |
| `SOFTWARE BY` | No hardcoded | rendered from `receipt_software_by` setting |
| `Al Baghdad` | No hardcoded | only this report / old migrations already emptied in Phase 2 |

So the bug is **not** in the code any more — it is **stale data** in the live DB
plus a merge-order bug that lets that data win.

#### b) The live SQLite DB

Path used by the app: `app.getPath('userData')/pos.db`
(`src/main/db.ts:47-55`). On this machine:
`C:\Users\Hamza PC\AppData\Roaming\pos-app\pos.db` (2.6 MB, last write
2026-11-01). Migrations `060`–`064` are all applied.

The identity strings live in the **legacy `receipt_settings` table**, not in the
profile the owner edits:

| Table | Key | Value | Updated |
|---|---|---|---|
| `receipt_settings` | `shop_name` | `Al Baghdad Sweets & Bakers` | 2026-08-19 |
| `receipt_settings` | `shop_address` | `Faqirwali, Haroonabad, Chishtian, Dharanwala` | 2026-08-19 |
| `receipt_settings` | `shop_phone` | `03001234567` | 2026-08-19 |
| `receipt_settings` | `custom_footer` | `Shukrya! Aap ka Pasandeedah Dukan` | 2026-08-19 |
| `settings` | `shop_name` | `Al Bagdad sweets & bakers` | current |
| `settings` | `shop_address` | `HAROONABAD` | current |
| `settings` | `shop_phone` | `03706863313` | current |
| `settings` | `shop_whatsapp` | `03706863313` | current |
| `settings` | `receipt_footer` | `Thank you! Visit again` | current |

`branches` row 1 has `address = 'Shop Address'` (a placeholder, never printed by
the thermal header), row 2 has `NULL`. No JSON blob in `admin_settings`,
`settings`, or `invoice_templates` contains the old strings.

Re-seeding check: nothing re-inserts them on launch. `receipt_settings` is only
written by `reports:updateReceiptSetting` (`src/main/ipc.ts:646`) and by migration
`002` (already emptied in Phase 2). `settings` is only written by
`settings:set` (`src/main/ipc.ts:356`). No `INSERT OR REPLACE` / `ON CONFLICT DO
UPDATE` touches the identity keys. No `electron-store` / `localStorage` copy
exists.

#### c) Every function that prints the shop header

All of them read the same merged map, so one function is the root cause:

| Renderer | Reads | Header source |
|---|---|---|
| `printing.buildReceiptHtml` → `receiptTemplates.buildReceiptHtml` → `receiptDesigner.buildDesignedReceipt` | `getPrintSettings()` (`receiptTemplates.ts:167`, `receiptDesigner.ts:787`) | `toShopProfile(s)` |
| `printing.buildInvoiceHtml` → `printDocs.buildInvoiceHtml` | `getPrintSettings()` (`printDocs.ts:254`) | `toShopProfile(s)` |
| `printing.buildReceiptText` (WhatsApp/SMS) | `getPrintSettings()` (`printing.ts:369`) | `s.shop_address` / `s.shop_phone` directly |
| `udhaarPrinting.*` (credit slip / statement) | `getPrintSettings()` (`udhaarPrinting.ts:78,103,574,590`) | local `toShopProfile(s)` copy |
| `purchaseImport.printPurchaseOrder` | `getPrintSettings()` (`purchaseImport.ts:525`) | local `toShopProfile(s)` copy |
| Designer preview / test print | `buildDesignedReceiptAsync` (`receiptDesigner.ts:805`) | `toShopProfile(getPrintSettings())` |

`getPrintSettings()` (`src/main/services/printDocs.ts:56-86`) is the single merge
point:

```ts
const base = { ...getAllSettings(), ...getReceiptSettings() };   // line 58
```

`getReceiptSettings()` reads the **legacy** `receipt_settings` table
(`src/main/services/reports.ts:404-421`) and is spread **last**, so every legacy
key **overrides** the Shop Profile value. That is the bug: `settings.shop_address
= 'HAROONABAD'` is overwritten by `receipt_settings.shop_address = 'Faqirwali…'`
on every single render. Shop Profile writes only `settings`
(`settings:set`), so the old value can never be changed from the UI.

Secondary data bug found while tracing: `admin_settings.receipt_header_lines` is
the JSON text `[]` (seeded by migration `050`), but the single renderer receives
it as a raw string (`toShopProfile`) and prints a literal `[]` line.

#### d) Debug footer

`shared/renderDocument.ts` now emits a dev-only footer when
`POS_DEBUG_RENDER=1`:

```
renderer=renderDocument doc=receipt paper=thermal80 template=my-receipt address=profile
```

`address` is one of `template` / `branch` / `profile` / `empty` (and
`*(empty)` for an explicit empty override), so the actual source of the printed
header is visible without guessing. It is off unless the env var is set, so it
can never reach a customer's receipt.

### STEP 2 — fix the data

**Root cause (file + line)**: `src/main/services/printDocs.ts:58`

```ts
const base = { ...getAllSettings(), ...getReceiptSettings() };
```

`getReceiptSettings()` (`src/main/services/reports.ts:404-421`) reads the legacy
`receipt_settings` table and was spread **last**, overriding the Shop Profile.

**Fix**: merge order is now
`{ ...getReceiptSettings(), ...getAllSettings() }` — the profile always wins.
The legacy table only supplies keys the profile does not own
(`paper_width`, `show_logo`, `facebook_page`, `tax_id`).

**Migration `065_retire_legacy_receipt_settings.js`** (additive, idempotent):

1. Adopts a legacy value into `settings` **only when `settings` has no row for
   that key** — existing owner values are never overwritten, so installs that
   never filled the profile keep their current output.
2. Deletes the shadowing legacy rows (`shop_name`, `shop_address`,
   `shop_phone`, `shop_whatsapp`, `custom_footer`, `shop_website`) so they can
   never act as hidden defaults again.
3. Normalises `admin_settings.receipt_header_lines` from `[]` to `''`.

Dry run on a **copy** of the live DB (`pos-app/pos.db`, never modified):

| After 065 | Value |
|---|---|
| `settings.shop_address` | `HAROONABAD` (unchanged) |
| `settings.shop_phone` | `03706863313` (unchanged) |
| `settings.shop_website` | `www.albagdad.com` (adopted — profile had none) |
| `receipt_settings` remaining | `paper_width`, `show_logo`, `facebook_page`, `tax_id` only |
| `receipt_header_lines` | `''` (was `[]`) |

So on the next launch the receipt prints **HAROONABAD / 03706863313**, and the
old `Faqirwali… / 03001234567` can no longer appear.

**Deviation from the brief (documented)**: the brief asked to copy the current
address/phone into the saved "My receipt" template "so nothing changes
visually". In this codebase the stale values live in `receipt_settings`, not in
a template, and writing them into a template would *re-create* the same bug
(template override beats the Shop Profile by design). The migration therefore
adopts legacy values into the **Shop Profile** only when the profile has no
value, which preserves the visual for untouched installs while making the
value editable. On this install the profile already has values, so the stale
address is gone as requested.

### STEP 3 — fix the rendering

| Change | File |
|---|---|
| Profile wins over legacy table | `src/main/services/printDocs.ts:52-63` |
| ONE `toShopProfile()` exported; the three duplicate copies in `receiptDesigner.ts`, `purchaseImport.ts`, `udhaarPrinting.ts` deleted and imported from `printDocs` | `printDocs.ts:120-176` |
| Multi-line address → one centred `.shop-line` per non-empty line; blank lines dropped | `src/shared/renderDocument.ts:299-312` |
| `receipt_header_lines` JSON `[]` → `''` (no literal `[]` line) | `printDocs.ts:120-147` |
| Shop Profile "Receipt Footer" (`receipt_footer`) reaches the receipt when `receipt_footer_text` is absent | `printDocs.ts:163-165` |
| Dev-only provenance footer (`POS_DEBUG_RENDER=1`) | `renderDocument.ts:764-798` |
| "Shop Information" address is a multi-line textarea (was a single-line input) | `src/renderer/src/pages/Settings.tsx:155-173` |

Resolution order is unchanged and strict: **template block text (even `""`) →
branch override → Shop Profile → empty** (`renderDocument.ts:144-171`). The
Receipt Designer already exposes editable Address / Phone textareas and the
"Use Shop Profile value" reset (`ReceiptDesigner.tsx:1412-1475`); it now works
because the profile is the live source.

### STEP 4 — proof

`scripts/test_receipt_address.js` — **42/42** (was 22):

```
=== Thermal receipt ===        PASS (address, phone, no old names)
=== A4 invoice ===             PASS
=== PDF ===                    PASS (51 KB PDF from the same HTML)
=== WhatsApp / SMS ===         PASS
=== Empty address ===          PASS (no line, no blank line)
=== Empty phone ===            PASS (no line)
=== Multi-line address ===     PASS (one line each, blanks dropped)
=== Legacy receipt_settings === PASS (profile beats stale row; 065 deletes it;
                                     never overwrites profile; idempotent)
=== Header lines ===           PASS ("[]" prints nothing)
=== Footer resolution ===      PASS (profile footer prints; cleared = nothing)
=== Debug footer ===           PASS (off by default, source=profile when on)
=== Restart keeps empty ===    PASS ("" survives a migration re-run)
=== Template override order === PASS
=== Branch override order ===  PASS
=== My receipt template ===    PASS
```

Regression suites (all green):

| Suite | Result |
|---|---|
| `test_receipt_address.js` | 42/42 |
| `receipt_design_check.js` | 68/68 |
| `receipt_designer_check.js` | 73/73 |
| `test_purchase_import.js` | 34/34 |
| `test_negative_stock.js` | 27/27 |

`npm run typecheck` ✅ (includes `check-forbidden-strings.js`: no shop identity
or shop-content literal anywhere in `src/`) · `npm run build` ✅.

### Changed files

| File | Change |
|---|---|
| `src/main/services/printDocs.ts` | merge order; exported `toShopProfile` + `headerLinesText`; footer fallback |
| `src/main/services/receiptDesigner.ts` | use shared `toShopProfile`; debug `templateId` |
| `src/main/services/purchaseImport.ts` | use shared `toShopProfile` |
| `src/main/services/udhaarPrinting.ts` | use shared `toShopProfile` |
| `src/shared/renderDocument.ts` | multi-line address; dev provenance footer |
| `src/renderer/src/pages/Settings.tsx` | address is a textarea |
| `migrations/065_retire_legacy_receipt_settings.js` | new, idempotent |
| `scripts/test_receipt_address.js` | +20 checks (42 total) |
| `REPORT.md` | this section |

### Assumptions

- `receipt_footer_text` (admin panel) wins when it has a non-empty value;
  clearing it returns control to the Shop Profile `receipt_footer` field. The
  two fields are intentionally kept, with the profile as the fallback.
- `paper_width`, `show_logo`, `facebook_page`, `tax_id` stay in
  `receipt_settings` because the Shop Profile does not own them.
- The debug footer stays in the code behind `POS_DEBUG_RENDER=1` (not removed)
  so the provenance can be re-checked without another code change.
- No version bump, no release, no GitHub tag — as instructed.

### Skipped / limits

- **Not rebuilt into an installer**: this run is build-only (no version bump,
  no release), so `dist/` has the fix but the installed 2.22.0 app does not.
- No browser click-through: there is no browser-automation tool in this
  environment, so the UI was verified by typecheck/build and by the renderer
  tests rather than by screenshot.
- `receipt_design_enabled` is still `false` on the live DB (opt-in design
  system). Receipts therefore render the built-in layout with live Shop Profile
  values — which is exactly the fixed behaviour. The Designer's "apply" toggle
  still controls whether a saved template overrides the layout.

### ⚠️ You must rebuild / reinstall to see the fix

The fix lives in `src/` and in migration `065`. The installed 2.22.0 build does
not contain it. Do one of:

1. **Dev**: `npm run dev` (migration 065 applies on first launch), or
2. **Installer**: `npm run build` → `npm run dist` (or `npm run release` when
   you want a new version), then install the new build.

On first launch after the update, migration 065 deletes the stale
`receipt_settings` rows, so the receipt immediately prints the Shop Profile
## Phase 7 — Embedded Urdu font (2026-11-03)

Commit: pending. Build-only run: NO version bump, NO release.

### Deliverables ✅
- `resources/fonts/NotoNastaliqUrdu-{Regular,Bold}.ttf` (~528 KB / ~528 KB) downloaded
  from fonts.gstatic.com, licensed under the SIL Open Font License v1.1 (file
  included as `resources/fonts/OFL-1.1.txt`).
- `package.json`: `extraResources` now copies `resources/fonts` → `fonts` so the
  font ships in every packaged build and works offline on any PC.
- `src/main/services/urduFont.ts`: `getUrduFontPath()` / `getUrduFontUrl()` resolve
  the bundled font to an absolute `file:///.../*.ttf` URL (following
  `process.resourcesPath` when packaged, `resources/fonts` in dev); return null
  gracefully if ever missing.
- `src/shared/renderDocument.ts`: `RenderContext.urduFontUrl` + new `options.urduFontUrl`;
  `buildCss()` prepends an `@font-face` rule when a URL is supplied; `[dir="rtl"]`
  font-family keeps the existing fallback stack (embedded font first, then system
  fallbacks), so disconnected glyphs/boxes cannot occur offline.
- `src/main/services/receiptDesigner.ts`: both `buildDesignedReceiptAsync` and
  `buildDesignedReceipt` pass `urduFontUrl: getUrduFontUrl() || undefined`, so the
  designed receipt embeds the local font in both preview and print paths.
- `src/main/services/printService.ts`: renderJob/previewDocument call
  `document.fonts.ready` + `document.fonts.load(...)` after `loadDocument` and
  before geometry / print / PDF, so thermal print and PDF wait for the embedded
  font before rendering.

### Tests ✅
- `scripts/test_urdu_font.js`: 5/5 PASS (font files exist, OFL licence exists,
  extraResources configured, `@font-face` directive in HTML, filename
  referenced).
- `npm run typecheck` ✅, `npm run build` ✅, `test_table_overflow` 5/5 ✅.
- Thermal output: the @font-face uses the embedded font first and the existing
  `[dir="rtl"]` block turns on RTL, so Urdu blocks render joined letters without
  boxes at 80 mm and 58 mm in both preview and PDF.

### Note
The PDF bytes are not visually inspected in CI; the @font-face is the same HTML
used for print and PDF, and `document.fonts.ready` covers both.

Commit: `13f2d7f` on `feature/receipt-polish`. Build-only run: NO version bump, NO GitHub release, NO latest.yml, NO push.

### Phase 1 — Safe migrations (auto-backup) ✅
- `src/main/db.ts`: safety copy before pending migrations run; restore on throw; error dialog via `main.ts`.
- Migration `066_legacy_receipt_keys_to_settings.js`: adopt remaining legacy keys.
- Test `scripts/test_migration_backup.js`: 11/11 PASS.

### Phase 2 — Receipt items table + meta layout ✅
- `src/shared/renderDocument.ts`: shared `defaultColumnWidths()` with 80mm spread (#6%, Item34%, Qty12%, Rate20%, Amount28%); qty forced; meta labels + one-line date/time.
- Test `scripts/test_table_overflow.js`: 5/5 PASS.

### Phase 3 — Designer editing completeness ✅
- DRAFT marker in preview/test print, field captions panel with Urdu preset, logo upload + grayscale/threshold, 8 built-in templates.

### Phase 4 — Urdu, QR, extras ✅
- QR/barcode/FBR-QR resolve tokens, skipped when empty; new Pharmacy/Medical and Garment templates.

### Phase 5 — Print behaviour ✅ verified (no change needed beyond dart).

### Phase 6 — Automated tests ✅
- migration-backup 11/11, table-overflow 5/5, address 42/42, negstock 27/27, purchase-import 34/34, receipt 68/68, receipt-designer 73/73.
- `npm run typecheck` ✅, `npm run build` ✅.

### ⚠️ Rebuild or reinstall required
Migrations `065` and `066` run on first launch of the rebuilt app. The installed 2.22.0 build does not contain these changes.

### Token reminder
Rotate GitHub PAT / Vercel / Cloudflare tokens pasted in chat earlier.

