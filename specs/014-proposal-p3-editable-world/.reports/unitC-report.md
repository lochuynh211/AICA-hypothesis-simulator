# Unit C report — T012-T014 seed store + 5 promoted base seeds

Branch: `proposal-p3-editable-world`
Commit: `967084f` — feat(p3): T012-T014 seed store + 5 promoted base seeds

## What was built

1. **`SeedWorld` model** — `app/api/aica_api/models/proposal/world.py`: `seed_id: str`,
   `label: BilingualLabel`, `description: BilingualLabel` (reused `BilingualLabel` from the
   existing `package_manifest.py`, no new bilingual-label type invented), `world: World`.
   Re-exported from `app/api/aica_api/models/proposal/__init__.py`.
2. **`WorldSeedStore`** — `app/api/aica_api/services/world_seed_store.py`: mirrors
   `DatasetCatalogRegistry`'s scan/index/error pattern exactly (constructor takes a
   `seeds_dir: Path`, scans `*.json`, validates each strictly against `SeedWorld`, quarantines
   invalid files into `list_errors()`, never partially exposes them). Public API:
   `list_seeds()` (id/label/description summaries), `list_errors()`, `get_seed(seed_id)`.
   Imports only `aica_api.models.proposal.world` + `aica_api.storage.file_store` + stdlib.
3. **`scripts/promote_seeds.py`** — one-time promotion script (not `aica_api` runtime code).
   Reads `generation_workspace/worlds.json` (18 generator worlds) + the frozen
   `soundcharts-grounded-...-seed-1042` dataset's manifest/catalog + the frozen
   `purpose_stage_matrix.v1.json`'s own `matrix_version` ("v1" — never hardcoded), and maps
   each chosen generator world into a complete `World`: `trigger`→`ControlInputs`
   (trigger_purpose/lifecycle_stage default to the generator world's own, overridable),
   `environment`/`driver`/`passengers`→`Situation`'s 11 core fields + `motion_state`,
   `upro`→ oshi fields + `age_band`, `direct_item_history`→ `played_items` +
   `content_proposal_acceptance_rate`/`content_recovery_rate` (rescaled 0-1 → 0-100). Every
   field the generator schema has no equivalent for (`gender`, `hobby_interest_tags`, schedule
   fields, all usage/recency/confidence maps, granular-operation lists) relies on the `World`
   model's own field defaults, per the task's completion rule. Run via
   `cd app/api && uv run python ../../scripts/promote_seeds.py`; writes 5 files, idempotent
   (deterministic — verified by `test_build_all_seeds_is_deterministic`).

## The 5 seeds

| seed_id | maps from generator world | trigger_purpose / lifecycle_stage | notable overrides |
|---|---|---|---|
| `seed-night-highway-oshi` | `world-night-highway-high-drowsiness` | `rest_recommended` / `before_rest_until_stop` (overridden) | `rest_spot_type=sa_pa`, `estimated_min_until_rest_spot=8`, `active_service=None` |
| `seed-daytime-ordinary` | `world-daytime-commute` | generator's own (`inattentive_driving_prevention_recovery` / `active_driving_content`) | `rest_spot_type=unknown`, `active_service=None`, `hobby_interest_tags=["driving","music"]` |
| `seed-characteristic-route-event` | `world-mountain-road` | `route_music` (overridden) / generator's own stage | `route_tags=["mountain","scenic_byway"]`, `destination_tags=["oshi_venue","event_hall"]`, `scheduled_event_type=concert`, `scheduled_event_timing=soon`, `scheduled_event_tags=["oshi_concert"]` |
| `seed-multiple-passengers-child` | `world-child-present` | `child_passenger_experience` (overridden) / `active_driving_content` | `multiple_passengers` forced `True` (generator world only had `child_present=True`) |
| `seed-upcoming-oshi-live-event` | `world-oshi-enabled` | generator's own | `scheduled_event_type=live_show`, `scheduled_event_timing=soon`, `scheduled_event_tags=["live_show","oshi"]` |

Catalog ids used (all pre-existing in the generator worlds, verified present in the frozen
catalog `proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-demonstration-seed-1042/catalog.json`):
`synthetic-artist-0001` (oshi_id, all 5 seeds), `synthetic-track-0001` (played_items /
content_proposal_acceptance_rate / content_recovery_rate, all 5 seeds — every generator world
in `worlds.json` shares this same base-template history entry). No new/invented ids were used;
nothing was left dangling.

## Files

- `app/api/aica_api/models/proposal/world.py` — added `SeedWorld`
- `app/api/aica_api/models/proposal/__init__.py` — re-export `SeedWorld`
- `app/api/aica_api/services/world_seed_store.py` — new
- `scripts/promote_seeds.py` — new
- `proposal_contracts/seeds/{seed-night-highway-oshi,seed-daytime-ordinary,seed-characteristic-route-event,seed-multiple-passengers-child,seed-upcoming-oshi-live-event}.json` — new, committed
- `app/api/tests/proposal/test_seed_store.py` — new
- `app/api/tests/proposal/test_seed_promotion.py` — new

## Test output tails

```
$ cd app/api && uv run pytest tests/proposal/test_seed_store.py tests/proposal/test_seed_promotion.py -q
....................................                                     [100%]
36 passed in 0.50s

$ cd app/api && uv run pytest tests/proposal -q
........................................................................ [ 12%]
...
.............................................................            [100%]
565 passed in 3.17s

$ cd app/api && uv run pytest -q   (full backend, incl. trigger)
...
...                                                                      [100%]
1584 passed, 3 skipped in 40.34s
```
pyc/`__pycache__` cleared before the targeted run; counts were not inflated.

## Concerns

- `content_proposal_acceptance_rate`/`content_recovery_rate` and `played_items` are populated
  from the generator's `direct_item_history` (rescaled 0-1 → 0-100 for the rate fields); the
  richer generator fields (`play_count_30d`, `skipped_count_30d`, `changed_count_30d`,
  `cancelled_count_30d`) have no 1:1 World field and were intentionally not force-mapped
  anywhere else — left as model defaults. Not a correctness issue (every field is still
  present/valid), just a fidelity note for later review.
- `test_committed_seed_files_match_current_promotion_output` (in
  `test_seed_promotion.py`) asserts the committed JSON is byte-for-byte what
  `build_all_seeds()` currently produces — this will need updating in lockstep if a future
  task intentionally changes the promotion mapping and regenerates the seeds.
- Did not touch T001/T002 (config dirs, `proposal_contracts/seeds/.gitkeep`+README) — out of
  this unit's scope; the seeds directory now exists (created implicitly by the script) and is
  populated, but has no `.gitkeep`/README since T002 wasn't part of T012-T014.
- Did not modify the isolation-guard test (`test_p1_isolation_imports.py`) — it currently scans
  only `models/proposal/*.py`, not `services/*.py`; `world_seed_store.py` already satisfies the
  isolation rule by construction (imports only `models.proposal.world` + `storage.file_store` +
  stdlib) but isn't mechanically enforced by that test. Flagging in case a later polish task
  (T011 extension mentioned in tasks.md) wants services covered too.
