# Rokar POS — Agent Guide

## Version
**v2.7.0** (Staged Search+Enter 1x/2x/3x + Shared Barcode Scan Hook: Quick Sale, Purchases, Inventory)

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
