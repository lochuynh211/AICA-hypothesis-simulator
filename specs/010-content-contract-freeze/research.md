# Phase 0 Research — P0.5 Content Contract & Song-Schema Freeze

All spec-level ambiguities were resolved in `/speckit-clarify` (see spec `## Clarifications`). This file records the remaining technical decisions and their rationale. No `NEEDS CLARIFICATION` items remain.

## D1 — Contract ownership: backend Pydantic, packages stay dict-based

- **Decision**: The proposal contracts are backend-owned Pydantic models in `aica_api/models/proposal/`. The future content package (P6) is a `python_module` written as `evaluate(input: dict) -> dict` and does **not** import these models; the backend adapter validates/normalizes at the boundary. A JSON-Schema export is the artifact the dict/JSON-based package and the P2 generator validate against.
- **Rationale**: Matches the verified trigger convention (`packages/*/algorithm.py` import nothing from `aica_api`; the backend owns `DecisionResult`/`PackageManifest` and validates at the adapter) and Constitution Principle V.
- **Alternatives considered**: A standalone importable contract library (rejected — breaks the established `models/` home and adds an import path the backend doesn't use); packages embedding their own validation (rejected — violates "packages share contracts").

## D2 — Frozen artifact location: repo-root `proposal_contracts/`

- **Decision**: JSON-Schema, the serialized disposition registry, and fixtures live in a repo-root `proposal_contracts/` directory, resolvable via a new `AICA_PROPOSAL_CONTRACTS_DIR` config default.
- **Rationale**: Mirrors `packages/`, `scenarios/`, `runs/`; lets P6/P2 (dict/JSON-based, backend-independent) consume by path.
- **Alternatives**: Fixtures under `app/api/tests/fixtures/` (rejected — backend-independent consumers would reach into the test tree and later relocate them).

## D3 — Schema strictness (from clarification)

- **Decision**: Strict at the song-namespace level (only `spotify_track`/`spotify_audio_features`/`simulation_flags`; unknown top-level namespace rejected) and strict for `simulation_flags`; lenient inside the Spotify track/audio-features objects (extra provider fields permitted).
- **Rationale**: Matches data-spec §17.1 ("no unknown top-level song namespace") and §21 (no-overwrite) while staying faithful to real Spotify object shapes. Pydantic realization: `model_config = ConfigDict(extra="forbid")` on the `Song` wrapper, the `SimulationFlags` model, and the genre-extension models; `extra="ignore"` (default) on `SpotifyTrack`/`SpotifyAudioFeatures` and their sub-objects.
- **Alternatives**: Strict everywhere (rejected — rejects valid richer records); lenient everywhere (rejected — weakens the namespace rule).

## D4 — Disposition registry granularity (from clarification)

- **Decision**: One registry entry per Appendix A.2 **field**; scored categorical fields carry per-enum-value response detail as nested sub-data. Cross-check = field-row-set equality vs the A.2 table.
- **Rationale**: Keeps a clean 1:1 row-set for the drift-guard while capturing the enum-level responses the content algorithm (§5.3) needs.
- **Alternatives**: Per-enum-value top-level rows (rejected — needs a mapping step before the A.2 cross-check); two registries (rejected — extra reconciliation surface).

## D5 — JSON-Schema export mechanism + drift guard

- **Decision**: Export via Pydantic's `model_json_schema()` from `export_schema.py` (`python -m aica_api.models.proposal.export_schema`), writing the committed `schema/*.json` and `dispositions/*.json`. A `test_schema_export.py` asserts the committed files byte-match a fresh in-memory export (sorted keys, stable formatting).
- **Rationale**: Single generator, drift-guarded — satisfies "generated artifacts are never hand-edited". Language-neutral output for P6/P2.
- **Alternatives**: Hand-written JSON-Schema (rejected — drifts from models); no export (rejected — backend-independent consumers need it).

## D6 — Fixture file format: JSON

- **Decision**: Fixtures are committed as JSON files under `proposal_contracts/fixtures/`, loaded in tests via a `conftest.py` helper that resolves the directory by path.
- **Rationale**: Consistent with `scenarios/`/`packages/` JSON data; directly loadable by dict-based consumers (P6/P2) and by JSON-Schema validation; the master docs' YAML snippets are illustrative only. Avoids adding a YAML dependency.
- **Alternatives**: YAML fixtures (rejected — adds a parser dependency and diverges from repo data convention).

## D7 — Rejection attributability (from clarification)

- **Decision**: Malformed-record rejection is surfaced through Pydantic's structured `ValidationError` (field location + message); negative-fixture tests assert on the offending field/location. No bespoke song-schema reason-code taxonomy; the frozen content-output `ContentErrorCode` set remains the only coded error layer.
- **Rationale**: Satisfies "each rejected for its specific intended rule" without scope creep.
- **Alternatives**: A dedicated per-rule code taxonomy (rejected — YAGNI); folding all into `invalid_catalog` (rejected — loses per-field attributability that tests need).

## D8 — Versioning

- **Decision**: Module constants `CONTRACT_VERSION = "1.0.0"` (selector input + content output) and `SCHEMA_VERSION = "1.0.0"` (song schema); the genre extension carries its own version tag; the registry is versioned in its filename (`...v1.json`) and a `registry_version` field.
- **Rationale**: Mirrors the docs' `contract_version` / `schema_version` split; these are what P1's setup snapshot will record.

## D9 — Verification environment

- **Decision**: Author/run the new tests locally with Anaconda Python 3.12.7 (pydantic 2.8.2, pytest 7.4.4); treat the containerized `uv run pytest` as the authoritative gate when reachable.
- **Rationale**: Docker/`uv`-install are unreachable in the current shell; the local env runs the existing suite green and exercises only Pydantic features stable across 2.8↔2.13. Recorded as a known limitation.
