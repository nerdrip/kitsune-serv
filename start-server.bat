@echo off
title KitsuneServ - Server Mode
cd /d "%~dp0"

echo Starting KitsuneServ in server mode...
echo Access via browser at http://localhost:10000
echo.

node src\server.js %*
