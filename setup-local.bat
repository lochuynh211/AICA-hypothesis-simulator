@echo off
REM One-time setup for local Windows development (no Docker required)
REM Prerequisites: Anaconda or Miniconda installed
REM
REM If behind a corporate proxy, set HTTP_PROXY/HTTPS_PROXY env vars first.

echo === AICA Hypothesis Simulator - Local Setup ===
echo.

REM Disable SSL verify for corporate proxies with self-signed certs
call conda config --set ssl_verify false

REM Create conda environment
echo [1/4] Creating conda environment "aica-dev"...
call conda env create -f environment.yml --yes
if errorlevel 1 (
    echo Conda environment may already exist. Updating...
    call conda env update -f environment.yml --prune
)
echo.

REM Activate and verify
echo [2/4] Verifying environment...
call conda activate aica-dev
python --version
node --version
echo.

REM Install pip deps with proxy support
echo [3/4] Installing Python dependencies...
pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org fastapi==0.115.6 "uvicorn[standard]==0.32.1" pytest==8.3.4 httpx==0.28.1
echo.

REM Configure npm for corporate proxy and install frontend dependencies
echo [4/4] Installing frontend npm dependencies...
call npm config set strict-ssl false
cd app\frontend
call npm install
cd ..\..
echo.

echo === Setup complete! ===
echo.
echo Run "start-local.bat" to launch the application.
echo   Backend: http://localhost:8137
echo   Frontend: http://localhost:5180
pause
