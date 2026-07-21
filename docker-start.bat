@echo off
REM Start the AICA Hypothesis Simulator via Docker in WSL2.
REM Usage:
REM   docker-start.bat              - start api + frontend (fast; no Ollama)
REM   docker-start.bat llm          - also start the backend Ollama LLM server
REM   docker-start.bat build        - rebuild images then start
REM   docker-start.bat build llm    - rebuild, then start including Ollama
REM (arguments may be given in any order)

echo === AICA Hypothesis Simulator (Docker on WSL2) ===
echo.

REM Parse optional arguments (build / llm), position-independent
set "PROFILE="
set "DO_BUILD="
if /i "%1"=="build" set "DO_BUILD=1"
if /i "%2"=="build" set "DO_BUILD=1"
if /i "%1"=="llm" set "PROFILE=--profile llm"
if /i "%2"=="llm" set "PROFILE=--profile llm"

REM Start Docker daemon in WSL
echo Starting Docker daemon...
wsl -d Ubuntu -u root -- bash -c "service docker start 2>/dev/null; sleep 2; docker info >/dev/null 2>&1 && echo OK || echo FAIL"

REM Build if requested
if defined DO_BUILD (
    echo Rebuilding images...
    wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose build --build-arg http_proxy=http://163.116.128.80:8080 --build-arg https_proxy=http://163.116.128.80:8080 2>&1 | tail -5"
)

REM Start containers. Add `llm` to also bring up the Ollama server (opt-in
REM because its image + model are large). Off-VPN with existing images this
REM needs no network at all.
echo Starting containers...
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose %PROFILE% up -d 2>&1 | tail -5"

REM Keep WSL alive in background (prevents VM shutdown)
tasklist /fi "WINDOWTITLE eq WSL-keepalive" 2>nul | find "wsl" >nul || (
    start /min "WSL-keepalive" wsl -d Ubuntu -- sleep infinity
)

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
    echo   docker-logs.bat
    pause
    exit /b 1
)

echo.
echo === Services running ===
echo   Backend:  http://localhost:8137/api/health
echo   Frontend: http://localhost:5180
if defined PROFILE (
    echo   Ollama:   enabled ^(--profile llm^)
    echo.
    echo First time only - pull the model once:
    echo   wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator ^&^& docker compose --profile llm exec ollama ollama pull qwen2.5:3b"
)
echo.
echo To stop:  docker-stop.bat
echo To logs:  docker-logs.bat
echo.

start http://localhost:5180
