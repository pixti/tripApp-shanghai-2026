@echo off
cd /d "%~dp0"
set "NODE=node"
node -v 1>NUL 2>&1
if not errorlevel 1 goto run
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto run
echo Node.js not found. Install it from https://nodejs.org
pause
exit /b 1
:run
rem Refresh subway routes from Amap (run in China daytime 07-21)
"%NODE%" tools\trip.mjs pull
"%NODE%" tools\routes.mjs
if errorlevel 1 goto end
"%NODE%" tools\trip.mjs push
if errorlevel 1 "%NODE%" tools\trip.mjs seal --data
:end
pause
