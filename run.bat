@echo off
setlocal

:: ── AnnotateLessAnalyseMore launcher (Windows) ────────────────────────────
set VENV_DIR=%~dp0venv
set PYTHON=python

:: Check Python is available
where %PYTHON% >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.9+ and add it to PATH.
    pause
    exit /b 1
)

:: Create venv on first run
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [SETUP] Creating virtual environment...
    %PYTHON% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: Activate venv
call "%VENV_DIR%\Scripts\activate.bat"

:: Install / upgrade dependencies
echo [SETUP] Installing dependencies...
pip install -q -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo [ERROR] pip install failed. Check your internet connection and requirements.txt.
    pause
    exit /b 1
)

:: Launch app
echo.
echo [OK] Starting AnnotateLessAnalyseMore...
echo [OK] Open your browser at http://127.0.0.1:5000
echo [OK] Press Ctrl+C to stop the server.
echo.
python "%~dp0app.py"

endlocal
pause
