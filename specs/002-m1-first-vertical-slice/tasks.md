---
description: "Task list for M1 First Runnable Vertical Slice"
---

# Tasks: M1 First Runnable Vertical Slice

**Input**: Design documents from `/specs/002-m1-first-vertical-slice/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD per the milestone cycle; constitution requires contract
surfaces — adapter, decision result, registries, persisted log — tested first).
Test tasks are written FIRST and MUST FAIL before their implementation task.

**Organization**: by user story. US1 (P1) is the end-to-end loop and carries the
backend engine + the playback/cockpit UI. US2 adds trace/evidence inspection UI.
US3 is the backend-only proof. US4 is invalid-fails-visibly.

## Format: `[ID] [P?] [Story] Description`
- **[P]** = different files, no incomplete dependency.

## Path Conventions
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`,
tests `app/frontend/tests/`; data `packages/`, `scenarios/`, `runs/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create backend package skeleton: `app/api/aica_api/{models,services,algorithms,storage,routers}/__init__.py` and `app/api/aica_api/config.py` (resolve runtime paths for `packages/`, `scenarios/`, `runs/`, overridable by env, defaulting to repo root)
- [ ] T002 [P] Create frontend scaffolding: `app/frontend/src/api/types.ts` (shared response types placeholder), `app/frontend/src/styles/app.css` (3-panel grid), and confirm `app/frontend/src/state/` exists

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: the domain models + storage block every story.

- [ ] T003 [P] Write failing model-validation tests in `app/api/tests/test_models.py` (valid package/scenario parse; invalid manifest rejected; route segment `at` monotonic + exactly one rest facility; DecisionResult totality/shape; suppressed candidate retained)
- [ ] T004 [P] Implement `app/api/aica_api/models/package.py` (PackageManifest, ParameterDef, FeatureDef, HyperparameterDef, ProposalDef, TriggerCategoryDef, FireControlRule) per data-model
- [ ] T005 [P] Implement `app/api/aica_api/models/scenario.py` (ScenarioDef, Persona, RouteIntent, RouteSegment, EventPreset, profiles) with the validators from T003
- [ ] T006 [P] Implement `app/api/aica_api/models/decision.py` (full §11 DecisionResult, Candidate, FireControl, Proposal)
- [ ] T007 [P] Implement `app/api/aica_api/models/run.py` (RunState, EventPlan, TickState, RouteFacts, Snapshot)
- [ ] T008 [P] Implement `app/api/aica_api/models/log.py` (RunLog, TraceEntry, TickEvent, ActionEvent, AlgorithmError discriminated events)
- [ ] T009 Implement `app/api/aica_api/storage/file_store.py` (safe atomic JSON read/write) with tests in `app/api/tests/test_file_store.py` (write-then-read roundtrip; atomic replace) — make T003/T009 tests green

**Checkpoint**: domain schema + storage compile and validate; tests green.

---

## Phase 3: User Story 1 - Review a UC-01 fatigue drive end-to-end (Priority: P1) 🎯 MVP

**Goal**: select package+scenario, run the deterministic drive to the one rest proposal, act, and persist evidence — visible in the UI and drivable end-to-end.

**Independent Test**: from the UI, start the run, play to the proposal, accept/postpone, and confirm a `runs/<id>.json` exists with the decision + action.

### Data fixtures

- [ ] T010 [P] [US1] Author `packages/rest_rule_based_v0_1/package.json` (+ `README.md`) — declarative_rule rest package with R1–R5 rules, rest_required category, rest_guidance proposal (bilingual), feature/hyperparameter band defs, fire-control guard (per data-model + research R4)
- [ ] T011 [P] [US1] Author `scenarios/uc01_fatigue_friend_drive_v0_1.json` — UC-01 fatigue drive: route segments (`at` fractions + bands, one rest facility at 0.5), drowsiness schedule (none→weak@0.3→moderate@0.42), `tick_seconds`, `total_duration_seconds`, allowed_actions, shaped so exactly one tick fires R3

### Backend engine (tests first)

- [ ] T012 [P] [US1] Write failing `app/api/tests/test_binning.py` then implement `app/api/aica_api/services/binning.py` (raw→ordinal band seam; near-identity passthrough for authored bands; never returns raw numbers)
- [ ] T013 [P] [US1] Write failing `app/api/tests/test_declarative_rule.py` (R1 severe override; R3 full conjunction + each broken conjunct; R2/R3 actionability boundary → suppressed candidate; R4 soft-warning; R5 no-trigger; totality; determinism; ordinal blend score populated) then implement `app/api/aica_api/algorithms/declarative_rule.py`
- [ ] T014 [US1] Write failing `app/api/tests/test_algorithm_adapter.py` (single evaluate() contract; rule output normalized to full §11 DecisionResult; suppressed candidate preserved; invalid/exception → AlgorithmError, never a decision) then implement `app/api/aica_api/algorithms/adapter.py`
- [ ] T015 [P] [US1] Write failing `app/api/tests/test_event_plan.py` then implement `app/api/aica_api/services/event_plan.py` (freeze EventPlan from scenario presets; deterministic per-tick schedule)
- [ ] T016 [US1] Write failing `app/api/tests/test_tick_engine.py` (fixed sim-time step; position derived from elapsed time; bands derived; exactly one tick crosses into REST_PROPOSAL for the fixture; ticking past end → completed) then implement `app/api/aica_api/services/tick_engine.py`
- [ ] T017 [US1] Write failing `app/api/tests/test_evidence_recorder.py` (append-only; persist after every event; prior events never rewritten; required snapshot fields) then implement `app/api/aica_api/storage/evidence_recorder.py`
- [ ] T018 [US1] Write failing `app/api/tests/test_run_manager.py` (create_run freezes snapshot+plan+first log; tick → engine→adapter→trace→persist→pause; action validated + applied) then implement `app/api/aica_api/services/run_manager.py`

### Backend registries + API

- [ ] T019 [P] [US1] Write failing `app/api/tests/test_package_registry.py` + `test_scenario_registry.py` (valid fixtures load; correct summaries; detail returns full model; compatibility check passes for the matched pair) then implement `app/api/aica_api/services/package_registry.py` and `scenario_registry.py`. (Invalid/incompatible cases are hardened in US4/T030.) Registries are a contract surface — tested-first here.
- [ ] T020 [US1] Implement routers `app/api/aica_api/routers/{packages.py,scenarios.py,runs.py}` and wire into `app/api/aica_api/main.py` (per contracts/runs.md + packages-scenarios.md); run-id generated at the router boundary (research R3)

### Frontend (tests first)

- [ ] T021 [P] [US1] Implement `app/frontend/src/api/client.ts` + `types.ts` (typed wrappers for packages/scenarios/runs endpoints) with `app/frontend/tests/client.test.tsx` (maps each endpoint to typed model)
- [ ] T022 [P] [US1] Implement `app/frontend/src/state/runStore.ts` (Context + reducer: run state, latest decision, trace list, pause flag) with `app/frontend/tests/runStore.test.tsx` (select→run→tick→pause→action→resume transitions)
- [ ] T023 [US1] Implement layout `app/frontend/src/components/layout/{AppShell,LeftContextPanel,CenterPlaybackPanel,RightReviewPanel}.tsx` and compose in `App.tsx` (3-panel grid)
- [ ] T024 [P] [US1] Implement `app/frontend/src/components/setup/{PackageSelector,ScenarioSelector}.tsx` and `context/{RouteSegmentList,LiveReadouts}.tsx` (bands from tick state)
- [ ] T025 [US1] Write failing `app/frontend/tests/playback.test.tsx` then implement `app/frontend/src/components/playback/{PlaybackControls,RouteTimeline,CockpitView,ProposalPanel}.tsx` (play/step/speed; cockpit swaps to proposal on fire; accept_rest/postpone call POST /actions). Include an assertion that display-only animation/progress never mutates the decision/trace state held in runStore (guards constitution I / FR-016).

**Checkpoint**: US1 end-to-end loop works in the UI; the MVP.

---

## Phase 4: User Story 2 - Inspect the decision trace and persisted evidence (Priority: P2)

**Goal**: per-tick trace (incl. suppressed candidates) and the persisted evidence JSON are viewable.

**Independent Test**: after running to the proposal, the trace shows the firing entry with candidates incl. a suppressed one, and the log view shows the saved JSON.

- [ ] T026 [P] [US2] Write failing `app/frontend/tests/trace.test.tsx` then implement `app/frontend/src/components/trace/DecisionTracePanel.tsx` (per-tick result_type, selected_category, score, candidates incl. suppressed marked suppressed, fire-control, reason_inputs, explanation)
- [ ] T027 [P] [US2] Implement `app/frontend/src/components/runs/RunLogViewer.tsx` (GET /api/runs/{id}/log → static JSON display; no replay) with `app/frontend/tests/runlog.test.tsx`
- [ ] T028 [US2] Additively extend the backend test `app/api/tests/test_run_manager.py` (created in T018): add a case where a run exercising the R2 actionability guard records a suppressed candidate in the persisted trace (verifies suppressed-preservation through the whole pipeline). Append-only to that file; does not modify T018's existing cases.

**Checkpoint**: decisions and evidence are fully inspectable.

---

## Phase 5: User Story 3 - Drive the same loop backend-only (Priority: P3)

**Goal**: the full create-run → tick → act → read-evidence loop works via the API with no frontend, deterministically.

**Independent Test**: a TestClient run reaches the same single proposal and persists the same log shape.

- [ ] T029 [US3] Write `app/api/tests/test_api_run_loop.py` (TestClient: POST /runs → tick until paused at the rest proposal → POST /actions accept_rest → GET /log contains trace + action; run twice and assert identical traces; ticking past end → completed) — backend-only acceptance (FR-014/SC-006)

**Checkpoint**: backend is the verified source of truth.

---

## Phase 6: User Story 4 - Invalid package or scenario fails visibly (Priority: P3)

**Goal**: invalid manifests/scenarios and incompatible pairings are reported, never silently used.

**Independent Test**: an invalid fixture appears in the registry `errors`, is absent from the list, and cannot start a run.

- [ ] T030 [US4] Write `app/api/tests/test_registry_validation.py` (invalid manifest fixture → reported in `errors`, absent from list, detail 404; incompatible package/scenario → POST /runs 400) and harden `package_registry.py`/`scenario_registry.py` + run-creation compatibility check to satisfy it
- [ ] T031 [P] [US4] Implement frontend validation-error display in `LeftContextPanel`/selectors (surface registry `errors` and a 400 compatibility error) with `app/frontend/tests/errors.test.tsx`

**Checkpoint**: honest failure is enforced and visible.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T032 [P] Add bilingual labels pass + basic styling in `app/frontend/src/styles/app.css` so the 3-panel UI reads cleanly (rough acceptable; no M6 polish)
- [ ] T033 [P] Update root `README.md` with the M1 review loop (start, select, play to proposal, act, find log) and backend-only curl steps (from quickstart.md)
- [ ] T034 Run `quickstart.md` validation end-to-end: `docker compose up`, drive the UI loop + the backend-only curl loop, confirm `runs/<id>.json`, and run both test suites green

---

## Dependencies & Execution Order

- **Setup (P1)** → no deps.
- **Foundational (P2: T003–T009)** → blocks all stories (models + storage).
- **US1 (P3)** → after Foundational. Backend engine (T012–T020) before/with frontend (T021–T025). Within engine: binning/declarative_rule/event_plan are [P]; adapter (T014) needs declarative_rule + decision model; tick_engine (T016) needs event_plan + binning; run_manager (T018) needs adapter + tick_engine + evidence_recorder; routers (T020) need run_manager + registries.
- **US2 (P4)** → after US1 (renders US1's trace/log).
- **US3 (P5)** → after US1 backend (T020).
- **US4 (P6)** → registries (T019) exist; hardened here.
- **Polish (P7)** → after US1–US4.

### Parallel Opportunities
- T004–T008 (separate model files) in parallel after T003.
- T010, T011 (package vs scenario fixtures) in parallel.
- T012, T013, T015 (binning, declarative_rule, event_plan — separate files) in parallel.
- T021, T022, T024 (client, store, setup/context components) in parallel.
- T026, T027 (trace vs log panels) in parallel.
- T032, T033 in parallel.

---

## Implementation Strategy

### MVP First (US1)
1. Setup → 2. Foundational (models+storage) → 3. US1 (engine TDD → registries/routers → frontend). **STOP and VALIDATE** the end-to-end loop (T034 subset).

### Incremental
US1 (MVP loop) → US2 (trace/log inspection) → US3 (backend-only proof) → US4 (invalid-fails) → Polish.

---

## Notes
- TDD: every test task precedes its implementation and MUST fail first.
- Security: NO new backend or frontend dependencies (httpx2 incident). Frontend state = Context+reducer.
- Determinism: ids/timestamps only at the router boundary; engine code pure (research R7).
- Total: 34 tasks (T001–T034).
