# Implementation Plan: Eligibility And Discrete Journey Engine (P4)

**Branch**: `proposal-p4-eligibility-journey-engine` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-proposal-p4-eligibility-journey/spec.md`; approved design `docs/superpowers/specs/2026-07-16-proposal-p4-eligibility-journey-design.md`.

## Summary

Add the orchestration layer around the (still-mock) proposal selectors: a deterministic **eligibility resolver** that narrows the purpose/stage-allowed service set by vehicle motion and platform capability *before* ranking — producing score-free, reason-coded eligible/excluded lists from a new **frozen versioned service-capability contract** — and a **pure discrete journey engine** that lets a reviewer act on a proposal (accept / reject / postpone / choose-another / request-more / stop / continue / complete) and drive a mocked accepted plan through start → completion → continuation → restoration, plus deterministic motion-change (with `background_on_motion` semantics) and rest-stage transitions. Everything is recorded in the append-only proposal run log and replays without recomputation. A minimal bilingual (JA-default) run-area surface exposes the eligible/excluded lists, action controls, journey state, and event timeline. Ranking logic itself remains out of scope (P5/P6).

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 18 + Vite (frontend).

**Primary Dependencies**: FastAPI + Pydantic v2 (backend); existing proposal namespace (`aica_api.models.proposal`, `aica_api.services`, `routers/proposal.py`); React + Vitest + existing `proposalClient.ts`/`proposalStore.ts`. No new dependency.

**Storage**: File-based JSON — `proposal_runs/<run_id>.json` (append-only run log) and `proposal_contracts/service_capabilities/service_capabilities.v1.json` (new frozen artifact). Never touches trigger `runs/`.

**Testing**: pytest (`app/api/tests/proposal/`), Vitest (`app/frontend`).

**Target Platform**: Local containerized web app (`docker compose up`).

**Project Type**: Web application (backend authority + React review frontend).

**Performance Goals**: Interactive local single-user; each action/eligibility call is a pure in-memory computation over ≤14 services + a bounded event log — sub-100ms, not a scaling concern.

**Constraints**: Deterministic (identical inputs → identical eligibility + transitions); append-only evidence; no recompute on replay; failures surface as `ALGORITHM_ERROR` events; pure engines take no clock/random (router mints ids/timestamps); full isolation from the trigger simulator.

**Scale/Scope**: 14 `ServiceId`s; 6 purpose/stage matrix rows; ~12 journey action types; ~9 new discrete-event kinds. One new frozen artifact, ~4 new backend modules, extensions to `routers/proposal.py` + `journey.py`/`enums.py`, and a minimal run-area UI addition.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How P4 satisfies it |
|---|---|---|
| I. Backend is source of truth | ✅ PASS | Eligibility + all journey transitions computed and persisted by the backend; the frontend run-area is display-only (renders eligible/excluded lists, events, journey state) and feeds no decision back. |
| II. Append-only, failures never hidden | ✅ PASS | Every eligibility decision, action, and transition appends to the run log via `proposal_run_manager`; selector/engine failures become `ALGORITHM_ERROR` events, never disguised as normal proposals/transitions. |
| III. Deterministic, replayable | ✅ PASS | Pure eligibility resolver + pure journey engine are deterministic; reopen/replay renders from the log without recomputing selectors and collects no new actions; preview is a non-persisting projection. |
| IV. Qualitative trigger discipline | ✅ N/A (preserved) | P4 adds no numeric route→trigger path; motion/capability are ordinal/boolean platform facts, not binned quantities. No regression to trigger binning. |
| V. One generic algorithm adapter | ✅ PASS | Selectors still run through the existing `dispatch_selector` adapter; eligibility is an orchestration step *outside* the adapter that narrows candidates. Excluded candidates remain in the record as excluded (never dropped) — exactly the "suppressed candidates remain" rule. |
| VI. Local-first simplicity (YAGNI) | ✅ PASS | Smallest slice: file-based frozen capability artifact + pure functions + additive endpoints; no DB/queue/account/tick-engine. Ranked during-rest actions and the full seeded rest slice are deferred to P7. |
| Security & safety boundaries | ✅ PASS | No external key; local trusted code; setup-time mutation discipline unaffected (journey actions are runtime events on an existing run, not parameter edits); persistence failures surface. |

**Result: PASS — no violations, Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/015-proposal-p4-eligibility-journey/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API + artifact contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
proposal_contracts/
└── service_capabilities/
    └── service_capabilities.v1.json          # NEW frozen versioned artifact (14 services)

app/api/aica_api/
├── models/proposal/
│   ├── enums.py                              # EXTEND: JourneyActionType, PlaybackState,
│   │                                         #   new DiscreteEventType + ProposalRunStatus members
│   ├── service_capabilities.py               # NEW: ServiceCapability / ServiceCapabilities loader
│   ├── eligibility.py                        # NEW: EligibilityExclusion, EligibilityResult
│   └── journey.py                            # EXTEND: playback_state, previous_content,
│                                             #   current_plan_ref, rejected_service_ids
├── services/
│   ├── proposal_eligibility.py               # NEW: pure resolve_eligibility(...)
│   ├── proposal_journey.py                   # NEW: pure apply_action(run_log, action)
│   └── proposal_journey_preview.py           # NEW: pure preview(run_log)
└── routers/
    └── proposal.py                           # EXTEND: wire eligibility into STEP-1;
                                              #   POST /runs/{id}/journey/action; GET /runs/{id}/journey/preview

app/api/tests/proposal/                       # NEW test modules (see quickstart/tasks)

app/frontend/src/
├── api/proposalClient.ts                     # EXTEND: journey action + preview calls
├── state/proposalStore.ts                    # EXTEND: journey state/actions
└── components/proposal/
    ├── panels/ServiceProposalPanel.tsx       # EXTEND: eligible/excluded(reason) lists
    └── (new) JourneyActionBar.tsx,           # NEW: action buttons + event timeline
        EventTimeline.tsx
```

**Structure Decision**: Web application (Option 2). All backend work lands in the existing isolated `aica_api.models.proposal` / `aica_api.services` / `routers/proposal.py` seam (never `aica_api.models` trigger or `aica_api.algorithms`). The new frozen artifact sits beside the existing `matrix/` and `dispositions/` contracts. Frontend changes are confined to the proposal component tree.

## Complexity Tracking

> No Constitution Check violations — this section intentionally empty.
