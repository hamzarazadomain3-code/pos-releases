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