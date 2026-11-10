@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py -3 scripts\build-releases.py --runtime bin %*
) else (
  python scripts\build-releases.py --runtime bin %*
)
set "RESULT=%ERRORLEVEL%"
if not %RESULT% equ 0 echo Release build failed. See the error above and docs\RELEASING.md.
pause
exit /b %RESULT%
