# Phase 0 Research: M2 Package & Schema Hardening

The ADR (two review rounds) + the spec + one clarify resolved the design. This file
records the concrete model/formula choices and migration decisions so Phase 1 has no
open unknowns.

## R1 — Behavioral rate model (driver/vehicle)

- **Decision**: Port the runtime-workflow additive rate model verbatim.
  - Driver per tick (per minute → scaled by `tick_seconds/60`): `drowsiness +=
    base_growth + night_add(if is_night) + monotony_add(if monotonous segment) +
    traffic_jam_add(if jam)`; `fatigue +=` analogous incl.
    `continuous_driving_add_per_min_after_60_min` once elapsed > 60 min and
    `mountain_road_add`; `attention +=` `base_recovery − monotony_drop −
    drowsiness_drop_factor*drowsiness − …`, `+ active_content_recovery` when a
    recovery content action is active. Levels clamped 0–100. Component deltas
    retained for the trace (`driver_update.delta`).
  - Vehicle per tick: `steeringInstabilityLevel = base + drowsiness_factor*drowsiness
    + fatigue_factor*fatigue + road adds − jam reduce`; `pedalAbnormalityLevel`
    analogous; rolling-window (`rolling_window_seconds`, default 300) counts
    `laneDepartureCount`/`adasWarningCount` incremented when thresholds exceeded.
- **Rationale**: Master-specified, deterministic, component-traceable.
- **Alternatives**: nonlinear fatigue (rejected — not in master; YAGNI).

## R2 — Position from speed profile

- **Decision**: `effective_speed_kph = traffic_jam_kph if jam else
  speed_profile[current_segment_type]`; `distance_km += effective_speed_kph *
  tick_seconds / 3600` (workflow §4.1). Route fraction derives from
  distance/total_route_distance. Replaces M1's `elapsed/total_duration` fraction.
- **Rationale**: Master model; deterministic; ties speed preset to progression.

## R3 — `raw_state` + `feature_groups` context

- **Decision**: `tick_engine.build_context` returns
  `{raw_state: {...numeric...}, feature_groups: {normalized: {...0–1...}, ordinal:
  {...bands...}}}`. `raw_state` keys: `drowsinessLevel`, `fatigueLevel`,
  `attentionLevel`, `speedKph`, `steeringInstabilityLevel`, `pedalAbnormalityLevel`,
  `laneDepartureCount`, `adasWarningCount`, `nextRestSpotMin`, `routeFraction`,
  `continuousDrivingMin`, `isNight`, `weatherRiskLevel`, segment type. `binning.py`
  derives the ordinal bands (M1 names) + normalized 0–1 features from `raw_state`.
- **Rationale**: `declarative_rule` consumes `feature_groups.ordinal`;
  `weighted_score` (and M3 hybrid) consume `raw_state`/`feature_groups.normalized`.
  Matches the constitution-IV refinement (external-service numerics bounded at M4).
- **Alternatives**: bands-only context (rejected — blocks weighted/hybrid).

## R4 — `weighted_score` formulas (from the transparent-hybrid proposal)

- **Decision**:
  - `base_safety_risk = clamp(0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly
    + 0.10·future_fatigue, 0, 1)` (feature scores normalized from `raw_state`).
  - `rest_required_score = base_safety_risk` plus gated bonus
    (`+0.10·rest_window + 0.08·rest_scarcity`) only when `base_safety_risk ≥ 0.45`.
  - `monotony_prevention_score = clamp(0.30·monotony + 0.20·familiar_route +
    0.25·attention_drop + 0.15·traffic_jam + 0.10·long_highway, 0, 1)`.
  - Thresholds `suggest 0.62 / recommend 0.76 / urgent 0.88` → strength
    gentle/clear/strong; state labels `REST_RECOMMEND`/`MONOTONY_WATCH`.
  - Priority `[rest_required, monotony_prevention]` then score desc → selected.
- **Rationale**: Master proposal §§10,13,15; prepares M3's hybrid (which adds
  smoothing/persistence/state-machine on the same shapes).
- **Note**: M2 `weighted_score` does **no** smoothing/persistence — `package_runtime_state`
  returned empty.

## R5 — Setup/run-plan flow + `plan_id` migration

- **Decision**: `POST /api/routes/analyze {scenario_id}` → route facts (local).
  `POST /api/run-plans {package_id, scenario_id, route_facts?, presets, profiles,
  parameters, hyperparameters, run_mode}` → validates edits, generates a draft
  `EventPlan`, returns `{plan_id, draft_plan, effective_setup, errors}`; draft held
  in an in-memory registry keyed by `plan_id`. `POST /api/run-plans/{plan_id}/regenerate`
  → updated draft. `POST /api/runs {plan_id}` → freezes draft + setup, creates run.
  **The M1 `{package_id, scenario_id}` create path is removed** (clarify A); M1's
  backend-only e2e test migrates to the flow.
- **Rationale**: One coherent contract (architecture §13.2); no dual path.
- **Determinism**: `plan_id`/timestamps only at the router boundary; draft-plan
  generation pure given `(route_facts, presets)`.

## R6 — `package_runtime_state` plumbing

- **Decision**: validated `dict` field on `RunState` + run log, default `{}`.
  `run_manager.tick` passes the current value into `adapter.evaluate(...,
  package_runtime_state=...)` and stores the returned `next_package_runtime_state`
  into run state for the next tick; persisted per tick. M2 built-ins return `{}`.
  A test uses a stub algorithm returning a non-empty value to prove threading +
  persistence.
- **Rationale**: master M2 scope; readies M3 with no schema change.

## R7 — Editable setup validation + original/modified persistence

- **Decision**: `ParameterDef`/`HyperparameterDef` carry `allowed`/`range`/`step`;
  `run-plans` validates each edited value, returns a clear per-field error on
  violation (no plan/run). Run log records `initial_parameters`/`current_parameters`,
  `initial_hyperparameters`/`current_hyperparameters`, and an explicit
  `original_values`/`modified_values` diff.
- **Rationale**: spec FR-008/FR-010; reuses M1 US4 error display.

## R8 — Scenario re-authoring + second scenario

- **Decision**: `uc01_fatigue_friend_drive` re-authored to carry
  driver/vehicle/speed profiles + presets (drop `drowsiness_schedule`), tuned so the
  profile-driven drowsiness/fatigue crosses the proposal threshold once.
  `uc01_overtime_driver` is night/solo/high-resistance with a fatigue-susceptible
  profile, convenience-store micro-rest, `allowed_actions: [accept_rest, postpone,
  decline]`. Both fire exactly one proposal deterministically.
- **Rationale**: spec US3/US4/FR-013; single behavioral model.

## R9 — Localized message/explanation

- **Decision**: `ProposalDef.message` + `DecisionResult.proposal.message` are
  `{ja,en}` (already M1); `DecisionResult.explanation` accepts `str | {ja,en} |
  list[str|{ja,en}]` with a plain-string fallback. M2 algorithms may emit a string;
  the schema accepts the localized shape M3 needs.
- **Rationale**: spec FR-011; ready M3 without a schema change.

## Outcome

All Technical Context items are concrete. **No `NEEDS CLARIFICATION` remain.**
