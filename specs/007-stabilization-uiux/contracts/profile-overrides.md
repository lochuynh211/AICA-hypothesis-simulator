# Contract: profile overrides (setup-time, frozen at run start)

## Wire the existing `CreateRunPlanBody.profiles` (currently dropped)
`POST /api/run-plans` body already has `profiles: Any = None`. M6 makes it effective:
- `profiles` = `{ driver_profile?, vehicle_profile?, speed_profile? }`; each present override is
  validated against its model (`DriverModelProfile` / `VehicleBehaviorProfile` / `SpeedProfile` in
  `models/profile.py`, with their nonneg / range / `extra=forbid` validators). Invalid → structured
  validation error (the draft is not built / 400-style); no run starts.
- The draft's **effective profiles** = the override when present, else the scenario's. The effective
  profiles are persisted on `RunState`/`RunLog` (the M5 profile fields) at `create_run` and used by the
  tick engine (`advance_tick` reads the effective profiles, exactly as it reads the scenario's today).
- Profiles are **frozen at run start** — no mid-run mutation (same immutability as hyperparameters).

## Effective-profile usage
`run_manager.create_run` already snapshots scenario profiles into `RunLog` (M5). M6 makes it snapshot
the **effective** (override-or-scenario) profiles, and `tick_engine.advance_tick` uses them. The M5
evidence export already surfaces driver/vehicle profiles, so an edited run's evidence shows the edits.

## Frontend prefill
The profile editor pre-fills from the selected scenario's profiles (available via the scenario data);
"reset to scenario default" restores them. Edited values are sent as `profiles` in the run-plan body.

## Contract tests
- A run-plan with a `profiles` override → the draft/run uses the overridden profile (the effective
  profile differs from the scenario; visible in the run log + evidence).
- A run-plan with NO override → the scenario's profiles are used (unchanged behavior).
- An invalid override value (e.g. a negative rate, a bad speed) → structured validation error; no run.
- The override is frozen: it cannot change once the run started (a new run is required to change it).
- A run made with an edited speed_profile shows the changed `speedKph` behavior in the tick raw_state.
