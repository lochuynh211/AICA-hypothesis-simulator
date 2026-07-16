# Implementation Plan: Transparent Music Content-Selector Package (P6)

**Branch**: `proposal-p6-content-selector` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-p6-content-selector/spec.md`

## Summary

Build a standalone `python_module` package `packages/aica_transparent_content_selector_v1/`
(single `algorithm.py` + `package.json` + `README.md`) whose pure `evaluate(context) -> dict`
consumes the frozen P0.5 `SelectorInput` and returns the frozen `CompletePlan` (no aggregate
plan score). It ranks concrete songs for `music_playlist`, `humming_karaoke`, and
`full_karaoke` with the two-axis (arousal/valence) trait model in
`docs/master/aica_transparent_content_proposal_algorithm.md`. All algorithm tables are
externalized as structured `package.json` hyperparameters; driver/environment evidence is
numeric 0–100 (`/100`); the package never performs file/network I/O. Validated on
hand-authored, algorithm-blind fixtures; golden replay against the real 36-song catalog
defers to P2.

## Technical Context

**Language/Version**: Python 3.12 (container `uv`; local fallback Anaconda 3.12.7)

**Primary Dependencies**: Standard library only inside the package (pure, deterministic — no
`aica_api`, no third-party). Tests use `pytest` + the frozen `aica_api.models.proposal`
Pydantic models and `proposal_contracts/schema/*.json` for output validation.

**Storage**: File-based fixtures only — one JSON song-DB fixture + world snapshots under
`proposal_contracts/fixtures/` (read by the test harness, never by the package).

**Testing**: `docker compose exec api uv run pytest` (canonical); local fallback
`/c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest` (Docker/uv unreachable in the
authoring shell). New tests under `app/api/tests/proposal/`.

**Target Platform**: Local containerized backend (the package is loaded/executed server-side
in later milestones; P6 runs it directly from tests).

**Project Type**: Algorithm package (single-project backend) + package fixtures.

**Performance Goals**: Not a milestone gate; per-run scoring over a small frozen catalog
(smoke 5 / demonstration 36 songs) completes well under a second. Determinism is the binding
non-functional property, not throughput.

**Constraints**: Pure deterministic `evaluate()` (no clock, randomness, or I/O); IEEE-754
binary64; full-precision ranking, `1e-12` cross-runtime tolerance; `−0 → +0`; no
`aica_api`/trigger imports; no changes to trigger code, tests, or the trigger package; no
network/LLM call.

**Scale/Scope**: One package, ~one algorithm file, ~10 test files, one JSON song-DB fixture +
several world/catalog fixtures. Contract surface = the frozen `SelectorInput`/`CompletePlan`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Justification |
|---|---|---|
| I. Backend is source of truth | PASS | The package computes decisions server-side; no frontend logic in P6. |
| II. Evidence append-only, failures never hidden | PASS | Every outcome is a typed decision/error category (§13); invalid inputs → typed errors, never a disguised plan. P6 produces evidence content; run-log persistence is a later milestone. |
| III. Deterministic, replayable simulation | PASS | Pure `evaluate()`: identical frozen inputs + versions → identical plan/evidence (`1e-12`); the frozen catalog is the replay boundary; no model rerun. |
| IV. Qualitative trigger discipline | PASS (scoped) | This is the proposal simulator; its authoritative content algorithm uses numeric `[0,100]/100` driver/environment evidence (data-spec §13), not external-service route numerics. No raw external-service quantity drives scoring; the catalog is frozen synthetic data. |
| V. One generic algorithm adapter contract | PASS | The package is a `python_module` exposing `evaluate(context: dict) -> dict`, returning one normalized `CompletePlan` shape; suppressed/excluded songs remain visible as excluded, not dropped. |
| VI. Local-first simplicity (YAGNI) | PASS | Single file-based package + fixtures; no new services, DB, or platform surface; no orchestrator/editor built in P6. |
| Security & safety boundaries | PASS | No keys/network; local trusted package code; hard eligibility + explicit-child + full-karaoke-stopped precede and dominate scoring and cannot be reversed by score; advisory only. |
| Contract surfaces tested first | PASS | Output validated against the frozen Pydantic model + JSON-Schema; contrast/trait/eligibility/determinism tests are the primary suite. |
| Generated artifacts not hand-edited | PASS | The frozen `proposal_contracts/schema` + disposition registry are consumed, not edited; any change flows through their exporter. |

**Result: PASS — no violations, Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/011-p6-content-selector/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (evaluate() I/O contract)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/aica_transparent_content_selector_v1/
├── package.json         # manifest: structured hyperparameters (all tables) + scalar knobs
├── algorithm.py         # pure evaluate(context)->dict + internal section functions
└── README.md            # provenance, contract, hyperparameter reference

proposal_contracts/fixtures/                 # extend the frozen P0.5 fixture tree
├── songs/                                    # (existing smoke/pairs/karaoke)
├── catalog/                                  # NEW: one JSON song-DB fixture(s) for scoring
└── worlds/                                   # NEW: numeric scoring world snapshots + contrasts

app/api/tests/proposal/                       # NEW P6 test files (alongside P0.5 tests)
├── conftest.py (extend)                       # catalog/world loaders + context assembler
├── test_content_selector_traits.py
├── test_content_selector_response_weights.py
├── test_content_selector_eligibility.py
├── test_content_selector_plan.py
├── test_content_selector_genre.py
├── test_content_selector_contrasts.py
├── test_content_selector_determinism.py
└── test_content_selector_contract.py
```

**Structure Decision**: Single-project backend. The algorithm lives in `packages/` following
the established `python_module` convention (mirrors `aica_transparent_hybrid_trigger_v1`);
tests live under the existing `app/api/tests/proposal/` package next to the P0.5 contract
tests; fixtures extend the frozen `proposal_contracts/fixtures/` tree. No frontend, router, or
`aica_api` runtime change in P6.

## Complexity Tracking

> No constitution violations — section intentionally empty.
