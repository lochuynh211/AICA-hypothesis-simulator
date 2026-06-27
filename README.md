# AICA Hypothesis Simulator

A local, single-user tool for reviewing AICA (AI Cockpit Assistant) trigger
algorithms by running driving scenarios and inspecting decision traces.

> **Status: M1 — First Vertical Slice.** This milestone delivers the full
> UC-01 fatigue review loop: one rule-based package, one scenario, backend tick
> engine, append-only evidence recorder, and a 3-panel React UI for playback
> and trace inspection. There is no Google Maps integration, second package, or
> structured feedback yet — those arrive in later milestones.

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
| `frontend` | http://localhost:5180   | App UI (open this in browser)    |
| `api`      | http://localhost:8137   | FastAPI backend                  |

Open **http://localhost:5180**.

### Changing the ports

If 8137 or 5180 is already in use on your machine, change them in two places:

- **`docker-compose.yml`** — the `ports:` mapping for the affected service
  (e.g. `"8137:8137"` → `"<new>:8137"`).
- **`app/frontend/vite.config.ts`** — if you change the frontend port, update
  `server.port`; if you change the backend port, update the proxy `target`
  (`http://api:8137`). The backend container port itself is set by the `--port`
  flag in `Dockerfile.api`.

> **Note on dependency changes:** the `.venv` and `node_modules` directories
> live in named Docker volumes that are seeded only when first created. If you
> change backend or frontend dependencies later, run `docker compose down -v`
> (to drop the stale volumes) before `docker compose up` so the rebuilt images'
> dependencies take effect.

## UC-01 fatigue review loop (UI)

1. **Left panel — Setup:** select package **Rest proposal (rule-based)** and
   scenario **UC-01 fatigue friend drive** (the only options in M1).
2. Press **Start Run** → a run is created and `runs/<run_id>.json` is written
   immediately by the backend.
3. Press **Play** (or **Step** to advance one tick at a time). The left panel
   readouts update with drowsiness/fatigue bands and route position; the right
   panel trace fills with one row per tick.
4. When the fatigue decision point is reached the run pauses and the cockpit
   area switches to the **rest proposal**. The trace shows
   `result_type: REST_PROPOSAL`, the selected candidate, fire-control outcome,
   and explanation.
5. Click **Accept rest** or **Postpone** → the action is recorded in the
   evidence log and playback resumes to completion.
6. Click **Load** in the **RUN LOG** section (bottom-right panel) to load the
   persisted evidence JSON for the run, including the full trace and your
   driver action.

## Verify backend-only (no frontend)

```bash
# Create a run
curl -s -XPOST http://localhost:8137/api/runs \
  -H 'content-type: application/json' \
  -d '{"package_id":"rest_rule_based_v0_1","scenario_id":"uc01_fatigue_friend_drive_v0_1"}'

# Tick until "paused": true (the rest proposal)
curl -s -XPOST http://localhost:8137/api/runs/<run_id>/tick

# Act on the proposal
curl -s -XPOST http://localhost:8137/api/runs/<run_id>/actions \
  -H 'content-type: application/json' -d '{"action":"accept_rest"}'

# Read the persisted evidence
curl -s http://localhost:8137/api/runs/<run_id>/log

# The file also appears at:
ls runs/   # <run_id>.json
```

## Running the tests

Backend (pytest, via uv):

```bash
cd app/api && uv run pytest
```

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

## M1 scope — what is NOT here yet

| Feature | Milestone |
|---------|-----------|
| Google Maps route surface (BYO API key) | M4 |
| Second hypothesis package or scenario | M2 |
| Weighted-score or Python algorithm | M3 |
| Editable setup / run-plan flow | M2 |
| Structured driver feedback form | M5 |
| Evidence replay (re-running from log without backend) | M5 |

These are intentional gaps, not bugs. M1 is a runnable end-to-end loop for
the single UC-01 use case.

## Project layout

```
app/api/         FastAPI backend (aica_api package; tick engine, registries, evidence)
app/frontend/    React + TypeScript + Vite (3-panel UI)
packages/        hypothesis packages (rest_rule_based_v0_1/)
scenarios/       driving scenarios   (uc01_fatigue_friend_drive_v0_1.json)
runs/            persisted run evidence — written at runtime, gitignored
docker-compose.yml, Dockerfile.api, Dockerfile.frontend
docs/master/     authoritative specification, architecture, and milestone plan
specs/           Spec Kit feature specs
```

See `docs/master/` for the full specification, architecture, and milestone plan.
