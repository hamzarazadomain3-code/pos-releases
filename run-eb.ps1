$ErrorActionPreference = "Continue"
$logFile = "E:\antigravty\billing softwere\pos-app\eb-log.txt"
$token = [System.IO.File]::ReadAllText("E:\antigravty\billing softwere\pos-app\eb_token.txt").Trim()
$env:GH_TOKEN = $token
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;" + $env:PATH
Set-Location "E:\antigravty\billing softwere\pos-app"
& "E:\antigravty\billing softwere\pos-app\node_modules\.bin\electron-builder.cmd" --publish always 2>&1 | Tee-Object -FilePath $logFile
Write-Host "`nBuild finished with exit code: $LASTEXITCODE"
