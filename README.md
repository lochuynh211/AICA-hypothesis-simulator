# AICA Hypothesis Simulator

A local, single-user tool for reviewing AICA (AI Cockpit Assistant) trigger
algorithms by running driving scenarios and inspecting decision traces.

> **Status: M2 — Package & Schema Hardening.** M2 adds the second hypothesis
> package (weighted-score), the overtime scenario with decline support, editable
> parameters/hyperparameters with inline validation, a draft run-plan flow with
> regeneration, and richer per-tick evidence (raw_state, feature groups, driver &
> vehicle updates). The M1 rule-based package and friend-drive scenario are still
> fully supported.

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

## M2 review flow (UI)

1. **Select a package** — **Rest proposal (rule-based)** or
   **Rest proposal (weighted-score)** — and a **scenario** — **UC-01 friend drive**
   or **UC-01 overtime driver**.
2. **Edit parameters / hyperparameters** — defaults are pre-filled; invalid values
   show an inline error and block the plan.
3. **Generate plan** — the backend generates a draft plan summary (tick cadence,
   traffic/rest events). Tweak settings and press **Regenerate** as desired.
4. Press **Start** → the run is created and `runs/<run_id>.json` is written
   immediately by the backend.
5. Press **Play** (or **Step** one tick at a time). The left panel readouts update
   with drowsiness/fatigue bands and route position; the right panel trace fills
   with one row per tick. For the weighted-score package the trace shows
   per-category scores, candidate strength, and state.
6. When the fatigue decision point is reached the run pauses and the cockpit area
   shows the **rest proposal**. Press **Accept rest**, **Postpone**, or (for the
   overtime scenario) **Decline**.
7. Click **Load** in the **RUN LOG** section (bottom-right panel) to view the full
   persisted evidence — setup snapshot, frozen plan, driver+vehicle profiles,
   per-tick `raw_state`/`feature_groups`/driver+vehicle updates, and your action.

## Backend-only flow (curl)

```bash
B=http://localhost:8137

# Analyse route (optional — warms the route facts)
curl -s -XPOST $B/api/routes/analyze \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"uc01_overtime_driver_v0_1"}'

# Create a draft run plan
PLAN=$(curl -s -XPOST $B/api/run-plans \
  -H 'content-type: application/json' \
  -d '{"package_id":"rest_weighted_score_v0_1",
       "scenario_id":"uc01_overtime_driver_v0_1",
       "presets":{},"parameters":{},"hyperparameters":{},"run_mode":"standard"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["plan_id"])')

# Regenerate the plan (optional; changes parameter overrides etc.)
curl -s -XPOST $B/api/run-plans/$PLAN/regenerate \
  -H 'content-type: application/json' -d '{}'

# Create a run from the plan
RID=$(curl -s -XPOST $B/api/runs \
  -H 'content-type: application/json' \
  -d "{\"plan_id\":\"$PLAN\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')

# Tick until "paused": true (the rest proposal)
curl -s -XPOST $B/api/runs/$RID/tick

# Act on the proposal (accept_rest | postpone | decline)
curl -s -XPOST $B/api/runs/$RID/actions \
  -H 'content-type: application/json' -d '{"action":"decline"}'

# Read the full persisted evidence
curl -s $B/api/runs/$RID/log

# The file is also at:
ls runs/   # <run_id>.json
```

## Running the tests

Backend (pytest, via uv):

```bash
cd app/api && uv run pytest
```

This covers: tick engine, weighted-score algorithm, declarative-rule algorithm,
run-plan draft flow, both packages × both scenarios via the plan_id flow (3 firing
pairings + ws×friend-drive log-structure and determinism), proposal strength
(gentle/clear, not strong), decline-with-no-pending → 409, and full evidence
persistence.

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

This covers: package/scenario selectors, parameter/hyperparameter editors,
plan preview, playback controls, cockpit proposal overlay, decline button
availability, route timeline, trace panel, run store, and error display.

## M2 scope — what is NOT here yet

| Feature | Milestone |
|---------|-----------|
| Google Maps route surface (BYO API key) | M4 |
| Python / transparent-hybrid algorithm | M3 |
| Structured driver feedback form | M5 |
| Evidence replay (re-running from log without backend) | M5 |
| `expert_override` mode | post-M2 |
| Run comparison | post-M2 |

## Project layout

```
app/api/         FastAPI backend (aica_api package; tick engine, registries, evidence)
app/frontend/    React + TypeScript + Vite (3-panel UI)
packages/        hypothesis packages (rest_rule_based_v0_1/, rest_weighted_score_v0_1/)
scenarios/       driving scenarios   (uc01_fatigue_friend_drive_v0_1.json, uc01_overtime_driver_v0_1.json)
runs/            persisted run evidence — written at runtime, gitignored
docker-compose.yml, Dockerfile.api, Dockerfile.frontend
docs/master/     authoritative specification, architecture, and milestone plan
specs/           Spec Kit feature specs
```

See `docs/master/` for the full specification, architecture, and milestone plan.
