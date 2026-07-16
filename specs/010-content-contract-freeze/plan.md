# Implementation Plan: P0.5 — Content Contract & Song-Schema Freeze

**Branch**: `proposal-p0.5-content-schema-freeze` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-content-contract-freeze/spec.md`

## Summary

Freeze the versioned proposal **content-selector** contracts as backend-owned Pydantic models, export them as language-neutral JSON-Schema, and add a machine-readable feature-disposition registry plus hand-authored, algorithm-blind fixtures — so the content package (P6) can be built and tested in isolation and the dataset generator (P2) has a validation target. No ranking logic, no screen, no runtime endpoint, no network/LLM. Approach: contracts live in an isolated `aica_api/models/proposal/` subpackage (packages stay dict-based per the adapter convention); frozen artifacts (schema + registry + fixtures) live in a repo-root `proposal_contracts/` directory resolvable by path. Cross-document §17 items touching the content contract are already reconciled in the master docs (commit `4b7fe5a`).

## Technical Context

**Language/Version**: Python 3.12 (backend, `app/api/`).

**Primary Dependencies**: Pydantic v2 (already present transitively via FastAPI 0.115.6 — `model_validator`, field constraints, `model_json_schema()`). **No new runtime dependencies.**

**Storage**: File-based only — repo-root `proposal_contracts/` holds committed JSON-Schema, the serialized disposition registry, and JSON fixtures. No database.

**Testing**: pytest. Canonical gate `docker compose exec api uv run pytest`; documented deterministic fallback is the local Anaconda Python 3.12.7 environment (pydantic 2.8.2 / pytest 7.4.4) which runs the existing suite green — used because Docker/`uv`-install are unreachable in the current shell. All Pydantic features used are stable across 2.8↔2.13.

**Target Platform**: Local containerized single-user backend.

**Project Type**: Web app (backend + frontend), but this milestone is **backend-only** — no frontend, i18n, or endpoint changes.

**Performance Goals**: N/A (pure contract validation; the new test suite runs sub-second).

**Constraints**: Deterministic; synthetic-only (`synthetic-` IDs, `.invalid` links); no live network/LLM; the proposal contract subpackage MUST NOT import or be imported by trigger models (isolation); frozen artifacts consumable without importing the backend.

**Scale/Scope**: ~50 §9/Appendix A.2 content feature rows; ~4 contract areas (input, content output, song schema, genre extension); ~12–16 song fixtures + a handful of world snapshots; ~7 new test modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| I. Backend is source of truth | Contracts are backend-owned Pydantic; no frontend/decision logic added; frozen artifacts are the backend's validation boundary. | PASS |
| II. Evidence append-only; failures never hidden | No run/evidence produced here, but the frozen content-output contract preserves typed error/decision categories and keeps excluded/unused/missing features visible (never dropped) — encoding the "failures are events, nothing silently dropped" discipline into the shape. | PASS |
| III. Deterministic, replayable | Contracts and schema export are deterministic; a drift-guard test pins committed artifacts to a fresh export; no runtime recomputation. | PASS |
| IV. Qualitative trigger discipline | Not a trigger feature. Song schema stores raw Spotify numerics that are only *decision-time* trait inputs (never persisted as scored traits, never drive a trigger); binning of world features is a later-milestone concern. | PASS (N/A) |
| V. One generic adapter contract | Reinforces it: proposal packages remain `evaluate(dict)->dict`; models are the backend normalization boundary; suppressed/excluded candidates remain represented (`excluded_items`, `unused_available_features`). | PASS |
| VI. Local-first simplicity (YAGNI) | No new deps, no DB, file-based artifacts, smallest slice (contracts only; service output deferred to P1). | PASS |
| Security & Safety boundaries | No external keys; local trusted code; no setup-time mutation surface introduced; typed errors instead of silent failure; synthetic-only, `.invalid` links, zero network. | PASS |
| Workflow & quality gates | SDD cycle followed; this milestone *is* a contract surface → strong contract tests are the deliverable; existing app stays runnable/untouched; schema/registry artifacts are generated-and-drift-guarded, never hand-edited. | PASS |

**Result:** No violations. Complexity Tracking table intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-content-contract-freeze/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (contract descriptions + exported schema references)
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
app/api/aica_api/models/proposal/          # NEW — isolated proposal contract subpackage
├── __init__.py                            # re-exports; CONTRACT_VERSION, SCHEMA_VERSION
├── enums.py                               # TriggerPurpose, LifecycleStage, ServiceId, RestSpotType,
│                                          #   ContentDecisionType/ContentErrorCode, FeatureDisposition,
│                                          #   FeatureOriginProvenance, ResponseCoefficientProvenance,
│                                          #   GenreLiteral, UsageLevel
├── selector_input.py                      # SelectorInput, FeatureProvenanceEntry, CandidateRef, ExcludedCandidate
├── content_output.py                      # CompletePlan, OrderedItem, ItemFeatureContribution,
│                                          #   SongTraitValues, PlanMode, LightingConfiguration, ExcludedItem
├── song_schema.py                         # SpotifyTrack (+sub-objects), SpotifyAudioFeatures, SimulationFlags, Song
├── genre_extension.py                     # GenreAffinityV1, GENRE_VOCABULARY
├── dispositions.py                        # feature-disposition registry (single source of truth)
└── export_schema.py                       # `python -m aica_api.models.proposal.export_schema`

app/api/aica_api/config.py                 # EDIT — add AICA_PROPOSAL_CONTRACTS_DIR default

proposal_contracts/                        # NEW — repo-root frozen artifacts (peer of packages/, scenarios/)
├── README.md
├── schema/
│   ├── selector_input.schema.json
│   ├── content_output.schema.json
│   ├── song.schema.json
│   └── genre_affinity_v1.schema.json
├── dispositions/
│   └── content_feature_dispositions.v1.json
└── fixtures/
    ├── songs/ { smoke/, pairs/, karaoke/ }
    ├── worlds/
    └── negative/

app/api/tests/proposal/                    # NEW — contract tests
├── __init__.py
├── conftest.py                            # fixture-loading helpers (resolve proposal_contracts/ by path)
├── test_selector_input_contract.py
├── test_content_output_contract.py
├── test_song_schema.py
├── test_genre_extension.py
├── test_dispositions.py
├── test_schema_export.py
└── test_docs_naming_consistency.py
```

**Structure Decision**: Backend Pydantic contracts in a new isolated `app/api/aica_api/models/proposal/` subpackage (the top-level `models/__init__.py` is not touched — proposal contracts import via `aica_api.models.proposal`, keeping proposal and trigger namespaces separate per the separation invariant and Principle V). Frozen, language-neutral artifacts (JSON-Schema, serialized registry, fixtures) live in a repo-root `proposal_contracts/` directory, mirroring how `packages/`, `scenarios/`, and `runs/` are organized, so P6 packages and the P2 generator resolve them by path without importing the backend. Tests live under `app/api/tests/proposal/`.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
