@echo off
REM Build AICA Hypothesis Simulator as a standalone Windows executable.
REM
REM Prerequisites (one-time setup):
REM   - Python 3.12+ installed and on PATH
REM   - Node.js 18+ installed and on PATH
REM   - pip install pyinstaller
REM   - cd app/api && pip install -e .
REM
REM Output: dist/aica-simulator.exe

setlocal
cd /d "%~dp0"

echo ============================================
echo  AICA Hypothesis Simulator - Build EXE
echo ============================================
echo.

REM Step 1: Build frontend
echo [1/3] Building frontend...
cd app\frontend
call npm ci
if errorlevel 1 (
    echo ERROR: npm ci failed
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo ERROR: frontend build failed
    exit /b 1
)
cd ..\..
echo       Frontend built to app/frontend/dist/
echo.

REM Step 2: Install backend dependencies (for PyInstaller to find them)
echo [2/3] Installing backend dependencies...
cd app\api
pip install -e . >nul 2>&1
if errorlevel 1 (
    echo ERROR: backend install failed
    exit /b 1
)
cd ..\..
echo       Backend dependencies installed.
echo.

REM Step 3: Run PyInstaller
echo [3/3] Packaging with PyInstaller...
pyinstaller build/aica_simulator.spec --distpath dist --workpath build/pyinstaller_work --clean -y
if errorlevel 1 (
    echo ERROR: PyInstaller failed
    exit /b 1
)
echo.

echo ============================================
echo  BUILD COMPLETE
echo ============================================
echo.
echo  Output: dist\aica-simulator.exe
echo.
echo  To run: double-click dist\aica-simulator.exe
echo  Browser will open to http://localhost:8137
echo ============================================
