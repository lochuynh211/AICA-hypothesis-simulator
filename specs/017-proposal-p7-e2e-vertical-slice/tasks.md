# Tasks: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

**Feature dir**: `specs/017-proposal-p7-e2e-vertical-slice/`
**Branch**: `proposal-p7-e2e-vertical-slice`
**Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) · [data-model.md](./data-model.md) · [contracts/recompute-api.md](./contracts/recompute-api.md) · [research.md](./research.md) · [quickstart.md](./quickstart.md)

**Style**: TDD (milestone workflow). Every story writes failing tests first, then the smallest implementation that makes them pass, then runs the affected layers.
**Commands**: backend `cd app/api && uv run pytest <path> -q`; full suite `uv run pytest -q`; frontend `cd app/frontend && npm run test` and `npm run build`.

`[P]` = parallelizable (different file, no incomplete dependency). Story labels `[US1]`–`[US5]` map to spec.md user stories.

---

## Phase 1 — Setup

- [ ] T001 Confirm the P7 baseline is green and dependencies present: run `cd app/api && uv run pytest -q` (expect 2061 passed / 3 skipped) and verify `packages/aica_transparent_service_selector_v1`, `packages/aica_transparent_content_selector_v1`, `proposal_contracts/seeds/seed-night-highway-oshi.json`, matrix v1 and service_capabilities v1 all load. Record the baseline count in the run-area notes; do not proceed if red.

---

## Phase 2 — Foundational (blocking prerequisites for US1/US2/US3)

**Goal**: additive data-model + run-manager surface + pure helper extractions that every later story builds on. All changes back-compat (defaults preserve pre-P7 runs). No behavior change to existing endpoints in this phase.

### Tests first

- [ ] T002 [P] Write failing model back-compat tests in `app/api/tests/proposal/test_p7_models.py`: a pre-P7 `ProposalRunLog` dict (no `world`/`opportunity_history`/`setup_snapshot_history`/`mode`) loads with the new defaults; `ProposalRunMode`, `DiscreteEventType.RECOMPUTED`, `DiscreteEventType.CONTEXT_EDITED`, and `RecomputeRequest` (empty + populated `overrides`) validate; history-length invariant helper asserted.
- [ ] T003 [P] Write failing run-manager tests in `app/api/tests/proposal/test_p7_run_manager.py`: `create_run(..., world=..., mode=quick_check)` persists both; `update_state(..., opportunity=..., world_snapshot=..., opportunity_history=[...], setup_snapshot_history=[...])` replaces head + history and deep-copies; omitted kwargs leave fields unchanged.
- [ ] T004 [P] Write failing `apply_overrides` tests in `app/api/tests/proposal/test_p7_apply_overrides.py`: applying an empty override list returns the base world unchanged with empty diff; a valid `situation.drowsiness_level` override returns a new World + one `FieldDiff`; an invalid path / out-of-range value / dangling catalog ref raises `InvalidOverrideError` with `.issues`.

### Implementation

- [ ] T005 Add `ProposalRunMode` enum and `DiscreteEventType.RECOMPUTED` / `CONTEXT_EDITED` members in `app/api/aica_api/models/proposal/enums.py` (append-only; no existing value changed).
- [ ] T006 [P] Add `RecomputeRequest` model in `app/api/aica_api/models/proposal/recompute.py` (`overrides: list[FieldOverride] = []`, optional service/content param + hyperparam dicts) and export it from `models/proposal/__init__.py`.
- [ ] T007 Add `world: World | None = None`, `opportunity_history: list[ProposalOpportunity] = []`, `setup_snapshot_history: list[SetupSnapshot] = []`, `mode: ProposalRunMode = interactive` to `ProposalRunLog`, and `mode: ProposalRunMode = interactive` to `ProposalRun`, in `app/api/aica_api/models/proposal/proposal_run.py`. Retype `CreateProposalRunBody.mode` to `ProposalRunMode` in `app/api/aica_api/routers/proposal.py`.
- [ ] T008 Widen `create_run` (`world`, `mode` params, deep-copied/stored, and set `ProposalRun.mode` in `list_runs`) and `update_state` (`opportunity`, `world_snapshot`, `opportunity_history`, `setup_snapshot_history` kwargs, `None`=unchanged, deep-copied) in `app/api/aica_api/services/proposal_run_manager.py`.
- [ ] T009 Extract a pure `apply_overrides(base_world, overrides, *, catalog) -> tuple[World, list[FieldDiff]]` in `app/api/aica_api/services/world_clone_store.py` from the `create_clone` body (allow empty list; no persistence), and refactor `create_clone` to call it (keeping its own non-empty-override guard). Existing `test_world_clone.py` must stay green.
- [ ] T010 Extract `_dispatch_content_for_service(run_log, selected_service_id, content_parameters, content_hyperparameters) -> tuple[AlgorithmEvidence, dict | None]` in `app/api/aica_api/routers/proposal.py` from the content-dispatch body of `select_service` (real-vs-mock context builder, `_REAL_CONTENT_PACKAGE_ID` gate, catalog redaction, `dispatch_selector`), and refactor `select_service` to call it. Existing STEP-2 tests must stay green (no behavior change).
- [ ] T011 Refactor `_freeze_setup_snapshot` in `app/api/aica_api/routers/proposal.py` to take `origin_seed_id`/`origin_clone_id`/`origin_profile_id` (and `world`, versions) as explicit params instead of the whole `CreateProposalRunBody`; update `create_proposal_run` to pass `body.origin_*`. No behavior change (existing create tests stay green).
- [ ] T012 Run `cd app/api && uv run pytest tests/proposal/test_p7_models.py tests/proposal/test_p7_run_manager.py tests/proposal/test_p7_apply_overrides.py -q` plus the existing `test_world_clone.py` and STEP-2/create tests; all green. Foundational phase complete.

**Checkpoint**: models + manager + helpers ready; no user-visible behavior changed yet.

---

## Phase 3 — US1: Recompute a proposal (Priority: P1) 🎯 MVP

**Goal**: `POST /runs/{id}/recompute` appends a new frozen decision point with a fresh service proposal.
**Independent test**: create → advance to after-rest → recompute with drowsiness/fatigue overrides → new frozen decision point appears in the same run and changing the values changes the proposal (spec US1).

### Tests first

- [ ] T013 [P] [US1] Write failing recompute contract + history tests in `app/api/tests/proposal/test_p7_recompute.py`: a recompute on a typed-world run in `after_rest_before_restart` appends one entry to `opportunity_history` and `setup_snapshot_history`, installs a new head `opportunity`/`setup_snapshot`, appends `OPPORTUNITY_OPENED`+`RECOMPUTED`+`SERVICE_SELECTED` events and a new service `AlgorithmEvidence`; earlier evidence/history entries are unchanged (FR-004, SC-002).
- [ ] T014 [P] [US1] Add failing determinism + no-override + context-edited tests to `test_p7_recompute.py`: identical overrides on identical state → byte-identical head `setup_snapshot` + `feature_snapshot` + `ranked_candidates`; empty overrides records no `CONTEXT_EDITED`; non-empty overrides records one `CONTEXT_EDITED` with field diffs (FR-007, D8).
- [ ] T015 [P] [US1] Add failing guard tests to `test_p7_recompute.py`: legacy run (no `world`) → 422 (FR-006); invalid override (bad path / out-of-range / dangling ref) → 422 with issues, no snapshot appended (FR-005); recompute while `playback_state` active/backgrounded → 422 `recompute_requires_idle_playback` and unchanged run, then succeeds after `complete`/`stop` (FR-006a, US1 scenario 6).
- [ ] T016 [P] [US1] Add failing post-rest-change + failure-visibility tests to `test_p7_recompute.py`: a high-vs-low `{drowsiness_level,fatigue_level}` override pair yields a different rank-1 service OR a different ordered content plan (FR-008, SC-003); a selector error is recorded as `ALGORITHM_ERROR` + `status=error` (200, not hidden), and zero-eligible resolves to `NO_ELIGIBLE_CANDIDATE` with no fabricated candidate (FR-019, edge cases).

### Implementation

- [ ] T017 [US1] Implement `POST /api/proposal/runs/{run_id}/recompute` in `app/api/aica_api/routers/proposal.py`: load run; 404/legacy-422/playback-422 guards; build effective World (base `world` + `control_inputs.lifecycle_stage`/`motion_state` from current `journey_state`); `apply_overrides` (422 on `InvalidOverrideError`); `_freeze_setup_snapshot`; matrix resolve → `ProposalOpportunity`; `resolve_eligibility` → `dispatch_selector` (service); assemble new head + push prior head to history; reset `active_service_id`/`rejected_service_ids`, preserve `motion_state`/`lifecycle_stage`/`previous_content`; append events (`CONTEXT_EDITED?`→`OPPORTUNITY_OPENED`→`RECOMPUTED`→`SERVICE_SELECTED`/`NO_ELIGIBLE_CANDIDATE`/`ALGORITHM_ERROR`) + service evidence via `proposal_run_manager`; return the log.
- [ ] T018 [US1] Run `cd app/api && uv run pytest tests/proposal/test_p7_recompute.py -q` until green; then `uv run pytest -q` (regression gate).

**Checkpoint**: recompute works end to end at the API layer — the P7 MVP.

---

## Phase 4 — US2: Full reference journey from the built-in seed (Priority: P1)

**Goal**: the whole pre-rest→rest→post-rest→return-to-driving journey completes from `seed-night-highway-oshi` in one run.
**Independent test**: drive create → pre-rest service+content → arrive → rest start → rest complete → recompute → after-rest content → accept → motion-change restore, asserting ordered events and final restored state (spec US2).

### Tests first

- [x] T019 [US2] Write a failing end-to-end journey test in `app/api/tests/proposal/test_p7_e2e_reference_journey.py` (interactive mode) walking quickstart steps 1–8 against the real service + content packages and `seed-night-highway-oshi`; assert: ordered event timeline across both opportunities; the pre-rest rank-1 is a driving-content service; the post-rest recompute yields an after-rest service; `full_karaoke` cannot be active while `motion_state=driving`; previous content restored; reopen renders without recomputation (AC-1, SC-001, SC-009).

### Implementation

- [x] T020 [US2] Make the e2e test pass: wire any gaps found (e.g. ensure `select-service` after a recompute reads the new head opportunity's `allowed_service_ids`; ensure `previous_content` survives recompute per data-model). Prefer fixing at the seam, not the test. Keep changes minimal and covered by T013–T016.
  - Genuine seam gap found and fixed in `recompute_proposal_run` (router only): it patched `control_inputs.lifecycle_stage`/`motion_state` from the current `journey_state` but not the separate `Situation.motion_state` field that `World.project()` actually puts into `feature_snapshot["situation"]` — the field the real content selector's full-karaoke stopped-motion gate reads. After `rest_spot_arrived` moved `journey_state.motion_state` to `stopped`, a post-rest recompute still projected the seed's stale `situation.motion_state="driving"`, spuriously denying `full_karaoke` content. Fixed by also `model_copy`-ing `situation.motion_state` alongside `control_inputs.motion_state` before re-projecting. `select-service` reading the new head's `allowed_service_ids` and `previous_content` surviving the recompute both already worked with zero changes.
- [x] T021 [US2] Run `cd app/api && uv run pytest tests/proposal/test_p7_e2e_reference_journey.py -q` until green; then `uv run pytest -q`.

**Checkpoint**: the milestone's headline demonstration passes at the API layer.

---

## Phase 5 — US3: Quick-check vs interactive mode (Priority: P2)

**Goal**: per-run `quick_check` auto-selects rank-1 service + content on create and recompute; parity with interactive.
**Independent test**: same snapshot in both modes → identical rank-1; quick_check reaches `content_selected` in one call (spec US3).

### Tests first

- [x] T022 [P] [US3] Write failing quick-check tests in `app/api/tests/proposal/test_p7_quick_check.py`: `create` with `mode=quick_check` and a typed world reaches `content_selected` in one response (rank-1 service auto-selected + content dispatched); `create` with `mode=interactive` stops at `service_selected` (FR-011–FR-013).
- [x] T023 [P] [US3] Add failing recompute-quick-check + parity + no-probabilistic tests to `test_p7_quick_check.py`: a `quick_check` recompute reaches `content_selected`; for one frozen snapshot the quick-check auto rank-1 service equals the interactive rank-1 service (FR-014, SC-006); assert no acceptance/recovery probability field appears anywhere and post-rest values come only from explicit input (FR-009, SC-007); quick-check with no eligible service stays at `service_selected` (no fabricated content).

### Implementation

- [x] T024 [US3] Add the quick-check branch to `create_proposal_run` in `app/api/aica_api/routers/proposal.py`: after STEP 1 yields a rank-1 service, when `mode == quick_check` call `_dispatch_content_for_service` for that service and advance to `content_selected` (append `CONTENT_SELECTED`/`ALGORITHM_ERROR`, update state) in the same response; persist `world` + `mode` on create.
- [x] T025 [US3] Add the same quick-check content dispatch to the recompute endpoint (`T017`) so a `quick_check` recompute reaches `content_selected` via `_dispatch_content_for_service`.
- [x] T026 [US3] Run `cd app/api && uv run pytest tests/proposal/test_p7_quick_check.py -q` until green; then `uv run pytest -q`.

**Checkpoint**: quick-check works on both create and recompute with proven parity.

---

## Phase 6 — US4: Advisory safety — reject-all & non-binding preview (Priority: P2)

**Goal**: prove reject-all after a recompute exits safely and preview never commits.
**Independent test**: post-recompute reject every eligible service → safe end-state; preview leaves the run byte-identical (spec US4).

### Tests first

- [x] T027 [P] [US4] Write failing reject-all-after-recompute test in `app/api/tests/proposal/test_p7_advisory_safety.py`: after a recompute produces several eligible after-rest services, rejecting each in turn reaches `NO_ELIGIBLE_CANDIDATE` without error and the run stays reopenable (FR-016, SC-005).
- [x] T028 [P] [US4] Add a failing preview-not-committed test to `test_p7_advisory_safety.py`: `GET /runs/{id}/journey/preview` on an in-progress run leaves the on-disk file and `GET /runs/{id}` byte-identical (FR-017, SC-004).

### Implementation

- [x] T029 [US4] Make T027/T028 pass. Expected: the P4 `reject`/`choose_another` and preview mechanisms already satisfy these; if a gap surfaces at the recomputed-opportunity boundary (e.g. rejection pool drawn from the stale opportunity), fix it at the seam in `app/api/aica_api/services/proposal_journey.py` / the recompute reset. Run `cd app/api && uv run pytest tests/proposal/test_p7_advisory_safety.py -q` then `uv run pytest -q`.
  - Result: ZERO production change was needed. Both invariants already held end-to-end through the P4 `_reject_service`/`_choose_another`/`_eligible_pool` engine and the pure-read preview handler, exercised across the recompute boundary — proven with 4 new tests (2 reject-all walks: explicit-`selected_service_id` and offered+`choose_another`; 1 preview-non-commit; the recomputed-vs-stale-pool disjointness assertion). Full suite: 2114 passed / 3 skipped (up from the 2061/3 T001 baseline).

**Checkpoint**: advisory-safety invariants hold across a recomputed stage.

---

## Phase 7 — US5: 4-panel screen integration (Priority: P3)

**Goal**: reviewer chooses mode, edits post-rest context + recomputes, and reads lifecycle/motion/allowed-service + a multi-opportunity timeline, JA-default bilingual.
**Independent test**: on the screen, toggle mode, submit a post-rest edit + recompute, confirm the timeline and readouts update from the backend, in both languages (spec US5).

### Tests first

- [x] T030 [P] [US5] Write failing `app/frontend/tests/proposal_recompute_panel.test.tsx`: a RecomputePanel edits drowsiness/fatigue and, on Recompute, calls `recompute(runId, overrides)` and dispatches `RECOMPUTED` with the returned log; a 422 (playback/invalid) surfaces inline, never a silent no-op.
- [x] T031 [P] [US5] Write failing `app/frontend/tests/proposal_mode_toggle.test.tsx`: the ModeToggle sets `interactive`/`quick_check` and the chosen mode is included in the create-run request; JA default + EN labels render.
- [x] T032 [P] [US5] Write failing `app/frontend/tests/proposal_timeline_recompute.test.tsx`: EventTimeline renders `RECOMPUTED`/`CONTEXT_EDITED` and the multi-opportunity sequence, and shows the committed action separately from a non-binding preview; lifecycle/motion/allowed-service readouts render from `journey_state`+head opportunity.

### Implementation

- [x] T033 [P] [US5] Add `recompute(runId, overrides, opts?)` to `app/frontend/src/api/proposalClient.ts` (POST `/runs/{id}/recompute`) with typed request/response.
- [x] T034 [US5] Add `mode` to proposal state and `RECOMPUTED` / `MODE_SET` actions in `app/frontend/src/state/proposalStore.ts` (display-only; backend log is source of truth).
- [x] T035 [P] [US5] Create `app/frontend/src/components/proposal/ModeToggle.tsx` (interactive/quick_check, Panel ②) and `RecomputePanel.tsx` (post-rest context edit + Recompute button + inline error) with JA-default bilingual labels in `app/frontend/src/i18n`.
  - Implemented as local `LABELS` dictionaries resolved through the existing `t()` (`src/i18n/t.ts`), the same convention every other proposal component (`JourneyActionBar`, `EventTimeline`, both panels) already uses — `src/i18n/` itself holds only the resolver, never per-component label dictionaries.
- [x] T036 [US5] Extend `app/frontend/src/components/proposal/EventTimeline.tsx` for `RECOMPUTED`/`CONTEXT_EDITED` + the multi-opportunity sequence, and add the lifecycle-stage/motion/allowed-service readout + committed-vs-preview separation to `panels/ServiceProposalPanel.tsx` / `panels/ContentProposalPanel.tsx`. Wire ModeToggle into create and RecomputePanel into the screen (`ProposalScreen.tsx`).
  - `ModeToggle`/`RecomputePanel` are wired into `ServiceProposalPanel` (rendered by `ProposalScreen.tsx`), mirroring how `JourneyActionBar`/`EventTimeline` were wired in P4 — `ProposalScreen.tsx` itself stays a thin 3-panel layout shell with no direct changes needed.
- [x] T037 [US5] Run `cd app/frontend && npm run test` until green and `npm run build` (tsc + vite) clean.
  - 58 test files / 547 tests green (528 baseline + 19 new); `npm run build` (`vite build`) clean; a direct `npx tsc --noEmit` shows the same pre-existing ~175-180 line baseline noise in unrelated test files (confirmed present before this unit's changes too, via `git stash`) — zero new errors traced to any P7 Unit F file.

**Checkpoint**: the reference journey is drivable and inspectable on the 4-panel screen in JA/EN.

---

## Phase 8 — Polish & cross-cutting

- [ ] T038 Run the full gates: `cd app/api && uv run pytest -q` (regression, incl. all trigger tests — SC-008) and `cd app/frontend && npm run test && npm run build`. All green.
- [ ] T039 Exercise the real end-to-end flow in the running app (`docker compose up`) per `quickstart.md`: drive the reference journey on the 4-panel screen, edit post-rest state + recompute, and confirm the timeline/readouts. Capture evidence for each acceptance criterion (AC-1..AC-7).
- [ ] T040 Verify isolation & determinism: confirm no `aica_api.models`/`aica_api.algorithms` (trigger) import was added to the proposal path; confirm the journey engine still has no selector dispatch/IO; re-run a recompute twice and diff the persisted head snapshot for byte-identity (FR-020, FR-021, SC-009).
- [ ] T041 Update `docs/master/aica_proposal_simulator_milestones.md` P7 section only if implementation clarified a contract (per design §12 none is expected); mark tasks complete and record the final test counts in the feature notes. Do NOT edit generated artifacts or the master algorithm docs.

---

## Dependencies & execution order

- **Phase 1** → **Phase 2 (Foundational)** blocks everything.
- **US1 (Phase 3)** depends on Foundational; it is the MVP.
- **US2 (Phase 4)** depends on US1 (uses recompute).
- **US3 (Phase 5)** depends on Foundational + US1 (recompute reuses the quick-check dispatch) + T010 helper.
- **US4 (Phase 6)** depends on US1 (recompute boundary).
- **US5 (Phase 7)** depends on US1/US3 endpoints existing; frontend tasks are otherwise independent.
- **Phase 8** last.

## Parallel opportunities

- Foundational tests T002/T003/T004 run in parallel (different files).
- US1 test tasks T013–T016 are `[P]` (same file, author sequentially but independent assertions; run as one file).
- US3 T022/T023, US4 T027/T028, US5 T030/T031/T032 and T033/T035 are `[P]` across their files.

## MVP scope

**US1 (Phase 3)** — the recompute endpoint with its frozen-snapshot history — is the minimum that delivers P7's unique value; US2 then demonstrates it end to end.

## Format validation

All tasks use `- [ ] Txxx [P?] [USx?] description with file path`. Setup/Foundational/Polish tasks carry no story label; US phases carry `[US1]`–`[US5]`.
