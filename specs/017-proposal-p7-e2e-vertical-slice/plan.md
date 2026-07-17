# Implementation Plan: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

**Branch**: `proposal-p7-e2e-vertical-slice` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-proposal-p7-e2e-vertical-slice/spec.md`; approved design `docs/superpowers/specs/2026-07-17-proposal-p7-e2e-vertical-slice-design.md`.

## Summary

Wire the real transparent service (P5) and content (P6) selectors through the P4 journey engine across the three rest lifecycle stages on the standalone 4-panel proposal screen, driven from the built-in `seed-night-highway-oshi` seed. The one genuinely new capability is **same-run recompute**: a new `POST /api/proposal/runs/{run_id}/recompute` endpoint that applies explicit `context_overrides` (P3 `FieldOverride`) to the run's persisted base typed `World` (using the current journey lifecycle stage + motion), re-validates + re-projects the feature snapshot, re-resolves the matrix, re-runs eligibility + the service selector, and appends a fresh `ProposalOpportunity` + `SetupSnapshot` + service `AlgorithmEvidence` to the same run log (append-only history + current head). A per-run `quick_check` mode auto-selects the rank-1 service and its content on create and recompute; `interactive` stops at `service_selected`. All decisions stay advisory; the journey engine stays pure (recompute lives in the router); the trigger simulator is untouched.

## Technical Context

**Language/Version**: Python 3.12 (backend, FastAPI + Pydantic v2), TypeScript 5 / React 18 + Vite (frontend).

**Primary Dependencies**: FastAPI, Pydantic v2, `uv` (backend); React, Vitest, @testing-library/react (frontend). No new third-party dependencies (Constitution VI / Security; supply-chain discipline).

**Storage**: File-based. Proposal runs persist to `proposal_runs/<run_id>.json`; frozen datasets/matrix/service-capabilities/seeds under `proposal_contracts/`. No database.

**Testing**: `uv run pytest` (backend, 2061 passing baseline), `npm run test` (Vitest, frontend). Contract/integration tests are mandatory for algorithm/evidence/persisted surfaces.

**Target Platform**: Local containerized web app (`docker compose up`), single-user.

**Project Type**: Web application (FastAPI backend authority + React review frontend).

**Performance Goals**: Interactive review latency (no hard target); deterministic replay is the hard requirement, not throughput.

**Constraints**: Backend is the sole source of truth (Constitution I); append-only evidence, failures visible (II); deterministic replay from frozen dataset (III); one adapter contract (V); proposal state isolated from trigger state; JA-default bilingual UI; no live model/network in a transparent run; `htmlapp/` not synced.

**Scale/Scope**: One new backend endpoint + ~4 additive model fields + 2 enum members + a router-level orchestrator + a shared content-dispatch helper extraction; ~5 frontend touch-points (client fn, store actions, mode toggle, recompute control, timeline extension). One built-in demonstration seed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Backend is source of truth | Recompute, mode auto-selection, snapshot freezing all run in the backend; the frontend only POSTs overrides/mode and renders the returned log. No decision computed in the view. | PASS |
| II. Evidence append-only, failures visible | Recompute appends (never rewrites) opportunity/snapshot history + evidence + events; algorithm failures become `ALGORITHM_ERROR` events on the new decision point, never disguised as proposals. | PASS |
| III. Deterministic replay | Recompute against the frozen dataset with identical overrides → byte-identical snapshot + ranking; reopen renders history without recomputation; no live model/network. | PASS |
| IV. Qualitative trigger discipline | No raw external-service numeric enters a decision; recompute overrides are reviewer-set world features already binned by the P3 world/validation layer. | PASS |
| V. One generic adapter contract | Recompute reuses the existing `dispatch_selector(...) → AlgorithmEvidence` path unchanged for both service and content; no new adapter type. | PASS |
| VI. Local-first simplicity (YAGNI) | Additive fields on an existing model, one endpoint, one helper extraction; no new service/DB/dependency; smallest slice that completes the journey. | PASS |
| Security: setup-time mutation only | Recompute is a **new opportunity** (a fresh setup), not a mid-run mutation of a frozen one — each recompute freezes its own snapshot; parameters/hyperparameters remain setup-time-frozen per decision point. | PASS |
| Isolation (proposal ≠ trigger) | No `aica_api.models`/`aica_api.algorithms` (trigger) import added to the proposal path; journey engine stays pure (recompute in the router). Full trigger suite is a regression gate. | PASS |

No violations. Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/017-proposal-p7-e2e-vertical-slice/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── recompute-api.md # Phase 1 output — recompute + quick-check endpoint contract
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
app/api/aica_api/
├── models/proposal/
│   ├── proposal_run.py        # + world, opportunity_history, setup_snapshot_history, mode
│   ├── enums.py               # + DiscreteEventType.RECOMPUTED, CONTEXT_EDITED; ProposalRunMode
│   └── recompute.py           # [new] RecomputeRequest body model (overrides: list[FieldOverride])
├── services/
│   └── proposal_run_manager.py    # create_run(world, mode); update_state(opportunity + history append)
└── routers/
    └── proposal.py            # + POST /runs/{id}/recompute; + _dispatch_content_for_service helper; quick-check on create + recompute

app/api/tests/proposal/
├── test_p7_recompute.py              # recompute contract/determinism/snapshot-boundary/invalid/legacy/playback-precondition/post-rest-change
├── test_p7_quick_check.py            # mode parity + auto content + no-probabilistic
├── test_p7_advisory_safety.py        # reject-all-after-recompute + preview-not-committed
└── test_p7_e2e_reference_journey.py  # full reference journey (AC-1)

app/frontend/src/
├── api/proposalClient.ts      # + recompute(runId, overrides)
├── state/proposalStore.ts     # + RECOMPUTED / MODE_SET actions; mode in state
└── components/proposal/
    ├── panels/ServiceProposalPanel.tsx / ContentProposalPanel.tsx  # lifecycle/motion/allowed-service + recompute control
    ├── RecomputePanel.tsx     # [new] post-rest context-edit + recompute control
    ├── EventTimeline.tsx      # + RECOMPUTED / CONTEXT_EDITED + multi-opportunity sequence
    └── ModeToggle.tsx         # [new] interactive / quick_check toggle (Panel ②)

app/frontend/tests/
├── proposal_recompute_panel.test.tsx
├── proposal_mode_toggle.test.tsx
└── proposal_timeline_recompute.test.tsx
```

**Structure Decision**: Web-application layout (existing). P7 extends the established `models/proposal` + `services` + `routers/proposal.py` backend seam and the `components/proposal` frontend seam. No new top-level project. `htmlapp/` untouched (proposal path is FastAPI/React only).

## Phase 0 / Phase 1 outputs

- Phase 0 research: [research.md](./research.md) — resolves recompute-orchestration placement, override application, history-append persistence, quick-check content dispatch, and post-rest feature flow. No open `NEEDS CLARIFICATION`.
- Phase 1 design: [data-model.md](./data-model.md), [contracts/recompute-api.md](./contracts/recompute-api.md), [quickstart.md](./quickstart.md).

## Complexity Tracking

No constitutional violations; table intentionally omitted.
