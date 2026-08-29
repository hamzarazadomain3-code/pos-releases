# Build script with file-lock handling for ShopKeeper POS
$ErrorActionPreference = "Stop"

Write-Host "=== ShopKeeper POS Build with NSIS ===" -ForegroundColor Cyan

# 1. Kill any running ShopKeeper POS processes
Write-Host "Step 1: Killing existing ShopKeeper POS processes..." -ForegroundColor Yellow
$shopkeeperProcesses = Get-Process -Name "ShopKeeper POS" -ErrorAction SilentlyContinue
if ($shopkeeperProcesses) {
    $shopkeeperProcesses | Stop-Process -Force
    Write-Host "  Killed $($shopkeeperProcesses.Count) process(es)" -ForegroundColor Green
    Start-Sleep 2
} else {
    Write-Host "  No processes found" -ForegroundColor Green
}

# 2. Kill any electron-builder/node processes from previous failed builds
Write-Host "Step 2: Cleaning up stale build processes..." -ForegroundColor Yellow
$staleProcesses = Get-Process | Where-Object { 
    ($_.ProcessName -match 'node|electron|nsis|makensis') -and 
    $_.StartTime -gt (Get-Date).AddMinutes(-60) -and
    $_.ProcessName -notmatch 'Code|opencode'
} -ErrorAction SilentlyContinue
if ($staleProcesses) {
    $staleProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  Cleaned up $($staleProcesses.Count) stale process(es)" -ForegroundColor Green
    Start-Sleep 2
}

# 3. Clean dist_release directory
Write-Host "Step 3: Cleaning dist_release directory..." -ForegroundColor Yellow
$distRelease = "E:\antigravty\billing softwere\pos-app\dist_release"
if (Test-Path $distRelease) {
    # Remove all files first
    Get-ChildItem -Path $distRelease -Recurse -Force -ErrorAction SilentlyContinue | 
        Where-Object { -not $_.PSIsContainer } | 
        Remove-Item -Force -ErrorAction SilentlyContinue
    
    # Remove directories
    Get-ChildItem -Path $distRelease -Recurse -Force -ErrorAction SilentlyContinue | 
        Where-Object { $_.PSIsContainer } | 
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host "  Cleaned dist_release" -ForegroundColor Green
}

# 4. Clean electron-builder cache
Write-Host "Step 4: Cleaning electron-builder cache..." -ForegroundColor Yellow
$cachePath = "$env:LOCALAPPDATA\electron-builder\Cache"
if (Test-Path $cachePath) {
    Remove-Item -Path $cachePath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Cleaned cache" -ForegroundColor Green
}

# 5. Wait for any file system operations to settle
Write-Host "Step 5: Waiting for file system to settle..." -ForegroundColor Yellow
Start-Sleep 5

# 6. Run build
Write-Host "Step 6: Running build..." -ForegroundColor Yellow
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"
Set-Location "E:\antigravty\billing softwere\pos-app"

# Build main and renderer
Write-Host "  Building main process..." -ForegroundColor Cyan
npm run build:main

Write-Host "  Building renderer..." -ForegroundColor Cyan
npm run build:renderer

# 7. Prepare puppeteer
Write-Host "Step 7: Preparing puppeteer..." -ForegroundColor Yellow
npm run prepare:puppeteer

# 8. Run electron-builder with NSIS
Write-Host "Step 8: Running electron-builder (NSIS)..." -ForegroundColor Yellow
$cred = "protocol=https`nhost=github.com`n"
$pw = ($cred | git credential fill 2>$null | Select-String 'password=') -replace 'password=',''
$env:GH_TOKEN = $pw

Write-Host "  Starting electron-builder with GH_TOKEN..." -ForegroundColor Cyan
npx electron-builder --publish always

Write-Host "=== Build completed successfully! ===" -ForegroundColor Green