@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Apply-Markpad-Icon.ps1"
if errorlevel 1 (
    echo.
    echo Icon installation failed. Your documents and draft recovery data were not changed.
    pause
    exit /b 1
)
echo.
echo Markpad's program, window, and shortcut icons have been updated.
pause
