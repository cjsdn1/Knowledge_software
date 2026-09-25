@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if exist "node_modules\pdfjs-dist\package.json" goto ready
echo Installing project dependencies...
call npm install
if errorlevel 1 goto failed

:ready
node scripts\launch-workstation.mjs
if errorlevel 1 goto failed
node scripts\open-workstation.mjs
if errorlevel 1 goto browser_failed
exit /b 0

:no_node
echo Node.js 22.13 or newer is required.
goto failed

:browser_failed
echo Server started, but the browser did not open. Visit http://127.0.0.1:4317/
goto failed

:failed
echo Check data\workstation.log for details.
pause
exit /b 1
