# AICA Hypothesis Simulator

A local, single-user tool for reviewing AICA (AI Cockpit Assistant) trigger
algorithms by running driving scenarios and inspecting decision traces.

> **Status: M0 — Project Foundation.** This milestone delivers only the runnable
> skeleton: a FastAPI backend with a health endpoint, a React/Vite frontend shell
> that displays that health, Docker Compose wiring, and test runners on both
> sides. There is no package/scenario selection, playback, or algorithm
> evaluation yet — those arrive in later milestones.

## Prerequisites

- Docker and Docker Compose.
- Host ports **8137** (backend) and **5180** (frontend) free.

## Start the application

From the repository root:

```bash
docker compose up
```

This starts two services with hot reload:

| Service    | URL                     | Purpose                          |
|------------|-------------------------|----------------------------------|
| `frontend` | http://localhost:5180   | App shell (open this in browser) |
| `api`      | http://localhost:8137   | FastAPI backend                  |

Open **http://localhost:5180**. The shell fetches backend health once on load
and shows `Backend: ok — aica-api` when the backend is reachable, or
`Backend unavailable` otherwise. If you open the page before the backend has
finished starting, reload once it is ready (M0 does not auto-retry).

Verify the backend directly (optional):

```bash
curl http://localhost:8137/api/health
# {"status":"ok","service":"aica-api","version":"0.0.0"}
```

### Changing the ports

If 8137 or 5180 is already in use on your machine, change them in two places:

- **`docker-compose.yml`** — the `ports:` mapping for the affected service
  (e.g. `"8137:8137"` → `"<new>:8137"`).
- **`app/frontend/vite.config.ts`** — if you change the frontend port, update
  `server.port`; if you change the backend port, update the proxy `target`
  (`http://api:8137`). The backend container port itself is set by the `--port`
  flag in `Dockerfile.api`.

## Running the tests

Backend (pytest, via uv):

```bash
cd app/api && uv run pytest
```

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

## Project layout (M0)

```
app/api/         FastAPI backend (package aica_api; GET /api/health)
app/frontend/    React + TypeScript + Vite shell
packages/        hypothesis packages        (empty until M1+)
scenarios/       driving scenarios          (empty until M1+)
runs/            persisted run evidence     (written at runtime, M1+)
docker-compose.yml, Dockerfile.api, Dockerfile.frontend
docs/master/     authoritative design specification and architecture
```

See `docs/master/` for the full specification, architecture, and milestone plan.
