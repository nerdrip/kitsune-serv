@echo off
set "NODE_OPTIONS=--use-system-ca %NODE_OPTIONS%"
call tools\build\_node-env.bat
if errorlevel 1 exit /b %errorlevel%
where npm.cmd >nul 2>nul || (echo [ERROR] npm is not installed or is not in PATH.& exit /b 1)
if "%KITSUNE_SKIP_VERIFY%"=="1" exit /b 0
echo [VERIFY] Installing exact dependencies...
call npm ci
if errorlevel 1 exit /b %errorlevel%
echo [VERIFY] Checking and testing the project...
call npm run check
if errorlevel 1 exit /b %errorlevel%
call npm test
if errorlevel 1 exit /b %errorlevel%
echo [VERIFY] Auditing production dependencies...
call npm audit --omit=dev
exit /b %errorlevel%
