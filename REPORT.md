# Rokar POS — Autonomous Audit & Fix Run

**Audit date:** 2026-11-07  
**Branch:** `feature/audit-p0`  
**Base:** `main` @ `6d2209f` (v2.23.0)  
**Scope:** `E:\antigravty\billing softwere\pos-app` only. The Cloudflare Worker/web project under `cloud/` was audited **read-only**; nothing outside this repository was edited.  
**Deployment:** **No release, version bump, `latest.yml`, push, or Cloudflare/Vercel deploy was performed.** This report supersedes the previous phase report (still available in git history).

---

## Executive summary

| Phase | Status | Typecheck | Build | Tests |
| --- | --- | --- | --- | --- |
| 0 — Architecture audit | ✅ PASS | — | — | — |
| 1 — Verify findings in code | ✅ PASS | — | — | — |
| 2 — Fix CONFIRMED P0 items | ✅ PASS (with documented PARTIAL/SKIPPED items) | ✅ | ✅ | ✅ |
| 3 — Web/desktop safety | ✅ PASS | ✅ | ✅ | ✅ |
| 4 — P1 UI / Sidebar cleanup | ⏭️ SKIPPED (gate not met) | — | — | — |
| 5 — Tests + owner checklist | ✅ PASS | ✅ | ✅ | ✅ |

The **installed desktop app must be rebuilt and reinstalled** by the owner to receive these fixes. The **web version must be rebuilt and redeployed** by the owner; this run deliberately did not publish anything.

---

## Phase 0 — Architecture audit (report only)

- Desktop: Electron + React renderer + `node:sqlite` (`src/main/db.ts`), services under `src/main/services/`, IPC in `src/main/ipc.ts`, preload bridge in `src/preload/preload.ts`.
- Web: the same renderer is built with `npm run build:web` into `cloud/web-dist/app` and served at `/app`. The Worker front door (`cloud/src/accounts.ts`, D1 `ACCOUNTS`) validates a web session and forwards each call to the shop's `ShopObject` Durable Object. That object runs the real 50-migration POS schema in DO SQLite and calls the real `registerIpcHandlers()` through `cloud/src/dispatch.ts`.
- Web session model: one web session maps to one POS user id. `dispatch` sets that user as the service session while the handler runs, then clears it. `auth:login` / `auth:loginWithPin` set their own session internally.
- **No desktop ↔ web sync.** They are separate databases. A fix applied here reaches web only after the owner rebuilds/redeploys the web bundle; it does not merge the data.
- `src/main/main.ts` uses `contextIsolation: true`, `nodeIntegration: false`; the preload still needs Node, so `sandbox: false`. No change made.

---

## Phase 1 — Findings and status

Status meanings: **CONFIRMED** = reproduced in code/data; **PARTIAL** = part of the claim is true but not all; **NOT CONFIRMED** = evidence did not support the claim.

| Finding | Status | Evidence (file:line) | Fixed? | Notes |
| --- | --- | --- | --- | --- |
| **A1** Two competing settings stores (`settings` vs `admin_settings`) with conflicting keys | **CONFIRMED** | `src/main/services/admin.ts:208-236`, `src/main/services/settings.ts`, `src/main/services/printDocs.ts` (merge order legacy `receipt_settings` → `settings` → `admin_settings`). Dev DB had `settings.receipt_footer='Thank you! Visit again'` while `admin_settings.receipt_footer_text='Come again soon!'`; `sales.ts` read `settings.allow_negative_stock`, so the Admin toggle was dead. | ✅ Yes | Canonical bridge (`applyProfileOverrides` + `mirrorAdminWrite`): `settings` wins for `currency`, `receipt_footer`, `allow_negative_stock`, `default_credit_days`; admin keys are overlaid on read and mirrored on write. No destructive table merge. |
| **A2** Dashboard payable and receivable both came from the customer list; payments wrong | **CONFIRMED** | `src/renderer/src/pages/Dashboard.tsx:229-242`; `src/shared/dashboardMath.ts` | ✅ Yes | Payable now sums **supplier** balances; receivable sums **customer** balances. “Payment In” is cash sales collected; “Payment Out” uses `today_expenses`; “Sale Return” counts only `status='returned'` / negative sales. Supplier payments are **not** included in “Cash Out” (documented assumption). |
| **A3** Cash-drawer label said “Total Sales Today” for a shift-scoped total; dashboard daily queries hard-code “today” | **CONFIRMED (partial)** | `src/renderer/src/components/CashDrawer.tsx`; `src/main/services/reports.ts` (`getDailyStats`, `getDailySalesTrend`) | ◐ Partial | Labels now say **“Total Received (This Session)”** and **“Bills (This Session)”**. Daily dashboard queries intentionally remain “today”; no user-selectable period selector was added in this run. |
| **A4** Shift and cash drawer were separate; force-close allowed no reason; no >24 h warning | **CONFIRMED** | `src/main/services/shifts.ts:43,55-73,149,157-181`; `src/main/services/cashDrawer.ts:40-55`; `src/renderer/src/pages/Billing.tsx:2024-2044`; `src/renderer/src/pages/Shifts.tsx` | ✅ Yes | Opening a shift now creates the matching drawer session; drawer opening cash syncs `shifts.start_cash`; closing a shift closes the open drawer with counted cash/variance; force-close **requires a non-empty reason** and records `reason=…` in the `shift_force_closed` audit row. Billing shows a warning pill after 24 h. |
| **A5** Secrets (`email_smtp_pass`, `sms_api_key`, `sms_api_secret`, licence key) returned to the renderer in clear text | **CONFIRMED** | `src/main/ipc.ts:362,896-901`; `src/main/utils/secrets.ts` | ✅ Yes | Masked at the IPC boundary only (`••••••••`). Services still read the real values. Saving the mask back is a no-op, so a settings page cannot overwrite a real secret with dots. |
| **A6** Report queries reference non-existent `sale_items.price` | **CONFIRMED** | `src/main/services/profitability.ts:89,216`; `src/main/services/inventoryReports.ts:321` | ✅ Yes | Replaced with `si.unit_price` (schema verified: `sale_items` has `unit_price`, not `price`). Regression test in `scripts/test_audit_fixes.js`. |
| **A7** Shipped/test products (`%Wiring Test Item%`, `INIT-%`, `AG0ENT6N`) and no `is_test` flag | **NOT CONFIRMED** | Dev DB (`pos.db`) contains 0 matching products; no `is_test` column exists. | ❌ No | No evidence in the available database. No `is_test` column / “Remove test data” action was added, because deleting real inventory on an unconfirmed finding is unsafe. Owner should search their own DB for those names before deciding. |
| **A8** Price-floor enforcement / below-cost sales | **PARTIAL** | `src/main/services/sales.ts:102-120` — below-cost lines are blocked unless `price_floor_override`, gated by `settings.price_floor_enabled` (default on) | ◐ Partial | Enforcement already exists in v2.23.0. A dedicated **below-cost report** was not added in this run. Note: items with `cost_price = 0` are not blocked (the comparison is `price < cost`). |
| **A9** Mojibake / encoding damage in existing data | **NOT CONFIRMED** | No DB rows available to reproduce; dev DB is freshly seeded/empty. | ❌ No | Encoding migration was intentionally **not** written: the brief allowed it only with DB evidence. UTF-8 BOM import/export and the Urdu/en-dash test were therefore also not changed. |
| **A10** Overdue credit days duplicated and shop default unused | **CONFIRMED** | `src/main/services/udhaar.ts:205,426`; `src/shared/creditDays.ts`; `migrations/067_default_credit_days.js` | ✅ Yes | One shared `resolveCreditDays()`. Customer `credit_days > 0` wins; `0` now means “use shop default” (`settings.default_credit_days`, seeded from legacy `admin_settings.payment_due_days` or 30). Shop default `0` disables overdue tracking. UI hint updated to “0 = shop default”. |
| **B1a** Security settings fields appear empty | **NOT CONFIRMED** | `src/renderer/src/pages/AdminPanel/SystemSettings.tsx:127-137`; dev DB has `min_password_length=8`, `session_timeout_minutes=30`, 2FA off | ❌ No | The code path and seeded values are present; the empty screenshot could not be reproduced from the available DB. |
| **B1b** `session_timeout_minutes` is not enforced | **CONFIRMED** | The key is read only by `SystemSettings.tsx:134`; no main/renderer code uses it for an idle timer. | ❌ No | Implementing idle auto-lock is a feature, not a one-line fix; recorded for the owner. New-install default was changed to **480 minutes** in `migrations/025_admin_panel.js:279` (existing installs keep their value). |
| **B7** Add User roles do not match Roles & Permissions | **PARTIAL** | `src/renderer/src/pages/Users.tsx:439-447` offers owner/manager/cashier; `migrations/025_admin_panel.js:167-172` also defines `super_admin` and `inventory_manager`. | ◐ Partial | Added a **multi-owner warning** when adding/promoting another owner. **Inventory Manager was not added** to the user dropdown: the app’s `can()` model is a three-level rank and has no per-route permission check, so adding the label alone would either give that user billing access or lock them out of inventory. This needs a permission-model change first. |

### Other observations (not changed)

- `email:send` was a raw relay (recipient/subject/HTML supplied by the caller) with no role check. It is not used by the till; receipts use `receipt:sendEmail`. Now owner-only with basic validation.
- `whatsapp:start` / `whatsapp:send` were ungated; now owner-only. `whatsapp:sendSaleReceipt` remains available to cashiers (it is the till receipt action).
- `backup:run` / `backup:restore` were already owner-gated.
- The web session is derived from the bearer token in `cloud/src/accounts.ts`; `sessionUser` is **not** taken from the client body. Trial expiry is enforced before `/rpc`. This is correct.
- Web Worker `nodemailer` / filesystem / `child_process` leaves are inert shims; raw email cannot send from the Worker. The desktop remains the only place those handlers do real work.

---

## Phase 2 — Changes applied

### Backend

| File | Change |
| --- | --- |
| `src/main/services/admin.ts` | Canonical settings bridge: `applyProfileOverrides()` overlays `settings` onto admin reads; `mirrorAdminWrite()` writes `currency_symbol→currency`, `receipt_footer_text→receipt_footer`, `allow_negative_stock→yes/no`, `payment_due_days→default_credit_days`. Batch writes use the same mirror. |
| `src/main/services/profitability.ts` | `si.price` → `si.unit_price` (2 queries). |
| `src/main/services/inventoryReports.ts` | `si.price` → `si.unit_price` (1 query). |
| `src/main/services/shifts.ts` | `openShift()` auto-creates a matching `cash_drawer_sessions` row. New `closeOpenDrawerForShift()` closes it with counted cash, variance and notes. `closeShift()` / `forceCloseShift()` close the drawer. Force-close requires a reason and writes `reason=…` to the audit row. |
| `src/main/services/cashDrawer.ts` | `openDrawer()` syncs `shifts.start_cash` to the entered opening cash for older shifts. |
| `src/main/services/udhaar.ts` | Uses `resolveCreditDays()` in both overdue computations; reads `settings.default_credit_days` with a safe fallback. |
| `src/main/ipc.ts` | Secret masking on `settings:getAll`, `admin:settings:getAll/get`; masked writes are ignored. Owner gates + validation for `email:send`, `email:sendDailyReport`, `whatsapp:start`, `whatsapp:send`. |
| `src/main/utils/secrets.ts` | New shared mask/keys/detection helpers. |
| `migrations/067_default_credit_days.js` | Additive, idempotent seed of `settings.default_credit_days` from `admin_settings.payment_due_days`, else 30. |
| `migrations/025_admin_panel.js` | New-install security default `session_timeout_minutes = 480` (was 30). Existing installs are not rewritten. |

### Renderer

| File | Change |
| --- | --- |
| `src/renderer/src/pages/Dashboard.tsx` | Uses pure helpers from `src/shared/dashboardMath.ts`; payable from suppliers, receivable from customers, returns only returned sales, cash collected from cash sales. |
| `src/shared/dashboardMath.ts` | New pure `sumPayables`, `sumReceivables`, `sumSaleReturns`, `sumCashCollected` with NaN/negative guards. |
| `src/renderer/src/components/CashDrawer.tsx` | Opening cash defaults to `shift.start_cash`; labels now session-scoped. |
| `src/renderer/src/pages/Billing.tsx` | Shift pill warns after 24 h (“…h open — reconcile”). |
| `src/renderer/src/pages/Shifts.tsx` | Force-close is labelled “Reason (required)” and explains why. |
| `src/renderer/src/components/UdhaarCustomerModal.tsx` | Credit-days placeholder now says “0 = shop default”. |
| `src/renderer/src/pages/Users.tsx` | Multi-owner warning when another owner already exists. |

### Tests / tooling

| File | Change |
| --- | --- |
| `scripts/test_audit_fixes.js` | New suite: credit-day resolution, migration 067 idempotency, secret masking, dashboard arithmetic, report-query schema/static checks, owner-gate static checks. |
| `scripts/test_inventoryReports.js` | Replaced a hard-coded expiry date (`2026-09-15`, now in the past) with `Date.now() + 15 days`; the suite no longer rots with the calendar. |
| `package.json` | New `test:audit` script. |

---

## Phase 3 — Web/desktop safety

- Confirmed the web app runs the **real** IPC handlers, so any handler that is unsafe on the desktop is also exposed to the web session.
- Fixed the two raw relays (`email:send`, `whatsapp:start/send`) with owner gates and recipient/subject validation (see above). The till’s own `receipt:sendEmail` and `whatsapp:sendSaleReceipt` paths are unchanged.
- Confirmed the Worker derives `sessionUser` from the session token, not from the request body, and enforces the trial gate before dispatch.
- Confirmed Worker shims make filesystem, `child_process`, `nodemailer`, `browser-window`, and updater calls inert. `backup:run/restore` are owner-gated on top of that.
- `contextIsolation: true` and `nodeIntegration: false` remain set on the desktop window. No `sandbox` change was made because the preload needs Node.
- No `cloud/` file was edited (read-only audit).

---

## Phase 4 — Sidebar / UI cleanup

**SKIPPED.** The brief allowed the Sidebar restructure only if **everything else passed**. Phase 2 still has documented PARTIAL/SKIPPED items (A3 period selector, A7, A8 below-cost report, A9, B1b idle timeout, B7 Inventory Manager). Restructuring navigation on top of unresolved permission gaps would hide the problem rather than fix it. The existing Sidebar was left unchanged.

---

## Phase 5 — Verification and owner checklist

### Automated verification run

| Command | Result |
| --- | --- |
| `npm run typecheck` | ✅ clean (`gen:key` + forbidden-strings + both `tsc` projects) |
| `npm run build` | ✅ main + renderer built |
| `npm run test:audit` | ✅ **23/23** |
| `node scripts/test_inventoryReports.js` | ✅ **12/12** |
| `npm run test:shortcuts` | ✅ all registry checks |
| `npm run test:holdresume` | ✅ all cart round-trip checks |
| `npm run test:licensing` | ✅ **55/55** |
| `npm run test:imageupload` | ✅ **23/23** |

Not run in this environment (Electron/UI heavy, require a real display/printer): `test:print`, `test:receipt`, `test:receiptdesigner`, `test:return`, `test:keyboard`, `test:recovery:ui`, `smoke:web`. They should be run by the owner on the build machine before release.

### Owner manual checklist

1. **Install**: rebuild the desktop installer from `feature/audit-p0` (no version bump was made) and install it on a test machine, not the live till first.
2. **Settings bridge**: open Shop Profile and Admin → System Settings. Change currency symbol and receipt footer in each; confirm the other screen and a printed receipt show the new value. Confirm `allow_negative_stock` toggled in Admin actually affects billing.
3. **Secrets**: open Admin → Email/SMS. Confirm the password/API secret fields show dots, not the real values. Change an unrelated setting and save; confirm the secret still works by sending a test email/SMS. Do **not** paste the secret into a screenshot or log.
4. **Dashboard**: with at least one supplier balance and one customer udhaar, confirm **Total Payable (Suppliers)** and **Total Receivable (Udhaar)** are different and match the respective ledgers. Make a cash sale and an expense today; confirm Cash In / Cash Out. Make a return; confirm Sale Return equals the refund, not total revenue.
5. **Shift + drawer**: open a shift → Cash Drawer. Confirm the drawer opens with the same opening cash. Close the drawer, then close the shift; confirm no orphan drawer session remains. Force-close a test shift without a reason → must be refused; with a reason → succeeds and the audit row contains `reason=`.
6. **>24 h warning**: leave a test shift open past 24 h (or adjust `opened_at` in a copy of the DB) and confirm the Billing pill warns.
7. **Credit days**: set a customer credit period to 0 and the shop default to 30; confirm the customer becomes overdue after 30 days, not never. Set shop default to 0 and confirm overdue tracking is disabled.
8. **Reports**: open Profitability and Inventory Reports; confirm they load (no `no such column: si.price`) and show average selling price.
9. **Users**: add a user with Owner role while another owner exists; confirm the warning appears. Confirm no role changes happen silently.
10. **Email/WhatsApp**: as a cashier, confirm the till can still send a receipt; as a cashier, confirm the raw Admin “send test” actions are refused. As owner, confirm they work.
11. **Web**: rebuild `cloud/web-dist/app` and redeploy; log in as owner and cashier; confirm `/app` still works, settings load, and secrets are masked. Confirm the web cashier cannot call raw email/WhatsApp relays.
12. **Backups**: take a backup before merging to `main`. Migration 067 is additive, but a backup is still required.

---

## Assumptions recorded

1. **A1** was resolved as a canonical bridge, not a destructive table merge. `settings` wins for the four bridged keys; no data was deleted.
2. **A10** changes behaviour: customer `credit_days = 0` now means “use the shop default”, not “never overdue”. This is intentional and documented in the UI. A shop that wants “never overdue” sets the **shop default** to 0.
3. Dashboard **Cash Out** is `today_expenses` only. Supplier payments are not included because they are not an expense in this schema’s cash-flow sense.
4. New-install `session_timeout_minutes` is 480, but the setting is **not enforced** yet (B1b). Existing installs keep their stored value.
5. Inventory Manager was not added to Add User because the app has no per-route permission gate; adding the label without that gate would be misleading or unsafe.
6. A7/A9 were not “fixed” because the available database could not confirm the finding. Deleting products or rewriting text encoding without evidence would risk real shop data.

## Skipped / blocked items

| Item | Reason |
| --- | --- |
| A7 test-data products / `is_test` flag / “Remove test data” | NOT CONFIRMED in `pos.db`; destructive action needs owner DB evidence. |
| A9 encoding migration / BOM import-export / Urdu test | NOT CONFIRMED; no DB rows to reproduce. |
| A8 dedicated below-cost report | Price-floor enforcement already exists; report is a new feature, not a P0 fix. |
| B1b idle session timeout | Setting exists but no idle timer; implementing it is a feature with UX/security decisions. |
| B7 Inventory Manager in Add User | Needs a per-route permission model, not just a dropdown label. |
| Phase 4 Sidebar restructure | Gate (“everything else passed”) not met. |
| Release / version bump / `latest.yml` / push / deploy | Explicitly out of scope for this run. |

---

## Final status

The confirmed P0 data-integrity and security items (A1, A2, A4, A5, A6, A10) are fixed, with regression tests. The remaining items are either partial by design (A3, A8, B7), unconfirmed in the available data (A7, A9, B1a), or need a product decision (B1b). All code changes are on `feature/audit-p0`; `npm run typecheck` and `npm run build` are clean.

**Owner action required:** rebuild/reinstall the desktop app and rebuild/redeploy the web version. No release or deploy was performed by this run.
