# Rokar POS — Agent Guide

## Version
**v2.15.1** (Perpetual one-time licence: no expiry, device-locked, revocable)

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

### Billing / shortcut unit tests (pure Node, no Electron)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:holdresume
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:shortcuts
```
`test:holdresume` (26 checks) round-trips a 3-item mixed-unit cart through the
real `serializeCartLine`/`rehydrateCartLines` (in `src/shared/cartMath.ts`) and
asserts pre-hold totals equal post-resume totals — the v2.15.1 Hold→Resume bug
lost `name`/prices and produced NaN. It also covers legacy held payloads and
garbage input, plus `summarizeHeldBill()` — the pure summary (line count, subtotal,
discount, tax, total incl. service charge/freight, customer id) the Held/Quotation
list now renders. `test:shortcuts` (22 checks) asserts the shared registry
invariants (unique combos per screen, DB-seed exclusions, `resolveCombo`
precedence, `screens` scoping, billing hint rows). Both need `npm run build:main`
first, which the npm scripts do for you.

### Image-upload helper test (pure Node, no Electron)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:imageupload
```
23 checks over `src/shared/imageMath.ts` — the gate every "upload an image from
this PC" control runs through: allowed MIME types (SVG rejected), the byte ceiling,
the empty-type passthrough, and `fitWithin()` downscale maths (landscape/portrait/
square, 1px floor, never enlarged). The decode + canvas downscale lives in
`utils/imageUpload.ts` and is covered end-to-end by `test:keyboard`, which fakes a
real file pick via `DataTransfer` and asserts the preview.

### Keyboard navigation test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:keyboard
# follows the same Electron pattern as test_recovery:ui — it needs a full build
# first (it loads dist/renderer), and PowerShell reports exit code 1 even on
# success because of the Electron stderr banner. Trust the "ALL PASSED" line.
```
`scripts/keyboard_smoke.js` (82 checks) drives the real renderer with synthetic
`keydown` events: it signs in, seeds a product and the default shortcut bindings,
then asserts the global layer (Ctrl+K palette, F1 help, Escape), that Ctrl+N opens
each migrated page's primary modal and Escape closes it, that Ctrl+F focuses the
page search box, that the merged **Labels** page opens in Designer mode and switches
to Quick Labels (the former Barcode page) and back, that a dialog's header exposes
minimize + maximize + close and
that maximizing/minimizing/restoring behaves (the docked dialog hands Ctrl+F back
to the page), that ArrowDown highlights an Inventory row and Enter opens its
Edit modal, that the Add Product form accepts an image picked from the PC and
shows a preview, that Ctrl+N on Audits starts an audit with focusable count cells,
that the Billing **Held Bills** list identifies each bill by customer and value, and
that Enter on the login username advances to the password field and submits. It
also runs a **Label Studio crash regression**: with a corrupt saved template and a
stale last-used id it must still mount, show a fallback notice, keep the dialog
stack closed on load (all 7 dialogs were unconditional until 2.15.1) and open the
Template Manager on demand.

## Keyboard navigation

Keyboard-first operation is shared infrastructure, not per-page code. The pieces:

- `keyboard/KeyboardProvider.tsx` — one **bubble-phase** `window.keydown` listener,
  mounted in `App.tsx`. It ignores anything already `preventDefault()`'d (so the
  barcode scanner and any typing win), handles the built-ins Ctrl+K / F1, blocks
  everything else while a palette/help overlay is open, and routes every other
  admin combo to the **active scope**.
- `keyboard/scopeRegistry.ts` + `hooks/useKeyboardScope.ts` — a scope stack. Modal
  scopes rank above page scopes, so an open modal masks the page. `active()` is the
  highest-id modal, else the highest-id page. When no scope is registered the
  provider does nothing, so un-migrated screens keep owning their own keys.
- `shared/shortcuts.ts` — **the single source of truth for every combo.** Each row
  is `{ id, label, defaultKey, screens }` (plus `global` / `dbBacked` / `hint`).
  The main process seeds the admin `shortcuts` table from `DEFAULT_SHORTCUTS`, the
  renderer resolves combos with `resolveCombo()` (admin binding → registry default),
  lookups are **scoped by `screens`** (`isActionAllowedOn`) so F5 means "New bill" on
  Billing but "Add product" on Inventory, and Billing's footer strip + F1 overlay are
  generated from `hintRows('billing')`. Adding a shortcut is one row here.
- `keyboard/shortcuts.ts` — thin re-export of the shared registry for the renderer;
  `GLOBAL_SHORTCUTS` (Ctrl+K palette, F1 help) always work; `BUILTIN_DEFAULTS` only
  carries `new_record` (Ctrl+N) for the provider fallback. Verify the invariants with
  `npm run test:shortcuts`.
- `src/main/main.ts` — the application-menu `reload` / `forceReload` /
  `toggleDevTools` roles carry default accelerators (Ctrl+R, **Ctrl+Shift+R**,
  Ctrl+Shift+I) that would shadow the app's own keys. They are **dev-only** now
  (`app.isPackaged ? [] : [...]`), so a packaged build exposes no Electron
  accelerator that can steal a billing keystroke. Support Recovery
  (Ctrl+Shift+Alt+R) is registered explicitly and kept in both.
- `hooks/useFormKeyboard.ts` — inside a modal: Enter = next field (last = submit),
  Shift+Enter = previous, Escape = close, first control autofocused, numeric fields
  select-all on focus, focus trap. It early-returns on `defaultPrevented`, so a
  field that handles its own Enter (staged search, qty box, line-item cell) wins.
- `hooks/useListKeyboard.ts` — any table/list: ↑/↓/Home/End/PageUp/PageDown
  highlight, Enter opens, Delete deletes (caller confirms), type-to-filter focuses
  the search box. Ignored while a row button/input has focus.
- `hooks/useLineItemKeyboard.ts` — editable grids: `search → qty → price` cycle,
  arrow cells, Ctrl+Enter submit, Delete row, Escape cancel.
- `components/Modal.tsx` — the shared shell every migrated page uses: registers the
  modal scope, wires `useFormKeyboard`, renders `modal-header`/`modal-footer`, and
  carries **window-style min / max / close controls** in the header. Maximize fills
  the viewport (`data-maximized`); minimize docks the panel to a corner bar
  (`data-minimized`) and withdraws the modal scope + form keyboard
  (`useKeyboardScope`/`useFormKeyboard` `enabled: false`) so the page underneath keeps
  working — the form stays mounted, so nothing typed is lost, and clicking the bar
  restores focus. The controls follow `showClose`: a mandatory decision dialog
  (`showClose={false}`) hides them so it cannot be deferred or covered.
- `components/KeyboardInput.tsx` / `QtyInput.tsx` — text inputs that never step on
  ArrowUp/ArrowDown and select on focus.
- `components/KeyboardHelp.tsx` / `CommandPalette.tsx` — the F1 overlay (lists the
  active scope's shortcuts) and the Ctrl+K page switcher.

### Adding keyboard support to a new page

1. Replace each `modal-overlay` block with `<Modal onClose=… onSubmit=… title=… shortcuts=[…]>`.
2. Add `useListKeyboard({ count, onOpen, onDelete })` and spread
   `getContainerProps()`/`getRowProps(i)` on the table wrapper and rows.
3. Add `useKeyboardScope({ kind: 'page', label, actions: { new_record, search, save }, shortcuts: [...] })`.
4. Swap price/qty `<input type="number">` for `<KeyboardInput decimals>`.
5. Add a row to the checklist below and extend `scripts/keyboard_smoke.js`.

### Verification checklist

`A` = asserted by `npm run test:keyboard` (automated). `M` = verified by hand.
Anything not yet migrated is listed under the table.

| Page / Modal | Flow | A | M |
| --- | --- | --- | --- |
| Global | Ctrl+K opens the page palette; Esc closes | ✓ | |
| Global | F1 opens shortcut help; Esc closes | ✓ | |
| Global | F1 lists only the keys valid on the current page | | ✓ |
| Login | Enter on username → password; Enter submits | ✓ | |
| Login | PIN pad tap entry | | ✓ |
| Inventory | Ctrl+F focuses search; ↑/↓ highlight; Enter opens Edit | ✓ | |
| Inventory | Delete removes highlighted product (with confirm) | | ✓ |
| Inventory | Ctrl+N opens Add Product; Esc closes; Enter saves | ✓ | |
| Inventory | Add Product: Upload from PC previews a picked image | ✓ | |
| Any dialog | header has min / max / close; maximize toggles; minimize docks + hands the keyboard back; restoring refocuses | ✓ | |
| Inventory | Barcode scan found → highlight + auto-edit | | ✓ |
| Purchases | Ctrl+N opens Add Supplier; Esc closes | ✓ | |
| Purchases | ↑/↓ rows; Enter opens the row's ledger/PO | | ✓ |
| Purchases PO modal | staged search → qty → add; scanner increments a line | | ✓ |
| Expenses | Ctrl+N opens Add Expense; Esc closes | ✓ | |
| Expenses | ↑/↓ rows; Enter edits; Delete deletes | | ✓ |
| Udhaar | Ctrl+N opens Add Customer; ledger modal Esc closes | ✓ | |
| Udhaar | ↑/↓ customers and ledger rows | | ✓ |
| Transfers | Ctrl+N opens new transfer; Esc closes | ✓ | |
| Transfers | ↑/↓ party/bank/account tables | | ✓ |
| Returns | Ctrl+F focuses search; ↑/↓ sale rows | ✓ | |
| Returns | qty→price Enter cycle; Ctrl+Enter submits | | ✓ |
| Audits | Ctrl+N starts an audit; count cells are focusable | ✓ | |
| Audits | type count → Enter saves and moves to next product | | ✓ |
| Audits | Ctrl+Enter saves progress | | ✓ |
| Promotions / Commissions / Branches | Ctrl+N opens the primary modal; Esc closes | ✓ | |
| Quotations / Users / Custom Reports / Invoice Designer | Ctrl+N opens the primary modal; Esc closes | ✓ | |
| Labels (Quick) | single nav entry (Label Studio); opens in Designer; Quick Labels mode = former Barcode Labels page; Ctrl+F focuses its search; ↑/↓ highlight | ✓ | ✓ |
| Labels | mode switch Quick ↔ Designer | ✓ | |
| Label Studio | Crash regression: mounts with corrupt saved template; no dialog stack on load | ✓ | |
| Label Studio | Ctrl+F focuses the product search (asserted post-mount); ↑/↓ navigates products; Space toggles | ✓ | ✓ |
| Label Studio | image element: Upload from PC, or `{image}` binds the product photo; prints as a real image | | ✓ |
| Reports / FIFO Stock Report | page scope registers (F1 shows the page heading) | ✓ | |
| Reports | ↑/↓ across the analytics tables | | ✓ |
| FIFO Stock Report | ↑/↓ across the per-product batch tables | | ✓ |
| Cash Drawer | focus trap; Esc closes; opening/closing cash don't step | | ✓ |
| Billing | Ctrl+F / F2 focus the search box; footer hints come from the registry | ✓ | |
| Billing | Ctrl+Shift+R opens Return / Refund; Esc closes | ✓ | |
| Billing | Ctrl+S = save, Ctrl+Shift+S = save+print, Ctrl+P = print last | | ✓ |
| Billing | Hold then resume restores a full cart (no NaN) | ✓* | ✓ |
| Billing | Held Bills list shows customer + value; Esc closes | ✓ | |
| Billing payment modal | Enter from **any** field completes the sale (legacy semantics) | | ✓ |

\* the hold→resume round-trip is asserted by `npm run test:holdresume` (pure cart
maths), because the failure mode was a data-loss bug rather than a keydown one.

**Migration status.** Every nav page's modals now use the shared `<Modal>` shell and
`<KeyboardInput>`; `useListKeyboard` runs on the tables and `useKeyboardScope` on the
page. Two things are deliberately still bespoke:

- **`Billing.tsx` / `QuickSaleGrid.tsx` page-level keyboard.** Their window `keydown`
  handlers, scanner and F-/chord shortcuts are left in charge (they register **no**
  page scope, so the global provider does nothing on those screens). Only their modals
  migrated. `<Modal onKeyDown={…}>` runs before the form-keyboard logic and the payment
  modal uses it to keep the legacy "Enter anywhere completes the sale" rule — it must
  also `stopPropagation()` or the window handler fires `completeSale()` a second time.
  Give the payment modal `onSubmit` only if you also keep that guard; the built-in
  Enter→next-field behavior would otherwise make the cashier Tab to "Complete Sale".
- **`App.tsx`'s "Installing update" spinner** and `components/WallpaperEditor.tsx` stay
  as inline overlays — they are non-interactive progress/editor surfaces, not forms.

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

**Every release also needs a version-less asset.** Finalize uploads the installer a second time as `RokarPOS-Setup.exe` (no version in the name). The marketing site downloads from `/releases/latest/download/RokarPOS-Setup.exe`, so that name has to exist on every release — otherwise the site's download button silently keeps serving the *previous* installer. If finalize prints `WARN: installer not found`, the alias was skipped and you must upload it by hand (`gh` is installed and reads `GH_TOKEN`):
```powershell
Copy-Item "dist_release\RokarPOS-Setup-<version>.exe" "dist_release\RokarPOS-Setup.exe" -Force
gh release upload v<version> "dist_release\RokarPOS-Setup.exe" --repo hamzarazadomain3-code/pos-releases --clobber
```
GitHub's upload endpoint takes the **raw file bytes** (`Content-Type: application/octet-stream`, asset name in the `?name=` query string) — it is *not* a `multipart/form-data` upload. If `uploadAsset()` in `finalize-release.js` ever sends multipart, GitHub stores the whole encoded body as the asset: the file becomes ~274 bytes too big and starts with `--<boundary>` instead of `MZ`, so every download is corrupt while the API still reports a plausible size. After any release, sanity-check the alias:
```powershell
curl.exe -sL -r 0-1 "https://github.com/hamzarazadomain3-code/pos-releases/releases/latest/download/RokarPOS-Setup.exe"   # first two bytes must be "MZ"
```
This costs ~120 MB of extra release storage per release. It is the price of never editing the website again; do not "optimise" it away without also pinning the site back to a versioned URL.

### App icon (why `signAndEditExecutable` is false)

`build.win.signAndEditExecutable` is `false` on purpose. electron-builder's built-in
executable editor shells out to `app-builder rcedit`, which unpacks the winCodeSign
bundle with `7za` — and `7za` is not on PATH on these build machines, so leaving it on
makes the whole build abort with `exec: "7za": executable file not found`. Turning it
off kept the build green but silently dropped our icon from `Rokar POS.exe` (Explorer
and the taskbar showed the stock Electron atom), while the NSIS installer/uninstaller
looked correct because NSIS embeds `installerIcon`/`uninstallerIcon` itself.

The icon is now applied by the `afterPack` hook (`scripts/after-pack.js`) using a
vendored `build/tools/rcedit-x64.exe` (needs no external extractor). It sets the icon
plus ProductName/FileDescription/CompanyName/version on the packaged executable. Do not
delete `build/tools/` or the hook, and do not "simplify" it back to `signAndEditExecutable: true`
unless `7za` is guaranteed on PATH. Verify a build with:
```powershell
python <pe-icon-parser> "dist_release\win-unpacked\Rokar POS.exe"   # expect 6 sizes, pixel-exact
```
`build/icon.ico` must stay a **square** multi-resolution ICO (16/32/48/64/128/256). The
canonical source is `build/icon-source.png` (square 800×800, transparent padding). The
raw logo `src/renderer/src/assets/rokar-sidebar-icon.png` is 800×793 — pad it to a square
canvas before resizing, otherwise the ICO frames come out 256×254 etc. and Windows renders
them wrong.

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
- `src/shared/imageMath.ts` + `src/renderer/src/utils/imageUpload.ts` + `src/renderer/src/components/ImageField.tsx` — the "upload an image from this PC" stack. `imageMath` (pure, tested by `test:imageupload`) validates MIME/size and computes the downscale; `readImageFile()` decodes, resizes via canvas (PNG for alpha sources, JPEG for photos) and returns a data URL so a phone photo never bloats a SQLite row or the localStorage quota Label Studio templates live in; `ImageField` is the shared control (Upload from PC + optional URL box + thumbnail + Remove + inline error). Used by the Label Studio image element, Inventory product photo, Settings shop logo and (validation only) the Admin wallpaper.
- `src/renderer/src/pages/Billing.tsx` — the till screen. The Held / Quotation list identifies each bill by **customer + line count + value**, computed from the saved payload by the pure `summarizeHeldBill()` in `src/shared/cartMath.ts` (so one corrupt row degrades to zeros instead of blanking the modal), and the cart's − / + / × controls keep a ≥34px hit area (42px on coarse pointers) for touch terminals.
- `src/renderer/src/hooks/useBarcodeScan.ts` — shared barcode scanner window keydown hook (`{ onScan, minLength=8, scanTimeout=50, enabled=true }`); used in QuickSaleGrid (refactored), Purchases PO modal (new), Inventory (new, always enabled). Scan flush = Enter with buffer >= minLength; capture-phase + preventDefault so it never also triggers staged-search Enter.
- `src/renderer/src/pages/QuickSaleGrid.tsx` — staged search Enter flow (1× select, 2× qty box, 3× add) + shared scanner hook; mirrors Billing keyboard nav / qty dialog
- `src/renderer/src/pages/Purchases.tsx` — PO modal staged search + barcode scan (scan adds/increments line)
- `src/renderer/src/pages/Inventory.tsx` — staged search (1× select highlight, 2× open Edit) + always-enabled barcode scan (found → highlight + auto-edit; not found → prompt "add new product with barcode")
- `src/renderer/src/pages/Labels.tsx` — one sidebar entry ("Label Studio") for all label printing: a **Quick Labels / Designer** mode switch. Quick renders `pages/BarcodeGenerator.tsx` (the former standalone Barcode Labels page); Designer renders `pages/LabelStudio.tsx`. The legacy `barcode` nav key still routes here in Quick mode, so old shortcuts/deep links keep working; the separate Barcode nav entry is gone.
- `src/renderer/src/components/filters/SearchInput.tsx` — optional `onKeyDown` prop (used for staged search in Inventory)
- `scripts/finalize-release.js` — finalizes GitHub release (needs GH_TOKEN — see Release above). Also uploads `RokarPOS-Setup.exe`, the version-less asset the website's `/releases/latest/download/` link depends on.
- `scripts/after-pack.js` — electron-builder `afterPack` hook that embeds `build/icon.ico` + version metadata into the packaged `Rokar POS.exe` with vendored `build/tools/rcedit-x64.exe` (see "App icon" above)
- `build/icon.ico` — the app/installer icon. Must be a square multi-resolution ICO; regenerate from `build/icon-source.png` (square 800×800) with PIL and verify the directory frames are exact squares
- `build/icon-source.png` — square 800×800 transparent-padded copy of the logo, kept so the ICO can be regenerated correctly
- `scripts/seed_demo.js` — seeds a disposable DB with fictional shop data through the real services, for screenshots and for poking at the app without touching a real shop's numbers
- `scripts/capture_screens.js` — captures real WebP screenshots of the app for the marketing site (see Marketing screenshots above)
- `scripts/test_inventoryReports.js` — 12-test verification suite
- `src/main/services/printService.ts` — the printing engine (geometry, shared print window, previews, PDF export)
- `src/main/services/labelStudioPrinting.ts` — Label Studio's main-process half: rebuilds a renderer serialized template into HTML (mm-coordinate elements + `{placeholders}`, barcode/QR via `printDocs.toDataUrl`) and exposes `printBarcodeBatchWithOptions` / `exportLabelBatchToPDF` / `exportLabelBatchToPNG` / `printCalibrationLabel` / `buildLabelStudioJob` / `buildCalibrationLabelHtml`
- `scripts/print_smoke.js` — Print geometry/enumeration suite (page box + layout audit + content audit), run with `npm run test:print`
- `scripts/receipt_design_check.js` — thermal redesign scenario suite (1 item / 6 items + discount + 0.57kg unit / udhaar) against a disposable DB, `npm run test:receipt`
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
- Printable widths are 48mm on 58mm paper and 72mm on 80mm paper (the physical print-head widths of Epson-class 57.5mm / 79.5mm rolls). The shop mixes both — the paper size is a per-slot setting, not an app-wide constant.
- **58mm uses the same item table as 80mm, minus the DISC column.** The redesigned
  thermal receipt (migration 050, `receiptTemplates.ts` `buildRoll`) prints a real
  fixed-width `<table>` on both rolls, never stacked rows. 80mm is
  `# | PARTICULARS | QTY | RATE | DISC | AMOUNT`; 58mm drops DISC (merged into the
  totals block) and spells the second column `ITEM` because PARTICULARS cannot fit
  in 48mm. The DISC column is the only one that can exceed the printable width on a
  narrow roll, which is why it is physically absent there. Columns are explicit
  `<colgroup>` percentages with `table-layout: fixed`; nothing below 58mm content
  is measured.
- **Totals stack on BOTH rolls, never side-by-side.** Measuring the 80mm layout
  found the two-column totals (`CASH … | SUB TOTAL …`) putting the right table
  +11..+18px past the printable edge once a wide payment mode (EASYPAYSA /
  JAZZCASH) met a long NET TOTAL: flexbox `min-width:0` lets the item shrink below
  its table, and the table then bleeds off the page. `buildRoll` emits the payments
  block then the SUB TOTAL / DISCOUNT / NET block as full-width rows with
  right-aligned values. Verify with `npm run test:receipt`, whose layout audit would
  catch a regression.
- **Roll pages must stay portrait.** `resolveGeometry` floors the measured page height at `widthMm + 2`; if the height were ever shorter than the width the driver treats the page as landscape and rotates the receipt 90°.
- `setAdminSetting` is owner-gated, so background timers (auto-backup) must not use it — write system-managed keys directly.

### Label Studio labels (custom per-element templates)

Label Studio lets the owner draw a template (elements at mm coordinates) and print
it, but the renderer cannot print — `window.print()` is dead in Electron. The
template is therefore serialized over IPC and **rebuilt as HTML in the main
process** by `src/main/services/labelStudioPrinting.ts`:

- `printing:printBarcodeBatchWithOptions(ids, size, copies, options)` prints the
  per-element design when `options.template` is supplied, otherwise the stock
  `buildLabelJob` layout (Inventory / Barcode Generator quick labels). `options`
  also carries `printer`, `xOffset`/`yOffset` (mm), `mirror` and `rotation`.
- `{placeholders}` mirror the renderer preview: `{name} {price} {sku} {barcode}
  {expiry} {mfg} {batch} {weight} {shop} {category} {date} {qty} {unit} {image}`. Fields the
  main process cannot know (mfg/batch/weight, and a produce scale weight) render
  empty rather than lying; price uses `printCurrency()` + the `decimal_places`
  setting. Barcodes reject a bogus EAN-13 and fall back to Code 128.
- **Image elements print a real image.** An `image` element carries either an
  uploaded data URL (picked from the PC via `ImageField`) or `{image}`, which binds
  to the product's own photo. Until 2.16 the printer emitted the literal text
  `IMG`, so a logo/photo silently vanished. Only safe sources are emitted
  (`data:image/*`, `http(s)`, `file:`, paths); anything else — e.g. `javascript:` —
  is dropped. `print_smoke` audits the job HTML for both.
- **`LABEL_SPECS` now carries the renderer's other stock sizes** (`40x30`, `50x25`,
  `58x40`, `60x40`) so they no longer silently fall back to 38x25, and an arbitrary
  "custom" size registers a one-off spec via `registerLabelSpec()` so the shared
  `geometryFromSpec` can lay out its roll page. The layout audit iterates
  `Object.keys(LABEL_SPECS)`, so every size is measured automatically.
- **Offsets / mirror / rotation are CSS, not driver options.** `webContents.print()`
  has no alignment controls, so offsets become `body{margin:…mm}` and mirror/rotation
  become a `transform`. A 90° rotation turns the *content* within the label, not the
  physical page — a true landscape label needs the printer driver to rotate.
- **PDF/PNG export returns a Node `Buffer`, which crosses IPC as a `Uint8Array`**
  (not a `Blob`). The renderer wraps it: `new Blob([new Uint8Array(result.data)])`.
  The shared type is `data?: Blob | Uint8Array`.
- `printCalibrationLabel(size)` prints one label-sized sheet (outline + mm ruler +
  TOP/LEFT/CENTER guides) so the owner can line the label stock up before a run.
- Verification: `npm run test:print` now audits the custom-template job too
  (`buildLabelStudioJob`) — page box, clipping, placeholder resolution, the
  image element (`<img>` + `{image}` + the `javascript:` guard), the
  PDF/PNG export bytes and the calibration sheet.

### Receipt typography (thermal darkness / readability)

Thermal receipts were printing faint and smaller than competing POS receipts. The
rendering pipeline is Chromium → Windows printer driver (`webContents.print`), so
there is **no ESC/POS `setDensity`/heat command and no DPI/quality option** — the
head's darkness is a driver setting (Printer properties → Darkness/Heat = High,
economy off). The only levers in code are glyph weight, size and colour, because a
1-bit thermal head drops the grey anti-aliased edges of thin glyphs.

`buildRoll()` in `receiptTemplates.ts` prints with:
- A per-paper type scale in **px** (the render pipeline is a fixed 96dpi CSS space,
  so px is as deterministic as pt; geometry stays mm/pt): shop name 22px, address /
  contact / header lines 14px, meta + totals 13px, item rows 13px, column headers
  12px, NET TOTAL 17px, unit/promo 10px, footer 11px. The 58mm layout subtracts 2px
  from every size.
- `font-weight: 700` on all body text (800 for shop name / serial / money / NET
  TOTAL, 900 for NET TOTAL).
- pure `#000` everywhere (no `#333` greys, no green promo).
- `-webkit-text-stroke: 0.15pt #000` to thicken strokes on the thermal head.
- `Arial, Tahoma` first (solid bold) plus Urdu-capable fallbacks.

The `receipt_font_size` setting (Settings → Billing: small/normal/large) now actually
does something — it applies a `-2px / 0 / +2px` delta to that scale, so a shop can
tune the print without a rebuild.

The item table prints **money without the currency prefix** (the `Rs` is shown once, on
NET TOTAL): several `Rs ` prefixes plus the numeric columns do not fit the printable
width. The bug where QTY/RATE/AMOUNT ran together (`1 Piece Rs 550.00Rs 550.00`) is
prevented by `table-layout: fixed` + an explicit `<colgroup>`; the smoke test asserts
the column header is present and the layout audit asserts nothing crosses the
printable width. Both rolls now use that table (58mm drops DISC, see above). A money
string longer than 7 characters gets the `lg` class and drops one font step so a large
amount stays on one line, and `INV-YYYYMMDD-NNNN` degrades to `INV-MMDD-NNNN` rather
than wrapping.

Editable receipt content lives in migration `050_receipt_design.js`
(`receipt_header_lines` JSON array, `receipt_terms_text`, `receipt_software_by`,
`receipt_show_serial_number`), surfaced in Admin → System Settings → Billing. The old
`receipt_header_text` is no longer rendered at the top; the footer message is
`receipt_footer_text` (default "Come again soon!").

Run `npm run test:print` after any typography change; it measures real element boxes
against the printable width.
