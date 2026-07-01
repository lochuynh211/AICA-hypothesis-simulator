@echo off
REM Show logs from the AICA Hypothesis Simulator containers.
REM Usage:
REM   docker-logs.bat          - show last 50 lines from all containers
REM   docker-logs.bat api      - follow API logs
REM   docker-logs.bat frontend - follow frontend logs

set "NO_PROXY=localhost,127.0.0.1"

if /i "%1"=="api" (
    wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose logs -f api"
) else if /i "%1"=="frontend" (
    wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose logs -f frontend"
) else (
    wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose logs --tail=50"
)
