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
"%NODE%" tools\deploy.mjs
pause
