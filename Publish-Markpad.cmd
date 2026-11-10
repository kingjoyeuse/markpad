@echo off
cd /d "%~dp0"
echo Publishes source and release assets to kingjoyeuse/markpad.
echo New repositories are PRIVATE unless -Visibility public is supplied.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Publish-Markpad.ps1" %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
