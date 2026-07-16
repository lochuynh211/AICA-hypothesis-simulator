# proposal_contracts/

Frozen contract artifacts for the AICA Proposal content-selector (P0.5 milestone).

This directory is a peer of `packages/`, `scenarios/`, and `runs/` at the repo root.
It is consumed by content packages (P6) and the dataset generator (P2) via file path,
without importing the backend.

## Version constants

| Constant | Value |
|---|---|
| `CONTRACT_VERSION` | `"1.0.0"` |
| `SCHEMA_VERSION` | `"1.0.0"` |
| `GENRE_EXTENSION_VERSION` | `"genre_affinity_v1"` |

## Artifact layout

```
proposal_contracts/
├── schema/                          # GENERATED — do not hand-edit
│   ├── selector_input.schema.json
│   ├── content_output.schema.json
│   ├── song.schema.json
│   └── genre_affinity_v1.schema.json
├── dispositions/                    # GENERATED — do not hand-edit
│   └── content_feature_dispositions.v1.json
└── fixtures/
    ├── songs/
    │   ├── smoke/    # valid song fixtures (algorithm-blind)
    │   ├── pairs/    # contrast pairs for audio field testing
    │   └── karaoke/  # high-instrumentalness songs with both flags=1
    ├── worlds/       # world/feature snapshot fixtures
    └── negative/     # fixtures that must be rejected with specific errors
```

## Rules

- **`schema/` and `dispositions/` are GENERATED — do not hand-edit.**
  Regenerate with: `python -m aica_api.models.proposal.export_schema` (from `app/api/`).
- Fixtures under `fixtures/` are hand-authored and algorithm-blind (no scoring intent).
- All song IDs must begin with `synthetic-`; all URLs must use `.invalid` hostnames.
- The drift-guard test (`tests/proposal/test_schema_export.py`) pins committed artifacts
  to a fresh in-memory export — any uncommitted change to `schema/` or `dispositions/`
  will fail CI.

## Consumer note

Content packages (P6) and the dataset generator (P2) resolve this directory by
setting `AICA_PROPOSAL_CONTRACTS_DIR` or using the default
(`<repo-root>/proposal_contracts/`). No backend import is required to read the
JSON-Schema or disposition registry.
