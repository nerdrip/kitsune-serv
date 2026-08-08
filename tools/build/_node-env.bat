@echo off
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" >nul 2>nul && exit /b 0
for %%D in ("C:\laragon\bin\nodejs\node-v24" "C:\laragon\bin\nodejs\node-v23" "C:\laragon\bin\nodejs\node-v22" "%ProgramFiles%\nodejs") do (
  if exist "%%~D\node.exe" (
    "%%~D\node.exe" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" >nul 2>nul && (
      set "PATH=%%~D;%PATH%"
      echo [INFO] Using Node.js from %%~D
      exit /b 0
    )
  )
)
echo [ERROR] Node.js 22.19 or newer is required. Node.js 24 LTS is recommended.
exit /b 1
