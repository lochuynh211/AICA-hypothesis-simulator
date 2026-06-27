---
description: "Task list for M3 Python Algorithm Support"
---

# Tasks: M3 Python Algorithm Support

**Input**: Design documents from `/specs/004-m3-python-algorithm-support/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD; constitution requires contract surfaces — the python_module
adapter, the error matrix, the hybrid runtime-state, the persisted log — tested first).
Test tasks precede implementation and MUST FAIL first.

**Organization**: by user story. **US2 (adapter) is sequenced before US1 (hybrid)**
because the hybrid runs through the adapter. US3 (error pause-by-default) is a
cross-cutting migration that touches M1/M2 tests. MVP = US2 + US1 (a Python package,
incl. the hybrid, runs and is reviewable).

## Format: `[ID] [P?] [Story] Description`
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`,
tests `app/frontend/tests/`; data `packages/`.

---

## Phase 1: Setup
- [ ] T001 Create the two Python-package dirs `packages/rest_python_v0_1/` and `packages/aica_transparent_hybrid_trigger_v1/` (empty; populated in their tasks); no code yet

---

## Phase 2: Foundational (Blocking — model changes)
- [ ] T002 [P] Extend `app/api/aica_api/models/package.py` (+ `app/api/tests/test_models.py`): `algorithm.type` Literal += `"python_module"`; add `entrypoint`, optional `tick_seconds`, `error_mode: "blocking"|"non_blocking"` (default blocking); keep M1/M2 valid
- [ ] T003 [P] Relax `app/api/aica_api/models/decision.py` `result_type` from the 5-value Literal to a permissive value accepting `REST_PROPOSAL`/`MONOTONY_PROPOSAL`/`SUPPRESSED`/`NO_PROPOSAL`/M1-M2/package-defined; keep all M1/M2 result_type tests green (+ a test that `MONOTONY_PROPOSAL`/`SUPPRESSED` now validate)

**Checkpoint**: schema accepts python_module + the broader result_type.

---

## Phase 3: User Story 2 - Select and evaluate any Python package (Priority: P1 — adapter root) 🎯

**Goal**: a `python_module` package loads, evaluates through the one contract, and normalizes to §11.

**Independent Test**: the simple Python package runs against a UC-01 scenario and produces the same normalized decision as the built-in weighted_score on the same inputs.

- [ ] T004 [US2] Write failing `app/api/tests/test_python_module.py` (isolated load + cache; `evaluate` called with the context dict; returned dict normalized to §11 with `result_type` verbatim; suppressed retained; returned `next_package_runtime_state` threaded) then implement `app/api/aica_api/algorithms/python_module.py` + a `python_module` dispatch branch in `algorithms/adapter.py`
- [ ] T005 [US2] Context builder + proposal_history: in `services/run_manager.py` (+ a helper), build the evaluate context `{simulation_time_sec, raw_state, feature_groups, parameters, hyperparameters, proposal_history, user_action_history, package_runtime_state}` with **required-field validation** (missing required → clear error, not silent 0) and derive `proposal_history` (lastProposalTimeSec/Category/Result, proposalCountLast30Min, acceptanceRateRecent) from the run's events; tests for the builder + required-field error
- [ ] T006 [P] [US2] Author `packages/rest_python_v0_1/{package.json (algorithm.type python_module, entrypoint algorithm.py), algorithm.py (mirrors weighted_score; next_package_runtime_state {}), README.md}`; `app/api/tests/test_rest_python.py` asserts parity with built-in weighted_score on the same context + the registry lists it
- [ ] T007 [US2] `tick_seconds` precedence: tick engine uses a python package's declared `tick_seconds` when set, else the scenario's; test

**Checkpoint**: any Python package is selectable + evaluated; simple package matches the built-in.

---

## Phase 4: User Story 3 - Python failures surfaced as evidence; pause by default (Priority: P2)

**Goal**: the three Python failure kinds → distinct error events, shown + persisted, and the run pauses by default (non_blocking continues) — unified with built-in errors.

**Independent Test**: packages that lack `evaluate` / raise / return junk each yield the right error_type, no decision, paused-by-default.

- [ ] T008 [US3] Write failing tests in `app/api/tests/test_python_module.py` for the error matrix (missing `evaluate` → `missing_evaluate`; raises → `algorithm_exception`; invalid return → `invalid_result_shape`; required-field-missing → context error) — each: no decision, error event recorded; implement the three error_types in `python_module.py`/adapter
- [ ] T009 [US3] MIGRATE `services/run_manager.py` to **pause-by-default** on any `algorithm_error` when the package `error_mode` is `blocking` (default): `paused=True`, status paused with an error marker, no decision; `non_blocking` continues. **Update the M1/M2 algorithm-error tests** (`test_run_manager.py`, `test_routers.py`, `test_api_run_loop.py`) that assert `paused=False` → assert pause-by-default; add a `non_blocking`-continues test
- [ ] T010 [US3] Router/tick envelope reflects the paused error (`{run_state(paused), error, paused:true}`); frontend trace already renders algorithm errors — add/extend `app/frontend/tests/errors.test.tsx` (or trace test) that a paused algorithm-error renders as an error, not a decision

**Checkpoint**: honest, master-aligned failure handling across built-in + Python.

---

## Phase 5: User Story 1 - Run & review the transparent hybrid (Priority: P1) 🎯 MVP headline

**Goal**: the hybrid runs a UC-01 rest scenario to a proposal with a full trace incl. evolving runtime state.

**Independent Test**: run the hybrid; trace shows features/scores/states/candidates/fire-control/proposal + a non-empty runtime state changing across ticks; repeat → identical.

- [ ] T011 [US1] Write failing `app/api/tests/test_transparent_hybrid.py` (smoothing damps a 1-tick spike; persistence gates firing [single spike doesn't fire until counter clears, skip-if bypasses]; state machine advances bands; fire-control cooldown suppresses a too-soon second proposal via proposal_history; priority selects rest over monotony; suppressed retained; determinism) then implement `packages/aica_transparent_hybrid_trigger_v1/{package.json (tick_seconds 30, §19 config as hyperparameters, localized proposals), algorithm.py (faithful port per contracts/transparent-hybrid.md), README.md}`
- [ ] T012 [US1] Tune the hybrid default config and/or pick + minimally tweak an existing UC-01 rest scenario so the hybrid **deterministically reaches exactly one REST_PROPOSAL** (smoothing-aware); backend test asserts it fires with a full trace and a non-empty `next_package_runtime_state` that **evolves** across ticks (smoothed_scores/persistence_counters change)
- [ ] T013 [US1] Frontend trace extension: `components/trace/DecisionTracePanel.tsx` shows per-tick state labels (`states.rest`/`states.monotony`) + a compact runtime-state indicator (smoothed_scores + persistence_counters) drawn from the tick's **recorded output** runtime state; `api/types.ts` adds the shape; `app/frontend/tests/trace.test.tsx` asserts they render + a suppressed candidate from a Python decision stays visible/marked (SC-006)
- [ ] T014 [US1] Backend e2e in `app/api/tests/test_api_run_loop.py`: hybrid via the plan flow (analyze → run-plans{package=hybrid} → runs{plan_id} → tick to proposal → action → GET /log); assert the persisted per-tick `package_runtime_state` is non-empty and changes across ticks

**Checkpoint**: the transparent hybrid is executable + fully reviewable. MVP headline met.

---

## Phase 6: Polish & Cross-Cutting
- [ ] T015 [P] Update root `README.md` with the M3 flow (select a Python/hybrid package, run, inspect states + runtime-state, Python-error pause) from quickstart.md
- [ ] T016 Run `quickstart.md` validation end-to-end (controller, docker): select the hybrid, run a UC-01 scenario, confirm the runtime-state evolves in the persisted evidence; confirm a Python error pauses the run; both test suites green

---

## Dependencies & Execution Order
- **Setup (T001)** → none. **Foundational (T002–T003)** → blocks all stories.
- **US2 (T004–T007)** → after Foundational; the **adapter root** — blocks US1 + US3.
- **US3 (T008–T010)** → after US2 (errors flow through the adapter); the pause-migration touches M1/M2 tests.
- **US1 (T011–T014)** → after US2 (+ ideally US3 so the hybrid e2e runs against the final error model).
- **Polish (T015–T016)** → after US1–US3.

### Parallel Opportunities
- T002, T003 (separate model files) parallel.
- T006 (simple package) ∥ adapter tests within US2.
- T015 ∥ within polish.

---

## Implementation Strategy
**MVP** = Setup → Foundational → US2 (adapter + simple package) → US1 (hybrid). STOP & validate the hybrid runs reviewably. US3 (error pause) folds in before the hybrid e2e.
**Incremental**: US2 → US3 → US1 → Polish (docker validation, README).

## Notes
- TDD: every test task precedes its impl and MUST fail first.
- Security: NO new dependencies; stdlib `importlib` only; local trusted code, no sandboxing.
- Determinism: Python fixtures pure; `simulation_time_sec` from frozen state; `package_runtime_state` threaded.
- Migration (not duplication): the run_manager error path becomes pause-by-default; M1/M2 error tests are updated, not weakened.
- Total: 16 tasks (T001–T016).
