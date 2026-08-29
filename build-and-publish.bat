@echo off
cd /d "E:\antigravty\billing softwere\pos-app"
set PATH=C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;%PATH%

REM Get GH_TOKEN from git credential
for /f "tokens=2 delims==" %%a in ('echo password^| git credential fill 2^>nul ^| findstr "password="') do set GH_TOKEN=%%a

echo Starting electron-builder...
npx electron-builder --publish always
echo Done! Exit code: %errorlevel%
