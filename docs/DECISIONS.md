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

