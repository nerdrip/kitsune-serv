@echo off
setlocal
cd /d "%~dp0\..\.."
title KitsuneServ - Linux desktop packages
call tools\build\_verify.bat
if errorlevel 1 exit /b %errorlevel%
where docker >nul 2>nul || (echo [ERROR] Docker Desktop is required to build Linux packages on Windows.& exit /b 1)
echo [BUILD] Linux AppImage, DEB and RPM in an isolated Linux container...
call npm run clean:artifact -- linux
if errorlevel 1 exit /b %errorlevel%
docker build --target export --output type=local,dest=artifacts\linux -f tools\build\Dockerfile.linux-builder .
if errorlevel 1 exit /b %errorlevel%
call npm run build:checksums
echo [OK] artifacts\linux
endlocal
