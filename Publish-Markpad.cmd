@echo off
cd /d "%~dp0"
echo Pushes committed source to kingjoyeuse/markpad. Use -Release to upload release assets.
echo New repositories are PRIVATE unless -Visibility public is supplied.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Publish-Markpad.ps1" %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
