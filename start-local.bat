@echo off
REM Start both backend and frontend for local Windows development
REM Run setup-local.bat first if you haven't already

echo === AICA Hypothesis Simulator - Starting ===
echo.

call conda activate aica-dev
if errorlevel 1 (
    echo ERROR: conda environment "aica-dev" not found. Run setup-local.bat first.
    pause
    exit /b 1
)

REM Start backend in a new window
echo Starting backend on http://localhost:8137 ...
start "AICA-API" cmd /k "conda activate aica-dev && cd app\api && python -m uvicorn aica_api.main:app --host 127.0.0.1 --port 8137 --reload"

REM Wait for backend to be ready
timeout /t 3 /nobreak >nul

REM Start frontend in a new window
echo Starting frontend on http://localhost:5180 ...
start "AICA-Frontend" cmd /k "conda activate aica-dev && cd app\frontend && npm run dev"

REM Wait and open browser
timeout /t 5 /nobreak >nul
echo.
echo Opening browser...
start http://localhost:5180

echo.
echo === Both services running ===
echo   Backend:  http://localhost:8137/api/health
echo   Frontend: http://localhost:5180
echo.
echo Close the "AICA-API" and "AICA-Frontend" windows to stop.
