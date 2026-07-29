@echo off
setlocal
cd /d "%~dp0\.."
where node >nul 2>nul || (echo [ERROR] Install Node.js 22.19 or newer first.& exit /b 1)
where npm >nul 2>nul || (echo [ERROR] npm is not available.& exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" || (echo [ERROR] Node.js 22.19 or newer is required.& exit /b 1)
echo Installing KitsuneServ web server dependencies...
call npm ci --omit=dev
if errorlevel 1 exit /b %errorlevel%
echo [OK] Installation complete. Run bin\start-server.bat
endlocal
