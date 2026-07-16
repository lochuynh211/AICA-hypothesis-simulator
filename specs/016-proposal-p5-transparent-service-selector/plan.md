# Implementation Plan: P5 — Transparent Service-Selector Package

**Branch**: `proposal-p5-transparent-service-selector` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-proposal-p5-transparent-service-selector/spec.md`

## Summary

Replace the fixed mock service selector with the first **real transparent
service-selector `python_module` package** (`aica_transparent_service_selector_v1`)
implementing the authoritative expert scorecard in
`docs/master/aica_transparent_service_proposal_algorithm.md`. The package ranks
eligible service candidates via the §3–§6 symbol chain
(`xᵢ → eᵢ → aᵢ → rᵢ → wᵢ → kᵢ → service_fit ∈ [−1,+1]`), records the full §14
per-feature explainability trace + dominance readout, and is fully editable
through externalized parameters/hyperparameters. The neutral
`ServiceSelectorOutput`/`RankedCandidate`/`FeatureContribution` contracts are
**extended with optional fields** so the mock still validates; Panel ③ is
enriched to render the real trace bilingually (JA default). A confidence-shrinkage
option (opt-in package **hyperparameter**, off by default — clarify 2026-07-16)
weakens sparse acceptance/recovery evidence without disturbing the frozen
baseline. Backend router wiring (`create_proposal_run`, `select_service`,
`dispatch_selector`) is reused unchanged — only which package the run selects
differs. No trigger-model coupling; no htmlapp sync.

## Technical Context

**Language/Version**: Python 3.12 (backend + package `algorithm.py`), TypeScript 5 / React 18 / Vite (frontend).

**Primary Dependencies**: FastAPI + Pydantic v2 (backend, existing); the package is pure stdlib (`math` only) — no `aica_api` imports, no third-party. Frontend: existing proposal client + i18n `t()`. **No new dependencies** (supply-chain invariant).

**Storage**: File-based — package under `packages/aica_transparent_service_selector_v1/`; run evidence appended to `proposal_runs/` (existing `ProposalRunLog`); test fixtures under `proposal_contracts/fixtures/` and the spec's `contracts/`.

**Testing**: `pytest` (backend + package math/features/response-matrix/eligibility/dominance/determinism/contrast); Vitest (frontend Panel ③ rendering). Run via `uv run python -m pytest` in `app/api`; `npm test` in `app/frontend`.

**Target Platform**: Local containerized single-user tool (`docker compose up`), Linux.

**Project Type**: Web application (FastAPI backend + React frontend) + file-based `python_module` package.

**Performance Goals**: Deterministic single-shot evaluation over ≤6 candidates × 17 features — sub-millisecond; no throughput target. Determinism/replay is the hard requirement (1e-12 cross-runtime, byte-equal same-runtime), not speed.

**Constraints**: Purity (no I/O/clock/randomness in `algorithm.py`); every hyperparameter read by direct index (missing key → `invalid_configuration`); isolation from trigger models; the §10 worked example (`+0.772349`) and §6.2/§6.4 tables are frozen goldens the default config must reproduce.

**Scale/Scope**: One new package (~600–800 LOC single file), contract extensions (~10 optional fields + subtotals/dominance objects), ~1 frontend panel enrichment, ~40–60 new tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Backend Is The Source Of Truth** | PASS | `service_fit`, ranking, evidence originate in the backend package/`dispatch_selector`; Panel ③ only renders. Frontend computes no decision. |
| **II. Evidence Append-Only, Failures Never Hidden** | PASS | Reuses `AlgorithmEvidence`: any exception/invalid/out-of-allowed-set return → `error` set, `output=None`, an `ALGORITHM_ERROR` event — never a fabricated ranking. Evidence separates facts from review. |
| **III. Deterministic, Replayable Simulation** | PASS | Selector is deterministic + stateless (`uncertainty=null`, `next_package_runtime_state={}`); identical inputs+versions reproduce identical output (1e-12); no live model/network call. The proposal run is discrete-event (no tick pre-generation concern). |
| **IV. Qualitative Trigger Discipline** | PASS (N/A-direct) | Service scoring reads already-binned world features; drowsiness/fatigue/monotony are 0–100 simulated inputs normalized to evidence, not raw external-service numerics. No raw map geometry enters scoring. |
| **V. One Generic Algorithm Adapter Contract** | PASS | `python_module` only; `evaluate(context)->dict` normalized by `dispatch_selector` into `ServiceSelectorOutput`. Suppressed/excluded candidates retained. Adapter stays generic — algorithm specifics live in the package. |
| **VI. Local-First Simplicity (YAGNI)** | PASS | File-based package; no accounts/db/cloud. Smallest slice that ships a real ranking; mock retained as fixture, not a parallel platform. |
| **Security & Safety Boundaries** | PASS | Local trusted Python (no sandbox needed, existing posture). No external keys. Setup-time-only mutation (config editable pre-run; new run to change). Invalid config blocks with visible error. |
| **Development Workflow & Quality Gates** | PASS | Spec→plan→tasks→implement with TDD; contract/evidence surfaces get contract+integration tests (stronger than UI). Milestone stays runnable. Generated artifacts (matrix, capabilities, dataset) untouched. |

**Result: PASS — no violations, Complexity Tracking not required.** The confidence-shrinkage extension is the one addition beyond the authoritative baseline; it is reconciled in the master docs (§17 + algorithm §5.4/§5.6/§19) as an opt-in, off-by-default hyperparameter whose off-state reproduces the frozen baseline — no principle is bent.

## Project Structure

### Documentation (this feature)

```text
specs/016-proposal-p5-transparent-service-selector/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── evaluate_contract.md          # package evaluate() I/O contract
│   └── service_output_extension.md   # optional §14 contract-field additions
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
└── aica_transparent_service_selector_v1/        # NEW — the real package
    ├── package.json      # externalized weights/multipliers/response matrices/maps/thresholds + confidence_shrinkage_v1 hp
    ├── algorithm.py      # pure evaluate(context)->dict; §15 components as functions
    └── README.md         # package summary + provenance pointers

app/api/aica_api/models/proposal/
└── service_output.py     # EXTEND: optional §14 fields on FeatureContribution/RankedCandidate + dominance/subtotal objects

app/api/aica_api/routers/
└── proposal.py           # (mostly unchanged) confirm _build_service_context carries all A.1 fields; no dispatch wiring change

app/api/tests/proposal/
├── test_p5_service_math.py          # symbol chain, weights sum, worked example +0.772349, dominance property
├── test_p5_response_matrix.py       # §5.2 driving/road/during-rest/post-rest cells + provenance
├── test_p5_features.py              # normalization, boundaries, γ, ordinal maps, scene means, oshi invalid
├── test_p5_eligibility_ranking.py   # allowed-set only, tie-break, no_proposal, low/neg still ranked
├── test_p5_confidence_shrinkage.py  # off==baseline firewall; on shrinks sparse rates
├── test_p5_contract_extension.py    # mock still validates; optional fields populated by real pkg
├── test_p5_determinism.py           # identical inputs → identical output; canonical replay
└── test_p5_contrast_golden.py       # §11 13 one-field contrasts on frozen fixture worlds

app/frontend/src/
├── api/proposalClient.ts            # EXTEND TS types with optional §14 fields
├── components/proposal/ServiceProposalPanel*.tsx  # enrich Panel ③ real trace (score/subtotals/dominance/per-feature table)
└── (tests) *.test.tsx               # Panel ③ rendering of the enriched trace

proposal_contracts/fixtures/service/  # NEW — frozen contrast fixture worlds (13 one-field pairs + worked example)
```

**Structure Decision**: Web application (existing `app/api` + `app/frontend`) plus a file-based `python_module` package under `packages/`. The package mirrors the P6 real-content-selector layout exactly (single-file pure `algorithm.py` + fully-externalized `package.json`). Backend changes are confined to an **additive** extension of `service_output.py`; the router dispatch path is reused unchanged. Frontend changes are confined to the service-proposal panel + its client types. No trigger (`app/api/aica_api/models`, `htmlapp/`) files are touched.

## Complexity Tracking

*No Constitution Check violations — this section intentionally empty.*
