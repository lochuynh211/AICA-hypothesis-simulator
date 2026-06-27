# ADR / Design — M2 Package & Schema Hardening

**Date:** 2026-06-27
**Milestone:** M2 — Package And Schema Hardening
**Status:** Accepted (pending implementation)
**Source docs:** `docs/master/aica_hypothesis_simulator_milestones.md` §4,
`aica_hypothesis_simulator_architecture.md` §§9–14,
`aica_hypothesis_simulator_runtime_workflow.md` §§3,4,7,9,10,
`others/aica_transparent_hybrid_trigger_algorithm_proposal.md` §§10,13,15,
`others/usecases/uc01_fatigue_drowsiness_rest_proposal.md`; constitution v1.0.0
**Builds on:** M1 (`docs/superpowers/specs/2026-06-27-m1-first-vertical-slice-design.md`)

---

## 1. Context

M1 delivered the first end-to-end review loop with one `declarative_rule` package,
one UC-01 scenario, the full §11 `DecisionResult`, registries, the deterministic
tick engine, and append-only evidence. M2 hardens packages and schema so the
simulator supports **multiple hypotheses safely**: a second algorithm type, a
second scenario, a real behavioral simulation, the architecture's setup/run-plan
flow with editable values, and run-log completeness.

Per the M1 ADR the base models/registries/adapter/tick-engine/recorder already
exist; M2 **hardens and extends** them. The master's rich behavioral model
(driver/vehicle/speed) and the transparent-hybrid proposal's multi-category
scoring are fully specified and are the references for M2's engine and
`weighted_score` algorithm.

## 2. Scope decisions (settled in brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | `weighted_score` distinctiveness | **Multi-category** (rest_required + monotony_prevention), real category scores, priority resolution — populates the §11 `scores`/multi-candidate/`selected_category`/`states` fields M1 left empty. |
| D2 | Setup-edit flow | **Full run-plans draft API** (`routes/analyze` + `run-plans` + `regenerate` → `runs` freezes), per architecture §13.2. |
| D3 | Profiles | **Rich behavioral modeling** — real driver/vehicle/speed profile models driving deterministic per-tick driver+vehicle state; binned before the trigger. |
| D4 | Feedback-event model | **Deferred to M5** (M5 owns structured feedback; defining it now is speculative). |
| D5 | Milestone size | **One M2**, implemented as ~6 ordered independent slices (not split into M2a/M2b). |
| D6 | M1 friend-drive fixture | **Re-authored** to the profile-driven engine (drop the authored `drowsiness_schedule`); single clean model. |
| D7 | Run mode | **`standard` only**; `expert_override` stays deferred to M5+. |

### Honest size note

M2 is **large — comparable to M1** — because D3 *replaces* M1's authored
drowsiness schedule + fraction position with a real simulation engine (the M1 tick
engine and friend-drive fixture are migrated, not merely extended). It is kept as
one milestone but built as six independent slices (§9). `expert_override`, Google
Maps, Python algorithms, and structured feedback remain in later milestones.

## 3. In scope / out of scope

**In:** rich driver/vehicle/speed behavioral engine (binned before the trigger);
`weighted_score` algorithm + `rest_weighted_score_v0_1` package; the
`routes/analyze` + `run-plans` (+`regenerate`) + migrated `runs` setup flow;
editable parameters/hyperparameters before run start with original/modified
persistence; second scenario `uc01_overtime_driver_v0_1`; schema hardening
(route facts, event plan, profiles, speed profile, category scores, state labels,
run_mode/evidence_status); run-log completeness; frontend multi-option selectors +
param/hyperparam editors + draft-plan preview/regenerate.

**Out (later milestones):** Google Maps route surface (M4); Python
`python_module` + the transparent-hybrid `aica_transparent_hybrid_trigger_v1`
(M3 — incl. smoothing, persistence counters, state machines, `package_runtime_state`);
structured feedback capture + evidence replay (M5); `expert_override` mode (M5+);
run comparison (post-V1).

## 4. Behavioral engine (slice 1 — foundation)

All numeric; **binned to ordinal bands before any value reaches the trigger**
(constitution IV). Deterministic: same profile + frozen plan → identical
progression.

### 4.1 Profile models (`models/profile.py`)
- **`DriverModelProfile`** — `drowsiness_model` (`base_growth_per_min`,
  `night_add_per_min`, `monotony_add_per_min`, `traffic_jam_add_per_min`),
  `fatigue_model` (`base_growth_per_min`,
  `continuous_driving_add_per_min_after_60_min`, `mountain_road_add_per_min`,
  `traffic_jam_add_per_min`), `attention_model` (`base_recovery_per_min`,
  `monotony_drop_per_min`, `drowsiness_drop_factor`,
  `active_content_recovery_per_min`), `recovery_model` (short/long rest
  drowsiness/fatigue recovery).
- **`VehicleBehaviorProfile`** — `rolling_window_seconds` (default 300),
  `steering_instability` (base + drowsiness/fatigue factors + road adds),
  `lane_departure` (thresholds, enabled roads), `pedal_abnormality`,
  `adas_warning`. Outputs continuous `steeringInstabilityLevel`/
  `pedalAbnormalityLevel` + rolling counts `laneDepartureCount`/`adasWarningCount`.
- **`SpeedProfile`** — numeric kph per segment type (`normal_road_kph`,
  `highway_kph`, `mountain_road_kph`, `sightseeing_road_kph`, `traffic_jam_kph`).

### 4.2 Per-tick model (`services/behavior/{driver_model,vehicle_model}.py`)
- **Position:** `effective_speed = traffic_jam_kph if jam else
  speed_profile[segment_type]`; `distance += effective_speed * tick_seconds / 3600`
  (workflow §4.1). Replaces M1's elapsed-fraction position.
- **Driver state:** additive per tick — drowsiness/fatigue/attention advance by
  summing applicable profile rate components (incl. the `>60min` continuous-driving
  term and night/monotony/traffic terms). Component deltas persisted
  (`driver_update.delta`) for trace traceability.
- **Vehicle signals:** steering instability / pedal / lane-departure / ADAS counts
  over the rolling window from driver state + road type.
- **Recovery:** rest actions apply `recovery_model` deltas (workflow §7.1).

### 4.3 Binning seam (`services/binning.py`)
Numeric driver/vehicle outputs (0–100 levels, counts) → ordinal bands
(`drowsiness_level`, `fatigue_level`, `signal_duration`, `driving_anomaly`, etc.)
**before** the adapter context. No raw number reaches the trigger.

### 4.4 Migration
The M1 authored-`drowsiness_schedule` path is removed; `event_plan`/`tick_engine`
recompute driver/vehicle state from profiles. M1 tick-engine tests are updated to
the profile model. `uc01_fatigue_friend_drive_v0_1` is re-authored to carry
profiles + presets (tuned to still fire exactly one REST_PROPOSAL).

## 5. `weighted_score` algorithm (slice 2)

Second built-in type through the **same adapter contract** (constitution V);
populates the multi-category §11 fields. No smoothing/persistence/state-machine
(those are M3's transparent-hybrid Python package).

### 5.1 `algorithms/weighted_score.py`
- **Feature scores** (0–1) mapped from the binned ordinal bands.
- **Category scores** (proposal §10):
  - `base_safety_risk = clamp(0.40·drowsiness + 0.25·fatigue +
    0.25·driving_anomaly + 0.10·future_fatigue, 0, 1)`
  - `rest_required_score` = `base_safety_risk`, plus a **gated** rest bonus
    (`+0.10·rest_window + 0.08·rest_scarcity`) only when
    `base_safety_risk ≥ minimum_risk_for_rest_bonus` (0.45) — rest opportunity
    alone cannot trigger.
  - `monotony_prevention_score = clamp(0.30·monotony + 0.20·familiar_route +
    0.25·attention_drop + 0.15·traffic_jam + 0.10·long_highway, 0, 1)`
- **Candidates:** each category vs thresholds `suggest 0.62 / recommend 0.76 /
  urgent 0.88` → `strength` (gentle/clear/strong) + `state` label
  (`REST_RECOMMEND`, `MONOTONY_WATCH`) + per-candidate `fire_control`. Below-suggest
  → `exists:false`; over-threshold-but-unactionable → **suppressed** (retained).
- **Priority resolution:** fired candidates sorted by
  `priority_rank [rest_required, monotony_prevention]` then score desc →
  `selected_category` drives the proposal; non-selected fired candidates remain in
  `candidates[]`.
- **Normalization:** full §11 with `scores`/`states`/multi-`candidates`/
  `selected_category` populated; `next_package_runtime_state` empty (M3).

### 5.2 `packages/rest_weighted_score_v0_1/package.json`
`algorithm.type: "weighted_score"`; two `trigger_categories` (`rest_required` p1,
`monotony_prevention` p2); feature/weight/threshold hyperparameters (editable);
`rest_guidance` proposal; fire-control (threshold + actionability guard);
`compatible_scenario_types: ["uc01_fatigue"]`. The adapter gains a `weighted_score`
dispatch branch; both algorithms still route errors to `algorithm_error` events.

## 6. Setup / run-plan API + editable setup (slices 3–4)

Replaces M1's one-shot `POST /api/runs {package_id, scenario_id}` with the
architecture §13.2 sequence. `plan_id`/timestamps only at the router boundary;
draft-plan generation from `(route_facts, presets)` is pure (determinism held).

- **`POST /api/routes/analyze`** — `{scenario_id}` (local path; Maps is M4) →
  route-derived facts: `total_route_distance`, `estimated_route_duration`,
  `route_segments` (`segment_type` ∈ highway/normal_road/mountain_road/
  sightseeing_road), `rest_spot_positions`, `route_progress_checkpoints`.
- **`POST /api/run-plans`** — `{package_id, scenario_id, route_facts, presets,
  profiles, parameters, hyperparameters, run_mode}` → validates edits against the
  package defs; generates a draft `EventPlan` (`tick_seconds`, `traffic_events`,
  `weather_events`, `rest_opportunities`) from route facts + presets; returns
  `{plan_id, draft_plan, effective_setup}`. Draft held in an in-memory registry,
  mutable until run start.
- **`POST /api/run-plans/{plan_id}/regenerate`** — changed presets/values →
  regenerated draft.
- **`POST /api/runs`** — migrated — `{plan_id}` → freezes the draft plan + setup
  snapshot (package, scenario, route facts, profiles, speed profile, parameters,
  hyperparameters, run_mode), creates the run, writes the first log.

**Editable setup:** each `ParameterDef`/`HyperparameterDef` carries allowed band
values / range / step; out-of-range edits rejected with a clear, frontend-visible
error (reusing M1 US4 display). Run log records `initial`/`current` parameters +
hyperparameters and an explicit `original_values` vs `modified_values` diff.

**Run mode:** `standard` only; values frozen at run start; a change requires a new
run-plan/run. `evidence_status: standard`.

## 7. Second scenario (slice 5) + frontend setup UI

### 7.1 `scenarios/uc01_overtime_driver_v0_1.json`
UC-01-02 persona "B": early-30s male, solo, **late-night drive home after
overtime**, foggy/tired, **high resistance to rest**. `type: "uc01_fatigue"`;
`is_night: true` (raises `night_add_per_min` + the algorithm's night feature);
fatigue-susceptible driver profile; convenience-store waypoint; presets tuned to
deterministically reach **one micro-rest proposal** (gentle/clear strength, 3-min
stretch — not a full nap); `allowed_actions: ["accept_rest", "postpone",
"decline"]` (adds **`decline`** for the high-resistance branch). Review focus:
is a short micro-intervention right for a resistant late-night driver.

### 7.2 Frontend (`components/setup/`)
- `PackageSelector`/`ScenarioSelector` → real **multi-option** (2×2) with
  compatibility filtering.
- `ParameterEditor` + `HyperparameterEditor` — render the selected package's defs
  as editable controls (band dropdowns / numeric-with-step), defaults pre-filled,
  validated client- and server-side.
- **Setup → plan preview** step: `routes/analyze` + `run-plans` → draft-plan
  summary with a **Regenerate** button; **Start** → `POST /api/runs {plan_id}`.
- Validation/compatibility errors surface via M1's `role=alert` display.
- `state/runStore` extends with setup-draft state (`plan_id`, draft plan, edited
  values, errors). Playback/cockpit/trace/log (M1) unchanged downstream.
- Profile **selection** from scenario-provided options may be exposed; rich profile
  **editing** is out (keeps the UI bounded).

## 8. Schema hardening + run-log completeness (slice 6)

Make-real (Pydantic-validated) the fields M1 stubbed: full `RouteFacts`,
`EventPlan` (traffic/weather/rest_opportunities), `DriverModelProfile`/
`VehicleBehaviorProfile`/`SpeedProfile`; `DecisionResult` now populates `scores`/
`states`/multi-`candidates`/`selected_category`. `RunLog`/`RunState` extended with
route-derived facts, frozen event plan, selected profiles + speed profile,
`run_mode`/`evidence_status`, `initial`/`current` parameters + hyperparameters, the
`original_values`/`modified_values` setup diff, and per-tick
`driver_updates`/`vehicle_updates` (component deltas). `package_runtime_state`
stays empty (M3). Persist after every event (append-only, unchanged).

## 9. Implementation slices (ordered, independent)

1. **Behavioral engine** — profile models, per-tick driver/vehicle model,
   speed-driven position, binning seam; migrate tick engine + re-author friend-drive
   fixture.
2. **`weighted_score`** — algorithm + package + adapter branch; multi-category +
   priority.
3. **Setup/run-plan API** — `routes/analyze`, `run-plans`(+regenerate), migrated
   `runs`; route facts + draft event plan.
4. **Editable setup + persistence** — validation, original/modified values, run-log
   completeness.
5. **Second scenario** — `uc01_overtime_driver_v0_1` + `decline` action.
6. **Frontend setup UI** — multi-option selectors, param/hyperparam editors,
   draft-plan preview/regenerate, error display.

(Schema hardening, §8, is threaded through slices 1/3/4 rather than a separate
slice.)

## 10. Testing strategy (TDD; contract surfaces first)

- **Behavioral engine:** determinism (same profile+plan → identical
  driver/vehicle progression); speed-driven position; `>60min` term; recovery on
  rest action; **binning emits only ordinal bands** (no raw number in context).
- **`weighted_score`:** category-score math matches the proposal formulas; gated
  rest bonus can't trigger alone; strength thresholds; multi-category candidates
  incl. a **suppressed** one; priority selects the right candidate; totality +
  determinism; normalized §11 with populated `scores`/`states`.
- **Setup/run-plan API:** `routes/analyze` returns facts; `run-plans` deterministic
  draft + validates edits (out-of-range → clear error); `regenerate` changes the
  draft; `runs {plan_id}` freezes + persists; invalid edited value rejected
  (visible).
- **Persistence:** run log carries route facts, frozen plan, profiles, speed
  profile, run_mode/evidence_status, original/modified values; append-only held.
- **Both packages × both scenarios:** each pairing runs to its proposal; rule vs
  weighted-score produce comparable §11 traces; the overtime `decline` action
  transitions correctly.
- **Frontend:** multi-option selectors + editors render defs and validate;
  draft-plan preview + regenerate; edited values flow into `run-plans`/`runs`;
  validation errors shown.
- **e2e (controller, docker):** drive both packages on both scenarios via
  setup→plan→run; confirm persisted logs carry the setup diff + plan + profiles.

## 11. Acceptance mapping (milestone §4)

| Criterion | M2 satisfies it |
|---|---|
| Backend rejects invalid packages with clear errors | registry validation (M1) + run-plan edit validation |
| Frontend shows package/scenario validation errors | M1 US4 display reused in the setup flow |
| Choose between rule-based and weighted-score packages | both built-in algorithms + packages |
| Choose between two UC-01 scenarios | friend-drive + overtime fixtures |
| Edit values before starting playback | ParameterEditor/HyperparameterEditor + run-plans flow |
| Run log records setup snapshot, plan, original + modified values | §6/§8 run-log completeness |

## 12. Constitution check (preview)

- **I** Backend source of truth — engine/scores/plan all backend; frontend renders.
- **II** Append-only/honest failure — recorder unchanged; algorithm errors as events.
- **III** Deterministic — engine + draft-plan generation pure; ids/timestamps at the
  boundary; frozen plan.
- **IV** Qualitative discipline — numeric profiles binned to ordinal bands before
  the trigger; the binning seam is the only entry point.
- **V** One adapter contract — `weighted_score` dispatched through the same
  `evaluate(...) → DecisionResult`; normalized; suppressed retained.
- **VI** Local-first YAGNI — two packages/scenarios, file-based, no DB/cloud; Maps/
  Python/feedback/expert-override deferred.

## 13. Consequences

- The simulator gains a real behavioral simulation and a second, multi-category
  algorithm — the first time a reviewer can compare two hypotheses on two scenarios
  with editable setup and complete evidence.
- M1's tick engine + friend-drive fixture are migrated to the profile model (one
  clean model, no dual code path).
- The §11 `scores`/`states`/multi-candidate/priority fields become real, paving the
  way for M3's transparent-hybrid Python package (which adds smoothing, persistence,
  state machines on top of the same shapes).
- The setup/run-plan API and editable setup land here, so M4 (Maps) only swaps the
  `routes/analyze` source and M5 (feedback) only adds capture on top of complete
  run logs.
