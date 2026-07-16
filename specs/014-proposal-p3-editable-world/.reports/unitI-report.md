# Unit I report — T032-T036: wire the REAL transparent content selector into STEP 2

Branch `proposal-p3-editable-world`. TDD: tests written first for T032/T033/T036, confirmed
they exercise the new code paths, then implementation.

## What changed

### T032 — manifest gains `family`/`approach`
`packages/aica_transparent_content_selector_v1/package.json`: added `"family": "content_selector"`
and `"approach": "transparent"` right after the existing `"kind"` key (additive; every other key —
`kind`, `compatible_scenario_types`, `contract_version`, `algorithm`, `supported_services`,
`parameters`, `hyperparameters` — is untouched). `algorithm.py` (the scoring logic) was NOT touched.

Side effect (expected, not a bug): `ProposalPackageRegistry._scan()` iterates `sorted(packages_dir.iterdir())`,
and `aica_transparent_content_selector_v1` now sorts before `mock_content_selector_v1`, so
`list_slots()`'s `content_selector/transparent` slot now reports the REAL package id instead of the
mock's. This is exactly the "make the real package the default" requirement — the frontend's
`ServiceProposalPanel`/`ContentProposalPanel` already pick `contentPackages[0].id` as the default,
so no frontend code change was needed for this. Three pre-existing P1-era tests asserted the old
mock-fills-the-slot behavior; updated them to assert the real package id instead (comments explain
why), keeping their actual intent (four slots exist, cross-assignment is impossible) unchanged:
`test_ep_packages.py::test_get_packages_returns_four_slots_with_mocks_in_transparent_slots`,
`test_proposal_registry.py::test_slots_map_mocks_to_transparent_slots`,
`test_us3_package_independence.py::test_list_slots_never_cross_assigns_either_package`.

### T034 — `routers/proposal.py`: real content context + dispatch
Added (new helpers, `select_service` otherwise unchanged in structure):
- `_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"` constant.
- `_catalog_map_for_dataset(dataset_id)` — `DatasetCatalogRegistry.get_catalog(dataset_id)` (the
  FULL frozen catalog, no eligibility narrowing) turned into the `{track_id: Song-dict}` map shape
  `build_content_context`/the package's `evaluate()` expect, via `song.model_dump(mode="json")`.
- `_genre_affinity_artist_genres(dataset_id)` — read-only load of
  `proposal_contracts/dataset/<id>/genre_affinity_v1.json`'s `artist_genres` map (catalog-derived,
  never world-owned per `models/proposal/world.py`'s own docstring); `{}` if missing/unreadable.
- `_build_real_content_context(...)` — assembles the STEP-2 context: starts from the run's
  `world_snapshot["feature_snapshot"]` (already grouped `situation`/`preference`/`history`/
  `additional_proposed`/`_genre_extension_enabled`[/`genre_affinity_v1`] via `World.project()`),
  merges in `catalog` (full frozen catalog) and `_service_id`, derives
  `enabled_feature_extensions` from `feature_snapshot["_genre_extension_enabled"]` (the P1 mock
  path hardcoded this to `[]`), and when the extension is on, merges the dataset's `artist_genres`
  into `feature_snapshot["genre_affinity_v1"]` alongside the World-owned `usage_by_genre`/
  `scene_genre_usage`. Reuses the existing `package_runtime_state` carry-forward logic from
  `_build_content_context`. `catalog_version` = `setup_snapshot.dataset_hash`.
- `select_service` now branches: `if content_pkg.id == _REAL_CONTENT_PACKAGE_ID and
  run_log.setup_snapshot is not None:` uses `_build_real_content_context`; otherwise (the mock
  package, OR the real package on a legacy `world_snapshot`-only run with no `dataset_id` to
  resolve a catalog from) keeps the existing `_build_content_context` unchanged. Dispatch itself
  (`proposal_selector.dispatch_selector`) is reused verbatim — no changes to that module.

## Content context / catalog construction
`feature_snapshot["catalog"]` = every song in the frozen dataset (`DatasetCatalogRegistry.get_catalog`),
keyed by `spotify_track.id`, dumped via `Song.model_dump(mode="json")` — the exact map shape the P6
test harness (`tests/proposal/conftest.py::build_content_context`) already exercises the algorithm
against. `eligible_candidates` = every catalog track id (NO eligibility narrowing added — FR-021).
`excluded_candidates` stays `[]`; the algorithm's own eligibility rules (skip window, karaoke gates,
market/restriction/child-safety) do the actual exclusion inside `evaluate()`.

## Contrast test — which two worlds, how the plans differed
Used the committed seed `seed-night-highway-oshi` (dataset
`soundcharts-grounded-spotify-compatible-demonstration-seed-1042`, `oshi_registered=true`,
`oshi_mode=on`, `oshi_id=synthetic-artist-0001`). `driver_profile.oshi_id` is a universally-scored
(`mask=1`) leaf (not genre-gated), so a single-field change is guaranteed to show up regardless of
the genre extension. World A = the seed unchanged; World B = ONE clone override
(`driver_profile.oshi_id` → `synthetic-artist-0157`, an artist with 10 catalog tracks — picked by
an exploratory script against the real 300-song frozen catalog to confirm a visible difference
before writing the test). `WorldCloneStore.create_clone`'s own `diff` confirms exactly one field
changed (`before`/`after` asserted in the test).

Result: the two `CompletePlan`s differ — `ordered_items` (track ids) differ, and
`synthetic-track-0186`/`synthetic-track-0176` (the new artist's tracks) enter World B's top-5 with
a rationale line explicitly citing the difference: `"推し一致が推薦に寄与（+0.072） / oshi match
supports this pick (+0.072)"`, and their `feature_contributions` row for `feature_id: "oshi_id"`
shows `exact_match: true`, `contribution: ~0.072` (zero in World A). Repeat-run determinism was
also asserted (same clone → identical plan across two independent create+select calls).

## Error / unsupported / no-proposal handling
- **algorithm_error**: tested by swapping in a package registered under the real package's own id
  (`aica_transparent_content_selector_v1`, `family`/`approach` set) whose `algorithm.py` raises —
  proves the new context-building path still routes through `dispatch_selector`'s existing
  exception→`algorithm_error` safety net (category `algorithm_exception`), never a fabricated plan.
- **unsupported_service**: unchanged pre-check in `select_service` (real package's
  `supported_services` is unchanged: `music_playlist`/`humming_karaoke`/`full_karaoke`) — verified
  it still 422s for e.g. `quiz` with the real package registered.
- **no_proposal**: built a world where every catalog song is `driver_profile.skipped_items`-listed
  with `skipped_at == simulation_time` (delta 0 ≤ the default 1800s skip-exclusion window), so
  every candidate is excluded → the real algorithm's own honest `decision_type: "no_proposal"`
  (not an exception, not a 500, not a fabricated plan) — `status` stays `content_selected` since the
  selector itself completed successfully and reported the outcome.

## Frontend (T035)
- `ContentProposalPanel.tsx`: already rendered `CompletePlan` generically (ordered items +
  `ReasonBreakdown` + plan metadata), so no rebuild was needed. Added explicit rendering for every
  non-`complete_plan`/non-`unsupported_service` `decision_type` (`no_proposal`,
  `insufficient_eligible_items`, `invalid_catalog`, `invalid_configuration`,
  `full_karaoke_requires_stopped`, others) via a new `data-testid="content-no-plan"` message block —
  previously these silently rendered nothing beyond the formulation callout.
- "MOCK DATA" marker: was a global badge in `ProposalShell`'s header (applied to both panels
  indiscriminately). Removed from `ProposalShell.tsx` and added as `data-testid="service-mock-badge"`
  inside `ServiceProposalPanel`'s own header — content is now real, so the marker no longer applies
  there.
- New Vitest file `app/frontend/tests/proposal_content_real.test.tsx` (3 tests): real-package
  `CompletePlan` renders identically to the mock's; `no_proposal` renders the new explicit message
  with no `plan-metadata`; the mock badge is present in the service panel and absent from the
  content panel's DOM/text.

## Files touched
- `packages/aica_transparent_content_selector_v1/package.json` (T032)
- `app/api/aica_api/routers/proposal.py` (T034)
- `app/api/tests/proposal/test_real_content_manifest.py` (new, T032)
- `app/api/tests/proposal/test_step2_real_content.py` (new, T033)
- `app/api/tests/proposal/test_contrast_demo.py` (new, T036)
- `app/api/tests/proposal/test_ep_packages.py`, `test_proposal_registry.py`,
  `test_us3_package_independence.py` (updated stale slot-ownership assertions)
- `app/frontend/src/components/proposal/panels/ContentProposalPanel.tsx` (T035)
- `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx` (T035, mock badge)
- `app/frontend/src/components/proposal/ProposalShell.tsx` (T035, mock badge removed)
- `app/frontend/tests/proposal_content_real.test.tsx` (new, T035)

## Test tails
```
Backend (targeted): 13 passed
Backend (tests/proposal full): 679 passed
Backend (whole backend, pyc cleared first): 1698 passed, 3 skipped
Frontend (CI=true npx vitest run): 52 files, 497 passed
Frontend build: vite build clean, 374.47 kB / gzip 109.43 kB
```
Contrast-demo result (`test_contrast_demo.py`): both plans are `decision_type: complete_plan`;
`ordered_items` track-id lists differ; World B's newly-surfaced tracks carry a `feature_contributions`
row for `oshi_id` with `exact_match: true` (zero/absent in World A) and a rationale line explicitly
naming "oshi match" — PASSED. Repeat-run determinism (`test_contrast_demo_is_deterministic_on_repeat`) — PASSED.

## Concerns
1. **Run-log size**: `AlgorithmEvidence.input_snapshot` persists the STEP-2 context verbatim, which
   now embeds the full 300-song frozen catalog (with nested Spotify track/audio-feature objects) on
   every `select-service` call against the real package. A single probe run measured ~1.5 MB for
   one persisted `proposal_runs/<id>.json`. This is architecturally consistent with how
   `dispatch_selector`/`AlgorithmEvidence` already worked (the mock path just never had a non-empty
   catalog to embed), but is a real new disk-usage cost worth a follow-up decision (e.g., exclude/
   redact `catalog` from the persisted `input_snapshot`, or store a catalog reference instead of
   the full map) — out of scope for this unit's brief, flagging for the owner.
2. Two content packages (`aica_transparent_content_selector_v1` and `mock_content_selector_v1`) now
   both declare `content_selector/transparent`, so exactly one slot doc-key maps to exactly one
   package id (`list_slots()` picks the alphabetically-first, which is the real one) even though
   both remain independently selectable by id in `POST /api/proposal/runs`/`select-service`. This
   is intended (mock stays available, real becomes default) but is a slot-model edge case worth
   noting if a future unit adds a second real package to the same slot.
3. No changes were needed to `services/proposal_selector.py`, `dataset_catalog_registry.py`, or the
   content package's `algorithm.py` — all reused unchanged, per the unit's constraints.
