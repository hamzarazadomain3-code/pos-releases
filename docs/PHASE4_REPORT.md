# PHASE 4 REPORT — Rokar POS (the printer pipeline)

**Run date:** 2026-11-27
**Baseline:** `v2.32.0` (`main` @ `51a9096`, unpushed) — Phase 0 → 3 are committed
**Scope:** `E:\antigravty\billing softwere\pos-app` only
**Proofs:** `E:\temp\proof\p4_*` (every claim below has a saved output)
**Phase:** 4 of the master-prompt run (Phase 0 → 5)

---

## 1. Summary

Phase 4 is the **printer pipeline** — the path a receipt takes from the sale
screen to the roll in the shop's printer. The phase-4 printing features
(the preview window, the reprints, the copies, the cut margin, the drawer
kick, the system-default printer) were already in the tree from the earlier
runs; this phase **found and fixed the places where the pipeline disagreed
with itself**.

**Seventeen items (4.1 – 4.17), all DONE.**

Items 4.1 – 4.7 are the pipeline's own rules. Items 4.9 – 4.17 came out of a
**second, deeper audit** of the same pipeline (an explore pass over the
engine, the services, the IPC layer and the printer screens) plus the
15-suite regression battery — which caught a **real race** that had been
hiding in the tree since Phase 0 (4.15) and a **UTC-day leak** in one of the
run's own suites (4.17).

The biggest wins for the shop, in plain words:

1. **Printing from the preview window now behaves exactly like printing
   directly.** Before this, the cashier could print the receipt from the
   preview window and the **cash drawer stayed shut** and **"Reprint last
   receipt" went back to the PREVIOUS sale** — the preview's Print button
   called the low-level print engine, while the direct print went through
   the service that remembers the sale and pops the drawer.
2. **The printer choice can no longer be wrong by accident.** The rule that
   decides "which printer, silently or with a dialog?" was a private function
   buried in the engine; it is now **one exported, tested rule**, and the
   "ask every time" setting still never silently prints to the Windows
   default (the bug that made receipts vanish or open a save-file prompt).
3. **The printer settings screen and the receipt-preview window are now
   bilingual** (English + Urdu) — they were hard-coded English. Every
   preview in the app now sends the translated toolbar strings, not just the
   receipt and the invoice (4.16).
4. **The documents now go to the printer that can actually print them.** An
   A5 purchase order used to go to the till's **thermal** printer; the A4
   test page went to the **thermal** printer too; the udhaar entry slip was
   **always 80mm** even on a 58mm shop (4.9, 4.11, 4.12).
5. **The label stock the shop configured is the page that prints.** Only
   three label sizes were honoured — every other size silently printed on a
   **38×25** page (4.10).
6. **The "Print Test Page" button works.** It passed `'receipt'` — which is
   **not a paper key** — into `PAPER_SPECS`, so it **threw before it
   printed anything** (4.9). The Settings panel also said **"Width:
   undefined"** (4.13).
7. **A successful print can now tell the owner something.** The "this layout
   does not fit your paper" note was glued onto a success message that the
   till screen threw away — the owner never saw it (4.14).

---

## 2. The items

### 4.1 — the preview window's Print button was a DIFFERENT print

**Root cause.** The direct print goes through `printing.printSale()`, which
remembers the sale as *"the last printed sale"* and pulses the cash drawer
for a fresh receipt. The **preview window's Print button** did not go
through that service: it called `printDocument()` — the low-level engine —
directly. So the document was right, but the two side effects never
happened:

- the cash drawer **never popped** (the cashier pressed Print, the receipt
  came out, the drawer stayed shut and the till's cash was not in the
  drawer);
- **`last_printed_sale_id` was not written**, so **"Reprint last receipt"**
  reprinted the sale *before* the current one.

**Fix.** The after-print behaviour is now **ONE rule**
(`afterPrintActions()` in `printService.ts`), and the job itself says what
it is:

```ts
export interface PrintJob {
  saleId?: number;      // a job with a sale id IS a customer receipt
  duplicate?: boolean;  // a reprint never pops the drawer
  kickDrawer?: boolean; // the caller can force it either way
}
```

`printDocument()` runs the rule when the print **succeeded** (never on a
failure), and the preview's protocol handler builds its job with
`previewPrintJob()` — so the preview's Print button now carries the sale id
and the "this is a reprint" flag, and lands on the **same** rule.

The rule itself is plain and testable:

| the job | the sale is remembered | the drawer pops |
|---|---|---|
| an invoice / a label / the test print / the calibration sheet (no sale id) | no | **no** |
| a fresh receipt | yes | yes (when the shop opted in) |
| a **reprint** | yes | **no** |
| any receipt with `kickDrawer` forced | yes | as forced |

**Proof.** `test:printPipeline` — "the preview job carries the sale id",
"the preview keeps the 'this is a reprint' flag", "a reprint printed from
the preview does NOT pop the drawer", "a fresh receipt printed from the
preview DOES pop the drawer", plus the source check that `printDocument`
runs the rule only inside `if (result.ok)`.

### 4.2 — the printer-resolution policy could not be tested

**Root cause.** `resolveTarget()` read the shop's settings from the
database and then decided, in one private function, whether the print goes
to a named printer, to the system default, or to the OS dialog. Because it
was private and DB-bound, **no test could reach the rule** — and the rule
is the one thing that decides whether the receipt lands on the right
device. (The rule itself was correct; it was untestable.)

**Fix.** The policy is now a **pure, exported** function:

```ts
export function resolvePrintTarget(input, printMode): Target
```

with the database-reading wrapper (`resolveTarget`) reduced to glue. The
policy is unchanged and is now pinned by tests:

| the shop picked | the result |
|---|---|
| a named printer | silent, to that printer |
| **"System default printer"** (`default`) | silent, to the **Windows default** |
| **"Ask every time"** (`auto`) | the **OS dialog** — never the Windows default |
| nothing configured | the OS dialog |
| the shop's "always ask" setting | the OS dialog, even with a printer chosen |
| a job that forces `mode: 'silent'` | silent, even when the shop asks |

**Why the `auto` case matters.** A Windows default that is a file-output
printer (Microsoft XPS, Print to PDF, OneNote) turns a silent print into a
save-file prompt; a default on a `nul:`-port software printer makes the job
vanish — which is what surfaced as random applications opening on the till.
The app never substitutes the default for an explicit "ask".

**Proof.** `test:printPipeline` — ten checks over the policy (each row of
the table above).

### 4.3 — the after-print behaviour was in the wrong place

**Root cause.** "What happens after a successful print" lived inside
`printing.printSale()`. The drawer pulse and the "last printed sale" write
were therefore attached to **one call site**, not to the print itself — and
every other path (the preview, and anything added later) silently skipped
them. The drawer pulse also had to live there because `openCashDrawer()`
lived in `printing.ts`, while the engine that prints is `printService.ts`.

**Fix.** The whole after-print behaviour moved into the **print engine**
(`printService.ts`), where the print actually happens:

- `afterPrintActions(job, drawerKickEnabled)` — the pure rule;
- `runAfterPrint(job)` — the rule plus the two effects (remember the sale,
  pulse the drawer);
- `openCashDrawer()` — moved here from `printing.ts` (it is a print-pipeline
  concern: the drawer is wired into the receipt printer) and re-exported
  from `printing.ts`, so no caller changed.

The two settings that decide it (`cash_drawer_kick`, opt-in and default
**off**; `receipt_duplicate_label`, default **on**) are read with the same
`safeAdminSetting` helper the rest of the engine uses.

**Proof.** `test:printPipeline` — the seven after-print checks + the source
check that the rule runs inside `if (result.ok)`.

### 4.4 — the printer settings screen was hard-coded English

**Root cause.** `Settings.tsx` had **no `useTranslation` at all** — the
whole page was English, including the **Printers & Paper** panel (the
printer, the paper, the copies, the cut margin, the drawer, the test pages)
and the **Receipt Template** panel. For an Urdu shop, the one screen where
they set up their printer was the one screen they could not read.

**Fix.** A new `printing.*` namespace in **both** `i18n/en.json` and
`i18n/ur.json` (the same keys in both files, and the parity is a permanent
check), and every string on those two panels now comes from it — including
the two paragraphs that carry **bold / italic** (the "Ask every time" and
"file output" hints), which use `Trans` so the emphasis survives the
translation.

The rest of the Settings page (the shop profile, the WhatsApp panel, the
backup panel, the appearance panel) is still English — that is a bigger
surface and it is named in the risks below.

**Proof.** `test:printPipeline` — the en/ur key parity for the whole
`printing.*` namespace, "every key the printer screens use exists in
en.json / ur.json", "no Urdu printing string is empty", and "the printer
panel has no hard-coded English left" (seven exact strings are checked
against the source).

### 4.5 — the receipt-preview window's toolbar was hard-coded English

**Root cause.** The preview is a separate `BrowserWindow` with **no
preload**, and its toolbar (the Print / Download PDF / WhatsApp / Close
buttons, the copies box, the "Printing…" busy label) is injected by the
**main process** — which cannot read the renderer's i18n files. Every
label was therefore a literal English string in `printService.ts`.

**Fix.** The toolbar's strings are now **placeholders**, and the **renderer
sends the translated strings with the request**:

- `src/shared/types.ts` — a new `PrintPreviewLabels` (nine labels) and
  `PrintSaleOptions.labels`;
- `src/renderer/src/utils/previewLabels.ts` — the one helper that reads
  them from i18next (`previewLabels(t, 'receipt' | 'invoice')`);
- `printService.ts` — `PreviewOptions.labels` + the eight new placeholders
  (`__PDF_LABEL__`, `__SHARE_LABEL__`, …), with the English strings kept
  as the fallback so an old caller still works;
- the three preview call sites (Billing's receipt + invoice preview,
  Settings' receipt preview, the Udhaar ledger's receipt preview) now pass
  the labels.

**Proof.** `test:printPipeline` — "the toolbar no longer hard-codes its
English strings" (five exact literals are checked against the source),
"the toolbar has a placeholder for every label" (eight placeholders), and
"the preview label helper returns every toolbar label".

### 4.6 — the receipt template's fit warning (checked, not a defect)

**Root cause (checked).** The designed receipt path returns
`warnings: []` while the shipped path can warn that a template did not fit
the paper. That is **correct**: the warning is about the *template* being
adjusted to fit, and in the designed path the template argument is ignored
entirely — the design decides the layout, and the design is resolved **for
the paper that is being printed** (`resolveAppliedDesign(paper, branchId)`).
Carrying the template warning into the designed path would have been
misleading, so it was left alone on purpose.

### 4.7 — the settings clamps (checked and pinned)

**Root cause (checked).** `getReceiptCopies()` (1–10), the cut margin
(`receipt_bottom_feed_mm`, 0–30 mm) and the drawer switch all read the
shop's settings, and the empty-value case is the trap: `safeAdminSetting`
returns `''` for a missing key and `Number('')` is **0**, which would turn
the 4 mm cut-margin default into *no feed*. The code already treated `''`
as "unset"; this phase **pinned it with tests** so it can never regress.

**Proof.** `test:printPipeline` — thirteen checks over the three settings
(the default, the clamp at both ends, the empty value, the junk value).

### 4.9 — the "Print Test Page" button threw before it printed anything

**Root cause.** Two bugs in one place.

1. `Settings.tsx` called `printTestSheet('receipt')`, but **`'receipt'` is
   not a paper key** — the paper keys are `thermal58` / `thermal80` / `a4` /
   `a5`. The value went straight into `PAPER_SPECS[paper]` and
   `PAPER_SPECS['receipt']` is `undefined`, so the button **died on the
   line that read `spec.widthMm`** — before a single sheet was printed.
2. `printCalibration()` always used `printerKey: 'receipt'`, so even a valid
   **A4** calibration sheet went to the **thermal** receipt printer.

**Fix.**

- `resolveCalibrationPaper(paper?)` (in `printing.ts`) maps `'receipt'` to
  **the receipt paper this shop uses**, keeps the four real keys, and falls
  back to the receipt paper for anything unknown — so a bad key can never
  reach `PAPER_SPECS` again.
- `printCalibration()` now **fails with a reason** (`Unknown paper: …`)
  instead of dereferencing `undefined`.
- `printerKeyForPaper(paper)` is the **one** rule for "which printer slot":
  a **ROLL** (58/80mm) → the receipt printer, a **SHEET** (A4/A5) → the
  invoice printer.

**Proof.** `test:printPipeline` — 11 checks: "'receipt' is not a paper key
(the old crash)", "the calibration paper is always a REAL paper key",
"the calibration paper follows the shop's receipt paper", the four
printer-slot rows, "an unknown paper does not throw" and "an unknown paper
fails with a message".

### 4.10 — the configured label stock was not the page that printed

**Root cause.** `resolveLabelSize()` accepted **three** sizes (`38x25`,
`50x30`, `100x50`) and returned `38x25` for everything else — while the
engine knows **eight** (`38x25`, `38x28`, `50x30`, `100x50`, `40x30`,
`50x25`, `58x40`, `60x40`). A shop that bought `58x40` stock got its labels
printed on a **38×25** page: the content was squeezed, the roll was the
wrong length, and the physical stock and the printed page did not match.

**Fix.** The resolver accepts **every size in `LABEL_SPECS`** and falls back
to `38x25` only for an unknown value. Exported, so the rule is pinned.

**Proof.** `test:printPipeline` — "the engine knows more than three label
sizes" + one check per known size ("the configured stock *X* is the page
that prints") + "an unknown stock size falls back to 38x25" (10 checks).

### 4.11 — an A5 purchase order went to the till's thermal printer

**Root cause.** `purchaseImport.ts` used `paper === 'a4' ? 'invoice' :
'receipt'`. The IPC accepts **four** papers (`a4`, `a5`, `thermal80`,
`thermal58`), so an **A5** order — sheet media — was sent to the **thermal
receipt printer**.

**Fix.** `purchaseOrderPrinterKey(paper)`: a **ROLL** → the receipt printer,
a **SHEET** → the invoice printer. One rule, used by both the print and the
preview path.

**Proof.** `test:printPipeline` — the four rows (A4, A5, 80mm, 58mm).

### 4.12 — the udhaar entry slip was always 80mm

**Root cause.** `buildEntrySlipJob()` hard-coded `thermal80` unless the
caller passed `thermal58` explicitly. A **58mm** shop got an entry slip
that does not fit its roll.

**Fix.** `resolveEntrySlipPaper(configured, override?)`: with no override
the slip follows the **receipt paper the shop configured**; an explicit
override still wins; a sheet paper is not a roll, so it stays 80mm.

**Proof.** `test:printPipeline` — the four rows.

### 4.13 — the Settings panel said "Width: undefined"

**Root cause.** The backend sends the receipt layouts with `paper` +
`contentMm` (the printable width in mm) — there has **never** been a
`width` field. The renderer's type asked for `width: string`, and the
panel printed `t('printing.template.width', { width: tpl.width })` → the
literal text **"Width: undefined"** on the owner's screen.

**Fix.** The renderer type now matches the backend (`paper` + `contentMm`),
in **all three** places that carry it (`shared/types.ts`, `Settings.tsx`,
`Billing.tsx`), and the string reads *"Printable width: 72mm"* (Urdu:
*"قابلِ پرنٹ چوڑائی: 72mm"*).

**Proof.** `test:printPipeline` — "every template carries a numeric
contentMm", "no template carries the old (never sent) 'width' field",
"every template names a real paper".

### 4.14 — a preview without its toolbar was reported as a success

**Root cause.** Two related drops:

1. `injectToolbar()` caught its own error and only **logged** it, so a
   preview whose toolbar failed to inject was still reported as *"Preview
   opened."* — the owner got a window with **no Print, no PDF, no Close**
   button and no explanation.
2. The notes a successful print carries ("the *X* layout does not fit your
   paper, so the *Y* layout was used") were **glued onto the success
   message** — and the till screen only ever looked at the **failure**
   messages. The note was therefore **never shown**, so the owner never
   learned that the paper in Settings is wrong.

**Fix.**

- `injectToolbar()` now **rejects**, and `previewDocument()` **awaits** it:
  a failed injection closes the window and returns
  `{ ok: false, message: 'Could not open the preview: …' }`.
- The notes are now **structured** — `PrintResult.warnings?: string[]` —
  and the till screen shows them (`r.warnings`) on a successful print. The
  message is no longer polluted.

**Proof.** `test:printPipeline` — "the toolbar injection is awaited", "a
failed injection closes the window and reports the failure", "the injection
itself rejects on an error (it is not only logged)", "a successful print
returns its notes as data", "the till screen shows the notes of a successful
print".

### 4.15 — the forced "set a new owner password" screen raced the app shell

**Root cause.** This is the one the **15-suite battery** caught (the
`test:ui` suite went **28/30**): the two z-order checks ("the dialog is ON
TOP of the assistant drawer") failed because the **forced
"Set a new owner password"** screen was sitting on top of everything.

The screen itself is **correct** — a forced screen must be above every
dialog. The bug was a **race**:

- `handleLogin()` did `setUser(u)` → `await resolveLanding(...)` → **then**
  `await window.api.auth.defaultPasswordActive()` → `setMustChangePw(true)`.
- The forced screen therefore arrived **one tick (or more) after** the app
  shell. For that window the app was up **without** the forced screen —
  a flash of an app the owner is not allowed to use yet.
- Every UI suite that signs in with the default password waits for "the
  login screen is gone", which was **already true** in that window — so the
  suite went on, the forced screen arrived later, and it stayed on top of
  the whole test. On a **loaded** machine (a battery running 15 suites) the
  window is wide enough to lose the race; on an idle one it was not. The
  Phase 0 and Phase 1 batteries both passed 30/30 — the timing simply
  differed.

**Fix — two layers, so the class of bug is gone and not just this instance:**

1. **The app**: `handleLogin()` now fetches the flag **and** the landing
   page **before** `setUser(u)`, so the app shell and the forced screen are
   rendered in the **same commit** — there is no half-open frame.
2. **The suite**: `scripts/test_uiDefects.cjs` no longer *guesses*. It asks
   the service (`window.api.auth.defaultPasswordActive()`), waits for the
   screen to appear, fills it, and then waits for the screen to **really be
   gone** (the old check — "the login screen is gone" — was true while the
   forced screen was still up). If the screen does not close, the suite now
   **fails loudly** instead of carrying on.

**Proof.** `test:printPipeline` — "the flag is fetched BEFORE the app shell
is rendered (no half-open frame)" (the source offsets are compared), "the UI
suite asks the service instead of racing the screen", "the UI suite waits for
the screen to really be gone". And `npm run test:ui` is back to **30/30**
with the two z-order checks passing (`E:\temp\proof\p4_ui.txt`).

### 4.16 — only the receipt and the invoice previews spoke the shop's language

**Root cause.** 4.5 made the **preview toolbar** bilingual, but only for
the two preview paths that were wired at the time. The **label preview**,
the **purchase-order preview** and the **udhaar statement preview** still
sent no labels, so their toolbars stayed English in an Urdu shop.

**Fix.** The labels are now plumbed through **all three** remaining
paths — the service, the IPC channel, the preload, the shared type and the
renderer call site each carry them (`previewLabels(t)`), with the English
fallback kept for an old caller. `BarcodeGenerator.tsx` and `LabelStudio.tsx`
gained their first `useTranslation` for this.

**Proof.** `test:printPipeline` — for each of the three services, each of
the three IPC channels, the preload and each of the five renderer call
sites: "passes / carries / sends the translated labels" (15 checks).

### 4.17 — a suite was reading the UTC day instead of the shop's business day

**Root cause.** The regression battery ran **at 00:47** (Karachi, UTC+5) and
`test:billAmend` went **88/89**: *"Sales History NET equals Dashboard today
sales -- 0 vs 400"*. The two numbers disagreed because they were asked about
**two different days**:

- the **dashboard** asks for the shop's **business day** (the Phase 0
  resolver — `currentBusinessDate()` in the shop's timezone);
- the **test** asked for `new Date().toISOString().slice(0, 10)` — the
  **UTC** day, which between midnight and 05:00 in Karachi is **yesterday**.

So the app was **right** and the **test** was the one leaking UTC — the very
defect Phase 0 item 0.3 was about. It had been hiding for months because
every battery so far had run in the evening, when the UTC day and the shop's
business day are the same.

**Fix.** The suite now uses the **app's own resolver**
(`currentBusinessDate(startHour, now, getShopTimezone())`), and the legacy
`scripts/smoke.js` got the same treatment for its expense date.

**Why this is in the Phase 4 report.** It is not a printing defect, but it
was found by the Phase 4 battery and it is exactly the kind of bug that a
green battery does **not** prove the absence of. **A green suite is only
evidence for the hour it ran in.**

**Proof.** `npm run test:billAmend` → **89/89, ALL PASSED** at 00:51 local
(`E:\temp\proof\p4_billAmend.txt` after the re-run).

---

## 3. Files

### New
| File | What it is |
|---|---|
| `scripts/test_printPipeline.cjs` | the permanent Phase 4 suite (112 checks) |
| `src/renderer/src/utils/previewLabels.ts` | the one helper that reads the preview toolbar's labels from i18next |

### Changed (the engine)
| File | What changed |
|---|---|
| `src/main/services/printService.ts` | the pure `resolvePrintTarget()` (4.2), `afterPrintActions()` + `runAfterPrint()` + the moved `openCashDrawer()` (4.3), `previewPrintJob()` + the sale id on the job (4.1), the eight new toolbar label placeholders (4.5), `printerKeyForPaper()` + the guarded `printCalibration()` (4.9), the awaited toolbar injection (4.14), `PrintResult.warnings` (4.14) |
| `src/main/services/printing.ts` | the job now carries `saleId` / `duplicate` / `kickDrawer` (4.1); `openCashDrawer` + the drawer setting are re-exported from the engine (4.3); the preview passes the labels (4.5); `resolveCalibrationPaper()` (4.9); the label stock resolver accepts every known size (4.10); the label preview sends the labels (4.16) |
| `src/main/services/purchaseImport.ts` | `purchaseOrderPrinterKey()` — a sheet goes to the invoice printer (4.11); the PO preview sends the labels (4.16) |
| `src/main/services/udhaarPrinting.ts` | `resolveEntrySlipPaper()` — the slip follows the receipt paper (4.12); the statement preview sends the labels (4.16) |

### Changed (the renderer + the bridge)
| File | What changed |
|---|---|
| `src/renderer/src/pages/Settings.tsx` | the Printers & Paper + Receipt Template panels are bilingual (4.4); the template panel shows a real width (4.13) |
| `src/renderer/src/pages/Billing.tsx` | the receipt + invoice previews send the translated toolbar labels (4.5); the till shows the notes of a successful print (4.14) |
| `src/renderer/src/components/UdhaarLedger.tsx` | the receipt + statement previews send the translated toolbar labels (4.5, 4.16) |
| `src/renderer/src/pages/BarcodeGenerator.tsx` | the label preview sends the translated toolbar labels (4.16) |
| `src/renderer/src/pages/LabelStudio.tsx` | the label preview sends the translated toolbar labels (4.16) |
| `src/renderer/src/pages/Purchases.tsx` | the purchase-order preview sends the translated toolbar labels (4.16) |
| `src/renderer/src/components/PurchaseImportWizard.tsx` | the purchase-order preview sends the translated toolbar labels (4.16) |
| `src/renderer/src/App.tsx` | the forced-password screen and the app shell render in the **same commit** (4.15) |
| `src/renderer/src/i18n/en.json` + `ur.json` | the new `printing.*` namespace (4.4 + 4.5); the template width string (4.13) |
| `src/shared/types.ts` | `PrintPreviewLabels` + `PrintSaleOptions.labels` (4.5); `PrintResult.warnings` (4.14); the receipt-template shape (4.13); the labels on the three remaining previews (4.16) |
| `src/main/ipc.ts` / `src/preload/preload.ts` | `printing:previewInvoice` takes the options (4.5); the three remaining preview channels carry the labels (4.16) |
| `package.json` | `npm run test:printPipeline` |

### Changed (the run's own permanent guards — found by the batteries)
| File | What changed |
|---|---|
| `scripts/test_uiDefects.cjs` | the forced-password screen is handled deterministically, not raced (4.15) |
| `scripts/test_billAmend.cjs` | the fixture password now meets the Phase 0 password policy; the "today" now comes from the app's business-day resolver (4.8, 4.17) |
| `scripts/test_billAmendItems.cjs` | the same (the password) |
| `scripts/test_billAmendUi.cjs` | the same (the create **and** the sign-in) |
| `scripts/smoke.js` | the same (the password) + the expense date now comes from the shop's business day (4.8, 4.17) |

> **Why those four changed.** The Phase 0 password policy (`src/shared/passwordPolicy.ts`)
> applies on **create and update**, so the suites that created a user with
> `cashier123` / `manager123` began to crash with *"Password must contain
> an uppercase letter"*. The **app's rule is right**; the fixtures were
> stale. The Phase 0 and Phase 1 batteries never ran those suites, so
> nothing caught it — the 102-suite final battery did. The fix is the
> smallest possible one: the fixture passwords now meet the policy.

---

## 4. Test evidence

### The new permanent suite
`npm run test:printPipeline` → **112/112** — `E:\temp\proof\p4_printPipeline.txt`

### The regression battery
`E:\temp\proof\p4_regr_summary.txt` (the one-line verdict) and
`E:\temp\proof\p4_regr_<suite>.txt` (each suite's own output).

| Suite | Result |
|---|---|
| `npm run typecheck` | exit 0 (`[forbidden-strings] OK`) |
| `npm run build` | exit 0 |
| `npm run test:printPipeline` | **112/112** |
| `npm run test:print` | 138/138 |
| `npm run test:receipt` | 68/68 |
| `npm run test:receiptdesigner` | 73/73 |
| `npm run test:billingSmoke` | 46/46 |
| `npm run test:whatsappReceipt` | green |
| `npm run test:ui` | 30/30 (was 28/30 — the forced-screen race, 4.15) |
| `npm run test:keyboard` | 93/93 |
| `npm run check:migrations` | "Integrity check: ok" |
| `npm run test:billAmend` | 89/89 (after the fixture fix) |
| `npm run test:billAmendItems` | 115/115 (after the fixture fix) |
| `npm run test:billAmendUi` | 38/38 (after the fixture fix) |
| `npm run test:billingKeys` | 26/26 |

> **On the exit codes.** Electron prints a "Network service crashed" banner
> on stderr and Windows then reports a **non-zero exit for a green suite**.
> The batch script therefore judges each suite by **both** its exit code and
> its own `ALL PASSED` / `[FAIL]` marker, and says so in the summary
> (`GREEN(exit-quirk)` when the two disagree).

---

## 5. Risks and honest gaps

### Fixed in this phase but worth knowing

- **The forced-password race (4.15) was hiding since Phase 0.** It only
  showed up on a loaded machine, so a green battery did **not** prove the
  tree was clean. It is fixed in the app *and* in the suite; the lesson for
  the run is that a suite that only checks "the login screen is gone" is not
  checking what it thinks it checks.
- **The label stock was being ignored (4.10).** A shop that bought a size
  the engine knows was printing on a 38×25 page. After this, the stock the
  owner picks is the page that prints — but only for the sizes in
  `LABEL_SPECS`; a size the engine does not know still falls back to 38×25
  (and says so in Settings).

### Still open (deliberately — they are bigger than a defect fix)

1. **The currency policy is not propagated to the printed documents.** The
   Receipt Designer lets the owner set the symbol, the position and the
   decimals for the **designed** receipt, but the **shipped** roll, the
   **invoice**, the **purchase order** and the **udhaar statement** print
   their own money format. Making ONE money format for every printed
   document is a real change to the documents themselves — it is an owner
   decision (which symbol, which position), not a bug fix.
2. **The Receipt Designer only designs the receipt.** The other document
   types (invoice, purchase order, statement, credit slip) have their own
   fixed layouts and the designer cannot touch them. Making the designer
   cover every document type is a large feature.
3. **The legacy receipt-template selector is dead UI on a fresh install.**
   `migration 063` turns the designed path on for an install that never
   applied a custom design, so the "Receipt Template" dropdown in Settings
   and the template dropdown on the till select something the printer
   ignores. Hiding it (or wiring it into the library) is a UX decision that
   changes what the owner sees on two screens; it is on the owner checklist.
4. **A silent print that times out may open a second dialog.** The printer
   driver can take longer than the engine's timeout, and the retry path can
   then ask a second time. Medium-sized, and the fix touches the print
   queue's timing — the phase kept the queue as it is.
5. **The preview window's TITLE is still English** ("Receipt preview"). The
   window title is pinned by the spec and by the AGENTS.md note that it must
   be re-asserted *after* the document loads; the **buttons** are bilingual,
   the title is not.
6. **The WhatsApp receipt is still a plain-text document**, not the designed
   receipt the owner sees on the paper, and it carries no duplicate / amended
   stamp. Changing it means sending an image or a PDF instead of text — a
   bigger change than this phase, and it changes what the customer
   receives.
7. **The rest of the Settings page is still English** (the shop profile, the
   WhatsApp panel, the backup panel, the appearance panel), and **the whole
   Receipt Designer screen is still English** (it has no `useTranslation` at
   all — checked in the code). Both are named surfaces, not accidents; they
   are the next i18n surfaces, and the owner checklist says so.
8. **The preview toolbar's strings are passed from the renderer.** A caller
   that does not send them gets the English defaults — that is the safe
   direction, but it means a new preview call site must remember to pass
   them. The permanent suite now checks every existing call site.
9. **The two links that need a real printer are checked against the source,
   not end-to-end**: `printDocument()` running the after-print rule, and the
   preview's protocol handler building the line-keyed job. The suite says
   so explicitly in the section titles — it does not pretend to have printed
   anything.
10. **The printer itself is still the driver's business.** Darkness, heat,
    the auto-cutter and the roll's calibration are not code; the **test
    pages** (a millimetre ruler + black bars across the printable width) are
    how the owner checks them, and the **Receipt Designer's Test print** is
    how they check a design before saving it.
11. **Money is still SQLite `REAL`** (D3) — unchanged, documented debt.

---

## 6. Next (the phase gate)

Phase 4 is complete and **committed** on the local `main` — **not pushed**,
so the owner can review the diff and the report first. The working tree
holds nothing but the owner's own files (`scripts/seed_demo.js` + the five
stray scripts), untouched and unstaged.

The last phase in the prompt's order:

- **Phase 5** — the release + the owner checklist + the live deploy.

**The owner must still decide:** (a) rotate the SMTP/SMS credentials
(Phase 0), (b) whether the strict password policy is acceptable for the
staff accounts (Phase 0), (c) which built-in receipt template becomes the
shop's default (Phase 2, D23), (d) whether the duplicate settings controls
are cleaned up (Phase 0), (e) whether the shop wants per-branch stock
(Phase 1 risk 1), (f) whether the purchases permission should become a real
per-permission flag (Phase 3 risk 1), (g) whether the WhatsApp receipt
should become the designed document (Phase 4 risk 6), (h) whether the
**currency policy** should reach every printed document (Phase 4 risk 1),
(i) whether the **Receipt Designer** should cover the other document types
(Phase 4 risk 2), (j) whether the **dead legacy template selector** is
hidden or wired up (Phase 4 risk 3).
