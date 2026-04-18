@echo off
title KitsuneServ - Build Release
cd /d "%~dp0"

echo ============================================
echo   KitsuneServ Release Builder
echo ============================================
echo.

:: Get version from package.json
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" package.json') do set VERSION=%%~a
echo [INFO] Version: %VERSION%

:: Generate timestamp (YYYYMMDD-HHMMSS)
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set DT=%%a
set TIMESTAMP=%DT:~0,8%-%DT:~8,6%
echo [INFO] Timestamp: %TIMESTAMP%
echo.

:: --- Step 0: Fix 7za.exe exit code issue (winCodeSign extraction) ---
echo [0/4] Preparing build environment...
set "SZA_DIR=%~dp0node_modules\7zip-bin\win\x64"
set "SZA_ORIG=%SZA_DIR%\7za_orig.exe"
set "SZA_WRAP=%SZA_DIR%\7za.exe"
set "SZA_SRC=%~dp0temp\7za_wrapper.cs"
set "SZA_PATCHED=0"

:: Only patch if 7za_orig.exe doesn't exist yet (first time or restored)
if not exist "%SZA_ORIG%" (
    echo   Patching 7za.exe to treat warnings as success...
    copy "%SZA_WRAP%" "%SZA_ORIG%" >nul
    if not exist "%~dp0temp" mkdir "%~dp0temp"
    > "%SZA_SRC%" (
        echo using System; using System.Diagnostics; using System.IO;
        echo class P { static int Main^(string[] a^) {
        echo   string d = Path.GetDirectoryName^(System.Reflection.Assembly.GetExecutingAssembly^(^).Location^);
        echo   string r = Path.Combine^(d, "7za_orig.exe"^);
        echo   string args = "";
        echo   foreach ^(string s in a^) { if ^(args.Length ^> 0^) args += " "; if ^(s.Contains^(" "^)^) args += "\"" + s + "\""; else args += s; }
        echo   ProcessStartInfo si = new ProcessStartInfo^(^); si.FileName = r; si.Arguments = args; si.UseShellExecute = false;
        echo   Process p = Process.Start^(si^); p.WaitForExit^(^);
        echo   int c = p.ExitCode; return ^(c == 1 ^|^| c == 2^) ? 0 : c;
        echo } }
    )
    C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:"%SZA_WRAP%" "%SZA_SRC%" >nul 2>&1
    if %errorlevel% neq 0 (
        echo   [WARN] Could not compile 7za wrapper - restoring original
        copy "%SZA_ORIG%" "%SZA_WRAP%" >nul
        del "%SZA_ORIG%" 2>nul
    ) else (
        set "SZA_PATCHED=1"
        echo   [OK] 7za.exe patched successfully.
    )
    del "%SZA_SRC%" 2>nul
) else (
    set "SZA_PATCHED=1"
    echo   [OK] 7za.exe already patched.
)

:: Clean failed winCodeSign cache entries
set "WCS_DIR=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
if exist "%WCS_DIR%" (
    echo   Cleaning winCodeSign cache...
    rmdir /s /q "%WCS_DIR%" 2>nul
)
echo.

:: --- Step 1: Build Electron executable ---
echo [1/4] Building Electron executable...
call npx electron-builder --win --config.compression=maximum
set BUILD_ERR=%errorlevel%

:: Restore original 7za.exe
if "%SZA_PATCHED%"=="1" (
    if exist "%SZA_ORIG%" (
        copy "%SZA_ORIG%" "%SZA_WRAP%" >nul
        del "%SZA_ORIG%" 2>nul
    )
)

if %BUILD_ERR% neq 0 (
    echo [ERROR] Electron build failed!
    pause
    exit /b %BUILD_ERR%
)
echo [OK] Electron build complete.
echo.

:: --- Step 2: Prepare release directory ---
set RELEASE_DIR=release\KitsuneServ-%VERSION%
echo [2/4] Preparing release directory: %RELEASE_DIR%

if exist "release" rmdir /s /q "release"
mkdir "%RELEASE_DIR%"

:: Copy unpacked Electron app (exe + runtime DLLs + resources)
echo   Copying Electron runtime...
xcopy "dist\win-unpacked\*" "%RELEASE_DIR%\" /E /I /Q >nul

:: Copy configs (not packaged in asar)
echo   Copying configurations...
xcopy "config" "%RELEASE_DIR%\config\" /E /I /Q >nul

:: --- Step 3: Create directory structure ---
echo [3/4] Creating directory structure...
mkdir "%RELEASE_DIR%\servers"
mkdir "%RELEASE_DIR%\servers\apache"
mkdir "%RELEASE_DIR%\servers\nginx"
mkdir "%RELEASE_DIR%\servers\php"
mkdir "%RELEASE_DIR%\servers\node"
mkdir "%RELEASE_DIR%\servers\go"
mkdir "%RELEASE_DIR%\servers\bun"
mkdir "%RELEASE_DIR%\servers\deno"
mkdir "%RELEASE_DIR%\servers\python"
mkdir "%RELEASE_DIR%\servers\postgresql"
mkdir "%RELEASE_DIR%\servers\mysql"
mkdir "%RELEASE_DIR%\servers\mariadb"
mkdir "%RELEASE_DIR%\servers\mongodb"
mkdir "%RELEASE_DIR%\servers\redis"
mkdir "%RELEASE_DIR%\servers\memcached"
mkdir "%RELEASE_DIR%\servers\caddy"
mkdir "%RELEASE_DIR%\servers\minio"
mkdir "%RELEASE_DIR%\data"
mkdir "%RELEASE_DIR%\temp"
mkdir "%RELEASE_DIR%\www"
mkdir "%RELEASE_DIR%\www\apps"
mkdir "%RELEASE_DIR%\projects\node"
mkdir "%RELEASE_DIR%\projects\go"
mkdir "%RELEASE_DIR%\projects\bun"
mkdir "%RELEASE_DIR%\projects\deno"
mkdir "%RELEASE_DIR%\projects\python"

:: Create default www/index.html
echo ^<html^>^<body^>^<h1^>KitsuneServ - It works!^</h1^>^<p^>Your local development server is ready.^</p^>^</body^>^</html^> > "%RELEASE_DIR%\www\index.html"

:: Create start script
echo @echo off > "%RELEASE_DIR%\start.bat"
echo title KitsuneServ >> "%RELEASE_DIR%\start.bat"
echo cd /d "%%~dp0" >> "%RELEASE_DIR%\start.bat"
echo start "" "KitsuneServ.exe" >> "%RELEASE_DIR%\start.bat"

:: --- Step 4: Create ZIP archive ---
echo [4/4] Creating ZIP archive...
set ZIP_NAME=KitsuneServ-%VERSION%-%TIMESTAMP%-win-x64.zip
powershell -NoProfile -Command "Compress-Archive -Path 'release\KitsuneServ-%VERSION%\*' -DestinationPath 'release\%ZIP_NAME%' -Force"
if %errorlevel% neq 0 (
    echo [ERROR] ZIP creation failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ============================================
echo   Build Complete!
echo ============================================
echo.
echo   Release Dir  : %RELEASE_DIR%\
echo   ZIP Archive  : release\%ZIP_NAME%
echo.
echo   Directory structure in release:
echo     KitsuneServ-%VERSION%\
echo       ├── KitsuneServ.exe  (Electron runtime)
echo       ├── *.dll            (Chromium libs)
echo       ├── resources\       (app.asar with source)
echo       ├── start.bat
echo       ├── config\         (default configs)
echo       ├── servers\        (14 service dirs)
echo       ├── data\           (database data)
echo       ├── projects\       (user projects)
echo       ├── www\            (document root)
echo       └── temp\           (downloads temp)
echo.
pause
