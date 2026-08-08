@echo off
setlocal
cd /d "%~dp0\..\.."
title KitsuneServ - Windows packages
call tools\build\_verify.bat
if errorlevel 1 exit /b %errorlevel%
echo [BUILD] Windows installer and portable package...
call npm run clean:artifact -- windows
if errorlevel 1 exit /b %errorlevel%
call npm run dist:win
if errorlevel 1 exit /b %errorlevel%
call npm run build:checksums
echo [OK] artifacts\windows
endlocal
