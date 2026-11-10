@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to rebuild the source. Install Node.js 24 LTS and try again.
  echo You can run bin\Markpad.exe without Node.js.
  pause
  exit /b 1
)
if not exist "node_modules\esbuild\package.json" (
  call npm ci
  if errorlevel 1 goto failed
)
call npm test
if errorlevel 1 goto failed
call npm run build:portable
if errorlevel 1 goto failed
echo.
echo Build complete. Start bin\Markpad.exe using your shortcut or directly.
pause
exit /b 0
:failed
echo.
echo Build did not complete. Review the error above. Existing notes are unchanged.
pause
exit /b 1
