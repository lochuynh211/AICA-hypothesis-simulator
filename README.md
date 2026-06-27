# AICA Hypothesis Simulator

A local, single-user tool for reviewing AICA (AI Cockpit Assistant) trigger
algorithms by running driving scenarios and inspecting decision traces.

> **Status: M3 — Python Algorithm Support.** M3 adds a Python `algorithm.py`
> adapter (any package can now ship a local `algorithm.py`), the transparent hybrid
> trigger package (`aica_transparent_hybrid_trigger_v1`), per-tick runtime-state
> threading (smoothed scores + persistence counters that evolve across ticks), and
> algorithm-error evidence (errors pause the run and are recorded in the trace). M2
> features (weighted-score, overtime scenario, editable parameters/hyperparameters,
> draft run-plan flow, richer per-tick evidence) are still fully supported.

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

## M3 review flow — transparent hybrid (UI)

1. **Select** package **AICA Transparent Hybrid Trigger v1** and a UC-01 rest
   scenario (e.g. UC-01 friend drive). Optionally edit hyperparameters (28 tunable
   values: smoothing α, score weights, band thresholds, persistence counts, cooldowns).
2. **Generate plan → Start → Play** (or Step). The trace shows, per tick:
   - Per-category **features** (11 features, 0–1 normalised)
   - **Category scores** (base safety risk, rest required, monotony prevention) —
     computed from *smoothed* features (EMA α = 0.35)
   - **State labels** (`REST_NORMAL → REST_WATCH → REST_SUGGEST → REST_RECOMMEND →
     REST_URGENT`; `MONOTONY_NORMAL → MONOTONY_WATCH → MONOTONY_CONTENT_SUGGEST`)
   - All **candidates** (including suppressed ones) and **fire-control** outcome
   - A compact **runtime-state indicator** (smoothed scores + persistence counters)
     that visibly changes tick-to-tick — the M3 headline
3. The persistence gate is visible: the smoothed rest score crosses the threshold
   one tick before the proposal fires (→ SUPPRESSED, counter 0→1), then fires the
   next tick (counter 1→2). Both ticks are in the persisted evidence.
4. When the rest proposal arrives, press **Accept rest** or **Postpone**.
5. In the **RUN LOG** the per-tick `package_runtime_state` is non-empty for every
   tick and changes across the run — proving state is threaded forward, not reset.

### Python algorithm errors

A `python_module` package whose `algorithm.py` lacks `evaluate`, raises an
exception, or returns an invalid result shape produces an `algorithm_error` event
in the trace (`missing_evaluate` / `algorithm_exception` / `invalid_result_shape`).
The error is shown in the UI trace and **pauses the run by default** (the run cannot
advance until the user acts), unless the package declares
`"error_mode": "non_blocking"` in its manifest. Errors are never disguised as
normal AICA decisions.

## Backend-only flow (curl)

```bash
B=http://localhost:8137

# List available packages (includes rest_python_v0_1 and aica_transparent_hybrid_trigger_v1)
curl -s $B/api/packages | python3 -c \
  'import sys,json;print([p["id"] for p in json.load(sys.stdin)["packages"]])'

# Analyse route (optional — warms the route facts)
curl -s -XPOST $B/api/routes/analyze \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"uc01_fatigue_friend_drive_v0_1"}'

# Create a draft run plan (use the transparent hybrid package)
PLAN=$(curl -s -XPOST $B/api/run-plans \
  -H 'content-type: application/json' \
  -d '{"package_id":"aica_transparent_hybrid_trigger_v1",
       "scenario_id":"uc01_fatigue_friend_drive_v0_1",
       "parameters":{},"hyperparameters":{},"run_mode":"standard"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["plan_id"])')

# Regenerate the plan (optional; changes parameter overrides etc.)
curl -s -XPOST $B/api/run-plans/$PLAN/regenerate \
  -H 'content-type: application/json' -d '{}'

# Create a run from the plan
RID=$(curl -s -XPOST $B/api/runs \
  -H 'content-type: application/json' \
  -d "{\"plan_id\":\"$PLAN\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')

# Tick until "paused": true (the rest proposal fires at tick 100)
curl -s -XPOST $B/api/runs/$RID/tick

# Act on the proposal (accept_rest | postpone)
curl -s -XPOST $B/api/runs/$RID/actions \
  -H 'content-type: application/json' -d '{"action":"accept_rest"}'

# Read the full persisted evidence — check package_runtime_state per tick
curl -s $B/api/runs/$RID/log | python3 -m json.tool | grep -A5 package_runtime_state

# The file is also at:
ls runs/   # <run_id>.json
```

## Running the tests

Backend (pytest, via uv):

```bash
cd app/api && uv run pytest
```

This covers: tick engine, weighted-score algorithm, declarative-rule algorithm,
run-plan draft flow, all five pairings (rule-based + weighted-score × friend-drive
+ overtime, plus hybrid × friend-drive) via the plan_id flow, proposal strength
(gentle/clear, not strong), decline-with-no-pending → 409, full evidence persistence,
the `python_module` adapter (missing_evaluate / algorithm_exception /
invalid_result_shape error matrix), the transparent hybrid (smoothing, persistence,
state machines, fire-control, priority, determinism, runtime-state threading), and
the M3 HTTP e2e (analyze → run-plans → runs → tick-loop → actions → log with
evolving per-tick `package_runtime_state`).

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

This covers: package/scenario selectors, parameter/hyperparameter editors,
plan preview, playback controls, cockpit proposal overlay, decline button
availability, route timeline, trace panel (incl. M3 state labels and runtime-state
indicator), run store, and error display.

## M3 scope — what is NOT here yet

| Feature | Milestone |
|---------|-----------|
| Google Maps route surface (BYO API key) | M4 |
| Structured driver feedback form | M5 |
| Evidence replay (re-running from log without backend) | M5 |
| Full monotony-prevention UX scenario | M8 |
| Untrusted-upload sandboxing for `python_module` packages | post-M3 |
| `expert_override` mode | post-M3 |
| Run comparison | post-M3 |

> **Local-trusted-code note:** `python_module` packages run in the same process as
> the backend with no sandboxing. Only use packages you trust. The AICA Hypothesis
> Simulator is a local, single-user development tool — not a multi-tenant or
> production system.

## Project layout

```
app/api/         FastAPI backend (aica_api package; tick engine, registries, evidence)
app/frontend/    React + TypeScript + Vite (3-panel UI)
packages/        hypothesis packages
  rest_rule_based_v0_1/               declarative_rule algorithm
  rest_weighted_score_v0_1/           weighted_score algorithm
  rest_python_v0_1/                   python_module parity package (M3)
  aica_transparent_hybrid_trigger_v1/ stateful transparent hybrid (M3)
scenarios/       driving scenarios   (uc01_fatigue_friend_drive_v0_1.json, uc01_overtime_driver_v0_1.json)
runs/            persisted run evidence — written at runtime, gitignored
docker-compose.yml, Dockerfile.api, Dockerfile.frontend
docs/master/     authoritative specification, architecture, and milestone plan
specs/           Spec Kit feature specs
```

See `docs/master/` for the full specification, architecture, and milestone plan.
