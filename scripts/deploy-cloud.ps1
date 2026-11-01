# Deploy the Cloudflare Worker that serves the live web app (rokar-pos).
#
# Used by the local pre-push hook (.git/hooks/pre-push): a push to main also
# refreshes https://rokar-pos.bakery-saas.workers.dev/app, without needing the
# CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID repo secrets that the CI job
# requires.
#
# Auth: the machine's Wrangler OAuth session, stored by wrangler in
#   %APPDATA%\xdg.config\.wrangler\config\default.toml
# No token is stored in this file or in the repo.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-cloud.ps1
#
# Output: .git/deploy-cloud.log (append-only, truncated at ~1 MB).

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$cloud = Join-Path $repo 'cloud'
$log = Join-Path $repo '.git\deploy-cloud.log'

if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  Remove-Item $log -Force
}

function Write-Log([string]$message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $log -Value $line -Encoding utf8
}

# One deploy at a time: two pushes in quick succession would fight over
# cloud/dist and cloud/web-dist and produce a half-written bundle.
$mutex = New-Object System.Threading.Mutex($false, 'Global\RokarPosCloudDeploy')
if (-not $mutex.WaitOne(0)) {
  Write-Log 'another deploy is already running -- skipped this one'
  exit 0
}

try {
  Write-Log '---- deploy start (push to main) ----'
  $exitCode = 1

  if (-not (Test-Path (Join-Path $cloud 'wrangler.toml'))) {
    throw "cloud/wrangler.toml not found under $repo"
  }

  Push-Location $cloud
  try {
    # npm run deploy = build worker + web app, then wrangler deploy.
    # ErrorActionPreference must be Continue here: wrangler writes progress and
    # warnings to stderr, and with 'Stop' PowerShell turns the first stderr line
    # into a terminating NativeCommandError with an empty message.
    $ErrorActionPreference = 'Continue'
    $output = & npm.cmd run deploy 2>&1 | ForEach-Object { [string]$_ }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
  }

  if ($null -ne $output) {
    foreach ($line in $output) {
      if ($line.Trim() -ne '') { Write-Log $line }
    }
  }

  if ($exitCode -ne 0) {
    throw "npm run deploy exited with code $exitCode"
  }

  Write-Log 'deploy OK -> https://rokar-pos.bakery-saas.workers.dev/app'
}
catch {
  Write-Log "DEPLOY FAILED: $($_.Exception.Message)"
  Write-Log 'Fix: cd cloud; npm run deploy   (run "npx.cmd wrangler login" if the OAuth session expired)'
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
