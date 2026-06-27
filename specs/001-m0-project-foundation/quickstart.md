# Quickstart: M0 Project Foundation

How to run and verify the M0 skeleton once implemented. This mirrors what the
README will document (FR-009).

## Prerequisites

- Docker + Docker Compose.
- Host ports **8137** (backend) and **5180** (frontend) free. To change them, edit
  the published ports in `docker-compose.yml` and, for the frontend, `server.port`
  and the proxy target in `app/frontend/vite.config.ts`.

## Start the application

From the repository root:

```bash
docker compose up
```

This starts two services with hot reload:

- `api` — FastAPI on `http://localhost:8137`
- `frontend` — Vite dev server on `http://localhost:5180`

## Verify the health round-trip

1. Open `http://localhost:5180` in a browser.
2. The app shell displays the backend health status (e.g., "Backend: ok —
   aica-api"). This is the M0 success signal (SC-001, SC-002).
3. Direct backend check (optional):

   ```bash
   curl http://localhost:8137/api/health
   # {"status":"ok","service":"aica-api","version":"0.0.0"}
   ```

If the page shows an error state, the backend may still be starting — reload once
it is ready (M0 does not auto-retry).

## Run the tests

Backend (pytest):

```bash
cd app/api && uv run pytest
```

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

Both suites should pass, including the health-endpoint contract test and the
health-status display test (SC-003, SC-004).

## What M0 does NOT do

No package/scenario selection, no playback, no evaluation, no run logs — those
arrive in M1+. M0 only proves the foundation is runnable and testable.
