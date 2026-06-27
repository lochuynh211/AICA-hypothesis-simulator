# Contract: Run lifecycle endpoints

## `POST /api/runs`
- **Body**: `{ package_id, scenario_id }` (M1: no setup edits).
- Backend validates compatibility, freezes snapshot + generates the EventPlan
  internally, initializes state, writes the first run log.
- **201** → `RunState` (incl. `run_id`, `status: "created"`, frozen `snapshot`,
  `event_plan`, `route_facts`).
- **400** → `{ detail }` for incompatible package/scenario or invalid selection
  (FR-003). No run is created.

## `POST /api/runs/{run_id}/tick`
- Advances one fixed sim-time step, builds context, evaluates via the adapter,
  appends a `TickEvent` (with the `DecisionResult` trace), persists the log.
- **200** → `{ run_state, decision: DecisionResult, paused: bool, completed: bool }`.
  - `paused: true` with `run_state.pending_proposal` set when a proposal fires.
  - `completed: true` when the route end is reached; further ticks are no-ops
    returning `completed: true` without advancing.
- On algorithm failure: appends an `AlgorithmError` event, persists, and returns
  **200** → `{ run_state, error: AlgorithmError, paused: false }` — **never** a
  fabricated decision (FR-011).
- **404** unknown run.

## `POST /api/runs/{run_id}/actions`
- **Body**: `{ action: "accept_rest" | "postpone" }`.
- Valid only while `status: "paused"` with a `pending_proposal`; validated against
  the scenario's `allowed_actions`. Applies the transition, appends an `ActionEvent`,
  persists.
- **200** → updated `RunState` (status back to `playing` or `completed`).
- **409** → `{ detail }` if no proposal is pending (FR edge case).
- **400** → disallowed action. **404** unknown run.

## `GET /api/runs`
- **200** → `{ runs: [ { run_id, created_at, package_id, scenario_id, status } ] }`
  (read from `runs/`).

## `GET /api/runs/{run_id}`
- **200** → current `RunState`. **404** unknown.

## `GET /api/runs/{run_id}/log`
- **200** → the persisted `RunLog` JSON exactly as stored on disk (static display;
  no replay rendering in M1). **404** unknown.

## Contract tests (incl. backend-only end-to-end)
- Create run with the fixtures → 201, log file exists.
- Tick repeatedly → exactly one tick returns `paused` with the rest proposal; the
  same sequence is identical across two runs (determinism).
- Action `accept_rest` while paused → 200, resumes; action with no pending proposal
  → 409.
- `GET /log` returns the on-disk JSON containing the trace (with any suppressed
  candidate) and the action event.
- Full loop driven via `TestClient` with no frontend (FR-014 / SC-006).
