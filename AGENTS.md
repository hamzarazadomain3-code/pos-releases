# Rokar POS — Agent Guide

## Version
**v2.12.0** (Perpetual one-time licence: no expiry, device-locked, revocable)

## Environment
- Node.js v24.18.0 (portable at `C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64`)
- Shell: PowerShell 5.1
- Platform: Windows 10/11 (`win32`)

## Key Commands

### Typecheck
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npx.cmd tsc -p tsconfig.main.json --noEmit
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npx.cmd tsc -p tsconfig.renderer.json --noEmit
```

### Build
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run build
```

### Test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; node scripts/test_inventoryReports.js
```

### Licensing (perpetual, since 2026-10-03)

**The licence is a one-time purchase and never expires.** This replaced a 1-year
subscription that the marketing site had been contradicting all along (the site said
"No annual lock-in" while `server.js` stamped every key `expires = now + 365 days`).

How it works:
- `license-server` has a `lifetime INTEGER` column. A lifetime key stores
  `LIFETIME_SENTINEL` (`2999-12-31`) in `expires_at` **purely to satisfy that
  column's NOT NULL** — rewriting it would mean a table rebuild. Every expiry
  decision goes through `isLifetime(row)`, so the sentinel is never read.
- `/api/generate` defaults to `lifetime: true`. Pass `lifetime: false` for a dated
  key (rentals, evaluation).
- The client caches this in the `license_lifetime` setting. `ensureLicenseValidSync()`
  runs on **every sale** (`sales.ts`) and returns immediately for a lifetime key, so
  the hot path is one string compare.

Three defects were fixed at the same time. Each looked correct in isolation:
1. **`device_id` was never sent**, so the server's `max_devices` check was dead code
   and one key validated from unlimited machines. With no expiry left, that made a
   perpetual licence trivially shareable, so `/api/validate` now *refuses* a request
   without a `device_id` rather than skipping the check.
2. **A server rejection was swallowed.** `throw new Error(data.msg)` sat inside the
   `try` whose `catch` said "network error", so a `Revoked` or `Expired` response was
   ignored and the shop carried on billing. Rejections are now captured in a variable
   and re-thrown after the `try`. Network failures are still tolerated.
3. **Revocation was unenforceable.** `checkLicense()` runs once at startup and only
   logs its error, and the lifetime shortcut skips the per-sale check. A revoked
   lifetime key is now recorded in `license_revoked` and blocks the next sale.
   `activateLicense()` clears that flag.

`scripts/test_licensing.js` (`npm run test:licensing`) covers all of this with a
stubbed server — 19 checks, including that a perpetual licence passes with the
network down and that a revoked one blocks the next sale. Add a case there rather
than reasoning about the logic by hand.

Keys already issued keep their 365-day expiry and are **not** converted
automatically. To convert them, call `/api/renew` per key (it returns
`{ok:true, lifetime:true}` and changes nothing for a lifetime key, so it is safe to
run against every key), or run `UPDATE licenses SET lifetime = 1` in Turso.

## Password recovery test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:recovery
```
48 checks over the real `recovery.ts` against a throwaway DB: hash domain separation, answer
normalisation, lockout at 5 failures, CLI/service code parity, cross-device + single-use
rejection, and that one shop can be recovered repeatedly.

```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:recovery:ui
```
26 end-to-end checks that drive the REAL renderer in a hidden `BrowserWindow` with the real
preload and real IPC handlers, so it also proves the `recovery:*` channel names line up
end-to-end and the `Ctrl+Shift+Alt+R` chord is armed. Needs a full `npm run build` first
(it loads `dist/renderer`), hence it does not reuse `build:main`.

Two gotchas if you extend it:
- **`.lock-box` is not unique.** The login screen, the auto-lock screen and the forced
  "Set a new owner password" modal all use it. Scope queries to the LAST box in DOM order
  (`window.__t.top()`), never `querySelector('.lock-box')` — the first match is the login
  screen and will silently keep matching "Rokar POS".
- **Injected page helpers are wiped by `window.location.reload()`.** Re-inject via
  `ensureHelpers()` after any navigation.
- PowerShell reports `Exited with code 1` for these Electron runs even on success, because
  Electron prints a `Network service crashed` banner to stderr. Trust the summary line and
  `$LASTEXITCODE`, not the pipeline's exit status.

### Print geometry smoke test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:print
# Add --shots to also write PNGs of every rendered page for visual review:
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; electron scripts/print_smoke.js --shots
```
Three layers of checking, because page dimensions alone hide real defects:
- **Page box** — every generated PDF's actual width/height is measured against the paper spec.
- **Layout audit** (`auditJobLayout`) — measures real element boxes in the loaded page against the PRINTABLE width and fails if anything is clipped. This is what catches receipts arriving sliced. Includes a stress case that renames a product to a 97-character name and restores it afterwards.
- **Content audit** (`readJobText`) — reads back the laid-out text and asserts the expected fields are present, so a markup slip cannot silently drop a column.

The audit runs the *production* job builders (`buildReceiptJob`/`buildInvoiceJob`), so it also covers the template/paper clamping. If `C:` is full, point the DB elsewhere first: `$env:TEMP="E:\tmp-opencode"; $env:ROKAR_SMOKE_USERDATA="E:\tmp-opencode\smokedata"`.

### Marketing screenshots (capture_screens.js)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run capture:screens -- --out E:/tmp-opencode/site/public/screens
```
Boots the real renderer against a seeded demo database and writes WebP screenshots
of Dashboard / Billing / Inventory / Udhaar / Purchases / Reports, plus a
`manifest.json`. The website's ProductTour section uses these instead of hand-drawn
mockups, so **every screenshot shows fictional data from `scripts/seed_demo.js`** —
the website must keep labelling them "sample data".

Seeding is separate (`scripts/seed_demo.js`, also `npm run seed:demo` with
`POS_DB_PATH` pointing somewhere disposable) and goes through the real
`sales`/`inventory`/`purchases` services, so stock movements and customer ledgers
are consistent with real use. It then back-dates the bills across 14 days by
rewriting `sales.created_at`, which is safe only because nothing on the sale path
denormalises a timestamp into an aggregate table.

Four Electron gotchas cost most of the debugging time here. All four fail
*silently* — you get a plausible-looking wrong file rather than an error:
- **`backgroundThrottling: false` is mandatory.** The capture window is parked
  off-screen, so Chromium treats it as occluded and throttles the lazy `import()`
  that loads each page. Navigation silently never completes and every screenshot
  comes out as the *previous* page. Three screenshots came out byte-identical
  before this was found.
- **Wait for the page to render, not for a timer.** Clicking a nav item flips
  `active` synchronously but the component is still loading. Each screen declares a
  `ready` expression (`.page-header h1` text, `.sale-invoice-title`, …) that is
  polled before capturing.
- **The first `capturePage()` after the window is shown throws `UnknownVizError`.**
  Transient — the compositor frame does not exist yet. Retry rather than abort.
- **A dark capture is not necessarily a blank capture.** Rokar's Dashboard is
  genuinely ~42% dark pixels. Detect an unpainted buffer by *uniformity*
  (low standard deviation, >80% dark), not by overall brightness.
- Also: never `await` a `requestAnimationFrame` in this window — it is occluded, so
  rAF is throttled to zero and the promise never resolves. Use a timer.

### Release
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run release
# After it finishes (exit code 1 is EXPECTED when FINALIZE_FAIL: GH_TOKEN not set), publish the draft:
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; $line = Get-Content -LiteralPath ".env" | Where-Object { $_ -match '^(?:GH_TOKEN|GITHUB_TOKEN)=' } | Select-Object -First 1; $p = $line -split '=', 2; Set-Item -Path "env:$($p[0])" -Value ($p[1].Trim().Trim('"', "'")); node scripts/finalize-release.js
```
Note: `npm run release` = build + electron-builder publish + `node scripts/finalize-release.js`. The finalize step does NOT inherit `.env` (dotenv only wraps electron-builder), so it fails with `FINALIZE_FAIL: GH_TOKEN not set` and leaves the GitHub release as a DRAFT — run the second command above to create the tag and publish it (the auto-updater only sees published releases).

**Every release also needs a version-less asset.** Finalize uploads the installer a second time as `RokarPOS-Setup.exe` (no version in the name). The marketing site downloads from `/releases/latest/download/RokarPOS-Setup.exe`, so that name has to exist on every release — otherwise the site's download button silently keeps serving the *previous* installer. If finalize prints `WARN: installer not found`, the alias was skipped and you must upload it by hand:
```powershell
Copy-Item "dist_release\RokarPOS-Setup-<version>.exe" "dist_release\RokarPOS-Setup.exe" -Force
gh release upload v<version> "dist_release\RokarPOS-Setup.exe" --repo hamzarazadomain3-code/pos-releases --clobber
```
This costs ~120 MB of extra release storage per release. It is the price of never editing the website again; do not "optimise" it away without also pinning the site back to a versioned URL.

## Architecture Notes
- **Database**: `node:sqlite` with `DatabaseSync` (via `src/main/db.ts` `getDb()`)
- **Migrations**: `migrations/0XX_*.js` — always use `PRAGMA table_info()` guard pattern
- **Services**: `src/main/services/` — each exports a singleton (e.g., `export const inventoryReports = new InventoryReportsService()`)
- **IPC**: Handlers in `src/main/ipc.ts` under `registerIpcHandlers()`, bridge in `src/preload/preload.ts`
- **Version bump**: Update `package.json` `version` field

## Components
- `migrations/024_inventory_advanced.js` — schema for advanced reports
- `src/main/services/inventoryReports.ts` — purchase history, daily/weekly/monthly inventory, supplier metrics
- `src/main/services/profitability.ts` — daily/weekly/monthly profitability, category analysis, break-even
- `src/main/services/alertService.ts` — low stock, expiry, low profit, slow mover alerts
- `src/main/main.ts` — scheduler (midnight snapshot, hourly alerts)
- `src/main/services/backup.ts` — `runBackup()`/`restoreBackup()` (restore validates the file, checkpoints WAL, swaps the db, re-runs migrations)
- `src/renderer/src/utils/currency.ts` — cached currency symbol + `formatMoney()`/`getCurrencySymbol()` (driven by admin `currency_symbol`/`decimal_places`); use these instead of hardcoded "Rs" in new UI
- `src/renderer/src/components/LiveClock.tsx` — timezone-aware header clock (`clock_timezone` setting)
- `src/renderer/src/hooks/useBarcodeScan.ts` — shared barcode scanner window keydown hook (`{ onScan, minLength=8, scanTimeout=50, enabled=true }`); used in QuickSaleGrid (refactored), Purchases PO modal (new), Inventory (new, always enabled). Scan flush = Enter with buffer >= minLength; capture-phase + preventDefault so it never also triggers staged-search Enter.
- `src/renderer/src/pages/QuickSaleGrid.tsx` — staged search Enter flow (1× select, 2× qty box, 3× add) + shared scanner hook; mirrors Billing keyboard nav / qty dialog
- `src/renderer/src/pages/Purchases.tsx` — PO modal staged search + barcode scan (scan adds/increments line)
- `src/renderer/src/pages/Inventory.tsx` — staged search (1× select highlight, 2× open Edit) + always-enabled barcode scan (found → highlight + auto-edit; not found → prompt "add new product with barcode")
- `src/renderer/src/components/filters/SearchInput.tsx` — optional `onKeyDown` prop (used for staged search in Inventory)
- `scripts/finalize-release.js` — finalizes GitHub release (needs GH_TOKEN — see Release above). Also uploads `RokarPOS-Setup.exe`, the version-less asset the website's `/releases/latest/download/` link depends on.
- `scripts/seed_demo.js` — seeds a disposable DB with fictional shop data through the real services, for screenshots and for poking at the app without touching a real shop's numbers
- `scripts/capture_screens.js` — captures real WebP screenshots of the app for the marketing site (see Marketing screenshots above)
- `scripts/test_inventoryReports.js` — 12-test verification suite
- `src/main/services/printService.ts` — the printing engine (geometry, shared print window, previews, PDF export)
- `scripts/print_smoke.js` — 46-check print geometry/enumeration suite
- `src/main/services/recovery.ts` — password recovery: Option A (security question + owner recovery
  code) and Option B (developer-issued support code). Recovery answers are salted with
  `pos-recovery-salt`, NOT the password salt `pos-salt` — a shared app-wide salt would put answers
  and passwords in one hash domain. Support codes are `HMAC-SHA256(secret, "rokar-recover-v1|device|owner|epoch")`
  truncated to 40 bits and encoded as Crockford base32; `epoch` (`admin_settings.support_epoch`) makes
  each code single-use without needing a clock. Full spec incl. the key: `RECOVERY_CODE_SPEC.md`.
- `migrations/049_password_recovery.js` — `security_question`/`security_answer_hash` on users,
  `recovery_lockout`, `support_recovery_codes`, seeds `device_uuid` + `support_epoch`
- `tools/recovery-code-cli.js` — developer's code generator, run locally, NOT packaged (`build.files`
  excludes `tools/`). `node tools/recovery-code-cli.js <device-id> <request-number> [owner]`
- `src/renderer/src/pages/LoginRecovery.tsx` — login-screen recovery flow (both modes)
- `src/renderer/src/pages/Users.tsx` — "Recovery & Security" card (owner-gated)

## Printing Gotchas (Electron 43.4.0 on Windows)
- **Never pass `pageSize` to `printToPDF`.** Any explicit size fails with `Failed to generate PDF: Printing failed`. Page size comes from the document's own CSS `@page` rule, passed with `preferCSSPageSize: true`.
- **Page size is in microns**, `INCH`/`MM` constants — `MM * 1000`. Printable margin in inches: use `marginType: 'none'`.
- **Do not `destroy()` a `BrowserWindow` and immediately reuse the name.** Either call strands later `loadURL` calls (`ERR_FAILED (-2)`). `printService` keeps one hidden window, closes it (never destroys) and loads each job from a temp file, serialising every job through a queue. If a load still fails it recycles the window and retries once.
- **A `close()`d window is not yet `isDestroyed()`.** `disposeWindow` must also null `sharedPrintWindow`, otherwise the next job reuses a window that is shutting down and burns a failed load + retry every time the app is re-activated.
- **Thermal height is measured from the rendered DOM**, not guessed: narrow the window to the printable width, read `scrollHeight`, then stamp a final `@page { size: <w>mm <h>mm }` rule. Measuring at the wide default viewport yields a wrong height because line wrapping changes.
- **Auto-print must not resolve silently.** The `'auto'` printer setting means "ask every time" — it opens the OS dialog and is never substituted with the Windows default.
- **Hidden windows must not block app quit.** `hasUserFacingWindows()` in `main.ts` excludes the print window from the quit check.
- Printable widths are 52mm on 58mm paper and 72mm on 80mm paper. The shop mixes both — the paper size is a per-slot setting, not an app-wide constant.
- **58mm receipts cannot use the 4-column item table.** A product name, a unit label like "1000 Gram" and two money columns do not fit in 52mm; the table grows past the page and the printer slices the right side off. `receiptTemplates.ts` emits a stacked two-line row (`td.stack`) on narrow paper instead.
- `setAdminSetting` is owner-gated, so background timers (auto-backup) must not use it — write system-managed keys directly.
