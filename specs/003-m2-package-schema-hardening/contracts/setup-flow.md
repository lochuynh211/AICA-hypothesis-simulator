# Contract: Setup / run-plan flow (M2 — replaces M1 one-step run creation)

All JSON, no auth. `plan_id`/timestamps generated only at the router boundary.

## `POST /api/routes/analyze`
- **Body**: `{ scenario_id }` (M2 local path; Google Maps is M4).
- **200** → `RouteFacts` (`total_route_distance_km`, `estimated_route_duration_min`,
  `route_segments[]` typed, `rest_spot_positions[]`, `route_progress_checkpoints[]`).
- **404** unknown/invalid scenario.

## `POST /api/run-plans`
- **Body**: `{ package_id, scenario_id, route_facts?, presets, profiles?,
  parameters, hyperparameters, run_mode }` (run_mode = "standard").
- Validates package/scenario compatibility and each edited parameter/hyperparameter
  against its def (`allowed`/`range`/`step`).
- **201** → `{ plan_id, draft_plan: EventPlan, effective_setup, validation_errors: [] }`.
- **400** → `{ detail, validation_errors:[{field, message}] }` for incompatible
  pairing or any out-of-range value — **no plan created**.

## `POST /api/run-plans/{plan_id}/regenerate`
- **Body**: changed `{ presets?, parameters?, hyperparameters? }`.
- **200** → updated `{ plan_id, draft_plan, effective_setup, validation_errors }`
  (same `plan_id`, regenerated draft). **400** on invalid edit. **404** unknown plan.

## `POST /api/runs`  (migrated)
- **Body**: `{ plan_id }`.  **The M1 `{package_id, scenario_id}` path is removed.**
- Freezes the draft plan + setup snapshot (package, scenario, route facts, profiles,
  speed profile, parameters, hyperparameters, run_mode), creates the run, writes the
  first log (with `initial`/`original` values + empty `package_runtime_state`).
- **201** → `RunState`.  **400** unknown/expired `plan_id`.

## `POST /api/runs/{run_id}/tick`  (unchanged envelope; richer evidence)
- **200** → `{ run_state, decision, paused, completed, tick_index }`; the persisted
  `TickEvent` now also carries `raw_state`, `feature_groups`, `driver_update`,
  `vehicle_update`, `package_runtime_state`. Algorithm error → `algorithm_error`
  event (unchanged).

## `POST /api/runs/{run_id}/actions`  (adds `decline`)
- **Body**: `{ action: "accept_rest" | "postpone" | "decline" }` (validated against
  the scenario's `allowed_actions`). `decline` → recorded, run continues without a
  rest (no further proposal in M2's one-proposal model). 409 if no pending proposal.

## `GET /api/packages|scenarios|runs|runs/{id}|runs/{id}/log` — unchanged (now 2×2).

## Contract tests
- `routes/analyze` returns facts for both scenarios.
- `run-plans` generates a deterministic draft; an out-of-range edited value → 400
  with `validation_errors` and no plan; `regenerate` changes the draft.
- `runs {plan_id}` freezes + persists; a bare `{package_id, scenario_id}` is rejected
  (path removed).
- Full loop (both packages × both scenarios) via TestClient: analyze → run-plans →
  runs → tick to proposal → action (incl. `decline` on overtime) → GET /log carries
  the full per-tick evidence + original/modified values.
