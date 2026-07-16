# Implementation Plan: Proposal Screen (3-Panel) & Standalone Run Foundation

**Branch**: `proposal-p1-screen-foundation` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-proposal-p1-screen-foundation/spec.md`; approved design `docs/superpowers/specs/2026-07-16-proposal-p1-screen-foundation-design.md`; approved UI mockup `specs/013-proposal-p1-screen-foundation/ui-mockup.html`.

## Summary

Add a standalone **Proposal Simulator** workflow — a top-level `appMode` sibling to the existing
Trigger Simulator — with a **3-panel screen** (① World/input · ② Service proposal · ③ Content
proposal, each selector panel owning its own editable setup), neutral versioned contracts, a
four-slot proposal package model, **mock** service and content selectors, and a separate persisted
proposal-run namespace. No real ranking, journey engine, or editable world yet: the milestone proves
the boundaries and the screen are cleanly isolated from the Trigger Simulator so later milestones drop
real algorithms behind the same contracts. Backend is the runtime/evidence authority; the frontend is
review-only. All new proposal code stays in the isolated `models/proposal/` namespace and a parallel
registry/run path — the trigger `PackageManifest`/`PackageRegistry`/`run_manager` are untouched.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 18 (frontend).

**Primary Dependencies**: FastAPI + Pydantic v2 (backend); React + Vite + Vitest (frontend). Stdlib-only
persistence (atomic `file_store`). No new runtime dependencies (Constitution: supply-chain caution).

**Storage**: File-based. New `proposal_runs/<run_id>.json` namespace (separate from trigger `runs/`);
frozen matrix artifact `proposal_contracts/matrix/purpose_stage_matrix.v1.json`; mock packages under
`packages/mock_*`. Reuses the frozen P2 dataset (read-only, by version) for content-plan track names.

**Testing**: `pytest` (backend contract/unit/integration incl. `app/api/tests/proposal/`); Vitest
(frontend). Contract surfaces (selector I/O, matrix resolver, run log, registry) carry the strongest
tests per Constitution.

**Target Platform**: Local containerized app (`docker compose up`), single user, offline-capable.

**Project Type**: Web application (FastAPI backend + React frontend), already scaffolded under `app/`.

**Performance Goals**: N/A (local single-user review tool). Screen interactions are display-only; the
backend performs one mock evaluation per selector step.

**Constraints**: Offline; no live LLM/network in any run; JA-default bilingual; proposal state fully
isolated from trigger state; failures surfaced as explicit `algorithm_error` evidence, never faked
results; setup-time-only mutation (params/hyperparameters frozen at run start).

**Scale/Scope**: ~8 new backend model modules, 3 new services, 1 router, 2 mock packages, 1 matrix
artifact; ~8 new frontend components + 1 store + appMode context. No change to existing trigger scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| **I. Backend is source of truth** | PASS | Opportunity resolution, matrix resolution, selector dispatch, and evidence all originate in the backend. The frontend renders results and computes only display state (panel layout, disclosure open/closed, language). |
| **II. Append-only evidence, failures visible** | PASS | `ProposalRunLog` is append-only, persisted via atomic `file_store` after each event. A selector raise/invalid return becomes an `algorithm_error` evidence event via `proposal_selector.py` — never a faked result. |
| **III. Deterministic, replayable** | PASS | Mock outputs are fixed; opportunity carries a `run_seed`. Reopen renders from the stored log **without** recomputing selectors. No live LLM/network in any run. |
| **IV. Qualitative trigger discipline** | PASS (N/A-leaning) | P1 introduces no external-service numerics; world/situation values are reviewer-set inputs. No raw map/geometry enters a decision. |
| **V. One generic adapter contract** | PASS | Mock selectors are `python_module` packages exposing `def evaluate(context: dict) -> dict`; `proposal_selector.py` validates/normalizes into the neutral proposal contracts (parallel to, and consistent with, the trigger adapter's single-contract rule). No new algorithm *type* is introduced. |
| **VI. Local-first simplicity (YAGNI)** | PASS | Smallest vertical slice: mock selectors, file-based proposal runs, one frozen matrix version. No DB, accounts, cloud, or queue. Reuses existing `file_store`. |
| **Security & Safety Boundaries** | PASS | No external keys. Local trusted mock packages. Setup-time-only mutation: params/hyperparameters freeze at run start. Invalid package → visible error, never partially used. |
| **Development Workflow & Quality Gates** | PASS | Spec-Kit cycle followed; contract surfaces tested first (TDD); milestone leaves the app runnable; the frozen matrix artifact and mock manifests are source inputs (not hand-edited generated output). |

**Result: PASS — no violations. Complexity Tracking table not required.**

## Project Structure

### Documentation (this feature)

```text
specs/013-proposal-p1-screen-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (JSON Schemas + endpoint contracts)
├── ui-mockup.html       # Approved UI/UX reference (committed)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
app/api/aica_api/
├── models/proposal/                 # ISOLATED — must not import trigger models
│   ├── opportunity.py               # ProposalOpportunity (+ purpose/stage validator)   [NEW]
│   ├── service_output.py            # ServiceSelectorOutput, RankedCandidate            [NEW]
│   ├── matrix.py                    # PurposeStageServiceMatrix + resolver              [NEW]
│   ├── events.py                    # DiscreteEvent + event-type enum (shape only)      [NEW]
│   ├── journey.py                   # JourneyState (shape only)                         [NEW]
│   ├── evidence.py                  # AlgorithmEvidence                                 [NEW]
│   ├── proposal_run.py              # ProposalRun, ProposalRunLog (append-only)         [NEW]
│   ├── package_manifest.py          # ProposalPackageManifest, ProposalPackageFamilySlot[NEW]
│   ├── enums.py selector_input.py content_output.py …   # P0.5/P6 — reused, unchanged
├── services/
│   ├── proposal_package_registry.py # scans packages/ for proposal families             [NEW]
│   ├── proposal_selector.py         # load algorithm.py → evaluate → validate/normalize  [NEW]
│   └── proposal_run_manager.py      # create/get/list/delete + append-only persistence   [NEW]
├── routers/proposal.py              # /api/proposal/*                                     [NEW]
├── config.py                        # + proposal_runs_dir                                [EDIT additive]
└── main.py                          # + include proposal router                          [EDIT additive]

packages/
├── mock_service_selector_v1/        # package.json (full repr. manifest) + algorithm.py   [NEW]
└── mock_content_selector_v1/        # package.json (mirrors P6 manifest) + algorithm.py    [NEW]

proposal_contracts/matrix/
└── purpose_stage_matrix.v1.json     # frozen versioned artifact (6 rows; post-rest = 5)    [NEW]

app/frontend/src/
├── App.tsx                          # wrap in AppModeProvider + top toggle                [EDIT additive]
├── state/
│   ├── appMode.tsx                  # 'trigger' | 'proposal' context                       [NEW]
│   └── proposalStore.ts             # isolated store (JA default)                          [NEW]
├── api/proposalClient.ts            # proposal endpoints                                   [NEW]
└── components/proposal/
    ├── ProposalShell.tsx            # toggle + sub-nav [Screen | Runs]                     [NEW]
    ├── ProposalScreen.tsx           # 3-column 16/42/42 layout                             [NEW]
    ├── ProposalRunsScreen.tsx       # list / reopen / delete                              [NEW]
    ├── ProvenanceBadge.tsx  ReasonBreakdown.tsx  HyperparamMatrix.tsx                     [NEW]
    └── panels/{WorldPanel,ServiceProposalPanel,ContentProposalPanel}.tsx                  [NEW]

app/api/tests/proposal/…  app/frontend/src/**/__tests__/…    # new tests per layer          [NEW]
```

**Structure Decision**: Existing **web application** layout (`app/api` + `app/frontend`). P1 extends it
additively: all new backend contracts live in the isolated `models/proposal/` subpackage with parallel
services/router; the frontend gains a top-level `appMode` and an isolated proposal store + components.
The trigger backend and frontend are not modified except three additive edits (`config.py`, `main.py`,
`App.tsx`).

## Complexity Tracking

> Not required — Constitution Check passed with no violations.
