---
description: "Task list for M2 Package & Schema Hardening"
---

# Tasks: M2 Package & Schema Hardening

**Input**: Design documents from `/specs/003-m2-package-schema-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD per the milestone cycle; constitution requires contract
surfaces — engine determinism, weighted_score, adapter, run-plan API, persisted log —
tested first). Test tasks precede their implementation and MUST FAIL first.

**Organization**: by user story. **US4 (behavioral engine) is sequenced first**
despite its P2 priority because US1/US2/US3 all consume it (dependency root). MVP =
US4 + US1 (engine + a second, multi-category package visible).

## Format: `[ID] [P?] [Story] Description`
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`,
tests `app/frontend/tests/`; data `packages/`, `scenarios/`.

---

## Phase 1: Setup
- [ ] T001 Create new backend package dirs `app/api/aica_api/services/behavior/__init__.py`; confirm `models/`, `algorithms/`, `routers/` exist (M1)
- [ ] T002 [P] Create frontend setup-component scaffolding dir `app/frontend/src/components/setup/` (PackageSelector/ScenarioSelector exist from M1) and extend `styles/app.css` with a setup-panel section

---

## Phase 2: Foundational (Blocking — schema models)
**⚠️ Blocks every story.** Pydantic models + binning context shape.

- [ ] T003 [P] Write failing `app/api/tests/test_profile_models.py` (valid driver/vehicle/speed profiles parse; rates ≥0; thresholds 0–100) then implement `app/api/aica_api/models/profile.py` (DriverModelProfile, VehicleBehaviorProfile, SpeedProfile)
- [ ] T004 [P] Extend `app/api/aica_api/models/run.py`: full `RouteFacts`, full `EventPlan` (traffic/weather/rest_opportunities), `RunPlanDraft`, `TickState` (+raw_state, feature_groups, distance_km, continuous_driving_min), `RunState` (+package_runtime_state, route_facts, profiles, run_mode, evidence_status, initial/current params+hyperparams, original/modified values) per data-model
- [ ] T005 [P] Extend `app/api/aica_api/models/scenario.py`: add driver/vehicle/speed profiles, is_night, presets; REMOVE drowsiness_schedule; update validators
- [ ] T006 [P] Extend `app/api/aica_api/models/decision.py` (localized `explanation: str|{ja,en}|list`, Candidate.strength/state) and `models/package.py` (`algorithm.type` += "weighted_score"; weighted_score hyperparameter defs)
- [ ] T007 [P] Extend `app/api/aica_api/models/log.py`: TickEvent carries raw_state, feature_groups, driver_update, vehicle_update, package_runtime_state; RunLog carries original/modified values; ActionEvent accepts "decline"
- [ ] T008 Update/extend model tests (`app/api/tests/test_models.py`) for the extended shapes; keep them green

**Checkpoint**: schema compiles + validates.

---

## Phase 3: User Story 4 - Behavioral realism drives the decision (Priority: P2 — sequenced first) 🎯 foundation

**Goal**: deterministic profile-driven per-tick driver/vehicle state + speed-driven position; raw_state + feature_groups context. Replaces M1's authored schedule.

**Independent Test**: run a scenario twice → identical per-tick raw_state; proposal timing follows the evolving state.

- [ ] T009 [P] [US4] Write failing `app/api/tests/test_driver_model.py` (additive rate model; night/monotony/jam terms; >60min fatigue term; recovery on rest; determinism; clamp 0–100) then implement `app/api/aica_api/services/behavior/driver_model.py`
- [ ] T010 [P] [US4] Write failing `app/api/tests/test_vehicle_model.py` (steering/pedal levels; rolling-window lane-departure/ADAS counts; determinism) then implement `app/api/aica_api/services/behavior/vehicle_model.py`
- [ ] T011 [US4] Extend `app/api/aica_api/services/binning.py` + `app/api/tests/test_binning.py`: `raw_state → feature_groups{normalized 0–1, ordinal bands}` (test-first); ordinal are strings, normalized 0–1, both present
- [ ] T012 [US4] Write failing `app/api/tests/test_event_plan.py` updates + implement `app/api/aica_api/services/event_plan.py` to build the full EventPlan (tick_seconds, traffic/weather events, rest_opportunities) from route facts + presets; `services/route_analysis.py` deriving RouteFacts from a scenario (test-first)
- [ ] T013 [US4] MIGRATE `app/api/aica_api/services/tick_engine.py` (+ rewrite `app/api/tests/test_tick_engine.py`): speed-driven position (distance_km), profile-driven driver/vehicle state, build context `{raw_state, feature_groups}`, completed past end; determinism (two passes identical raw_state). Remove the drowsiness_schedule path.
- [ ] T014 [US4] Re-author `scenarios/uc01_fatigue_friend_drive_v0_1.json` to carry driver/vehicle/speed profiles + presets (drop drowsiness_schedule), tuned so the profile-driven progression fires exactly one REST_PROPOSAL; update the M1 declarative_rule path to consume `feature_groups.ordinal`

**Checkpoint**: deterministic behavioral engine; friend-drive still fires one proposal.

---

## Phase 4: User Story 1 - Run and inspect either of two packages (Priority: P1) 🎯 MVP

**Goal**: a second weighted_score package with multi-category scores/candidates/priority, selectable and inspectable.

**Independent Test**: run the weighted-score package; trace shows category scores, multiple candidates (incl. suppressed/non-selected), selected category.

- [ ] T015 [US1] Write failing `app/api/tests/test_weighted_score.py` (category-score formulas; gated rest bonus; strength thresholds; multi-category candidates incl. suppressed; priority selection; monotony candidate from high-monotony raw_state [SC-007]; totality; determinism) then implement `app/api/aica_api/algorithms/weighted_score.py`
- [ ] T016 [US1] Extend `app/api/aica_api/algorithms/adapter.py` (+ `app/api/tests/test_algorithm_adapter.py`): dispatch `weighted_score`; normalize to full §11 with scores/states/candidates/selected_category populated; runtime-state returned empty; error → AlgorithmError
- [ ] T017 [P] [US1] Author `packages/rest_weighted_score_v0_1/package.json` (+ README) — `algorithm.type: weighted_score`, two trigger_categories (rest_required p1, monotony_prevention p2), feature/weight/threshold hyperparameters, localized rest_guidance proposal, fire-control; parses under the package model
- [ ] T018 [P] [US1] Frontend: make `setup/PackageSelector.tsx` + `ScenarioSelector.tsx` real multi-option (2×2) with compatibility filtering; `app/frontend/tests/setup.test.tsx`
- [ ] T019 [US1] Frontend: `trace/DecisionTracePanel.tsx` shows per-category `scores`, candidate strength/state, selected category (weighted-score richer trace); extend `app/frontend/tests/trace.test.tsx`

**Checkpoint**: both packages selectable; weighted-score trace shows multi-category detail. MVP.

---

## Phase 5: User Story 2 - Edit setup values and preview the plan (Priority: P1)

**Goal**: routes/analyze → run-plans(+regenerate) → runs{plan_id}; editable params/hyperparams validated; original/modified + package_runtime_state persisted.

**Independent Test**: edit a valid value, preview+regenerate, start; edit an invalid value → clear error + no run.

- [ ] T020 [US2] Implement `app/api/aica_api/services/run_plan.py` (draft generate/regenerate, in-memory draft registry, edit validation against defs) with `app/api/tests/test_run_plan.py` (deterministic draft; out-of-range edit → error; regenerate changes draft)
- [ ] T021 [US2] MIGRATE `app/api/aica_api/services/run_manager.py` (+ tests): `create_run(plan_id)` freezes the draft + setup snapshot, records initial/original values; thread `package_runtime_state` tick-to-tick (pass in + store next); remove the package_id+scenario_id create path
- [ ] T022 [US2] Implement routers `app/api/aica_api/routers/{routes.py, run_plans.py}` + MIGRATE `runs.py` to `{plan_id}`; wire into main; `app/api/tests/test_routers.py` updated (routes/analyze, run-plans 201/400, regenerate, runs{plan_id}, bare-create rejected). Add `package_runtime_state` round-trip test (stub algo returns non-empty → persists tick-to-tick)
- [ ] T023 [US2] Persistence: run log records setup snapshot, route facts, frozen plan, profiles, run_mode/evidence_status, original/modified values, and per-tick raw_state/feature_groups/driver+vehicle updates/package_runtime_state; `app/api/tests/test_evidence_recorder.py` / run_manager test asserts these from the persisted file
- [ ] T024 [P] [US2] Frontend: `setup/ParameterEditor.tsx` + `HyperparameterEditor.tsx` (render defs, client validate) and `setup/PlanPreview.tsx` (call routes/analyze + run-plans, show draft, Regenerate, Start→runs{plan_id}); `state/runStore.ts` setup-draft state; `app/frontend/src/api/{client.ts,types.ts}` add the endpoints; `app/frontend/tests/setup.test.tsx` (edit→preview→regenerate→start; invalid edit → visible error, no run)

**Checkpoint**: full setup→plan→run flow; editable + validated + persisted.

---

## Phase 6: User Story 3 - Second, distinct UC-01 scenario (Priority: P2)

**Goal**: overtime night/solo/resistant scenario reaching a micro-rest proposal with a decline action.

**Independent Test**: run the overtime scenario → one micro-rest proposal; decline recorded, run continues.

- [ ] T025 [P] [US3] Author `scenarios/uc01_overtime_driver_v0_1.json` (is_night, solo, fatigue-susceptible profile, convenience-store micro-rest, `allowed_actions:[accept_rest,postpone,decline]`), tuned to fire exactly one proposal; parses under the scenario model
- [ ] T026 [US3] Backend `decline` action: `run_manager.action` + router accept `decline` → recorded, run continues without rest; `app/api/tests/test_run_manager.py` / routers test (decline transition; no further proposal)
- [ ] T027 [US3] Frontend: `playback/ProposalPanel.tsx` adds a Decline button (shown when allowed) calling actRun("decline"); `app/frontend/tests/playback.test.tsx`
- [ ] T028 [US3] Backend e2e for the overtime pairing in `app/api/tests/test_api_run_loop.py` (TestClient: analyze→run-plans→runs→tick to proposal→decline→log)

**Checkpoint**: two scenarios; decline branch works.

---

## Phase 7: Polish & Cross-Cutting
- [ ] T029 [P] Extend `app/api/tests/test_api_run_loop.py` to cover **both packages × both scenarios** end-to-end (determinism + persisted evidence completeness) — the M1 backend-only test migrated to the plan_id flow
- [ ] T030 [P] Frontend styling pass in `app/frontend/src/styles/app.css` for the setup panel (editors, plan preview, multi-option selectors); keep data-testids; `npm test` + `npm run build` green
- [ ] T031 [P] Update root `README.md` with the M2 review flow (select package+scenario, edit, preview/regenerate plan, run, decline, inspect richer trace + evidence) from quickstart.md
- [ ] T032 Run `quickstart.md` validation end-to-end (controller, docker): both pairings via UI + curl; confirm persisted logs carry setup diff + plan + profiles + per-tick raw_state/feature_groups; both test suites green

---

## Dependencies & Execution Order
- **Setup (P1)** → none. **Foundational (P2: T003–T008)** → blocks all stories.
- **US4 (P3, T009–T014)** → after Foundational; **blocks US1/US2/US3** (engine + context + re-authored fixture).
- **US1 (P4, T015–T019)** → after US4 (weighted_score consumes raw_state/feature_groups).
- **US2 (P5, T020–T024)** → after US4 (run-plan freezes the engine's plan); run_manager migration.
- **US3 (P6, T025–T028)** → after US4 + US2 (second scenario uses engine + run-plan flow).
- **Polish (P7)** → after US1–US3.

### Parallel Opportunities
- T003–T007 (separate model files) parallel.
- T009, T010 (driver vs vehicle model) parallel.
- T017 (weighted package) ∥ T018 (selectors) ∥ within US1.
- T024 (setup UI) ∥ T020/T021 (backend) once contracts fixed.
- T025 (overtime fixture) ∥ T026 (decline backend).
- T029/T030/T031 parallel.

---

## Implementation Strategy
**MVP** = Setup → Foundational → US4 (engine) → US1 (weighted_score visible). STOP & validate two packages selectable with a multi-category trace.
**Incremental**: + US2 (editable setup/run-plan) → + US3 (second scenario + decline) → Polish (both-pairings e2e, styling, README, docker validation).

## Notes
- TDD: every test task precedes its impl and MUST fail first.
- Security: NO new dependencies (backend or frontend).
- Determinism: engine + draft-plan generation pure; ids/timestamps only at the router boundary.
- Migration (not duplication): tick_engine, run_manager, friend-drive fixture, and the M1 backend-only test are migrated to the new model/flow.
- Total: 32 tasks (T001–T032).
