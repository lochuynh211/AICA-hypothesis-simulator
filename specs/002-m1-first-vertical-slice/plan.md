# Implementation Plan: M1 First Runnable Vertical Slice

**Branch**: `002-m1-first-vertical-slice` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-m1-first-vertical-slice/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-27-m1-first-vertical-slice-design.md](../../docs/superpowers/specs/2026-06-27-m1-first-vertical-slice-design.md)

## Summary

Build the first useful AICA review loop on top of M0: load one rule package and
one UC-01 scenario via registries, create a run that freezes a deterministic event
plan, advance a numeric-sim-time tick engine that derives qualitative bands and
evaluates each tick through the one algorithm-adapter contract (`declarative_rule`
→ full §11 `DecisionResult` with an ordinal blend score), record append-only
evidence to `runs/` after every event, and review it all in a close-to-skeleton
3-panel frontend with accept/postpone actions. Backend is the source of truth; the
loop is exercisable backend-only.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv, pinned trusted deps per M0 security
incident); TypeScript 5 on Node 18 host / Node 22 container (frontend, Vite 5).

**Primary Dependencies**: Backend — FastAPI, Pydantic v2 (bundled with FastAPI),
uvicorn. Frontend — React 18, Vite 5. **No new dependencies** (security posture):
frontend run state uses React Context + reducer, not a new state library.

**Storage**: File-based JSON — `packages/` (manifest + README), `scenarios/`
(JSON), `runs/` (append-only evidence logs written by the backend).

**Testing**: pytest + httpx (FastAPI `TestClient`) backend; Vitest + Testing
Library + jsdom frontend.

**Target Platform**: Local single-developer machine via Docker Compose; browser at
`http://localhost:5180`, backend `:8137` (per M0).

**Project Type**: Web application — `app/api` backend + `app/frontend` frontend.

**Performance Goals**: None beyond a responsive local loop. Determinism is the hard
requirement, not latency.

**Constraints**: Deterministic tick engine (fixed sim-time step, position derived
from elapsed time, run bounded by total duration); qualitative ordinal bands reach
the trigger (no raw value drives a decision); append-only evidence persisted after
every event; algorithm failures recorded as `algorithm_error` events, never normal
decisions; one algorithm-adapter contract; no Google Maps; no new deps.

**Scale/Scope**: One rule package, one UC-01 scenario, single user, one decision
point (one rest proposal per run). The full architecture tree (`models/`,
`services/`, `algorithms/`, `storage/`, frontend panels) is largely filled in M1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution v1.0.0. Unlike M0, M1 exercises **every** principle.

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Backend owns registries, tick state, decisions, evidence; frontend renders backend results and computes only display-only animation (FR-016). |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | `evidence_recorder` appends and persists after every event; prior entries never rewritten; evaluation failures → `algorithm_error` events, never normal decisions (FR-011, FR-012). |
| III. Deterministic, Replayable Simulation | ✅ Pass (replay-render deferred) | Event plan frozen at run start; per-tick state computed from the frozen plan; determinism is testable (FR-005, SC-003). Read-only evidence *replay rendering* is M5; M1 satisfies the deterministic-tick + frozen-plan half. |
| IV. Qualitative Trigger Discipline | ✅ Pass | Trigger consumes ordinal bands; `binning` is the single server-side seam where any raw value would be reduced; no raw value drives a decision (FR-017). |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | Single `evaluate(...) → DecisionResult`; `declarative_rule` normalized to the full §11 shape; suppressed candidates preserved; adapter stays generic (FR-006, FR-008). |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | One package/scenario, file-based, no DB/accounts/cloud/queues; no new deps; Maps/feedback/weighted-score/python deferred. |
| Security & Safety Boundaries | ✅ Pass | No external map key in M1; Python/JS are local trusted code; deps pinned (httpx2 incident); nothing untrusted executed. |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (adapter, decision result, registries, persisted log) carry the strongest tests, written first (TDD). |

**Result: PASS — no violations.** Complexity Tracking intentionally empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md,
contracts/, and quickstart.md introduce no DB/accounts/cloud, no new deps, no raw
value into the trigger, and keep the adapter + append-only recorder as the two
boundaries. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-m1-first-vertical-slice/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── packages-scenarios.md   # registry + detail endpoints
│   ├── runs.md                 # create/tick/action/list/get endpoints
│   └── decision-result.md      # the §11 DecisionResult shape (M1 subset populated)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
app/api/aica_api/
├── main.py                      # add routers (health stays from M0)
├── config.py                    # runtime paths for packages/ scenarios/ runs/
├── models/
│   ├── package.py               # PackageManifest, ParameterDef, FeatureDef, HyperparameterDef,
│   │                            #   ProposalDef, TriggerCategoryDef, FireControlRule
│   ├── scenario.py              # ScenarioDef, Persona, RouteIntent, RouteSegment, EventPreset, profiles
│   ├── run.py                   # RunState, EventPlan, TickState, RouteFacts, Snapshot
│   ├── decision.py              # DecisionResult (full §11), Candidate, FireControl, Proposal
│   └── log.py                   # RunLog, TraceEntry, TickEvent, ActionEvent, AlgorithmError
├── services/
│   ├── package_registry.py
│   ├── scenario_registry.py
│   ├── binning.py               # raw→ordinal band seam (near-identity for M1 local scenario)
│   ├── event_plan.py            # freeze EventPlan from scenario presets at run start
│   ├── tick_engine.py           # fixed sim-time step; derive position + bands; build context
│   └── run_manager.py           # create_run / tick / action orchestration
├── algorithms/
│   ├── adapter.py               # one evaluate() contract + normalization + algorithm_error
│   └── declarative_rule.py      # R1–R5 first-match + ordinal blend score
├── storage/
│   ├── file_store.py            # safe atomic JSON read/write
│   └── evidence_recorder.py     # append-only run-log persistence
├── routers/
│   ├── packages.py  scenarios.py  runs.py
└── tests/
    ├── test_package_registry.py  test_scenario_registry.py
    ├── test_declarative_rule.py  test_algorithm_adapter.py
    ├── test_binning.py  test_tick_engine.py  test_event_plan.py
    ├── test_evidence_recorder.py  test_run_manager.py
    └── test_api_run_loop.py      # backend-only end-to-end

packages/rest_rule_based_v0_1/{package.json, README.md}
scenarios/uc01_fatigue_friend_drive_v0_1.json

app/frontend/src/
├── api/{client.ts, types.ts}    # typed client + response types
├── state/runStore.ts            # React Context + reducer (no new dep)
├── components/
│   ├── layout/{AppShell,LeftContextPanel,CenterPlaybackPanel,RightReviewPanel}.tsx
│   ├── setup/{PackageSelector,ScenarioSelector}.tsx
│   ├── context/{RouteSegmentList,LiveReadouts}.tsx
│   ├── playback/{PlaybackControls,RouteTimeline,CockpitView,ProposalPanel}.tsx
│   ├── trace/DecisionTracePanel.tsx
│   └── runs/RunLogViewer.tsx
├── styles/app.css
└── App.tsx                      # compose the 3-panel shell
app/frontend/tests/*.test.tsx
```

**Structure Decision**: Fills the architecture §5 tree for the M1 subset. Backend
adds `models/`, `services/`, `algorithms/`, `storage/`, `routers/`; frontend adds
the panel components + typed client + context store. M0's health endpoint stays
wired (surfaced as a status indicator in the context panel).

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
