@echo off
cd /d E:\antigravty\billing softwere\pos-app
set PATH=C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;%PATH%
rem set GH_TOKEN=YOUR_GITHUB_TOKEN
echo Starting electron-builder at %TIME%...
npx.cmd electron-builder --publish always
echo Finished at %TIME% with exit code %ERRORLEVEL%