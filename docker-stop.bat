@echo off
REM Stop the AICA Hypothesis Simulator Docker containers.

echo Stopping containers...
REM `--profile llm` so the opt-in Ollama container is stopped too (a profile
REM service isn't always removed by a plain `down`).
wsl -d Ubuntu -u root -- bash -c "cd /mnt/c/Users/l-huynh/Desktop/AICA-hypothesis-simulator && docker compose --profile llm down"

REM Kill the WSL keepalive process
taskkill /fi "WINDOWTITLE eq WSL-keepalive" >nul 2>&1

echo Done.
