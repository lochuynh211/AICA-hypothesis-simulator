# P3 Unit B report — T007–T011 typed World model + deterministic project()

## Scope

Tasks T007 (test), T008 (impl: `ControlInputs`/`Situation`/`DriverProfile`/`World`), T009 (golden
projection test), T010 (impl: `World.project()`), T011 (import-guard extension for `world.py`).

## Files changed

- `app/api/aica_api/models/proposal/world.py` (new) — `ControlInputs`, `Situation`, `DriverProfile`,
  `World`, plus small timestamped-item sub-models (`PlayedItem`, `SkippedItem`, `ChangedFromItem`,
  `CompletedItem`, `ManuallySelectedItem`, `RepeatedItem`, `CancelledContentPlan`, `ServiceRejection`),
  and `World.project()`.
- `app/api/aica_api/models/proposal/enums.py` — added `TrafficState`, `RoadType`, `NightState`,
  `OshiMode`, `OshiType`, `AgeBand`, `Gender`, `RecencyState`, `ScheduledEventType`,
  `ScheduledEventTiming` (needed by `Situation`/`DriverProfile`; none of these existed before this unit).
- `app/api/aica_api/models/proposal/__init__.py` — re-exports for the new enums and `world.py` classes
  (consistent with the package's existing re-export convention).
- `app/api/tests/proposal/test_world_model.py` (new) — T007: `ControlInputs`/`Situation`/`DriverProfile`/
  `World` construction, range/enum/purpose-stage validation, and the field-completeness guard (every
  A.1/A.2 feature from `CONTENT_FEATURE_DISPOSITIONS` appears in exactly one of `Situation`/
  `DriverProfile`, no duplicates, no gaps; asserts the registry has exactly 49 entries).
- `app/api/tests/proposal/test_world_projection.py` (new) — T009: the golden projection test.
- `app/api/tests/proposal/test_p1_isolation_imports.py` — extended `test_source_files_discovered` to
  assert `dataset.py` and `world.py` are present in the scanned file set (T011). The scan itself is
  glob-based (`*.py` under `models/proposal/`) so `world.py` was already structurally covered by
  `test_no_module_imports_trigger_models`; this makes the coverage explicit rather than incidental.

No other files touched. `pyproject.toml` unchanged (no new dependency).

## Exact projected shape produced

`World.project() -> (feature_snapshot: dict, feature_provenance: dict[str, FeatureProvenanceEntry])`.

`feature_snapshot` top-level keys:
- Always: `situation`, `preference`, `history`, `additional_proposed`, `_genre_extension_enabled`.
- Only when `driver_profile.genre_affinity_v1_enabled` is `True`: `genre_affinity_v1` (containing
  **only** `usage_by_genre` and `scene_genre_usage` — see "catalog / _service_id" below).

Field names per group were verified byte-for-byte (as a set) against
`proposal_contracts/fixtures/worlds/night-highway-baseline.json`:

- `situation` (11): `drowsiness_level`, `fatigue_level`, `traffic_state`, `road_type`, `night_state`,
  `monotony_level`, `route_tags`, `destination_tags`, `child_present`, `multiple_passengers`,
  `motion_state`.
- `preference` (20): `oshi_registered`, `oshi_mode`, `oshi_id`, `oshi_type`, `oshi_tags`, `age_band`,
  `gender`, `hobby_interest_tags`, `service_usage_level`, `service_recency_state`,
  `scene_service_usage_level`, `catalog_item_usage_level`, `catalog_item_recency_state`,
  `content_tag_usage_level`, `content_tag_recency_state`, `scene_content_tag_usage_level`,
  `played_items`, `skipped_items`, `changed_from_items`, `cancelled_content_plans`.
- `history` (7): `service_proposal_acceptance_rate`, `service_recovery_rate`,
  `content_proposal_acceptance_rate`, `content_recovery_rate`, `scheduled_event_type`,
  `scheduled_event_timing`, `scheduled_event_tags`.
- `additional_proposed` (11): `estimated_min_until_rest_spot`, `rest_spot_type`, `active_service`,
  `recent_service_rejections` (from the UI's `Situation` group), `service_proposal_acceptance_confidence`,
  `service_recovery_confidence`, `content_proposal_acceptance_confidence`, `content_recovery_confidence`
  (from the UI's `DriverProfile`/History), `completed_items`, `manually_selected_items`,
  `repeated_items` (from the UI's `DriverProfile`/Preference).

11 + 20 + 7 + 11 = 49, matching spec §9 Appendix A.2's row count and
`len(CONTENT_FEATURE_DISPOSITIONS) == 49` exactly (asserted by
`test_registry_has_49_entries`/`test_every_disposition_feature_present_exactly_once`).

**Implementation approach**: rather than hand-writing the group-bucketing logic (error-prone to keep in
sync with the disposition registry), `project()` iterates `CONTENT_FEATURE_DISPOSITIONS` directly and maps
each entry's `category` (`"Situation"→"situation"`, `"Preference"→"preference"`, `"History"→"history"`,
`"Additional proposed"→"additional_proposed"`) to bucket a flat `{**situation.model_dump(mode="json"),
**driver_profile.model_dump(mode="json", exclude={genre fields})}` dict. This makes the "every A.1/A.2
field appears exactly once" guarantee structural (driven by the same registry the field-completeness test
checks) rather than something that could silently drift if a field were added to one model but the
bucketing code forgotten.

`feature_provenance` is populated for exactly those 49 feature_ids, using each disposition entry's own
`feature_origin` (`FeatureOriginProvenance`) and `source_reference` — i.e. read directly from the in-repo
`aica_api.models.proposal.dispositions.CONTENT_FEATURE_DISPOSITIONS` Python object (the same object
`export_schema.py` serializes to `proposal_contracts/dispositions/content_feature_dispositions.v1.json`),
not by re-reading the JSON file at runtime — keeping `project()` free of I/O.

## How `catalog` / `_service_id` / `artist_genres` were handled

Per the task brief, `catalog` and `_service_id` are **not** emitted by `project()` — they are not
world-owned (the caller supplies them when building the selector context: `catalog` from the frozen
dataset, `_service_id` from the already-selected service). This is asserted by
`test_no_catalog_or_service_id_leaked_by_project` and exercised correctly in the cross-check test, which
merges them in manually before calling `evaluate()`.

The same reasoning extends to `genre_affinity_v1.artist_genres`: it is **catalog**-derived (found at
`proposal_contracts/dataset/<dataset_id>/genre_affinity_v1.json`, a sibling of `catalog.json`), not a
driver-profile field. `DriverProfile` only owns `usage_by_genre`/`scene_genre_usage` (confirmed against
data-model.md §DriverProfile, which lists no `artist_genres` field), so `project()`'s `genre_affinity_v1`
block contains only those two keys — the caller is expected to merge in `artist_genres` from the dataset
alongside `catalog`, exactly as it does for `catalog`/`_service_id`. This is documented at length in
`world.py`'s module docstring and verified in `test_genre_affinity_v1_block_is_world_owned_subset` (its
key set is `{"usage_by_genre", "scene_genre_usage"}`, a strict subset of the P0.5 fixture's
`genre_affinity_v1` key set).

**One qualitative-vs-numeric discrepancy resolved**: the two P0.5 world fixtures use qualitative band
strings for `drowsiness_level`/`fatigue_level`/`monotony_level` (e.g. `"med"`), but the real selector
(`packages/aica_transparent_content_selector_v1/algorithm.py`) does
`float(situation.get("drowsiness_level", 0)) / 100.0` — which would raise on a string. Cross-checked
against every other real-selector test in `app/api/tests/proposal/` (`test_content_selector_*.py`), which
uniformly use numeric 0–100 ints for these three fields. Concluded the fixtures' string bands are
illustrative/pre-P3 authoring artifacts (their only actual consumer, `test_genre_extension.py`, reads only
the `genre_affinity_v1` sub-object, never feeds the whole fixture through `evaluate()`). `Situation`
therefore types these three fields as `int` (0–100) per data-model.md, and the golden test compares fixture
vs. `project()` output by **field-name set**, not by value — which is what research.md §R1 actually asks
for ("group keys + field names match the fixture").

## Self-review findings fixed during the unit

- First draft of the genre-block helper (`_dump_optional_genre_field`) was initially written with a
  redundant/misnamed top-level function (`profile_values_genre`) — renamed and tightened before running
  any tests (caught during my own read-through, not by a test failure).
- One test line (`test_rate_and_confidence_boundary_values_accepted`) initially had a stray
  `"music_playlist" if False else ServiceId.music_playlist` left over from drafting — cleaned up before
  the final run.
- Verified with a scratch script that Pydantic v2's `model_dump(mode="json")` renders `Enum`-typed dict
  *keys* (e.g. `dict[ServiceId, UsageLevel]`, `dict[GenreLiteral, UsageLevel]`) as their plain string
  values — this was the one genuinely uncertain mechanic `project()` depends on, so I confirmed it
  empirically (`{'d': {'a': 1}}`) before relying on it, rather than assuming.

## Exact pytest commands + output tails

```
$ cd app/api && find . -name __pycache__ -type d -exec rm -rf {} +
$ uv run pytest tests/proposal/test_world_model.py tests/proposal/test_world_projection.py -q
.......................................................                  [100%]
55 passed in 0.47s
```
(combined count: 39 in `test_world_model.py` + 16 in `test_world_projection.py` = 55)

```
$ cd app/api && uv run pytest tests/proposal -q
........................................................................ [ 13%]
........................................................................ [ 27%]
........................................................................ [ 40%]
........................................................................ [ 54%]
........................................................................ [ 68%]
........................................................................ [ 81%]
........................................................................ [ 95%]
.........................                                                [100%]
529 passed in 3.45s
```
(baseline before this unit, `tests/proposal` alone: 474 passed — net +55, matching the two new test
files, with zero regressions in any pre-existing proposal test.)

```
$ cd app/api && uv run pytest -q         # full backend (trigger + proposal)
... (73 dots per line) ...
1548 passed, 3 skipped in 42.80s
```
Same 1548 passed / 3 skipped both before and after the `__init__.py` re-export edit — confirms the
re-exports introduced no import-order/circularity issue.

## Concerns

- **Enum vocabulary choices without an authoritative source**: `Gender` (`male`/`female`/`non_binary`/
  `unspecified`) and the timestamped sub-model field names for `completed_items`/`manually_selected_items`/
  `repeated_items`/`cancelled_content_plans`/`recent_service_rejections` (e.g. `selected_at`,
  `repeated_at`, `plan_id`/`cancelled_at`, `service_id`/`rejected_at`) are **not** specified anywhere in
  the docs — these five fields are `context_only`/never read by the real content-selector algorithm, so
  there is no algorithmic ground truth to pin them against (unlike `played_items`/`skipped_items`/
  `changed_from_items`, whose field names I took verbatim from `algorithm.py`'s literal `.get("track_id")`
  / `.get("last_played_at")` etc. reads). I made a reasonable, internally-consistent choice; a later unit
  (e.g. the frontend WorldPanel or a seed-authoring task) may want to revisit these five shapes if a
  stronger source turns up.
- `ControlInputs.matrix_version`/`dataset_id` are validated only for non-emptiness in this unit, per the
  task's explicit deferral of "resolvable against the matrix/dataset registry" to the later
  `services/world_validation.py` (T017/T018), which is out of this unit's scope — documented in the
  model's docstring so it isn't mistaken for an oversight.
- `World`/`Situation`/`DriverProfile`/`ControlInputs` are not Pydantic-`frozen`; the "setup-time only"
  mutation rule (Constitution) is not enforced at the model level in this unit — this matches the sibling
  P1 models (`ProposalOpportunity`, etc.), which are likewise mutable Pydantic models relying on
  service-layer/API-layer discipline rather than `frozen=True`. `CatalogRef`/`DatasetProvenance` (read-only
  dataset side, previous unit) remain the only genuinely frozen models, which is correct since those alone
  must never change after being loaded.
