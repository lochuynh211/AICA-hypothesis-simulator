@echo off
REM Restart the AICA Hypothesis Simulator: stop the containers, then start them
REM again. This is docker-stop.bat followed by docker-start.bat.
REM
REM Usage (arguments forwarded to the start phase, combinable in any order):
REM   docker-restart.bat              - api + frontend, direct internet (off-VPN)
REM   docker-restart.bat llm          - also start the backend Ollama LLM server
REM   docker-restart.bat vpn          - route container outbound via the VPN proxy
REM   docker-restart.bat build        - rebuild images, then start
REM   docker-restart.bat llm vpn      - typical on-VPN start (Ollama + proxy)

echo === Restarting AICA Hypothesis Simulator ===
echo.

REM --- Stop phase (docker-stop.bat) ---
echo Stopping containers...
REM `--profile llm` so the opt-in Ollama container is stopped too (a profile
REM service isn't always removed by a plain `down`).
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose --profile llm down"

REM Kill the WSL keepalive process
taskkill /fi "WINDOWTITLE eq WSL-keepalive" >nul 2>&1

echo.

REM --- Start phase (docker-start.bat) ---
echo === AICA Hypothesis Simulator (Docker on WSL2) ===
echo.

REM Parse optional arguments (build / llm / vpn), position-independent
set "PROFILE="
set "DO_BUILD="
set "USE_VPN="
for %%A in (%1 %2 %3) do (
    if /i "%%A"=="build" set "DO_BUILD=1"
    if /i "%%A"=="llm" set "PROFILE=--profile llm"
    if /i "%%A"=="vpn" set "USE_VPN=1"
)

REM When `vpn` is given, point the containers at the corporate proxy BY IP (no
REM DNS needed inside the container, and no dependency on the non-interactive
REM shell sourcing $HTTP_PROXY). Empty otherwise = direct.
set "PROXYENV="
set "BUILDARGS="
if defined USE_VPN (
    set "PROXYENV=AICA_HTTP_PROXY=http://163.116.128.80:8080 AICA_HTTPS_PROXY=http://163.116.128.80:8080 AICA_NO_PROXY=localhost,127.0.0.1,api,ollama "
    set "BUILDARGS=--build-arg http_proxy=http://163.116.128.80:8080 --build-arg https_proxy=http://163.116.128.80:8080 "
)

REM Start Docker daemon in WSL
echo Starting Docker daemon...
wsl -d Ubuntu -u root -- bash -c "service docker start 2>/dev/null; sleep 2; docker info >/dev/null 2>&1 && echo OK || echo FAIL"

REM Build if requested (build-args only set when `vpn` is given)
if defined DO_BUILD (
    echo Rebuilding images...
    wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose build %BUILDARGS%2>&1 | tail -5"
)

REM Start containers. `llm` adds the Ollama server; `vpn` prefixes the proxy env.
echo Starting containers...
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && %PROXYENV%docker compose %PROFILE% up -d 2>&1 | tail -5"

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
if defined PROFILE echo   Ollama:   enabled ^(--profile llm^)
if defined USE_VPN (
    echo   Proxy:    ON ^(container outbound via VPN proxy - Google Maps enabled^)
) else (
    echo   Proxy:    off ^(direct internet^)
)
if defined PROFILE (
    echo.
    echo First time only - pull the model once:
    echo   wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator ^&^& docker compose --profile llm exec ollama ollama pull qwen2.5:3b"
)
echo.
echo To stop:  docker-stop.bat
echo To logs:  docker-logs.bat
echo.

start http://localhost:5180
