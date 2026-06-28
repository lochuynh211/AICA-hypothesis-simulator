# Phase 1 Data Model: M6 V1 Stabilization & UI/UX Polish

M6 is mostly UI + small backend additions. No new persisted decision data; profile overrides reuse an
existing field and are frozen at run start.

## Frontend store (`state/runStore.ts`) — EXTENDED
- `viewMode: 'setup' | 'review' | 'runs'` (default `'setup'`). Transitions: Start Run → `review`;
  New run / Setup → `setup` (clears the run); Runs nav → `runs`.
- `uiLanguage: 'ja' | 'en'` (default `'ja'`; session-only, NOT persisted).
- profile-override edit state (per the selected scenario's profiles + edits) + a reset-to-default action.
- replay state: the loaded `RunLog` for a past run + the current replay `tickIndex` (read-only).
- (existing M2–M5 state retained.)

## Profile override (backend — reuse `CreateRunPlanBody.profiles`)
`CreateRunPlanBody.profiles` (already present, currently dropped) carries optional overrides:
```
profiles = { driver_profile?: DriverModelProfile, vehicle_profile?: VehicleBehaviorProfile,
             speed_profile?: SpeedProfile }   # each validated against its Pydantic model
```
- Validated against the existing models (`models/profile.py`): `DriverModelProfile` (drowsiness/
  fatigue/attention/recovery sub-models; nonneg validators), `VehicleBehaviorProfile` (steering/lane/
  pedal/adas + rolling_window), `SpeedProfile` (5 kph ints, `extra="forbid"`). An invalid value → a
  structured validation error; no run starts.
- The draft uses the **effective** profile = the override if present, else the scenario's. The effective
  profiles are **frozen** into `RunState`/`RunLog` (already persisted there since M5) at run start and
  used by `advance_tick`. No mid-run change.

## Evidence export — EXTENDED (not new persisted data)
- `GET /api/runs/{id}/evidence` gains an optional `ui_language` query param; the report's `ui_language`
  records it (default the M5 `"bilingual"` constant for back-compat).
- `GET /api/runs/{id}/evidence.md` returns the same report rendered as Markdown (derived; not persisted).

## Replay source (`replay/replaySource.ts`) — NEW, derived (not persisted)
Reads a persisted `RunLog` and exposes, per `tickIndex`, the recorded state for the playback components:
`{ tick_state, raw_state, feature_groups, decision_result, route_fraction, proposal_marker }` from the
TickEvent at that index. Pure/read-only; no engine, no recalculation.

## Run list entry (from `GET /api/runs`, already exists)
`{ run_id, created_at, package_id, scenario_id, status }` — surfaced as the Runs-view list.

## No new persisted schema
RunLog/evidence shapes are unchanged from M5 (RunLog already carries the profiles since M5). Markdown +
ui_language are derived views; viewMode/uiLanguage/replay are frontend-only state.
