@echo off
setlocal
cd /d "%~dp0\..\.."
title KitsuneServ - Plesk extension
call tools\build\_verify.bat
if errorlevel 1 exit /b %errorlevel%
echo [BUILD] Installable KitsuneServ Bridge extension...
call npm run clean:artifact -- plesk
if errorlevel 1 exit /b %errorlevel%
call npm run build:plesk
if errorlevel 1 exit /b %errorlevel%
call npm run build:checksums
echo [OK] artifacts\plesk
endlocal
