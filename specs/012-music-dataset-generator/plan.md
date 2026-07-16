# Implementation Plan: P2 — Synthetic Music Dataset Generation & Validation

**Branch**: `proposal-p2-soundcharts-dataset` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-music-dataset-generator/spec.md`

## Summary

Deliver the offline music-dataset generator: a **separate repo-root Python package `music_dataset_generator/` (import root `mdg`)** implementing the S0–S9 Soundcharts-grounded pipeline. It plans coverage, acquires real-song candidates through one of two interchangeable strategies (`isrc_resolved` default / `soundcharts_search` fallback), resolves ISRCs via MusicBrainz + Deezer, harvests real audio by ISRC from Soundcharts, deterministically bins/selects/maps/validates/repairs/freezes a **versioned, hash-stamped, Spotify-compatible catalog** (real names + verbatim real audio, `synthetic-` IDs, `.invalid` URLs, label-free), maintains a carry-over ledger for loopable/resumable additive generation, applies a sub-first genre map into the frozen 12-term vocabulary, generates ≥15 base worlds + 12 contrast pairs, and produces a labeled test-case set where an interactive LLM judges blind and the P6 selector cross-checks and certifies contrast reversals.

Technical approach: the **deterministic core is standalone CLIs** (`python -m mdg <stage>`) using `httpx` for data-source HTTP (Soundcharts/MusicBrainz/Deezer — not LLM APIs) and reusing the frozen `aica_api` `Song` schema through a one-way build-time path dependency; the **LLM stages are performed by the interactive agent** via a committed file-handoff contract (schema-checked input → prompt → schema-checked output). The committed frozen dataset — not a harvest rerun — is the replay boundary; the deterministic transform (accumulated cache + frozen LLM outputs → catalog) is byte-identical and runs with no network/agent, which the test suite proves on committed recorded fixtures.

## Technical Context

**Language/Version**: Python 3.12 (matches `app/api` / `aica-api`).

**Primary Dependencies**: `pydantic` v2 (schema/models), `httpx` (Soundcharts/MusicBrainz/Deezer HTTP + retries); build-time path dependency on `aica-api` **solely** to import the frozen `Song` schema (`aica_api.models.proposal.song_schema`); the P6 package (`packages/aica_transparent_content_selector_v1/algorithm.py`) loaded **by file path** (no import). No LLM SDK, no OpenAI/Anthropic client, no LLM API key.

**Storage**: files only. Committed: frozen catalog + manifest → `proposal_contracts/dataset/<dataset_id>/`; test cases → `proposal_contracts/test_cases/`; prompt templates + I/O JSON schemas + frozen LLM output instances + build report → committed. Gitignored (new `generation_workspace/` entry): raw-response cache, lineage, carry-over ledger.

**Testing**: `pytest` under `music_dataset_generator/tests/`. Deterministic tests use committed recorded raw-response fixtures (no network/agent). Live tests marked `@pytest.mark.live` (skipped by default; run with the Soundcharts key).

**Target Platform**: local cross-platform CLI (developed on Windows; runs in the Linux `api` container and a bare terminal). No long-running service.

**Project Type**: offline CLI tooling package (separate repo-root package; not part of the runtime API).

**Performance Goals**: minimize live Soundcharts calls (probe + 36-song demonstration harvest budget tracked in the build report); the deterministic transform over the demonstration cache completes in seconds. No high-throughput requirement.

**Constraints**: deterministic core is offline-capable (no network, no LLM, no agent); byte-identical reproducible transform; BYO Soundcharts key (env-only, never persisted/logged/in-artifact); MusicBrainz ≤1 req/s + descriptive User-Agent.

**Scale/Scope**: `smoke` (5 valid + ≥4 negatives), `demonstration` (36 standard: ~30 JA/~6 EN/0 other + ≥4 negatives outside; 12 artists × 3 tracks; ≥12 albums; ≥3 eras), `stress` (configurable, same distributions); 15 base worlds + 12 one-variable contrast pairs; ~20–32 labeled test cases (12 required pairs + natural converge/neutral cases).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| I. Backend is source of truth | P2 is offline tooling that produces a frozen **data** artifact; it computes no simulation decision and adds no runtime surface. The backend later consumes the frozen catalog. No frontend involvement. | PASS |
| II. Evidence append-only; failures never hidden | Repair halts visibly with `catalog_generation_failed` after 2 strikes; every repair, miss, and quota use is logged in the committed build report; typed error codes surface every failure; `judge_disagreement` recorded as data. No failure is disguised as a valid record. | PASS |
| III. Deterministic, replayable | The committed frozen dataset (not a harvest rerun) is the replay boundary; the transform is byte-identical; no live LLM/network call occurs in a transparent simulation run (FR-029, FR-032). | PASS |
| IV. Qualitative trigger discipline | The catalog stores real audio numbers, but P6 derives traits/bins **at decision time**; generation-time binning is coverage arithmetic, not a trigger, and stores no ordinal band as a trigger input. Firewall keeps selection coverage-driven. | PASS |
| V. One generic algorithm adapter | The P6 certifier loads the existing `python_module` `evaluate` entrypoint by file path; no new adapter, no algorithm specifics leak into shared code. | PASS |
| VI. Local-first simplicity (YAGNI) | Separate local file-based package; no DB/queue/cloud/accounts. Orchestration skill deferred; `soundcharts_search` bounded to a clear `strategy_unavailable`. | PASS |
| Security & Safety — BYO-key | Soundcharts key env-only; never shipped, defaulted, persisted, logged, or written to any artifact/manifest/lineage/build report. Deterministic core runs with no key. | PASS |
| Security & Safety — no silent failure into trusted evidence | Invalid records block via the validator/repair hard stop; lineage/coverage integrity failures raise typed errors, never silently produce a catalog. | PASS |
| Dev Workflow — contract surfaces tested first | Song-schema conformance, validator rules, the deterministic transform, and the genre map are contract surfaces and are TDD'd first (Step 4). | PASS |
| Dev Workflow — generated artifacts never hand-edited | The frozen catalog/manifest/test-cases are produced only by the CLIs; committed but never hand-edited (edits re-run the generator/validator). | PASS |

**Result: PASS — no violations.** Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/012-music-dataset-generator/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI command contracts + LLM handoff schemas + error taxonomy)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
music_dataset_generator/                # separate repo-root package (import root `mdg`)
├── pyproject.toml                       # deps: pydantic, httpx; [tool.uv.sources] aica-api = {path="../app/api", editable=true}
├── README.md
├── RUNBOOK.md                           # exact CLI + LLM-handoff sequence (orchestration skill deferred)
├── mdg/
│   ├── __init__.py                      # GENERATOR_VERSION, PROMPT_TEMPLATE_VERSION, VALIDATION_RULES_VERSION
│   ├── cli.py                           # `python -m mdg <stage> …`
│   ├── config.py                        # workspace/dataset paths (env + flags); Soundcharts key from env only
│   ├── models.py                        # DatasetManifest, LineageEntry, LedgerEntry, TestCase, BuildReport, CoveragePlan, CoverageCell, CandidateName
│   ├── errors.py                        # typed generation error codes (design §9 + data-spec §22)
│   ├── coverage/plan.py                 # S0 (ledger-relative; cells/spreads/pairs/quotas + language & era)
│   ├── sources/{soundcharts,musicbrainz,deezer,resolver}.py   # S1a/S2a/S2b
│   ├── harvest/{by_isrc,by_uuid,search,cache}.py              # S2c/S2a/S1a + cache/lineage
│   ├── binner.py  selector.py  mapper.py  genre_map.py        # S3/S4/§13
│   ├── validator.py  repair.py  freeze.py                     # S5/S6
│   ├── worlds.py  judge.py  certify.py                        # S7/S8/S9
│   ├── ledger.py  handoff.py
│   └── prompts/                         # COMMITTED templates + input/output JSON schemas per LLM stage
└── tests/
    ├── conftest.py                      # fixture loader; live marker
    ├── fixtures/                        # committed small real by-isrc payloads + coverage/ledger fixtures
    ├── test_coverage_plan.py  test_resolver.py  test_harvest.py
    ├── test_binner.py  test_selector.py  test_mapper.py
    ├── test_validator.py  test_repair.py  test_freeze.py
    ├── test_genre_map.py  test_ledger.py  test_handoff.py
    ├── test_transform_reproducible.py  test_firewall.py  test_strategy_parity.py
    ├── test_worlds.py  test_judge.py  test_certify.py
    └── test_live_harvest.py             # @pytest.mark.live

proposal_contracts/
├── dataset/<dataset_id>/                # frozen catalog + manifest (committed)
├── test_cases/                          # labeled test-case set (committed)
└── build_reports/                       # committed build report(s)

generation_workspace/                    # gitignored: raw cache, lineage, carry-over ledger, frozen LLM I/O instances

app/api/aica_api/config.py               # + AICA_GENERATION_WORKSPACE_DIR, AICA_PROPOSAL_DATASET_DIR
.gitignore                               # + generation_workspace/
```

**Structure Decision**: A **separate repo-root package** (`music_dataset_generator`, import root `mdg`) — the generator is offline tooling, not runtime API scope (spec FR-030). It reuses the frozen `Song` schema through a one-way build-time path dependency on `aica-api` (never the reverse) and loads the P6 selector by file path, so the runtime API has zero dependency on the generator. Frozen outputs land in the shared `proposal_contracts/` tree (the app consumes them in P3); non-frozen generation state is isolated in a gitignored `generation_workspace/`.

## Complexity Tracking

*No constitution violations — table intentionally empty.*
