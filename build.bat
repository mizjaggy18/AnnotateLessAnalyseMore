@echo off
setlocal
:: ── AnnotateLessAnalyseMore — build standalone exe (Windows) ─────────────
:: Output: dist\AnnotateLessAnalyseMore.exe
:: Double-click the exe — no Python needed on the target machine.

set SCRIPT_DIR=%~dp0
set VENV_DIR=%SCRIPT_DIR%venv
set PYTHON=python

:: ── 1. Ensure Python is available ────────────────────────────────────────
where %PYTHON% >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.9+ and add it to PATH.
    pause & exit /b 1
)

:: ── 2. Create / activate venv ────────────────────────────────────────────
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [BUILD] Creating virtual environment...
    %PYTHON% -m venv "%VENV_DIR%"
    if errorlevel 1 ( echo [ERROR] venv creation failed. & pause & exit /b 1 )
)
call "%VENV_DIR%\Scripts\activate.bat"

:: ── 3. Install runtime deps + PyInstaller ────────────────────────────────
echo [BUILD] Installing / verifying dependencies...
pip install -q -r "%SCRIPT_DIR%requirements.txt"
pip install -q pyinstaller

:: ── 4. Clean previous build artifacts ────────────────────────────────────
if exist "%SCRIPT_DIR%dist\AnnotateLessAnalyseMore.exe" (
    echo [BUILD] Removing previous exe...
    del /f /q "%SCRIPT_DIR%dist\AnnotateLessAnalyseMore.exe"
)
if exist "%SCRIPT_DIR%build" (
    echo [BUILD] Removing previous build cache...
    rmdir /s /q "%SCRIPT_DIR%build"
)

:: ── 5. Run PyInstaller ───────────────────────────────────────────────────
echo [BUILD] Running PyInstaller...
cd /d "%SCRIPT_DIR%"
pyinstaller annotate.spec --clean --noconfirm

if errorlevel 1 (
    echo.
    echo [ERROR] PyInstaller failed. Check the output above for details.
    pause & exit /b 1
)

:: ── 6. Report result ─────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║  BUILD COMPLETE                                              ║
echo ║                                                              ║
echo ║  Executable:                                                 ║
echo ║    dist\AnnotateLessAnalyseMore.exe                         ║
echo ║                                                              ║
echo ║  HOW TO USE:                                                 ║
echo ║  1. Copy the .exe to any folder that contains your images.  ║
echo ║  2. Double-click AnnotateLessAnalyseMore.exe                ║
echo ║  3. Your browser opens automatically at http://127.0.0.1    ║
echo ║                                                              ║
echo ║  NOTE: First launch takes ~3-5 s while the exe unpacks.     ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

endlocal
pause
