# Unit E report — T017-T020: world validation + setup snapshot (additive)

## Status
COMPLETE.

## Scope delivered

1. **`app/api/aica_api/services/world_validation.py`** (new) —
   `validate_world(world: World, catalog: list[Song]) -> list[ValidationIssue]`.
   - `ValidationIssue` is a small `pydantic.BaseModel` with `{path, code, message}` (bilingual
     EN/JA message for catalog-reference issues; plain English for structural issues, which
     come straight from Pydantic's own `ValidationError.errors()`).
   - **Rules 1+2 (enum/range, purpose/stage compatibility)**: implemented by re-validating
     `world.model_dump(mode="json")` through `World.model_validate(...)` and translating any
     `ValidationError` into `ValidationIssue`s. This *reuses* the shared rules already on the
     models (Pydantic's `ge`/`le`/enum constraints, `ControlInputs._purpose_stage_compatible`)
     rather than re-implementing them, and is necessary because a `World` mutated in place
     post-construction (these models do not set `validate_assignment`, since the setup UI
     edits fields incrementally) bypasses constructor-time validation entirely.
   - **Rule 3 (catalog reference existence)**: implemented directly against the supplied
     `catalog: list[Song]` (no `mdg` import, per the isolation constraint) — builds a set of
     valid track ids (`spotify_track.id`) and artist ids (`spotify_track.artists[].id` +
     `spotify_track.album.artists[].id`), then checks `driver_profile.oshi_id` against artist
     ids and `played_items`/`skipped_items`/`changed_from_items`/`completed_items`/
     `manually_selected_items`/`repeated_items` (`.track_id`) plus
     `catalog_item_usage_level`/`catalog_item_recency_state`/
     `content_proposal_acceptance_rate`/`content_recovery_rate`/
     `content_proposal_acceptance_confidence`/`content_recovery_confidence` (map keys) against
     track ids. A valid world → `[]`.
   - Isolation: imports only `aica_api.models.proposal.world`, `aica_api.models.proposal.song_schema`,
     stdlib (`warnings`, `typing`), and `pydantic`. No `mdg`, no trigger `aica_api.models`.

2. **`SetupSnapshot` / `SetupSnapshotOrigin`** added to
   `app/api/aica_api/models/proposal/world.py` — fields per data-model.md §SetupSnapshot:
   `origin` (`seed_id`/`clone_id`/`profile_id`, all optional/independent), `matrix_version`,
   `dataset_id` + `dataset_hash`, `service_package_id` + `service_contract_version`,
   `content_package_id` + `content_contract_version` (both optional — a service-only run has
   no content step yet), `service_parameter_set_version`, `content_parameter_set_version`
   (optional), `feature_provenance: dict[str, FeatureProvenanceEntry]` (reused from
   `selector_input.py`, defaults to `{}`). `extra="forbid"` throughout.

3. **`ProposalRunLog.setup_snapshot: SetupSnapshot | None = None`** added ADDITIVELY in
   `app/api/aica_api/models/proposal/proposal_run.py`. `world_snapshot: dict` is untouched —
   the run-create endpoint migration to populate `setup_snapshot` (and any eventual retirement
   of `world_snapshot`) is explicitly deferred to the next unit (T021-T023).

## Tests written (TDD, written first)

- `app/api/tests/proposal/test_world_validation.py` (16 tests): valid seed world → `[]`;
  out-of-range int and invalid enum member each → field-level issue; incompatible
  `(trigger_purpose, lifecycle_stage)` → issue at `path="control_inputs"`; unknown
  `oshi_id`, unknown `played_items[].track_id`, unknown `catalog_item_usage_level` key each →
  `{path, code="unknown_catalog_reference", message}` naming the bad id; a negative-control
  test that the seed's own genuine references produce no `unknown_catalog_reference` issues;
  a multi-violation test asserting all paths are reported together.
- `app/api/tests/proposal/test_setup_snapshot.py` (11 tests): `SetupSnapshot`
  construction/validation (valid, content-fields-optional, all-origin-refs-None,
  feature_provenance defaults to `{}`, missing-required-field rejected, unknown-field
  rejected, round-trip identical); `ProposalRunLog` carrying a `setup_snapshot` round-trips
  (`model_dump` → re-load) identically; backward compat — a `ProposalRunLog` dict with no
  `setup_snapshot` key at all still loads and yields `None` (simulating a pre-P3 persisted run
  file), and an explicit `null` also loads.

## Side-effect fix required

Adding `setup_snapshot` to `ProposalRunLog` changed its generated JSON schema, so the
committed schema-drift guard (`test_p1_schema_export.py`) failed against the stale committed
artifact. Regenerated via `python -m aica_api.models.proposal.export_schema` from `app/api/`;
only `proposal_contracts/schema/p1_proposal_run_log.schema.json` changed (now includes the
`SetupSnapshot`/`SetupSnapshotOrigin`/`FeatureProvenanceEntry`/`FeatureOriginProvenance` defs).
This is the intended, expected regeneration step for an additive model change, not a
workaround.

## Verification

- `cd app/api && uv run pytest tests/proposal/test_world_validation.py tests/proposal/test_setup_snapshot.py -q` → 21 passed.
- `cd app/api && uv run pytest tests/proposal -q` → 604 passed (no regressions; includes the
  regenerated schema artifact).
- Full backend suite `cd app/api && uv run pytest -q` → 1623 passed, 3 skipped (pre-existing,
  unrelated skips).

## Commit

`8a5029b` — `feat(p3): T017-T020 world validation + setup snapshot (additive)`

Files changed:
- `app/api/aica_api/services/world_validation.py` (new)
- `app/api/aica_api/models/proposal/world.py` (SetupSnapshot/SetupSnapshotOrigin added)
- `app/api/aica_api/models/proposal/proposal_run.py` (additive `setup_snapshot` field)
- `app/api/tests/proposal/test_world_validation.py` (new)
- `app/api/tests/proposal/test_setup_snapshot.py` (new)
- `proposal_contracts/schema/p1_proposal_run_log.schema.json` (regenerated, drift fix)

Not pushed, not merged (per task instructions).

## Concerns / notes for the next unit (T021-T023)

- The task text for T018 (tasks.md) says "reusing `mdg.worlds.validate_world_references`" —
  superseded by this unit's explicit constraint to NOT import `mdg` and implement directly
  against the supplied catalog. Implemented per the constraint; tasks.md itself was not
  edited (out of scope for this unit).
- `validate_world`'s catalog-reference check does not attempt to validate
  `control_inputs.dataset_id`/`matrix_version` resolvability against the dataset/matrix
  registries — that requires those registries, not just a `catalog: list[Song]`, and the
  task's explicit function signature only accepts `world` + `catalog`. The next unit
  (`POST /worlds/validate`, `POST /api/proposal/runs`) is where a router has both the
  `DatasetCatalogRegistry` and `PurposeStageServiceMatrix` in hand and can perform that
  resolution before calling `get_catalog(dataset_id)` and passing the result in here — if
  resolution fails there, that's a separate, router-level 422 (unknown dataset/matrix
  version), not a `world_validation` concern.
- `content_tag_usage_level`/`content_tag_recency_state`/`scene_content_tag_usage_level`/
  `scene_service_usage_level` map keys are tag/service identifiers, not catalog track/artist
  ids, and were deliberately excluded from the catalog-reference check (their keys aren't
  drawn from `Song` records).
- `SetupSnapshot` is not yet wired into any endpoint; `world_snapshot` remains the only
  field actually populated by `POST /api/proposal/runs` until T023.
