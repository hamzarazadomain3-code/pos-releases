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
