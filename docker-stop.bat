@echo off
REM Stop the AICA Hypothesis Simulator Docker containers.

echo Stopping containers...
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose down"

REM Kill the WSL keepalive process
taskkill /fi "WINDOWTITLE eq WSL-keepalive" >nul 2>&1

echo Done.
