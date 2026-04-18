@echo off
title KitsuneServ - Dependency Installer
cd /d "%~dp0"

echo ============================================
echo   KitsuneServ - Dependency Installer
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found.
    echo     Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%a in ('node -v') do set NODE_VER=%%a
echo [OK] Node.js found: %NODE_VER%

:: Check npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] npm not found. Please install npm.
    pause
    exit /b 1
)

for /f "tokens=*" %%a in ('npm -v') do set NPM_VER=%%a
echo [OK] npm found: v%NPM_VER%

echo.
echo [1/2] Installing npm dependencies...
call npm install
echo [OK] Dependencies installed.

echo.
echo [2/2] Creating directory structure...
for %%d in (apache nginx php node go bun deno python postgresql mysql mariadb mongodb redis memcached caddy minio) do (
    if not exist "servers\%%d" mkdir "servers\%%d"
)
if not exist "data" mkdir data
if not exist "temp" mkdir temp
if not exist "www\apps" mkdir "www\apps"
for %%d in (node go bun deno python) do (
    if not exist "projects\%%d" mkdir "projects\%%d"
)
if not exist "config" mkdir config
if not exist "utils\adminer" mkdir "utils\adminer"

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo   To start in desktop mode (Electron):
echo     start.bat
echo.
echo   To start in server mode (web browser):
echo     start-server.bat
echo.
pause
