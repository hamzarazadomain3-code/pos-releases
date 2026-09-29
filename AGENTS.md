# Rokar POS — Agent Guide

## Version
**v2.8.0** (Reliable printing: 58mm/80mm receipts, A4/A5 invoices, roll & sheet barcode labels, per-slot printers)

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

### Release
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run release
# After it finishes (exit code 1 is EXPECTED when FINALIZE_FAIL: GH_TOKEN not set), publish the draft:
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; $line = Get-Content -LiteralPath ".env" | Where-Object { $_ -match '^(?:GH_TOKEN|GITHUB_TOKEN)=' } | Select-Object -First 1; $p = $line -split '=', 2; Set-Item -Path "env:$($p[0])" -Value ($p[1].Trim().Trim('"', "'")); node scripts/finalize-release.js
```
Note: `npm run release` = build + electron-builder publish + `node scripts/finalize-release.js`. The finalize step does NOT inherit `.env` (dotenv only wraps electron-builder), so it fails with `FINALIZE_FAIL: GH_TOKEN not set` and leaves the GitHub release as a DRAFT — run the second command above to create the tag and publish it (the auto-updater only sees published releases).

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
- `scripts/finalize-release.js` — finalizes GitHub release (needs GH_TOKEN — see Release above)
- `scripts/test_inventoryReports.js` — 12-test verification suite
- `src/main/services/printService.ts` — the printing engine (geometry, shared print window, previews, PDF export)
- `scripts/print_smoke.js` — 46-check print geometry/enumeration suite

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
