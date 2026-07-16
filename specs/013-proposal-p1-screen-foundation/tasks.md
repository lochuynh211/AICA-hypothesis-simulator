---
description: "Task list — P1 Proposal Screen (3-Panel) & Standalone Run Foundation"
---

# Tasks: Proposal Screen (3-Panel) & Standalone Run Foundation

**Input**: Design documents from `specs/013-proposal-p1-screen-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/proposal-api.md, ui-mockup.html
**Tests**: **Required** (milestone mandates TDD; Constitution requires contract-surface tests first).

## Conventions

- Backend: `app/api/aica_api/…`, tests `app/api/tests/proposal/…`, run `cd app/api && uv run pytest`.
- Frontend: `app/frontend/src/…`, tests co-located `__tests__`, run `cd app/frontend && npm test`.
- Isolation invariant: `app/api/aica_api/models/proposal/*` MUST NOT import `aica_api.models` (trigger).
- TDD: write the test task, watch it fail for the intended reason, then implement.

---

## Phase 1: Setup (shared infrastructure)

- [ ] T001 Add `proposal_runs_dir` (env `AICA_PROPOSAL_RUNS_DIR`, default `<repo>/proposal_runs`) to `app/api/aica_api/config.py`.
- [ ] T002 [P] Create the frozen matrix artifact `proposal_contracts/matrix/purpose_stage_matrix.v1.json` — the 6 spec §7.5 rows; `after_rest_before_restart` lists the 5 services incl. `call_response_stopped`.
- [ ] T003 [P] Frontend appMode scaffold: `app/frontend/src/state/appMode.tsx` (`'trigger' | 'proposal'` context+provider) and wrap `app/frontend/src/App.tsx` with it + a header toggle (trigger shell otherwise untouched).
- [ ] T004 [P] Frontend proposal store skeleton `app/frontend/src/state/proposalStore.ts` (Context + `useReducer`, `uiLanguage` default `'ja'`, isolated from `runStore`) + `app/frontend/src/api/proposalClient.ts` skeleton.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**Purpose**: the isolated neutral contracts, matrix resolver, package model + registry, mock packages, selector-dispatch boundary, and run-manager core. Everything below is a prerequisite for US1–US3.

### Contracts (TDD, isolated `models/proposal/`)

- [ ] T005 [P] Test enums in `app/api/tests/proposal/test_p1_enums.py` (MotionState, ProposalPackageFamily/Approach, ServiceDecisionType, DiscreteEventType, ProposalRunStatus exact members), then add them to `app/api/aica_api/models/proposal/enums.py`.
- [ ] T006 [P] Test `ProposalOpportunity` (purpose/stage compatibility validator; non-empty `allowed_service_ids`; no UI/tick fields) in `app/api/tests/proposal/test_opportunity_contract.py`, then implement `app/api/aica_api/models/proposal/opportunity.py`.
- [ ] T007 [P] Test `ServiceSelectorOutput`/`RankedCandidate`/`FeatureContribution` (≤3 ranked; contiguous ranks; `no_proposal`⇒empty; candidate ∈ allowed) in `app/api/tests/proposal/test_service_output_contract.py`, then implement `app/api/aica_api/models/proposal/service_output.py`.
- [ ] T008 [P] Test `DiscreteEvent`/`JourneyState`/`AlgorithmEvidence` shapes in `app/api/tests/proposal/test_events_journey_evidence.py`, then implement `app/api/aica_api/models/proposal/{events,journey,evidence}.py`.
- [ ] T009 [P] Test `ProposalRun`/`ProposalRunLog` (append-only shape; required fields) in `app/api/tests/proposal/test_proposal_run_model.py`, then implement `app/api/aica_api/models/proposal/proposal_run.py`.
- [ ] T010 [P] Test `ProposalPackageManifest` + `ProposalPackageFamilySlot` (4 slots; content requires `supported_services`; `python_module` only) in `app/api/tests/proposal/test_proposal_manifest.py`, then implement `app/api/aica_api/models/proposal/package_manifest.py`.
- [ ] T011 Re-export the new models from `app/api/aica_api/models/proposal/__init__.py`; add an **import-guard** test `app/api/tests/proposal/test_p1_isolation_imports.py` asserting no `models/proposal/*` module imports `aica_api.models` (trigger).

### Matrix resolver

- [ ] T012 Test `PurposeStageServiceMatrix` loader/resolver in `app/api/tests/proposal/test_matrix_resolver.py` — loads T002 artifact; all 6 rows resolve; post-rest returns the 5 incl. `call_response_stopped`; incompatible/unknown `(purpose,stage)` raises typed error — then implement `app/api/aica_api/models/proposal/matrix.py`.

### Mock packages

- [ ] T013 [P] Create `packages/mock_service_selector_v1/package.json` (`family=service_selector`, `approach=transparent`, full representative parameters + hyperparameters incl. matrices from the service algorithm doc §5–§6) + `algorithm.py` (`def evaluate(context)->dict` returning a fixed valid `ServiceSelectorOutput` with well-formed contributions; `no_proposal` on empty allowed set).
- [ ] T014 [P] Create `packages/mock_content_selector_v1/package.json` (`family=content_selector`, `approach=transparent`, hyperparameters mirroring the real P6 manifest) + `algorithm.py` returning a fixed valid `CompletePlan` whose `ordered_items` reference **real track IDs from the frozen P2 demonstration catalog**; `unsupported_service` when asked for a service it doesn't support; no `plan_score`.

### Registry + selector dispatch + run-manager core

- [ ] T015 Test `ProposalPackageRegistry` in `app/api/tests/proposal/test_proposal_registry.py` (loads both mocks; maps to the 4 slots; a content package cannot fill a service slot; a malformed manifest → errors list, never partially used), then implement `app/api/aica_api/services/proposal_package_registry.py`.
- [ ] T016 Test `proposal_selector` dispatch in `app/api/tests/proposal/test_proposal_selector.py` (loads a package's `algorithm.py`, calls `evaluate`, validates into the neutral contract; a raise/invalid return ⇒ `algorithm_error` evidence, never a faked result; does NOT route through the trigger adapter), then implement `app/api/aica_api/services/proposal_selector.py`.
- [ ] T017 Test `proposal_run_manager` core in `app/api/tests/proposal/test_proposal_run_manager.py` (create run → append-only `ProposalRunLog` → atomic persist to `proposal_runs/`; frozen params/hyperparameters; `run_id=prun_…`), then implement `app/api/aica_api/services/proposal_run_manager.py` (reuse `storage/file_store` atomic writes).
- [ ] T018 Add router skeleton `app/api/aica_api/routers/proposal.py` and mount it additively in `app/api/aica_api/main.py`; smoke test `app/api/tests/proposal/test_proposal_router_mounted.py` (router present; trigger routers unaffected).
- [ ] T019 [P] Extend schema export `app/api/aica_api/models/proposal/export_schema.py` to emit JSON Schemas for the new P1 contracts under `proposal_contracts/schema/`; add a drift-guard test `app/api/tests/proposal/test_p1_schema_export.py` (committed schemas byte-match a fresh export).

**Checkpoint**: backend contracts, matrix, registry, mocks, dispatch, and run-manager core exist and pass unit tests; no trigger code changed except the additive `config.py`/`main.py`.

---

## Phase 3: User Story 1 — Open the screen and run a mock proposal (Priority: P1) 🎯 MVP

**Goal**: A reviewer opens the Proposal workspace and runs a full mock proposal (World → Service → Content) in JA, with reason breakdowns. **Independent test**: run the flow end-to-end; all 3 panels render meaningful content in JA; service+content come through their boundaries.

### Backend (TDD)

- [ ] T020 [P] [US1] Test `GET /api/proposal/matrix` in `app/api/tests/proposal/test_ep_matrix.py` (6 rows; post-rest=5), then implement in `routers/proposal.py`.
- [ ] T021 [P] [US1] Test `GET /api/proposal/packages` in `app/api/tests/proposal/test_ep_packages.py` (4 slots; mocks loaded in transparent slots; LLM slots null; errors surfaced), then implement.
- [ ] T022 [US1] Test `POST /api/proposal/runs` (create + STEP 1) in `app/api/tests/proposal/test_ep_create_run.py` (resolves opportunity from matrix; runs mock service selector; ≤3 ranked; default select rank-1; persists `SERVICE_SELECTED` event + evidence; 422 on incompatible purpose/stage or mis-slotted package), then implement.
- [ ] T023 [US1] Test `POST /api/proposal/runs/{id}/select-service` (STEP 2) in `app/api/tests/proposal/test_ep_select_service.py` (runs mock content selector for the chosen service; one ordered plan, no `plan_score`; appends `CONTENT_SELECTED` event + evidence; 422 when service ∉ allowed or unsupported), then implement.

### Frontend (TDD with Vitest)

- [ ] T024 [P] [US1] `app/frontend/src/api/proposalClient.ts` — typed methods for matrix/packages/create/select-service + response types; unit test `proposalClient.test.ts`.
- [ ] T025 [P] [US1] `ProvenanceBadge.tsx` + `ReasonBreakdown.tsx` + `HyperparamMatrix.tsx` in `app/frontend/src/components/proposal/` with `__tests__` (badge maps `FeatureOriginProvenance`; ReasonBreakdown renders feature/value/a/w/contribution + supported/opposed + rationale; HyperparamMatrix renders/edits a matrix from a manifest hyperparameter).
- [ ] T026 [US1] `panels/WorldPanel.tsx` (+ test): sections Trigger signal → Car state (`lifecycle_stage`+`motion_state`) → World·situation (editable) → Preference & history (from profile) → Driver profile; provenance badges; writes to `proposalStore`.
- [ ] T027 [US1] `panels/ServiceProposalPanel.tsx` (+ test): package+mode picker; editable Parameters (2-up) + collapsible Hyperparameters (matrices via `HyperparamMatrix`); Formulation callout; Run → ranked ≤3 candidate cards with `ReasonBreakdown`; choose-service hands off.
- [ ] T028 [US1] `panels/ContentProposalPanel.tsx` (+ test): mirrors ServiceProposalPanel for the chosen service; renders the single ordered plan (real song names), per-item `ReasonBreakdown`, plan metadata, excluded examples.
- [ ] T029 [US1] `ProposalShell.tsx` + `ProposalScreen.tsx` (3-column 16/42/42, full-bleed, collapses <1180px) + wire `appMode='proposal'` to render the shell; test the 3-panel render.
- [ ] T030 [US1] Bilingual test `ProposalScreen.i18n.test.tsx`: JA is default; toggling to EN switches every panel/label; toggle back to JA (satisfies FR-004, SC-007).
- [ ] T031 [US1] Integration test `app/api/tests/proposal/test_us1_flow.py`: a mock opportunity flows through both selector boundaries and yields a service ranking + a content plan (SC-001, SC-002, SC-003).

**Checkpoint**: US1 independently demoable — open Proposal, run World→Service→Content, see reasons, JA default.

---

## Phase 4: User Story 2 — Persist, reopen, delete a proposal run (Priority: P1)

**Goal**: Runs auto-persist to a separate namespace; reviewer can list, reopen (from record, no recompute), and delete. **Independent test**: create → list → reopen matches record → delete removes; no trigger run touched.

### Backend (TDD)

- [x] T032 [P] [US2] Test `GET /api/proposal/runs` (list summaries from `proposal_runs/*.json` + active) in `app/api/tests/proposal/test_ep_list_runs.py`, then implement.
- [x] T033 [P] [US2] Test `GET /api/proposal/runs/{id}` (full log from disk; renders without recomputing selectors) in `app/api/tests/proposal/test_ep_get_run.py`, then implement.
- [x] T034 [US2] Test `DELETE /api/proposal/runs/{id}` (removes only `proposal_runs/<id>.json`; 404 unknown; no trigger run affected) in `app/api/tests/proposal/test_ep_delete_run.py`, then implement.
- [x] T035 [US2] Persistence round-trip + determinism test `app/api/tests/proposal/test_us2_persistence.py`: create → file exists under `proposal_runs/` → reopen deep-equals the recorded evidence; identical create+select reproduces identical mock output (SC-004, Determinism gate).

### Frontend (TDD)

- [x] T036 [US2] `ProposalRunsScreen.tsx` (+ test): list runs, reopen (renders recorded evidence read-only, no recompute), delete; wire the `[ Screen | Runs ]` sub-nav in `ProposalShell`.

**Checkpoint**: US2 independently demoable — persistence lifecycle works, isolated from trigger runs.

---

## Phase 5: User Story 3 — Isolation, safety framing & package independence (Priority: P2)

**Goal**: Prove the trust invariants. **Independent test**: edits don't cross workspaces; allowed set == matrix; packages validate independently; failures/empty sets are explicit.

- [ ] T037 [P] [US3] Backend isolation test `app/api/tests/proposal/test_us3_isolation.py`: creating/editing a proposal run writes only under `proposal_runs/`, never `runs/`, and does not touch trigger in-memory state (FR-024, SC-004/SC-005).
- [ ] T038 [P] [US3] Package-independence test `app/api/tests/proposal/test_us3_package_independence.py`: mock service + content packages validate independently against their slots; a content package is rejected from a service slot and vice-versa; neither consumes the other's result (FR-014/015, SC-006).
- [ ] T039 [P] [US3] Failure-visibility test `app/api/tests/proposal/test_us3_failure_visibility.py`: a raising/invalid mock selector ⇒ explicit `algorithm_error` record (not a fabricated proposal); empty allowed/eligible set ⇒ `no_proposal`; unsupported service ⇒ `unsupported_service` (FR-019/020/021, SC-008).
- [ ] T040 [P] [US3] Matrix-freeze/allowed-set test `app/api/tests/proposal/test_us3_allowed_set.py`: every ranked candidate ∈ frozen allowed set; run records `matrix_version`; post-rest resolves 5 incl. `call_response_stopped` (FR-011/012/013, SC-002, SC-009).
- [ ] T041 [P] [US3] Frontend isolation test `app/frontend/src/state/__tests__/proposalStore.isolation.test.ts`: dispatching proposal-store edits does not mutate `runStore` state (FR-025).
- [ ] T042 [P] [US3] Backend provenance test `app/api/tests/proposal/test_us3_provenance.py`: the selector input / world snapshot carries a `FeatureOriginProvenance` (`cdc_su_baseline`/`normalized_cdc_su_concept`/`proposed_addition`) for every world feature, with `{ja,en}` labels (FR-005).
- [ ] T043b [P] [US3] Frontend provenance test `app/frontend/src/components/proposal/__tests__/ProvenanceBadge.render.test.tsx`: `WorldPanel` renders a provenance badge for every world feature field (FR-005).

**Checkpoint**: all trust invariants covered by dedicated tests.

---

## Phase 6: Polish & cross-cutting

- [ ] T043 [P] Add `packages/mock_service_selector_v1/README.md` and `packages/mock_content_selector_v1/README.md` (contract, params, "mock — illustrative results" note).
- [ ] T044 [P] Consistency test `app/api/tests/proposal/test_matrix_matches_spec.py`: the v1 matrix artifact matches consolidated spec §7.5 (incl. post-rest 5) — guards master-doc drift.
- [ ] T045 Regression gate: `cd app/api && uv run pytest` (full suite incl. existing trigger tests green) and `cd app/frontend && npm test` (incl. existing trigger component tests) — trigger simulator unaffected (Regression gate, SC-005).
- [ ] T046 Build gates: `cd app/frontend && npm run build` and `docker compose config`.
- [ ] T047 End-to-end manual walkthrough per `quickstart.md` (`docker compose up`): run the demo flow, exercise every acceptance criterion, confirm JA default + EN toggle, isolation, reopen-without-recompute, delete.

---

## Dependencies & completion order

```
Phase 1 (Setup) ─▶ Phase 2 (Foundational) ─▶ Phase 3 US1 (MVP) ─▶ Phase 4 US2 ─▶ Phase 5 US3 ─▶ Phase 6 Polish
```

- **Phase 2 blocks all stories** (contracts, matrix, registry, mocks, dispatch, run-manager core).
- **US1** is the MVP and must complete before US2 (US2 lists/reopens the runs US1 creates).
- **US3** validates guarantees that US1/US2 already implement; its tasks are mostly independent tests and can begin once Phase 2 + the relevant endpoints exist, but are sequenced after US2 for a clean story order.
- Within a phase, `[P]` tasks touch different files and may run in parallel; non-`[P]` tasks share a file (e.g. `routers/proposal.py`) or depend on the immediately prior task.

## Parallel execution examples

- **Phase 2 contracts**: T005, T006, T007, T008, T009, T010 in parallel (distinct model files) → then T011 (aggregates) → T012 → T013/T014 (parallel mock packages) → T015/T016/T017 → T018/T019.
- **US1 endpoints**: T020, T021 in parallel; T022 then T023 (same router file, sequential).
- **US1 frontend**: T024, T025 in parallel; then T026/T027/T028 (distinct panel files, parallel) → T029 → T030 → T031.
- **US3**: T037, T038, T039, T040, T041 all parallel (independent test files).

## Implementation strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)** — a runnable, demoable proposal flow.
- Deliver incrementally: US1 (run+see) → US2 (persist/reopen/delete) → US3 (trust guarantees) → Polish.
- Every phase leaves the app runnable and the trigger simulator green (Regression gate at T045).

## Acceptance-criterion coverage map

| Criterion | Tasks |
|---|---|
| SC-001 open + run mock proposal | T022, T023, T029, T031, T047 |
| SC-002 candidates ⊆ allowed, ≤3 | T007, T022, T040 |
| SC-003 one plan, no aggregate score | T014, T023, T028 |
| SC-004 persist/reopen/delete, isolated | T017, T032–T035, T037 |
| SC-005 no trigger change; suite green | T045, T037 |
| SC-006 4-slot independent validation | T010, T015, T038 |
| SC-007 JA-default bilingual | T030, T047 |
| SC-008 failure/empty explicit | T016, T039 |
| SC-009 post-rest 5 incl. call_response_stopped | T002, T012, T040, T044 |
| FR-005 provenance labels | T025, T026, T042, T043b |
| Editable params/matrices (D8/FR-002a) | T013, T014, T025, T027, T028 |
| Reason breakdown (D9/FR-003a) | T025, T027, T028 |
