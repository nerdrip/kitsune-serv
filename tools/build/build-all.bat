@echo off
setlocal
cd /d "%~dp0\..\.."
title KitsuneServ - Build everything
echo ============================================
echo   KitsuneServ - build all release packages
echo ============================================
call tools\build\_verify.bat
if errorlevel 1 exit /b %errorlevel%
set "KITSUNE_SKIP_VERIFY=1"
call tools\build\build-server.bat
if errorlevel 1 exit /b %errorlevel%
call tools\build\build-plesk.bat
if errorlevel 1 exit /b %errorlevel%
call tools\build\build-windows.bat
if errorlevel 1 exit /b %errorlevel%
call tools\build\build-linux.bat
if errorlevel 1 exit /b %errorlevel%
call npm run build:sbom
if errorlevel 1 exit /b %errorlevel%
call npm run build:manifest
if errorlevel 1 exit /b %errorlevel%
call npm run build:checksums
if errorlevel 1 exit /b %errorlevel%
echo.
echo [OK] All packages are grouped under artifacts\
endlocal
