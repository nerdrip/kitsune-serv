@echo off
title KitsuneServ - Dependency Installer
cd /d "%~dp0"
setlocal

echo ============================================
echo   KitsuneServ - Dependency Installer
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found.
    echo     Please install Node.js 22.19+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%a in ('node -v') do set NODE_VER=%%a
echo [OK] Node.js found: %NODE_VER%
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]===22 ? Math.max(0,Math.sign(19-v[1])) : Math.max(0,Math.sign(22-v[0])))"
if errorlevel 1 (
    echo [!] Node.js 22.19+ is required. Node.js 24 LTS is recommended.
    exit /b 1
)

set "NODE_OPTIONS=--use-system-ca %NODE_OPTIONS%"

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
echo [1/2] Installing exact npm dependencies...
call npm ci
if errorlevel 1 exit /b %errorlevel%
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
endlocal
