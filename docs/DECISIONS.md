# DECISIONS — Phase 0 (master-prompt run)

One entry per judgement call. Newest last. The master prompt's rule 2 requires
ambiguity to be decided here instead of guessed in code.

## D1 — Baseline is v2.32.0, not v2.22.0

The prompt says the app shows 2.22.0. The tree is **2.32.0** and
`PROGRESS.md` / `REPORT.md` record the runs that got it there. Treating the
older number as the baseline would mean re-implementing shipped work and
re-breaking it. **Decision:** the prompt's Phase 0 table is the spec; each item
is checked against the real code and only the missing part is built.

## D2 — One plan, one ledger, one report per phase

- `docs/PLAN.md` — architecture map, status matrix, order of work (this run).
- `PROGRESS.md` — the existing run ledger (kept, one row per shipped item).
- `REPORT.md` — the existing long-form reports (kept).
- `docs/PHASE0_REPORT.md` — written at the end of Phase 0 with real outputs.
- `CHANGELOG.md` — created in this run; one line per fixed item.

## D3 — Money stays REAL in Phase 0 (documented debt)

The schema stores money as SQLite `REAL` (`sale_items.unit_price`,
`line_total`, `sales.total_amount`, …) across 90 migrations and a live shop's
data. Converting every column to integer paisa is a data migration with
rounding decisions per column, and a mistake would change historical bills.
**Decision:** Phase 0 keeps the storage format, centralises rounding at the
existing computation points, and never introduces a new float-only money path.
A full paisa migration is deferred to its own phase with a populated-copy test
and a backup; it is listed as debt in `PLAN.md`.

## D4 — Mojibake is fixed at the source first

`reports.ts` and `Inventory.tsx` contain literal `â€"` / `â€¢` sequences (real
mojibake, confirmed by code points, not a console artefact). **Decision:** fix
the source strings to real UTF-8, add a permanent scan test, and only then
inspect stored DB text. A DB repair, if needed, gets a backup + an idempotent
migration that matches exact mojibake sequences — never a blanket re-encode.

## D5 — Item 0.1 needs no code change

The `si.price` → `si.unit_price` fix (A6) is already in the tree, with a
regression assertion in `scripts/test_audit_fixes.js`. **Decision:** do not
touch the working queries; verify them (done: `test:audit` 48/48,
`test_inventoryReports` 12/12) and record the remaining proof gap honestly —
no Electron test clicks every Reports tab yet.

## D6 — Test harness conventions

- Electron UI suites: real built renderer, `POS_DB_PATH` throwaway DB,
  `app.getAppPath()` pinned to the project root; PowerShell may report exit 1
  because of Electron's stderr banner — trust `$LASTEXITCODE` / the
  `ALL PASSED` line.
- Pure suites import `dist/shared/*` or `dist/main/services/*` after
  `npm run build:main`.
- Proofs: `E:\temp\proof\p0_<item>_*.txt`; a claim without a saved output is
  not DONE.

## D7 — Secrets

Secrets (SMTP password, API keys) must be masked in every view and log, and
encrypted with Electron `safeStorage` in the main process. The currently
exposed Gmail app password cannot be un-leaked by code: the owner must rotate
it (a CHANGELOG/owner note will say so without printing the value). No secret
is ever printed by tests or scripts.

## D8 — No new dependencies

Phase 0 uses what the repo already has (React, Vite, node:sqlite, pdfkit,
xlsx, bwip-js, qrcode, nodemailer, i18next). A new dependency needs a written
reason here first.

## D9 — IPC error wrapper shape (for 0.2)

The 383 handlers have mixed success shapes and callers depend on them.
**Decision:** do not change any success return value. Wrap handler
registration so a *thrown* error is logged in full to the main-process log
file, and reaches the renderer as a friendly, translated message plus a short
error id (e.g. `R-3F2A`) that the log can be searched by. Validation messages
that handlers already return deliberately (e.g. `{ ok:false, message }`) are
kept as they are.

## D10 — One business day, one display conversion

Timestamps are stored in UTC (existing convention). “Today” comes only from
`resolveBusinessRange()` (`src/shared/salesHistory.ts`) using the
`clock_timezone` setting (default `Asia/Karachi`). Display conversion happens
once, in the renderer's date/time formatter; a new `new Date(...).toISOString()`
slice for a user-facing date is forbidden.

## D11 — The IPC error id carries the time and a random suffix (0.2)

The prompt asks for a short id the owner can quote. A four-hex id alone repeats
across a busy day, so the id is `E-YYMMDDHHMMSS-XXXX` (time + 4 random hex).
The full stack (with the secret values scrubbed) goes to the main-process log
file; the renderer only ever gets the friendly bilingual message and the id.

## D12 — The credential vault covers exactly five keys (0.15)

The scope is the credentials that sit in `admin_settings` as plain text:
`email_smtp_pass`, `sms_api_key`, `sms_api_secret`, `whatsapp_api_token`,
`whatsapp_token`. The assistant's own API key and the licence key have their
own flows (provider settings / the licence file) and are **not** part of this
vault. The value is stored as `enc:v1:<base64>` — the OS key store does the
work, so a copied database file is useless without the shop's Windows user.

Two fallbacks are deliberate:

- **No key store** (a rare box without a keyring): the value is stored as it
  is and one warning is logged. Blocking the shop from saving its SMTP
  password would be worse than the risk; Windows always has DPAPI.
- **A value that cannot be decrypted** (another machine, another user, a
  corrupt blob): it reads as empty, never as the cipher text, so the shop is
  told to re-enter the password instead of sending garbage to the provider.

A legacy plain-text value still works and is migrated in place on its first
read, so no shop has to re-enter anything.

## D13 — The password policy is enforced in ONE place (0.15)

The policy was already stored and read, but only the LENGTH was enforced.
**Decision:** the rules live in the pure `src/shared/passwordPolicy.ts` and
every user write (create + update) goes through it. A PIN is **not** a
password: the cashier's 4-digit PIN stays 4 digits (the complexity rules and
the length rule are skipped for it; the separate 4-10 digit rule still
applies).

## D14 — A modal is above the assistant drawer (0.14)

The assistant drawer (`.assistant-panel`, z-index 60) used to sit above the
modal overlay (50): the drawer covered the dialog's right edge and the
**docked (minimized) card disappeared behind it**, so the cashier could not
bring the dialog back. **Decision:** the modal overlay moves to z-index 70 —
above the drawer, below the auto-lock overlay (100) and the mobile sidebar
(1000), so a dialog is still modal and the docked card is always reachable.

## D15 — The PO supplier dropdown asks before it re-labels an order (0.14)

Changing the supplier of an order that already has lines used to re-label the
whole order silently (the items added for supplier A were created against
supplier B). Nothing was lost, but the order was wrong. **Decision:** the
dropdown never throws the owner's work away — the order is held back and the
owner chooses one of three explicit outcomes: keep the items for the new
supplier, go back to the old supplier, or remove the items. The order cannot
be created (nor drafted) until that question is settled.

## D16 — The same product is merged, never shown twice (0.14)

Two paths could put one product on two rows: the cart's Undo (it re-inserted
the removed line blindly) and the PO modal's per-row product cell. **Decision:**
both MERGE the quantity into the row that keeps the product instead of adding a
twin — the same rule the PO modal already applied at save time (with a prompt).
The cart's normal "add the same product again" path is unchanged: it already
increases the quantity of the existing row.

---

# Phase 1 — the product / inventory data model

## D17 — "Expired" means BEFORE today, and there is ONE rule (1.5)

The expiry question was answered in four places with two different answers: the
sale, Billing and the held-bill list used `date < today` (a product expiring
today was sellable) while the inventory report used `days_until_expiry <= 0`
(a product expiring today was EXPIRED). **Decision:** the rule lives in
`src/shared/expiry.ts` and nowhere else.

**THE RULE:** a date is expired when it is **before** today. A date that falls
on today is still sellable — the shop sells through the expiry date and it
becomes expired at midnight. A missing or unreadable date is **never** expired
(we never block a sale on a value we do not understand); an unambiguous
`DD/MM/YYYY` date is understood, an ambiguous `03/05/2026` is not.

## D18 — An expired BATCH is not sellable, but a manager may still sell it (1.6)

The sale only ever looked at the product's own expiry date, so a batch that was
past its expiry could leave the shelf silently, and a product whose product
level date was past was blocked even when a fresh batch was sitting there.
**Decision:** the batch that would actually be consumed decides. FIFO **skips**
the expired batches; if the fresh stock cannot cover the line and expired stock
is all that is left, the line is blocked as expired. The existing manager
override (PIN + reason + an activity-log row) still applies — and an approved
expired line is sold from the expired batch, exactly as the manager asked.

## D19 — The FIFO deduction is all-or-nothing (1.1)

`deductStockFIFO()` wrote `batch.quantity -= take` for every batch it touched
and only then checked whether it had enough. The error was thrown with the
batches already short, and `adjustStock()` has no transaction of its own — so a
refused manual adjustment silently destroyed batch stock while the product
stock and the ledger stayed untouched. **Decision:** the deduction is atomic.
The batches are given back before the error is thrown, and the manual
adjustment runs inside a **SAVEPOINT** (not `BEGIN` — the caller may already
own a transaction, the udhaar write-off does).

## D20 — The stock ledger records WHO and WHERE (1.8)

`recordMovement()` could not write `user_id` or `branch_id` at all, so every
sale, purchase, return, void, audit correction and manual adjustment was an
anonymous line and the branch columns were dead. **Decision:** the ONE writer
of `stock_movements` takes the user and the branch, and every caller passes
them. The branch is read from the `current_branch_id` setting (the same one
the branches screen writes) — the stock ledger never depends on the branches
service, which would be an import cycle.

## D21 — One unit-conversion rule, and the stock is in BASE units (1.12)

The conversion lived in `purchaseCalc.ts` and rounded to FOUR decimals while
the stock itself rounds to THREE, so a batch quantity and `products.stock_qty`
could drift apart by 0.0001. **Decision:** `src/shared/units.ts` owns the rule
(`baseQty = qty × quantity_in_base_units`, `costPerBase = cost ÷ factor`, the
quantity rounded to the app's 3-decimal stock precision). A missing or zero
factor means **1**, never zero.

The purchase import is part of the same rule: the wizard resolves the file's
`unit` column against the product's own units and sends the factor, so
"2 box" of a 12-piece box puts **24 pieces** on the shelf (and the undo takes
all 24 off again — it used to take off 2). An unknown unit name is never
guessed: the line stays in base units.

## D22 — The purchase line snapshot is COMPLETE (1.10 / 1.11)

`purchase_items` carries both a modern pair (`batch_no`, `received_qty`) and a
legacy pair (`batch_number`, `quantity_received`), and the canonical purchase
wrote only the modern one — so the purchase-expiry alert (which reads the
legacy pair) never saw a normal purchase. The same insert also dropped
`unit_name` and `total_cost`. **Decision:** the canonical purchase writes
**both** pairs plus the unit and the line total, and the reports read the
columns that actually exist (`COALESCE(received_qty, quantity_received, 0)`).
The two broken report queries (they selected `pi.quantity_ordered`, a column
that has never existed) are fixed and now covered by a permanent test.

---

# Phase 2 — the receipt designer + the template library

## D23 — the template library ships with NO default set

The receipt design itself is behind a safety switch (`receipt_design_enabled`
= `'false'`, migration 055), so an install that never opens the designer
prints byte-identical receipts. The **library** had to make the same promise:
the eight built-in templates are starting points, not shop designs, and
picking one of them for the shop is the owner's decision.
**Decision:** `defaultLibrary()` carries the built-ins and **no defaults at
all** (`defaults` is empty; the branch defaults are empty too). A missing
library therefore means "built-ins, none chosen" — never "the first built-in
wins by accident". `normalizeLibrary()` keeps that promise even against a
hand-edited file: a default that points at a missing template is dropped, and
a spoofed built-in id is ignored (the built-ins are canonical).

The resolution order is fixed and tested: **branch default → global default →
the applied design**. `resolveLibraryDefault()` returns `undefined` when
nothing is set, and the print path then uses the applied design — so a
library that was never touched changes nothing.

---

# Phase 3 — the purchase-order screen

## D24 — the purchase permission is the MANAGER rank, enforced in the service

`manage_purchases` and `can_import_purchase` exist in `RolesPermissions.tsx`
but nothing read them: the rule lived only in the sidebar
(`minRole: 'manager'`), so the IPC handlers were open to any signed-in user.
**Decision:** the service enforces **`can('manager')`** — the SAME rank the
sidebar already used for the Purchases page — on every mutating action
(create, receive, cancel, pay). The import keeps its own
`requireImportPermission()`.

Why the rank and not the flag: `auth.can()` is a role-rank helper over
`src/shared/roles.ts`; a per-permission flag would need a second mechanism
that no other service uses, and the two would drift. The gap this leaves is
named honestly in the report (a shop cannot yet say "the cashier may receive
but not create").

## D25 — a receipt is addressed to a LINE, never to a product

The old receipt aggregated the requested quantities into a
`Map<product_id, …>` and read that map for **every** line of the product, so
an order with two lines of the same product (two batches, two prices)
received the requested amount **twice**. **Decision:** the receipt is
addressed to `purchase_items.id` (`item_id`). The old `product_id` shape is
still accepted for the existing callers, but it is applied to the **first
outstanding line only** — never to every line of that product. A line may
legitimately be split by batch, so the duplicate-product rule stays a SCREEN
rule (the screen merges the lines for the owner); the service accepts them.

## D26 — one money rule: the service calls the screen's own `validatePo`

The screen had always refused a negative freight, a discount above 100 %, a
negative tax and a paid-now amount above the order total; the service
accepted all of them, so a direct IPC call could write an order the screen
would never create. **Decision:** the service calls the **same**
`validatePo()` from `src/shared/purchaseCalc.ts`, and the validator now
computes the totals itself when the caller does not pass them. The one error
the service ignores is `duplicate_product` (see D25).

The order of the two refusals matters and is fixed by the code: the money is
validated **before** the shift rule, so an order that is wrong in both ways
reports the money first — the same order the screen shows.

## D27 — the received counter: the NEW column wins, the LEGACY one fills in

`received_qty` (migration 064) and `quantity_received` (migration 024) are
the same number in two columns. Rows written before migration 064 carry the
truth only in the LEGACY column — and the new column exists and holds **0**,
not NULL — so a plain `COALESCE(received_qty, quantity_received)` read **0**
for them: the shop was told nothing had been received while the goods were on
the shelf. **Decision:** one SQL fragment owns the rule —
`RECEIVED_QTY_SQL` in `src/main/services/purchases.ts`: the NEW counter wins
whenever it holds a number; the legacy one fills in only when the new one is
still empty. Every read uses it. Migration `091` backfills the old rows in
place (idempotent, additive — it only fills an empty new counter, so it can
never lower a counter that is already right).

## D28 — a batch number IS a batch

The same batch number could land on two different rows (the number was built
from the product id + a timestamp), and a second receipt of the same batch
created a **twin** row instead of adding to the existing one.
**Decision:** `inventory.addToBatch()` owns the rule — a batch number
identifies ONE batch; adding to it adds the quantity to that row and never
creates a duplicate. The purchase receipt and the import both use it. The
batch number of a purchase line is unique **per line**.

## D29 — the import's undo is refused once the order has been received

The undo removed the imported stock and the purchase rows, with nothing
stopping it after the shop had already received the order — the stock left
the shelf while the goods were physically there, and the purchase row was
gone, so nothing could ever be received again. **Decision:** an undo of a
**received** order is refused and the owner is told why. An order that was
never received can still be undone exactly as before (the base-unit reversal
from Phase 1 is unchanged).

## D30 — the Purchases surface is bilingual, and the reason travels as a CODE

The Purchases screen, the PO modal and the import wizard were hard-coded
English — the one surface an Urdu shop could not read.
**Decision:** a new `purchases.*` namespace in **both** `i18n/en.json` and
`i18n/ur.json` (the same keys in both files, and the parity is a permanent
check). The validation reasons travel as the **error CODE**
(`VALIDATION_MESSAGE_KEYS`: code → i18n key), never as a sentence: the
renderer asks i18next for the sentence in the shop's language, and the main
process uses `VALIDATION_MESSAGES` (English), because an IPC error is a
technical message, not a screen.

## D31 — a purchase order carries the branch, and `updated_at` moves

`purchase_orders.branch_id` (migration 038) and `purchase_items.branch_id`
were never written, and the header's `updated_at` never moved.
**Decision:** the branch is read from the `current_branch_id` setting (the
same one the branches screen writes — the purchase service never depends on
the branches service, which would be an import cycle) and is written on the
header **and** on every line; the header's `updated_at` moves on every
write. The branch is still only **recorded** — the stock itself is still one
number per product (Phase 1 risk 1).

---

# Phase 4 — the printer pipeline

## D32 — the printer-resolution policy is ONE pure, exported rule

The decision "which printer, silently or with a dialog?" used to live in a
private function that read the shop's settings from the database. The rule
itself was correct; the problem was that **no test could reach it**, and it
is the one function that decides whether the receipt lands on the right
device. **Decision:** the policy is now a **pure exported function**
(`resolvePrintTarget(input, printMode)` in `printService.ts`) and the
database-reading wrapper is only glue. The policy is unchanged:

- a printer named in Settings → silent, to that printer;
- the explicit `DEFAULT_PRINTER` sentinel → silent, to the **Windows
  default**;
- `AUTO_PRINTER` ("ask every time") and "nothing configured" → the **OS
  dialog**.

The app **never** silently prints to the Windows default unless the owner
explicitly picked the "System default printer" option. A Windows default
that is a file-output printer (XPS, Print to PDF, OneNote) turns a silent
print into a save-file prompt; a default on a `nul:`-port software printer
makes the job vanish — which is what surfaced as random applications
opening on the till.

## D33 — the after-print behaviour is ONE rule, and it lives in the engine

"What happens after a successful print" lived inside
`printing.printSale()`. The drawer pulse and the "last printed sale" write
were therefore attached to **one call site**, not to the print — so the
preview window's Print button (which calls the engine directly) silently
skipped both. **Decision:** the whole after-print behaviour moved into the
**print engine** (`printService.ts`):

- `afterPrintActions(job, drawerKickEnabled)` — the pure rule;
- `runAfterPrint(job)` — the rule plus the two effects;
- `openCashDrawer()` — moved here from `printing.ts` (the drawer is wired
  into the receipt printer, so it is a print-pipeline concern) and
  re-exported from `printing.ts` so no caller changed.

The rule: a job that carries **no sale id** is not a customer receipt (an
invoice, a label, the test print, the calibration sheet) — it never records
a sale and it **never** pops the drawer. A job that carries a sale id
records it; the drawer pops only for a **fresh** receipt, never for a
reprint, and the caller can force it either way.

## D34 — the preview window's Print button behaves exactly like the direct print

The preview is built from the **same job** as the paper, so the document was
always right — but the two **side effects** were not, because the preview
called the engine while the direct print called the service. **Decision:**
the job itself says what it is (`saleId`, `duplicate`, `kickDrawer`), the
engine runs the one after-print rule (D33) whenever a print **succeeded**,
and the preview's protocol handler builds its job with `previewPrintJob()`
so it carries the sale id and the "this is a reprint" flag.

Consequence: printing from the preview now pops the drawer (for a fresh
receipt) and "Reprint last receipt" reprints the sale the cashier actually
printed — the same as the direct print.

## D35 — the preview toolbar's strings are sent by the renderer

The preview window is a plain `BrowserWindow` with **no preload**, and its
toolbar is injected by the **main process**, which cannot read the
renderer's i18n files. Every label was therefore an English literal.
**Decision:** the toolbar's strings are **placeholders**, and the **renderer
sends the translated strings with the request** (`PrintSaleOptions.labels`,
built by `src/renderer/src/utils/previewLabels.ts`). The main process keeps
the English strings as the **fallback**, so a caller that sends nothing
still gets a working toolbar.

The **window title** stays English ("Receipt preview"): it is pinned by the
spec and by the rule that it must be re-asserted *after* the document loads
(the document's own `<title>Receipt</title>` otherwise overwrites it).

## D36 — the printer surface is bilingual under a new `printing.*` namespace

`Settings.tsx` had no `useTranslation` at all, so the Printers & Paper and
Receipt Template panels — the one screen where an Urdu shop sets up its
printer — were English only. **Decision:** a new `printing.*` namespace in
**both** `i18n/en.json` and `i18n/ur.json` (the same keys in both files, and
the parity is a permanent check), covering the two panels and the preview
toolbar. The two paragraphs that carry **bold / italic** use `Trans`, so the
emphasis survives the translation instead of being flattened into the text.

The rest of the Settings page and the whole Receipt Designer screen are
still English. They are named surfaces, not accidents: the designer screen
has no i18n at all, and it is the next surface on the list.




## D37 - one rule for "which printer slot does this paper belong to?"

The audit found three places that decided "receipt printer or invoice
printer?" by hand, and each was wrong in a different way: the calibration
sheet always used the receipt printer (so an **A4** test page went to the
thermal printer), and the purchase-order path used `paper === 'a4' ? ...`
(so an **A5** order went to the thermal printer too). **Decision:** one
exported rule, `printerKeyForPaper(paper)` in `printService.ts` - a **ROLL**
(58/80mm) belongs to the **receipt** printer, a **SHEET** (A4/A5) to the
**invoice** printer. The purchase-order service uses the same idea through
its own `purchaseOrderPrinterKey()` (it lives in a different module, so it
cannot import the engine's helper without a cycle).

## D38 - an unknown paper is a controlled failure, never a crash

`PAPER_SPECS` has four keys (`thermal58` / `thermal80` / `a4` / `a5`), and
`'receipt'` is **not** one of them - yet the Settings screen passed
`'receipt'` to the test-page button, and the value was dereferenced blind.
**Decision:** the paper a calibration sheet uses is resolved by one function
(`resolveCalibrationPaper()`), which maps `'receipt'` to the receipt paper
the **shop** uses and falls back to it for anything unknown, so a bad key can
never reach `PAPER_SPECS`. `printCalibration()` additionally fails with a
**message** (`Unknown paper: ...`) instead of throwing.

## D39 - the label stock the shop configured IS the page that prints

The engine knows eight label sizes; the resolver accepted three and quietly
fell back to `38x25` for the rest, so the printed page did not match the
physical stock. **Decision:** the resolver accepts **every size in
`LABEL_SPECS`** and falls back to `38x25` only for a value the engine does
not know. The rule is exported so the permanent suite can pin it per size.

## D40 - the notes of a successful print are structured, not glued onto the message

The engine reported "the chosen layout does not fit your paper" by
appending it to the success message; the till screen only ever read the
**failure** messages, so the owner never saw it. **Decision:**
`PrintResult.warnings?: string[]` - the notes travel as **data**, the
message stays clean, and the renderer decides to show them. A preview whose
toolbar failed to inject is also reported as a **failure** now (the
injection is awaited and rejects), because a preview with no Print / PDF /
Close button is not a preview.

## D41 - the forced "set a new owner password" screen may not race the app shell

The screen is correct and must be above every dialog. The **race** was not:
the flag was fetched *after* `setUser()`, so for a frame the app was up
without the forced screen - and every UI suite that signs in with the
default password could lose that race (on a loaded machine one did, and
`test:ui` went 28/30). **Decision:** the app fetches the flag **and** the
landing page **before** `setUser()`, so the shell and the forced screen are
rendered in the **same commit**; and a suite that must clear the screen
**asks the service** (`window.api.auth.defaultPasswordActive()`) and waits
for the screen to really be gone instead of guessing from the DOM.

## D42 - every preview toolbar speaks the shop's language

D35 made the preview toolbar bilingual, but only for the two preview paths
that happened to be wired. **Decision:** the labels are plumbed through
**every** preview path (the receipt, the invoice, the labels, the purchase
order, the udhaar statement) - service, IPC channel, preload, shared type
and renderer call site each carry them - and the permanent suite checks
every call site, so a new preview cannot silently be English-only.
## D43 - a suite asks for the SHOP's business day, never the UTC day

The app resolves "today" through `currentBusinessDate(startHour, now,
timezone)` in `src/shared/salesHistory.ts` - the Phase 0 resolver. One of the
run's own suites did NOT: it used `new Date().toISOString().slice(0, 10)`,
which is the **UTC** day. Between midnight and 05:00 in Karachi the UTC day
is **yesterday**, so the suite compared the history of one day with the
dashboard of another and failed (88/89). **Decision:** every suite that needs
"today" asks the app's own resolver - `currentBusinessDate(0, new Date(),
getShopTimezone())` - never the raw UTC date. The lesson is recorded here
because it is a property of the **clock**, not of the code: a green battery
is only evidence for the hour it ran in.