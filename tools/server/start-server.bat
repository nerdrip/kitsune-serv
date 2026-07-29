@echo off
setlocal
cd /d "%~dp0\.."
if not defined KITSUNE_HOST set "KITSUNE_HOST=127.0.0.1"
node src\server.js %*
endlocal
