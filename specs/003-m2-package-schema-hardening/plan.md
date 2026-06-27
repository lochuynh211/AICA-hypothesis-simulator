# Implementation Plan: M2 Package & Schema Hardening

**Branch**: `003-m2-package-schema-hardening` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-m2-package-schema-hardening/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-27-m2-package-schema-hardening-design.md](../../docs/superpowers/specs/2026-06-27-m2-package-schema-hardening-design.md)

## Summary

On top of M1's loop, M2 adds: a deterministic driver/vehicle behavioral engine
(profile rate-models → per-tick `raw_state`; `binning` → `feature_groups`),
replacing M1's authored drowsiness schedule and fraction-position; a second
`weighted_score` algorithm + package (multi-category scores → strength → priority →
selected, populating the §11 fields M1 left empty); the architecture's
`routes/analyze → run-plans(+regenerate) → runs{plan_id}` setup flow with editable
parameters/hyperparameters and original/modified persistence; a second UC-01
overtime scenario with a `decline` action; `package_runtime_state` tick-to-tick
pass-through (empty for M2 built-ins); localized `{ja,en}` messages/explanations;
and complete per-tick evidence (`raw_state`, `feature_groups`, driver/vehicle
updates). Backend is the source of truth; both pairings run from UI and API.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv, pinned trusted deps); TypeScript 5
on Node 18 host / Node 22 container (frontend, Vite 5).

**Primary Dependencies**: FastAPI, Pydantic v2, uvicorn (backend); React 18, Vite 5
(frontend). **No new dependencies** (M0 supply-chain discipline); frontend setup
state extends the existing React Context + reducer.

**Storage**: File-based JSON — `packages/`, `scenarios/`, `runs/`. Two packages,
two scenarios now.

**Testing**: pytest + httpx (backend); Vitest + Testing Library + jsdom (frontend).

**Target Platform**: Local single-developer Docker Compose; browser :5180, api :8137.

**Project Type**: Web application — `app/api` + `app/frontend`.

**Performance Goals**: None beyond a responsive local loop. Determinism is the hard
requirement.

**Constraints**: Deterministic behavioral engine (additive rate model; same
profile+plan → identical progression); the evaluation context exposes numeric
`raw_state` + `feature_groups`; `binning` is the external-service boundary (no Maps
yet); append-only evidence with per-tick `raw_state`/`feature_groups`/updates +
`package_runtime_state`; one adapter contract; `plan_id`-only run creation;
`standard` run mode only; no new deps.

**Scale/Scope**: Two packages × two scenarios; single user. Large milestone built
as six independent slices (ADR §9).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution v1.0.0.

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Engine, scores, plan, evidence all backend; frontend renders + edits setup pre-run only. |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | Recorder unchanged + richer per-tick evidence; algorithm errors stay `algorithm_error` events. |
| III. Deterministic, Replayable | ✅ Pass | Behavioral engine + draft-plan generation pure; ids/timestamps at the router boundary; frozen plan; determinism tested (FR-005/SC-005). |
| IV. Qualitative Trigger Discipline | ✅ Pass (refined) | Invariant is *external-service* numerics — none exist until M4 (Maps data will be bounded into route facts at ingestion). Simulator-internal `raw_state` reaches weighted/hybrid algorithms; `binning` provides ordinal `feature_groups` for rule packages. Logs persist `raw_state` + bounded route facts, not raw external detail. |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | `weighted_score` dispatched through the same `evaluate(..., package_runtime_state) → DecisionResult`; normalized; suppressed retained; runtime-state threaded tick-to-tick. |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | Two packages/scenarios, file-based, no DB/cloud/queues; no new deps; Maps/Python/feedback/expert-override deferred. |
| Security & Safety Boundaries | ✅ Pass | No external map key (M4); local trusted code; deps pinned; nothing untrusted executed. |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (engine determinism, weighted_score, adapter, run-plan, persisted log) tested first (TDD). |

**Result: PASS — no violations.** Complexity Tracking empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md,
contracts/, quickstart.md introduce no DB/cloud, no new deps, no raw external-service
numeric into the trigger, keep the adapter + append-only recorder as the boundaries,
and thread `package_runtime_state` without populating it. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-m2-package-schema-hardening/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── setup-flow.md          # routes/analyze, run-plans(+regenerate), migrated runs
│   ├── weighted-score.md      # multi-category DecisionResult population
│   └── behavioral-engine.md   # raw_state + feature_groups context shape
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

New/changed on top of M1:

```text
app/api/aica_api/
├── models/
│   ├── profile.py             # NEW DriverModelProfile, VehicleBehaviorProfile, SpeedProfile
│   ├── scenario.py            # extend: profiles, presets, is_night; drop drowsiness_schedule
│   ├── run.py                 # extend: RouteFacts (full), EventPlan (traffic/weather/rest_ops),
│   │                          #   raw_state per TickState, package_runtime_state, RunPlanDraft
│   ├── decision.py            # localized explanation; (scores/states/candidates already present)
│   ├── package.py             # localized ProposalDef.message (present); weighted_score algo type
│   └── log.py                 # extend: raw_state, feature_groups, driver/vehicle updates,
│                              #   package_runtime_state, original/modified values
├── services/
│   ├── behavior/              # NEW driver_model.py, vehicle_model.py
│   ├── binning.py             # extend: raw_state -> feature_groups (normalized + ordinal)
│   ├── route_analysis.py      # NEW local route facts from scenario
│   ├── run_plan.py            # NEW draft-plan generate/regenerate + in-memory draft registry
│   ├── event_plan.py          # extend: build from route facts + presets (traffic/weather/rest)
│   ├── tick_engine.py         # MIGRATE: profile-driven state, speed-driven position, raw_state
│   └── run_manager.py         # MIGRATE: create from plan_id; thread package_runtime_state
├── algorithms/
│   ├── adapter.py             # add weighted_score dispatch
│   ├── weighted_score.py      # NEW category scores/candidates/priority
│   └── declarative_rule.py    # consume feature_groups from the new context (minor)
├── routers/{routes.py(new), run_plans.py(new), runs.py(migrate)}
└── tests/ (per slice)

packages/rest_weighted_score_v0_1/{package.json, README.md}   # NEW
packages/rest_rule_based_v0_1/package.json                    # extend (localized, profiles compat)
scenarios/uc01_fatigue_friend_drive_v0_1.json                 # RE-AUTHOR to profiles
scenarios/uc01_overtime_driver_v0_1.json                      # NEW

app/frontend/src/
├── api/{client.ts, types.ts}  # add routes/run-plans endpoints + profile/plan types
├── state/runStore.ts          # extend: setup-draft state (plan_id, draft, edited values, errors)
├── components/setup/{PackageSelector,ScenarioSelector (multi),
│                     ParameterEditor,HyperparameterEditor,PlanPreview}.tsx
└── components/playback/ProposalPanel.tsx  # add decline action
```

**Structure Decision**: extends the M1 tree; the tick engine + run manager + the
friend-drive fixture are **migrated**, not duplicated (single behavioral model).

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
