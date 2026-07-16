# Quickstart — P0.5 Content Contract & Song-Schema Freeze

## What this milestone delivers

Frozen, versioned proposal **content-selector** contracts (backend Pydantic + exported JSON-Schema), a **feature-disposition registry**, and hand-authored **fixtures** — enough for the content package (P6) and dataset generator (P2) to be built against, with zero ranking logic, screen, endpoint, or network/LLM.

## Prerequisites

- P0 (the approved master doc set) — present.
- Python 3.12. Canonical test run: `docker compose exec api uv run pytest`. Local fallback used during development (Docker/uv unreachable in shell): Anaconda Python 3.12 with pydantic 2.8 / pytest 7.4.

## Run the contract tests

```bash
# canonical (when Docker is available)
docker compose exec api uv run pytest tests/proposal

# local fallback (from app/api/)
python -m pytest tests/proposal -q
```

## Regenerate the frozen schema + registry artifacts

```bash
# from app/api/ — writes proposal_contracts/schema/*.json and dispositions/*.json
python -m aica_api.models.proposal.export_schema
```
The drift-guard test (`tests/proposal/test_schema_export.py`) fails if the committed artifacts differ from a fresh export — so never hand-edit files under `proposal_contracts/schema/` or `proposal_contracts/dispositions/`.

## Validate a song by hand (illustrative)

```python
from aica_api.models.proposal.song_schema import Song
import json, pathlib

raw = json.loads(pathlib.Path("proposal_contracts/fixtures/songs/smoke/song-0001.json").read_text())
Song.model_validate(raw)   # raises pydantic.ValidationError for malformed records
```

## Acceptance walkthrough (maps to spec Success Criteria)

1. **SC-001** — build a `SelectorInput` (content variant) and a `CompletePlan` from the models; both validate. → `test_selector_input_contract.py`, `test_content_output_contract.py`.
2. **SC-002** — every `fixtures/songs/**` accepted; every `fixtures/negative/**` rejected at its offending field. → `test_song_schema.py`.
3. **SC-003** — registry covers every Appendix A.2 content field once; A.2 cross-check passes. → `test_dispositions.py`.
4. **SC-004** — genre extension off ⇒ six genre-gated features `context_only`; on ⇒ scorable; no core-namespace overwrite. → `test_genre_extension.py`, `test_dispositions.py`.
5. **SC-005** — schema/registry exports match the models (drift guard); dotted control-input naming absent from master docs. → `test_schema_export.py`, `test_docs_naming_consistency.py`.
6. **SC-006** — no aggregate plan score anywhere in the content output. → `test_content_output_contract.py`.
7. **SC-007** — existing backend suite still green (regression). → full `pytest` run.

## What is intentionally NOT here

Ranking/scoring logic (P6), dataset generator/validator (P2), the 4-panel screen + run/persistence types (P1), editable world (P3), journey-engine value semantics (P4), frontend/i18n, and the service-selector output contract (P1).
