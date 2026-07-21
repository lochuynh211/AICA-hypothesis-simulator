@echo off
REM Start the AICA Hypothesis Simulator via Docker in WSL2.
REM Usage (arguments may be combined in any order):
REM   docker-start.bat              - api + frontend, direct internet (off-VPN)
REM   docker-start.bat llm          - also start the backend Ollama LLM server
REM   docker-start.bat vpn          - route container outbound via the VPN proxy
REM   docker-start.bat build        - rebuild images, then start
REM   docker-start.bat llm vpn      - typical on-VPN start (Ollama + proxy)
REM
REM The `vpn` flag reads the WSL shell's own $HTTP_PROXY at launch and passes it
REM to the containers as AICA_HTTP_PROXY, so Google Maps works on-VPN. Omit it
REM off-VPN and the containers stay direct. Nothing persists between runs.

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

REM When `vpn` is given, mirror the shell proxy into the AICA_ namespaced vars
REM compose reads (WSL expands $HTTP_PROXY at runtime). Empty otherwise = direct.
set "PROXYENV="
set "BUILDARGS="
if defined USE_VPN (
    set "PROXYENV=AICA_HTTP_PROXY=$HTTP_PROXY AICA_HTTPS_PROXY=${HTTPS_PROXY:-$HTTP_PROXY} AICA_NO_PROXY=localhost,127.0.0.1,api,ollama "
    set "BUILDARGS=--build-arg http_proxy=$HTTP_PROXY --build-arg https_proxy=${HTTPS_PROXY:-$HTTP_PROXY} "
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
