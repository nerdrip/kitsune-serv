@echo off
title KitsuneServ - Starting...
cd /d "%~dp0"
call npm start
if errorlevel 1 exit /b %errorlevel%
