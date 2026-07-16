# Tasks: Eligibility And Discrete Journey Engine (P4)

**Feature**: `specs/015-proposal-p4-eligibility-journey` | **Branch**: `proposal-p4-eligibility-journey-engine`
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Design**: `docs/superpowers/specs/2026-07-16-proposal-p4-eligibility-journey-design.md`

Style: **TDD** — every implementation task is preceded by a failing test that must fail for the intended reason, then pass. Backend tests: `cd app/api && ./.venv/bin/python -m pytest tests/proposal -q`. Frontend: `cd app/frontend && npm run test`.

Paths are repo-relative. `[P]` = parallelizable (different files, no incomplete dependency).

---

## Phase 1: Setup

- [ ] T001 Author the frozen artifact `proposal_contracts/service_capabilities/service_capabilities.v1.json` for all 14 `ServiceId`s per research.md D2 mapping (`capabilities_version: "v1"`; fields driving_capable/screen_dependent/stopped_only/background_on_motion/lighting_compatible/requires_entity), validating against `specs/015-proposal-p4-eligibility-journey/contracts/service_capabilities.schema.json`.
- [ ] T002 [P] Add P4 enum members to `app/api/aica_api/models/proposal/enums.py`: `JourneyActionType`, `PlaybackState`, `EligibilityReasonCode`; extend `DiscreteEventType` (SERVICE_REJECTED, CONTENT_STARTED, MOTION_CHANGED, CONTINUE_REQUESTED, RETURN_TO_PREVIOUS_CONTENT, REST_STARTED, POSTPONED, CHOOSE_ANOTHER, REQUEST_MORE, NO_ELIGIBLE_CANDIDATE) and `ProposalRunStatus` (content_started, content_completed, content_stopped).
- [ ] T003 [P] Write `app/api/tests/proposal/test_p4_enums.py` asserting every new enum value exists and the existing members are unchanged (regression guard). Run — confirm it drives T002.

---

## Phase 2: Foundational (blocking prerequisites for all user stories)

- [ ] T004 [P] Test `app/api/tests/proposal/test_service_capabilities_model.py`: `ServiceCapabilities.load` round-trips the v1 artifact, all 14 services present, `background_on_motion=true ⇒ screen_dependent=true`, a missing service raises. (Write test first — fails.)
- [ ] T005 Implement `app/api/aica_api/models/proposal/service_capabilities.py` (`ServiceCapability`, `ServiceCapabilities` + `load(path)`/`get(id)`, mirroring `matrix.py`) to pass T004.
- [ ] T006 [P] Golden test `app/api/tests/proposal/test_service_capabilities_matches_spec.py`: assert the artifact matches the spec §7.1/§7.2 classification exactly (driving vs stopped tables, lighting column, `live_viewing` sole background_on_motion, `full_karaoke`/`stretch_video`/`call_response_stopped` stopped-only, `oshi_reexperience` requires_entity="oshi").
- [ ] T007 [P] Test `app/api/tests/proposal/test_eligibility_model.py`: `EligibilityExclusion`/`EligibilityResult` shape; assert NO field named score/fit/weight/utility exists (invariant test).
- [ ] T008 Implement `app/api/aica_api/models/proposal/eligibility.py` (`EligibilityExclusion{service_id, reason_codes}`, `EligibilityResult{eligible, excluded}`) to pass T007.
- [ ] T009 [P] Extend `JourneyState` in `app/api/aica_api/models/proposal/journey.py`: add `playback_state`, `current_plan_ref`, `previous_content` (+ `PreviousContent`), `rejected_service_ids` — all defaulted so existing persisted runs deserialize unchanged. Add `test_journey_state_backcompat` asserting an old-shape JourneyState still loads.
- [ ] T010 [P] Add `JourneyAction`, `JourneyTransition`, `TransitionRejection` models (new `app/api/aica_api/models/proposal/journey_action.py`) per data-model.md.
- [ ] T011 Create the pure engine skeleton `app/api/aica_api/services/proposal_journey.py` with `apply_action(run_log, action) -> JourneyTransition` dispatching on `action_type`; unknown/invalid-precondition → `TransitionRejection` (no I/O, no clock). Stub handlers raise `NotImplementedError` per action for now. Add `test_journey_engine_dispatch.py` covering unknown action → rejection.
- [ ] T012 Wire the action endpoint scaffold in `app/api/aica_api/routers/proposal.py`: `POST /api/proposal/runs/{run_id}/journey/action` — load run, build `JourneyAction`, call `apply_action`, on rejection return structured 422, else append events + `update_state` and return `ProposalRunLog`. Router mints timestamps. Add `test_journey_action_endpoint_mounted.py` (404 unknown run, 422 invalid precondition scaffold).

**Checkpoint**: models + engine skeleton + endpoint exist; no story behavior yet.

---

## Phase 3: User Story 1 — Eligibility narrowing with visible reasons (Priority: P1) 🎯 MVP

**Goal**: Narrow allowed services by motion/capability/readiness before ranking; score-free reason-coded exclusions; selector only ranks the eligible set.
**Independent test**: create runs at (before_rest, driving) and (after_rest, driving/stopped); assert eligible/excluded split + reason codes and that ranked output ⊆ eligible ⊆ frozen row.

- [ ] T013 [P] [US1] Test `app/api/tests/proposal/test_eligibility_resolver.py`: exhaustive `resolve_eligibility(allowed_row, motion, capabilities, readiness)` cases — full_karaoke/stretch_video/call_response_stopped excluded while driving with correct codes; `live_viewing` eligible while driving (background_on_motion); `oshi_reexperience` excluded `missing_required_entity` when no oshi; determinism (same inputs → same result); no score on any exclusion.
- [ ] T014 [US1] Implement `app/api/aica_api/services/proposal_eligibility.py::resolve_eligibility` (pure) to pass T013, using the capabilities artifact + a readiness view (entity presence from world/catalog).
- [ ] T015 [US1] Test `app/api/tests/proposal/test_us1_eligibility_wiring.py`: `POST /api/proposal/runs` narrows `eligible_candidates` and populates STEP-1 evidence `excluded_candidates` with reason codes; mock selector ranks only eligible; a candidate outside the frozen row is impossible (SC-003).
- [ ] T016 [US1] Wire `resolve_eligibility` into `create_proposal_run` (`routers/proposal.py`): compute eligibility after matrix resolve, pass eligible set to `_build_service_context`, thread `excluded` (reason-coded) into `dispatch_selector`'s excluded output. Pass T015.
- [ ] T017 [US1] Test + implement the readiness/entity resolver helper (`missing_required_entity`, `catalog_item_unavailable`) for both typed-world (`SetupSnapshot`) and legacy `world_snapshot` runs (legacy with no catalog → entity-dependent services excluded, never crash) — research.md D8. File: extend `test_eligibility_resolver.py` + `proposal_eligibility.py`.
- [ ] T017a [US1] Test in `test_us1_eligibility_wiring.py`: a run created directly at a stage whose matrix row narrows to an **empty eligible set** (e.g. `rest_recommended`/`during_rest_stopped`, empty row) yields an explicit `NO_ELIGIBLE_CANDIDATE` outcome at create-time, not a fabricated candidate or crash (spec Edge Cases / FR-013).

**Checkpoint**: US1 independently demonstrable via API; eligibility safe and score-free.

---

## Phase 4: User Story 2 — Advance a mocked accepted plan through its lifecycle (Priority: P1)

**Goal**: accept → start, complete, continue, stop → restore previous content; each a discrete event; replay renders identically.
**Independent test**: from a `content_selected` run apply accept/complete/continue/stop and assert event sequence, journey state, and no-recompute reopen.

- [x] T018 [P] [US2] Test `app/api/tests/proposal/test_us2_plan_lifecycle.py`: accept→`CONTENT_STARTED` (playback active, current_plan_ref set, previous_content captured); complete→`CONTENT_COMPLETED`; continue→`CONTINUE_REQUESTED` (uses plan `next_transition_policy`); stop→`RETURN_TO_PREVIOUS_CONTENT` (previous restored, playback stopped); invalid preconditions → 422.
- [x] T019 [US2] Implement `accept`, `complete`, `continue`, `stop` handlers in `services/proposal_journey.py` (read committed `CompletePlan` policy fields from the run's content evidence) to pass T018.
- [x] T020 [US2] Test `app/api/tests/proposal/test_us2_replay_no_recompute.py`: after the full action sequence, `GET /runs/{id}` renders the identical log with no selector re-invoked (Principle III / SC-004).
- [x] T021 [US2] Ensure the action endpoint persists lifecycle events/state via append-only manager and that reopen path is unchanged; adjust `routers/proposal.py` if needed to pass T020.

**Checkpoint**: a mocked accepted plan advances start→complete→continue→restore, replayable.

---

## Phase 5: User Story 3 — Advisory service actions never dead-end (Priority: P2)

**Goal**: reject / choose_another / request_more / postpone; rejection keeps the run alive while an eligible candidate remains; rejected service not re-offered.
**Independent test**: from a `service_selected` run with ≥2 eligible, reject top → proceed with next; assert rejected not re-offered; postpone/request-more behavior; last-eligible rejected → explicit no-eligible end-state.

- [ ] T022 [P] [US3] Test `app/api/tests/proposal/test_us3_advisory_actions.py`: reject→`SERVICE_REJECTED` + `rejected_service_ids` updated + not dead-ended; choose_another→next eligible non-rejected `SERVICE_SELECTED`; request_more→remaining eligible surfaced, no new score; postpone→`POSTPONED` opportunity-open; reject last eligible→`NO_ELIGIBLE_CANDIDATE` success (not 4xx).
- [ ] T023 [US3] Implement `reject`, `choose_another`, `request_more`, `postpone` handlers in `services/proposal_journey.py` (respect `rejected_service_ids`, re-use the eligible ranking order; no re-scoring) to pass T022.
- [ ] T024 [US3] Test `app/api/tests/proposal/test_us3_control_inputs_not_scored.py`: assert `trigger_purpose`/`lifecycle_stage` gate transitions but never appear as a preference/utility score in any journey evidence (FR-007 / SC per US1-5).

**Checkpoint**: advisory service actions complete and non-forcing.

---

## Phase 6: User Story 4 — Motion change & rest-stage transitions (Priority: P2)

**Goal**: deterministic motion-change (background_on_motion vs stop) + re-eligibility; rest_spot_arrived/started/completed transitions; during-rest actions never ranked.
**Independent test**: active live_viewing + motion→driving ⇒ backgrounded; active full_karaoke + motion→driving ⇒ stopped; rest_spot_arrived/completed set motion/stage/post-rest values and open new opportunity; determinism.

- [ ] T025 [P] [US4] Test `app/api/tests/proposal/test_us4_motion_change.py`: motion_change→`MOTION_CHANGED`; background_on_motion active plan backgrounded, hard stopped-only/screen-dependent active plan stopped; eligibility re-evaluated; identical inputs → identical result (SC-006).
- [ ] T026 [US4] Implement `motion_change` handler in `services/proposal_journey.py` (apply screen/background/stop policy from capabilities; re-run `resolve_eligibility`) to pass T025.
- [ ] T027 [P] [US4] Test `app/api/tests/proposal/test_us4_rest_transitions.py`: rest_spot_arrived→motion stopped + stage during_rest_stopped (`REST_SPOT_ARRIVED`); rest_started→`REST_STARTED`; rest_completed→applies payload post-rest drowsiness/fatigue, stage after_rest_before_restart, opens new opportunity (`REST_COMPLETED`); five named during-rest actions never appear as ranked candidates (FR-016).
- [ ] T028 [US4] Implement `rest_spot_arrived`, `rest_started`, `rest_completed` handlers (the new opportunity re-runs eligibility + mock selector under the new stage) to pass T027.

**Checkpoint**: motion + rest transitions deterministic; rest actions stay orchestration-only.

---

## Phase 7: User Story 5 — Non-binding preview & run-area UI (Priority: P3)

**Goal**: non-persisting preview projection; minimal bilingual run-area surface (eligible/excluded+reasons, action buttons, journey state, event timeline).
**Independent test**: preview returns binding:false chain, run byte-unchanged, no selector; run screen renders eligible/excluded/actions/timeline JA-default.

- [ ] T029 [P] [US5] Test `app/api/tests/proposal/test_us5_preview.py`: `GET /runs/{id}/journey/preview` returns `binding:false` steps; asserts events/evidence/state byte-unchanged before/after and no selector invoked (SC-007).
- [ ] T030 [US5] Implement `app/api/aica_api/services/proposal_journey_preview.py::preview` (pure projection from purpose/stage + committed plan policy) and the `GET /runs/{id}/journey/preview` route in `routers/proposal.py`. Pass T029.
- [ ] T031 [P] [US5] Frontend: extend `app/frontend/src/api/proposalClient.ts` + `state/proposalStore.ts` with journey action + preview calls; Vitest `proposalClient` coverage for the new calls.
- [ ] T032 [US5] Frontend: extend `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx` to show Eligible vs Excluded(reason-code) lists; add `JourneyActionBar.tsx` (action buttons) + `EventTimeline.tsx` (discrete-event list) wired to the store. Bilingual, JA default. Vitest render tests.

**Checkpoint**: milestone demoable end-to-end on the screen.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T033 [P] Evidence check test `app/api/tests/proposal/test_p4_evidence_gate.py`: every eligibility decision + journey action is in the append-only log; failures recorded as `ALGORITHM_ERROR` events (Principle II); no scores on exclusions.
- [ ] T034 [P] Isolation test `app/api/tests/proposal/test_p4_isolation.py`: P4 modules never import `aica_api.models` (trigger) or `aica_api.algorithms`, and the router touches only proposal dirs (extend existing `test_p1_isolation_imports.py` style).
- [ ] T035 Run the full backend suite `cd app/api && ./.venv/bin/python -m pytest -q` and the frontend `npm run test`; confirm the prior 702 proposal tests + trigger suite stay green (SC-008). Fix regressions.
- [ ] T036 [P] Reconcile docs: update `contracts/journey-api.md` / `data-model.md` if implementation diverged; confirm master-doc reconciliations (spec §6.1 capability artifact, milestones §17 items) still match the shipped artifact.
- [ ] T037 End-to-end: `docker compose up --build`, walk quickstart.md steps 1–6, capture evidence that each P4 acceptance criterion (SC-001..SC-008) is demonstrable in the running app.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T012)** block everything.
- **US1 (T013–T017)** depends only on Foundational — the MVP; deliver first.
- **US2 (T018–T021)** depends on Foundational (engine skeleton + endpoint). Independent of US1 behavior but shares the run lifecycle.
- **US3 (T022–T024)** depends on Foundational + US1's eligible-ranking (choose_another/request_more consume the eligible order).
- **US4 (T025–T028)** depends on Foundational + US1 (motion_change re-runs eligibility).
- **US5 (T029–T032)** depends on all prior (UI surfaces eligibility + actions + events); preview (T029–T030) depends only on Foundational.
- **Polish (T033–T037)** last.

## Parallel opportunities

- Setup: T002 ‖ T003.
- Foundational: T004, T006, T007, T009, T010 are `[P]` (distinct files); T005 after T004, T008 after T007, T011 after T009/T010, T012 after T011.
- Within a story, the `[P]` test task runs before its impl task; frontend T031 ‖ backend polish.
- Across stories, US2 preview/lifecycle and US1 eligibility test-writing can proceed in parallel once Foundational lands.

## MVP scope

**User Story 1 (T001–T017)** — the frozen capability artifact + eligibility resolver wired into run creation with score-free reason-coded exclusions — is the minimum viable, independently demonstrable P4 increment and the milestone's dominant safety behavior.
