# Implementation Plan: M3 Python Algorithm Support

**Branch**: `004-m3-python-algorithm-support` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-m3-python-algorithm-support/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-27-m3-python-algorithm-support-design.md](../../docs/superpowers/specs/2026-06-27-m3-python-algorithm-support-design.md)

## Summary

Add a `python_module` algorithm adapter (isolated `importlib` load by path, cached
per package; plain-dict context incl. `proposal_history`; normalize the returned
dict to the §11 `DecisionResult`, passing `result_type` through verbatim;
required-field validation; missing-evaluate/exception/invalid-return →
`algorithm_error`). Ship two Python packages: a simple `rest_python_v0_1` (mirrors
weighted_score) and `aica_transparent_hybrid_trigger_v1` (faithful smoothing α0.35,
feature/category formulas, REST_/MONOTONY_ state machines, velocity, persistence
counters + skip-if, fire-control, priority, populated
`next_package_runtime_state`). Make `package_runtime_state` threading (M2 plumbing)
non-empty; derive `proposal_history` from run events. **Unify algorithm-error
handling to the master's pause-by-default model** (configurable non-blocking),
updating M1/M2's continue-on-error tests. Modest trace extension for state labels +
the tick's recorded runtime-state summary.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv, pinned deps); TypeScript 5 / Node 18
host (frontend, Vite 5).

**Primary Dependencies**: FastAPI, Pydantic v2, uvicorn (backend) + **stdlib
`importlib`** for module loading; React 18, Vite 5 (frontend). **No new
dependencies.**

**Storage**: File-based JSON — `packages/` (now incl. Python packages with
`algorithm.py`), `scenarios/`, `runs/`.

**Testing**: pytest + httpx (backend); Vitest + Testing Library (frontend).

**Target Platform**: Local single-developer Docker Compose; browser :5180, api :8137.

**Project Type**: Web application — `app/api` + `app/frontend`.

**Performance Goals**: None beyond a responsive local loop; determinism is the hard
requirement.

**Constraints**: Local trusted code, in-process, **no sandboxing** (constitution VI,
milestone); deterministic (Python pure, `simulation_time_sec` from frozen state,
`package_runtime_state` threaded); `result_type` passed through (no alias map);
required context fields validated, optional default 0; algorithm errors **pause by
default** unless non-blocking; one adapter contract; no new deps.

**Scale/Scope**: Two Python packages, one reused UC-01 scenario, single user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Python runs server-side; frontend renders. |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | The three Python failure kinds → distinct `algorithm_error` events; **pause-by-default** (master-aligned) so a failure can't be skipped past silently; never a faked decision; suppressed retained. |
| III. Deterministic, Replayable | ✅ Pass | `simulation_time_sec` from frozen state; pure Python fixtures; `package_runtime_state` threading makes the stateful hybrid reproducible (FR-009/SC-003). |
| IV. Qualitative Trigger Discipline | ✅ Pass | Python consumes simulator-internal `raw_state` + `feature_groups` (no external-service raw numeric; Maps is M4). |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | `python_module` dispatched through the same `evaluate(...) → DecisionResult`; shape normalized, semantic `result_type` passed through; runtime-state threaded. |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | File-based packages, in-process trusted code, no sandboxing, no new deps; reuse an existing scenario. |
| Security & Safety Boundaries | ✅ Pass | Local trusted code only; no untrusted-upload sandboxing (explicitly out of scope, milestone + constitution); no external keys (Maps is M4). |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (adapter, error matrix, hybrid runtime-state, persisted log) tested first (TDD). |

**Result: PASS — no violations.** Complexity Tracking empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md,
contracts/, quickstart.md add no DB/cloud, no new deps, no external-service numeric;
keep the adapter + append-only recorder as boundaries; the pause-by-default change
strengthens principle II. No new violations.

## Project Structure

### Documentation (this feature)
```text
specs/004-m3-python-algorithm-support/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── python-module-adapter.md   # context dict + evaluate contract + error matrix
│   └── transparent-hybrid.md      # the hybrid's returned shape + runtime-state
├── checklists/requirements.md
└── tasks.md                       # /speckit-tasks
```

### Source Code (repository root)
```text
app/api/aica_api/
├── algorithms/
│   ├── adapter.py            # add python_module dispatch branch
│   ├── python_module.py      # NEW isolated importlib load + cache; context build helpers;
│   │                         #   normalize returned dict -> DecisionResult; 3 error types
│   └── (declarative_rule.py, weighted_score.py unchanged)
├── services/
│   └── run_manager.py        # MIGRATE: pause-by-default on algorithm_error (configurable
│                             #   non-blocking); derive proposal_history from run events;
│                             #   thread non-empty package_runtime_state through python eval
├── models/
│   ├── package.py            # algorithm.type += "python_module"; entrypoint; optional tick_seconds;
│   │                         #   relax DecisionResult.result_type (in decision.py)
│   └── decision.py           # result_type relaxed to accept master/package values
└── tests/
    ├── test_python_module.py        # load/missing-evaluate/exception/invalid-return; normalize
    ├── test_rest_python.py          # parity with weighted_score
    ├── test_transparent_hybrid.py   # smoothing/velocity/persistence/state-machine/priority/runtime-state
    ├── test_run_manager.py          # UPDATE: pause-by-default on error; proposal_history; rts threading
    ├── test_routers.py / test_api_run_loop.py  # UPDATE error-envelope to paused; hybrid e2e
    └── (M1/M2 algorithm-error tests updated to pause-by-default)

packages/rest_python_v0_1/{package.json, algorithm.py, README.md}                 # NEW
packages/aica_transparent_hybrid_trigger_v1/{package.json, algorithm.py, README.md} # NEW

app/frontend/src/
├── api/types.ts              # runtime-state shape on the trace
└── components/trace/DecisionTracePanel.tsx  # state labels + runtime-state indicator
```

**Structure Decision**: extends the M1/M2 tree; the `run_manager` error path is
**migrated** (pause-by-default) — a cross-cutting change with M1/M2 test updates,
flagged as such in tasks.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
