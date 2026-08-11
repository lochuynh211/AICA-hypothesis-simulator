#!/usr/bin/env bash
# Restart the AICA Hypothesis Simulator in Docker — the Linux/WSL-shell twin of
# docker-restart.bat (which is a Windows wrapper that shells into WSL to do
# exactly this). Run it directly from an Ubuntu shell.
#
# Usage (flags combinable, any order):
#   ./docker-restart.sh              api + frontend, direct internet (off-VPN)
#   ./docker-restart.sh llm          also start the backend Ollama LLM server
#   ./docker-restart.sh vpn          route container outbound via the VPN proxy
#   ./docker-restart.sh build        rebuild images, then start
#   ./docker-restart.sh llm vpn      typical on-VPN start (Ollama + proxy)
#
# Ports (from docker-compose.yml) are 8137 (API) and 5180 (frontend) — NOT the
# 8080/5173 defaults, deliberately, so this project never collides with the
# other containers on this machine.

set -uo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR" || exit 1

API_PORT=8137
FRONTEND_PORT=5180
VPN_PROXY="http://163.116.128.80:8080"

# ---------------------------------------------------------------- arg parsing
PROFILE=()
DO_BUILD=""
USE_VPN=""
for arg in "$@"; do
    case "${arg,,}" in
        build) DO_BUILD=1 ;;
        llm)   PROFILE=(--profile llm) ;;
        vpn)   USE_VPN=1 ;;
        -h|--help|help)
            # Print the header comment block (everything up to the first
            # non-comment line after the shebang).
            awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
            exit 0 ;;
        *)
            echo "ERROR: unknown argument '$arg' (expected: build | llm | vpn)" >&2
            exit 2 ;;
    esac
done

echo "=== Restarting AICA Hypothesis Simulator ==="
echo

# ------------------------------------------------------------- docker daemon
if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon not responding — trying to start it..."
    sudo -n service docker start >/dev/null 2>&1 || sudo service docker start
    sleep 2
    if ! docker info >/dev/null 2>&1; then
        echo "ERROR: cannot talk to the Docker daemon. Start it and retry." >&2
        exit 1
    fi
fi

# ------------------------------------------------------------- stop phase
# `--profile llm` so the opt-in Ollama container is stopped too (a profile
# service isn't always removed by a plain `down`).
echo "Stopping containers..."
docker compose --profile llm down

# Free the ports if a *host-native* dev server (start-local / uvicorn+vite run
# outside Docker) still holds them — otherwise `up` fails on the port bind.
# Only processes belonging to THIS repo are killed; a foreign owner aborts the
# script rather than being silently taken down.
free_port() {
    local port="$1" label="$2" pids pid cmd cwd
    pids="$(ss -ltnpH "sport = :$port" 2>/dev/null \
            | grep -oP 'pid=\K[0-9]+' | sort -u)"
    [ -z "$pids" ] && return 0

    for pid in $pids; do
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)"
        if [[ "$cmd" == *"$REPO_DIR"* || "$cwd" == "$REPO_DIR"* ]]; then
            echo "Freeing port $port ($label): killing local dev process $pid"
            kill "$pid" 2>/dev/null
        else
            echo "ERROR: port $port ($label) is held by PID $pid, which is NOT" >&2
            echo "       part of this repo: ${cmd:-<unknown>}" >&2
            echo "       Stop it yourself, then re-run." >&2
            exit 1
        fi
    done

    # Give them a moment, then escalate to SIGKILL if still bound.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        ss -ltnH "sport = :$port" 2>/dev/null | grep -q . || return 0
        sleep 0.5
    done
    for pid in $pids; do kill -9 "$pid" 2>/dev/null; done
    sleep 1
}

free_port "$API_PORT" "backend"
free_port "$FRONTEND_PORT" "frontend"
echo

# ------------------------------------------------------------- start phase
# When `vpn` is given, point the containers at the corporate proxy BY IP (no DNS
# needed inside the container). Empty otherwise = direct internet.
PROXY_ENV=()
BUILD_ARGS=()
if [ -n "$USE_VPN" ]; then
    PROXY_ENV=(
        "AICA_HTTP_PROXY=$VPN_PROXY"
        "AICA_HTTPS_PROXY=$VPN_PROXY"
        "AICA_NO_PROXY=localhost,127.0.0.1,api,ollama"
    )
    BUILD_ARGS=(--build-arg "http_proxy=$VPN_PROXY" --build-arg "https_proxy=$VPN_PROXY")
fi

if [ -n "$DO_BUILD" ]; then
    echo "Rebuilding images..."
    env "${PROXY_ENV[@]}" docker compose build "${BUILD_ARGS[@]}" || exit 1
fi

echo "Starting containers..."
env "${PROXY_ENV[@]}" docker compose "${PROFILE[@]}" up -d || exit 1

# ------------------------------------------------------------- health check
echo
echo -n "Waiting for the API to come up"
API_UP=""
for _ in $(seq 1 40); do
    if curl --noproxy '*' -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
        API_UP=1
        break
    fi
    echo -n "."
    sleep 2
done
echo

if [ -z "$API_UP" ]; then
    echo "ERROR: API did not become healthy on port $API_PORT. Recent logs:" >&2
    docker compose logs --tail=30 api >&2
    exit 1
fi

echo
echo "=== Services running ==="
echo "  Backend:  http://localhost:$API_PORT/api/health"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
if [ ${#PROFILE[@]} -gt 0 ]; then
    echo "  Ollama:   enabled (--profile llm)"
fi
if [ -n "$USE_VPN" ]; then
    echo "  Proxy:    ON (container outbound via VPN proxy - Google Maps enabled)"
else
    echo "  Proxy:    off (direct internet)"
fi
if [ ${#PROFILE[@]} -gt 0 ]; then
    echo
    echo "First time only - pull the model once:"
    echo "  docker compose --profile llm exec ollama ollama pull qwen2.5:3b"
fi
echo
echo "To stop:  docker compose --profile llm down"
echo "To logs:  docker compose logs -f api      (or: frontend)"
