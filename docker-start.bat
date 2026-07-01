@echo off
REM Start the AICA Hypothesis Simulator via Docker in WSL2.
REM Prerequisites: WSL2 Ubuntu with Docker Engine installed (setup by docker-setup.bat).

echo === AICA Hypothesis Simulator (Docker on WSL2) ===
echo.

REM Start Docker daemon in WSL
echo Starting Docker daemon...
wsl -d Ubuntu -u root -- bash -c "service docker start 2>/dev/null; sleep 2; docker info >/dev/null 2>&1 && echo OK || echo FAIL"

REM Build and start containers
echo Building and starting containers...
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose up -d --build --build-arg http_proxy=http://163.116.128.80:8080 --build-arg https_proxy=http://163.116.128.80:8080 2>&1 | tail -5"

REM Keep WSL alive in background (prevents VM shutdown)
start /min "WSL-keepalive" wsl -d Ubuntu -- sleep infinity

REM Wait for services
echo.
echo Waiting for services to start...
timeout /t 8 /nobreak >nul

REM Verify API
set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"
curl --noproxy "*" -s http://127.0.0.1:8137/api/health >nul 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak >nul
    curl --noproxy "*" -s http://127.0.0.1:8137/api/health >nul 2>&1
)
if errorlevel 1 (
    echo ERROR: API did not start. Check logs with:
    echo   wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose logs"
    pause
    exit /b 1
)

echo.
echo === Services running ===
echo   Backend:  http://localhost:8137/api/health
echo   Frontend: http://localhost:5180
echo.
echo IMPORTANT: Your browser must bypass the corporate proxy for localhost.
echo   Set NO_PROXY=localhost,127.0.0.1 as a system environment variable,
echo   or add localhost/127.0.0.1 to your browser's proxy exception list.
echo.

start http://localhost:5180
echo To stop: docker-stop.bat
