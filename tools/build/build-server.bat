@echo off
setlocal
cd /d "%~dp0\..\.."
title KitsuneServ - Web server packages
call tools\build\_verify.bat
if errorlevel 1 exit /b %errorlevel%
echo [BUILD] Universal Windows/Linux web server archives...
call npm run clean:artifact -- server
if errorlevel 1 exit /b %errorlevel%
call npm run build:server
if errorlevel 1 exit /b %errorlevel%
call npm run build:checksums
echo [OK] artifacts\server
endlocal
