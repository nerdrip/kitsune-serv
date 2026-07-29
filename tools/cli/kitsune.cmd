@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\KitsuneServ.exe" "%~dp0..\app.asar\src\cli.js" %*
exit /b %ERRORLEVEL%
