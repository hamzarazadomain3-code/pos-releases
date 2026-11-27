# PHASE 0 REPORT — Rokar POS (stabilize)

**Run date:** 2026-11-26 → 2026-11-27
**Baseline:** `v2.32.0` (`main` @ `3c53c73`, unpushed) — the prompt's "2.22.0" is stale (D1)
**Scope:** `E:\antigravty\billing softwere\pos-app` only
**Proofs:** `E:\temp\proof\p0_*` (every claim below has a saved output)
**Commits:** `a001ddb` (the code + the permanent suites), `6c35254` (the docs)

---

## 1. Summary

All **15** Phase 0 items (0.1–0.15) are **DONE**. Seven of them needed new
code; eight were already in the tree and were re-verified with a permanent
regression test instead of being "fixed" again.

| # | Item | Status | The one-line proof |
|---|---|---|---|
| 0.1 | `no such column: si.price` | DONE (verified) | `test:audit` 48/48 + `test_inventoryReports` 12/12 |
| 0.2 | raw IPC errors | DONE (new) | `test:ipcError` **38/38** |
| 0.3 | UTC vs Asia/Karachi | DONE (new) | `test:timezone` **16/16** |
| 0.4 | the screens disagree | DONE (new) | `test:unified` **11/11** |
| 0.5 | shift labels / >24 h | DONE (new) | `test:shifts` **14/14** |
| 0.6 | mojibake | DONE (new) | `test:utf8` clean (50 sequences fixed) |
| 0.7 | negative stock sold | DONE (verified) | `test:negstock` **31/31** (both sale paths) |
| 0.8 | one setting in many places | DONE (verified) | `test:settingsbridge` **16/16** (UI duplication is a known gap) |
| 0.9 | below-cost + expired sales | DONE (new) | `test:expired` **15/15** |
| 0.10 | receipt columns / totals | DONE (verified) | `test:receipt` 68/68 + `test:receiptdesigner` 73/73 |
| 0.11 | mixed date formats | DONE (verified) | `test:calendar` 64/64 + `test:dateCalendarUi` 38/38 |
| 0.12 | abandoned audits | DONE (new) | `test:audits` **13/13** |
| 0.13 | duplicate alerts | DONE (verified) | `test:alerts` 5/5 |
| 0.14 | the four UI defects | DONE (new) | `test:ui` **30/30** (+ 6 screenshots) |
| 0.15 | secrets / password policy | DONE (new) | `test:security` **24/24** |

The phase also ends with the prompt's **billing smoke test** as a permanent
suite: `npm run test:billingSmoke` → **46/46** (the drawer, discount+tax,
weight, wholesale, split payment, udhaar, hold/resume, return+restock, the
below-cost and expired blocks, the cross-screen number equality, backup/restore,
the drawer close, and "a sale that fails leaves no half-written bill").

---

## 2. What each item was, and what changed

### 0.2 — the IPC error boundary (new)

**Root cause.** 384 `ipcMain.handle` calls returned the raw `Error.message` to
the renderer, so a SQLite failure ("UNIQUE constraint failed: …") or a
`TypeError` was shown to the cashier as a crash — with no way to find it in the
log and no message in the shop's own language.

**Fix.** The new `src/main/ipcError.ts` is the one boundary: it classifies the
error, keeps a **deliberate validation message** untouched, and turns an
internal failure into a bilingual friendly message + an `errorId`
(`E-YYMMDDHHMMSS-XXXX`) while the full stack (scrubbed) goes to the main
process log file. `ipc.ts` (384 handlers), `licensing.ts` (3) and `updater.ts`
(3) all go through it.

**Test.** `scripts/test_ipcError.cjs` → **38/38** (`npm run test:ipcError`).

### 0.3 — the "today" leak (new)

**Root cause.** `new Date().toISOString()` was used for "today" in the
assistant tools, the sidebar badges, udhaar, the label studio, the udhaar entry
modal and the reports. At 00:00–05:00 in Asia/Karachi that is **yesterday**,
so the dashboard and the ledger disagreed with the bill.

**Fix.** Every one of those places now uses the local helpers; the Z-report
runs on the business-day range (`resolveBusinessRange`, a half-open
`>= ? AND < ?`).

**Test.** `scripts/test_timezoneAudit.cjs` → **16/16** (a static guard + the
Karachi UTC+5 boundary maths).

### 0.4 — one business day, one resolver (new)

**Root cause.** The daily closing, the sales list and the expense summary each
built their own date window (and the closing query even used an ambiguous
`created_at` in a join), so three screens could show three totals for the same
day.

**Fix.** The shared `businessDayWhere()` in `src/shared/salesHistory.ts` is now
the only place that builds a business-day window; `sales.listSales` grew an
optional `useBusinessDayRange` flag (default `false` — backward compatible).

**Test.** `scripts/test_unifiedTotals.cjs` → **11/11**.

### 0.5 — the shift rules (new)

**Root cause.** A shift could stay open forever and the "average bill" was a
hard-coded number on some screens.

**Fix.** `shifts.openShift` refuses a shift that is already open for more than
24 hours and writes a `shift_long_open` audit row at 20 hours. A forced close
still needs a manager and a reason.

**Test.** `scripts/test_shifts.cjs` → **14/14**.

### 0.6 — the mojibake (new)

**Root cause.** 50 literal `â€"`/`â€¢` sequences in `reports.ts`,
`Inventory.tsx` and `types.ts` (real mojibake, confirmed by code point).

**Fix.** Real UTF-8 (`—`, `•`, `→`, `×`, `−`), plus a permanent scan.

**Test.** `scripts/test_mojibake.cjs` (`npm run test:utf8`) → clean.

### 0.9 — the expired stock (new)

**Root cause.** The sale path checked the price floor but **not the expiry
date**, so an expired pack could be sold.

**Fix.** An expired line is blocked in `sales.ts` (the same-day expiry is still
sellable). A manager (owner/manager) can override with a PIN + a reason, and
every override is written to the activity log (`expired_override`). The Billing
screen got the approval dialog (i18n `billing.expired.*`, EN + UR).

**Test.** `scripts/test_expiredSale.cjs` → **15/15**.

### 0.12 — the abandoned audits (new)

**Root cause.** An audit that was started and then abandoned stayed in the list
forever (only a completed audit could be cancelled).

**Fix.** `audits:discard` (owner only, a completed audit is refused) deletes
the audit and its items and writes the `audit_discarded` activity row. The
screen got the **Discard** button.

**Test.** `scripts/test_audits.cjs` → **13/13**.

### 0.14 — the four UI defects (new)

**Root cause / fix (all four, in the real renderer):**

1. **The empty-cart checkout.** The button was disabled but had **no disabled
   styling** (unlike `.action-btn-return`) and still said "Pay & Save", so an
   empty cart showed a live-looking bright green button that did nothing. Now:
   it says "Add items to bill" (i18n `billing.checkout.*`, EN + UR), explains
   itself in its tooltip and is dimmed (`opacity: 0.45`).
2. **The PO supplier dropdown.** Changing the supplier of an order that already
   had lines re-labelled the whole order silently — the items added for
   supplier A were created against supplier B. Now the owner is asked what to do
   with those lines (keep them / go back / remove them) and the order cannot be
   created or drafted until that is settled.
3. **The duplicate rows.** Two paths could put one product on two rows: the
   cart's **Undo** (it re-inserted the removed line blindly) and the PO modal's
   **per-row product cell**. Both now **merge** the quantity into the row that
   keeps the product.
4. **The minimized card.** The assistant drawer (`z-index: 60`) sat **above**
   the modal overlay (`50`): the drawer covered the dialog's right edge and the
   docked (minimized) card disappeared behind it — the cashier could not bring
   the dialog back. The modal overlay is now `z-index: 70` (above the drawer,
   below the auto-lock overlay and the mobile sidebar).

**Test.** `scripts/test_uiDefects.cjs` (`npm run test:ui`) → **30/30** in the
REAL renderer, plus 6 screenshots (`E:\temp\proof\p0_0.14_0*.png`) — the empty
cart, the cart with an item, the cart after the undo, the PO supplier warning,
the merged PO row and the docked card on top of the assistant drawer.

### 0.15 — the secrets and the password policy (new)

**Root cause.** The SMTP password, the SMS keys and the WhatsApp tokens sat in
`admin_settings` as **plain text** (they were only masked at the IPC
boundary), and the password policy was **read but never enforced** — only the
length was checked.

**Fix.**

- The new `src/main/services/secretVault.ts` stores those **5** credentials
  through the OS key store (`safeStorage`, marker `enc:v1:`), decrypts them
  only where a service needs them (SMTP, SMS, and the assistant's redaction
  list — which had to move to the decrypted value or the redaction would
  never match). A legacy plain value still works and is **migrated in place**
  on its first read; a value that cannot be decrypted (another machine, another
  Windows user, a corrupt blob) reads as **empty** — never as the cipher text.
  No key store at all → the shop is not blocked from saving its password and
  one warning is logged.
- The new pure `src/shared/passwordPolicy.ts` **enforces** the whole policy
  (length + uppercase + numbers + special) on every user create/update. A PIN
  is exempt (it has its own 4–10 digit rule).

**Test.** `scripts/test_security.cjs` (`npm run test:security`) → **24/24**.

### The items that needed no code change (0.1, 0.7, 0.8, 0.10, 0.11, 0.13)

Each was re-verified with its own suite in this run (the counts are in the
table above). **0.8** keeps one honest gap: the *settings bridge* is proven,
but the **duplicate UI controls** (the same setting still reachable from two
screens) are still on screen — that is a Phase 1+ cleanup, listed under Risks.

---

## 3. Files

**New (15)**

| File | Why |
|---|---|
| `src/main/ipcError.ts` | the IPC error boundary (0.2) |
| `src/main/services/secretVault.ts` | the credential vault (0.15) |
| `src/shared/passwordPolicy.ts` | the pure, enforced password policy (0.15) |
| `scripts/test_ipcError.cjs` | 0.2 |
| `scripts/test_timezoneAudit.cjs` | 0.3 |
| `scripts/test_unifiedTotals.cjs` | 0.4 |
| `scripts/test_shifts.cjs` | 0.5 |
| `scripts/test_mojibake.cjs` | 0.6 |
| `scripts/test_settingsBridge.cjs` | 0.8 |
| `scripts/test_expiredSale.cjs` | 0.9 |
| `scripts/test_audits.cjs` | 0.12 |
| `scripts/test_security.cjs` | 0.15 |
| `scripts/test_uiDefects.cjs` | 0.14 |
| `scripts/test_billingSmoke.cjs` | the phase's billing smoke test |
| `docs/PHASE0_REPORT.md` | this report |

**Changed — main process**

`src/main/ipc.ts` (the `handle()` wrapper + `audits:discard`), `src/main/services/admin.ts`
(the vault write path + the settings bridge), `src/main/services/assistant/agent.ts`
(the decrypted redaction list), `src/main/services/assistant/toolImpls.ts`,
`src/main/services/audits.ts`, `src/main/services/auth.ts`,
`src/main/services/emailService.ts`, `src/main/services/expenses.ts`,
`src/main/services/labelStudioPrinting.ts`, `src/main/services/licensing.ts`,
`src/main/services/reports.ts`, `src/main/services/sales.ts`,
`src/main/services/shifts.ts`, `src/main/services/sidebarBadges.ts`,
`src/main/services/smsService.ts`, `src/main/services/udhaar.ts`,
`src/main/services/xzReports.ts`, `src/main/updater.ts`.

**Changed — renderer**

`src/renderer/src/pages/Billing.tsx` (the empty-cart label, the undo merge,
the expired approval dialog), `src/renderer/src/pages/Audits.tsx` (Discard),
`src/renderer/src/pages/Inventory.tsx` (UTF-8), `src/renderer/src/pages/Reports.tsx`
(the business day), `src/renderer/src/components/UdhaarEntryModal.tsx`,
`src/renderer/src/components/PurchaseOrderModal.tsx` (the supplier guard + the
merge), `src/renderer/src/pages/LabelStudio/format.ts`,
`src/renderer/src/styles.css` (the disabled bill buttons, the modal z-index,
the supplier banner), `src/renderer/src/i18n/en.json`, `src/renderer/src/i18n/ur.json`.

**Changed — shared / bridge / docs**

`src/shared/salesHistory.ts` (`businessDayWhere`), `src/shared/types.ts`
(`SaleInput.expired_*`, `Api.audits.discard`), `src/preload/preload.ts`
(`audits.discard`), `package.json` (8 new test scripts),
`CHANGELOG.md` (one line per item), `docs/PLAN.md` (the status matrix),
`docs/DECISIONS.md` (D11–D16).

**Not touched (on purpose):** `scripts/seed_demo.js` (the owner's modified
file) and the five stray untracked scripts (`phase12_payment_gap.js`,
`step0_db_check.js`, `test_dateParse.ts`, `test_reconcile.js`,
`verify_db_copy.js`) — they are the owner's/agent's work and were neither
edited nor staged.

---

## 4. Test evidence

Every row is a real run in this session; the output is saved under
`E:\temp\proof\`.

| Suite | Result | Proof |
|---|---|---|
| `npm run typecheck` | exit 0 (main + renderer + the forbidden-strings check) | `p0_regr_typecheck.txt` |
| `npm run build` | exit 0 | `p0_regr_build.txt` |
| `npm run test:audit` | 48/48 | `p0_regr_audit.txt` |
| `npm run test:utf8` | clean | `p0_regr_utf8.txt` |
| `npm run test:settingsbridge` | 16/16 | `p0_regr_settingsbridge.txt` |
| `npm run test:ipcError` | 38/38 | `p0_regr_ipcError.txt` |
| `npm run test:timezone` | 16/16 | `p0_regr_timezone.txt` |
| `npm run test:unified` | 11/11 | `p0_regr_unified.txt` |
| `npm run test:shifts` | 14/14 | `p0_regr_shifts.txt` |
| `npm run test:expired` | 15/15 | `p0_regr_expired.txt` |
| `npm run test:audits` | 13/13 | `p0_regr_audits.txt` |
| `npm run test:security` | 24/24 | `p0_regr_security.txt` |
| `npm run test:negstock` | 31/31 | `p0_regr_negstock.txt` |
| `npm run test:belowCost` | 7/7 | `p0_regr_belowCost.txt` |
| `npm run test:holdresume` | 26/26 | `p0_regr_holdresume.txt` |
| `npm run test:shortcuts` | 37/37 | `p0_regr_shortcuts.txt` |
| `npm run test:calendar` | 64/64 | `p0_regr_calendar.txt` |
| `npm run test:salesHistory` | 22/22 | `p0_regr_salesHistory.txt` |
| `npm run test:businessDay` | 13/13 | `p0_regr_businessDay.txt` |
| `npm run test:dashboardPeriod` | 11/11 | `p0_regr_dashboardPeriod.txt` |
| `npm run test:receipt` | 68/68 | `p0_regr_receipt.txt` |
| `npm run test:receiptdesigner` | 73/73 | `p0_regr_receiptdesigner.txt` |
| `npm run test:alerts` | 5/5 | `p0_regr_alerts.txt` |
| `npm run test:return` | 29/29 | `p0_regr_return.txt` |
| `npm run test:purchaseOrderUi` | 60/60 | `p0_regr_purchaseOrderUi.txt` |
| `npm run test:billingKeys` | 26/26 | `p0_regr_billingKeys.txt` |
| `npm run test:ui` | 30/30 | `p0_regr_ui.txt` + `p0_0.14_0*.png` |
| `npm run test:dateCalendarUi` | 38/38 | `p0_regr_dateCalendarUi.txt` |
| `npm run test:keyboard` | 93/93 | `p0_regr_keyboard.txt` |
| `npm run test:billingSmoke` | 46/46 | `p0_regr_billingSmoke.txt` |
| `npm run check:migrations` | pass (on a copy) | `p0_regr_migrations.txt` |

The batch summary (one line per suite, with the exit code and the time) is
`E:\temp\proof\p0_regr_summary.txt`.

---

## 5. Risks and honest gaps

1. **The duplicate settings CONTROLS (0.8).** The bridge is proven (one
   source of truth for the 10 duplicated keys), but the same setting is still
   editable from two screens. Cleaning the UI is a Phase 1+ task.
2. **Money is still `REAL`** (D3). A schema-wide paisa migration is a data
   migration with a per-column rounding decision — out of scope for Phase 0 and
   listed as debt.
3. **Most of the renderer is still hard-coded English.** This run made the
   text it touched bilingual (the checkout label, the expired dialog, the PO
   supplier warning). A full i18n sweep of every screen is a Phase 1+ task;
   the master prompt's "all UI text i18n (EN+UR)" is **not** fully met yet.
4. **The vault needs the shop's Windows user.** A database copied to another
   PC (or another user) cannot decrypt the credentials — that is the point,
   but the shop must re-enter the SMTP/SMS passwords there. The owner should
   also **rotate** the credentials that were in plain text before this run.
5. **The password policy is now stricter.** An owner whose staff used a weak
   password must set the policy in Admin → Security (or the user write is
   refused). The defaults are the shipped ones (8 chars, upper + number).
6. **The "kill mid-sale" check is an atomicity check, not a real kill.** It
   proves that a failed sale leaves no sale row, no item row, no payment and no
   stock movement. A literal process kill is covered by SQLite's transaction
   guarantee, not by a test here.
7. **No Electron test clicks every Reports tab** (0.1) — the queries and the
   IPC chain are proven; the tab rendering is not.
8. **The window/UI suites need a real build** (`npm run build`), and the
   screenshots need an on-screen window — an off-screen window hands back a
   stale frame (that was found and fixed in `test:ui`).
9. **Four of the new Electron suites hung the build** (they printed "all
   checks passed" but never quit Electron, so `npm run` never returned). All
   four now call `app.exit(0)`, the close-out batch kills any suite that runs
   longer than 300 s, and the rule is written down in `AGENTS.md`.

---

## 6. Next (the phase gate)

Phase 0 is complete and **committed** (`a001ddb` the code + the suites,
`6c35254` the docs) on the local `main` — **not pushed**, so the owner can
review the diff and the report first. The working tree holds nothing but the
owner's own files (`scripts/seed_demo.js` + the five stray scripts), untouched
and unstaged.

After the owner's approval, the next phases in the prompt's order:

- **Phase 1** — the product/inventory data model (the units, the batch/expiry
  rules, the stock ledger), with the "one rule, one place" rule the settings
  bridge already follows.
- **Phase 2** — the receipt/designer template library (the Phase 3 work is
  already in the tree; Phase 2 hardens it).
- **Phase 3** — the purchase-order screen hardening (the supplier guard and
  the merge rule from 0.14 are the template for the rest).
- **Phase 4** — the printer pipeline (the phase-4 receipt printing is already
  in the tree; it needs the shop's own printers).
- **Phase 5** — the release + the owner checklist + the live deploy.

**The owner must still decide:** (a) rotate the SMTP/SMS credentials, (b)
whether the strict password policy is acceptable for the staff accounts, (c)
whether the duplicate settings controls are cleaned up in Phase 1.
