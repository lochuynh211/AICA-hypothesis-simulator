# Unit D report — T015/T016 driver-profile store

## Status
COMPLETE. TDD: wrote `test_driver_profile_store.py` first (18 tests), then implemented the model +
service until green. Full backend suite green afterward (no regressions).

## Commit
`5286543` — "feat(p3): T015-T016 driver-profile store (built-in + user CRUD)" on branch
`proposal-p3-editable-world`. Not pushed/merged (per instructions).

## What was built

### Model — `app/api/aica_api/models/proposal/world.py`
Added `DriverProfileRecord` (`extra="forbid"`): `profile_id: str` (non-empty validator, mirrors
`SeedWorld.seed_id`), `label: BilingualLabel`, `builtin: bool`, `profile: DriverProfile`. Exported in
`__all__`.

### Service — `app/api/aica_api/services/driver_profile_store.py`
`DriverProfileStore(profiles_dir, builtin_dir=None)`:
- `list_profiles()` → `{profile_id, label, builtin}` summaries, built-ins first then user profiles.
- `get_profile(profile_id)` → full `DriverProfileRecord` or `None` (built-ins checked first).
- `save_profile(label, profile)` → validates `label`/`profile` via Pydantic (`BilingualLabel.model_validate`
  / `DriverProfile.model_validate` — accepts either dicts or already-typed instances), mints a new
  `profile_id` (`dprof_<YYYYMMDD-HHMMSS>_<6hex>`, the only place timestamp/randomness is generated —
  mirrors `proposal_run_manager._make_run_id`), persists via `write_json_atomic`, returns the record.
  Invalid input raises `pydantic.ValidationError` untouched, so callers get real field-level
  `errors()` (`loc`/`msg`/`type`) rather than a re-wrapped message.
- `delete_profile(profile_id)` → raises `DriverProfileConflictError` for a built-in id (router maps →
  409), `DriverProfileNotFoundError` for an unknown user id (→ 404), else unlinks the file.

Built-ins are loaded once at construction from `builtin_dir` (default
`settings.proposal_contracts_dir / "profiles"`) and never written to. User profiles are re-scanned from
disk on every `list_profiles()`/`get_profile()` call (mirrors `proposal_run_manager.list_runs`/`get_run`
re-reading rather than caching), so saves from one store instance are visible from another instance
pointed at the same directory — exercised by
`test_saved_user_profiles_visible_from_a_new_store_instance`.

### Storage choice
Committed JSON under `proposal_contracts/profiles/*.json` (preferred option) — mirrors the
`proposal_contracts/seeds/` pattern, plus a README explaining these are **hand-curated, not generated**
(unlike seeds, which are script-promoted). User profiles persist under `settings.proposal_profiles_dir`
(already git-ignored, already wired in `config.py` from a prior task).

### Built-in profiles (4, deliberately contrasting)
| id | oshi | hobby tag | genre affinity (enabled) |
|---|---|---|---|
| `profile-anime-fan` | on, `synthetic-artist-0068` (anime) | `anime-fan` | anime=high, vocaloid=high, j-pop=med |
| `profile-wellness-calm` | off | `wellness` | ambient=high, jazz=high, classical=med |
| `profile-jrock-fitness` | on, `synthetic-artist-0079` (j-rock) | `fitness` | j-rock=high, electronic=med |
| `profile-neutral-default` | off | (none) | disabled (no genre extension) |

`oshi_id` values were cross-checked against
`proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-demonstration-seed-1042/catalog.json`
(collected every `spotify_track.album.artists[].id`) — both `synthetic-artist-0068` and
`synthetic-artist-0079` are present, and their genres in that dataset's `genre_affinity_v1.json`
(`anime` and `j-rock` respectively) match the profile's intent. `usage_by_genre` keys are the
`GenreLiteral` controlled vocabulary (Pydantic-enum-validated), not catalog references, so `vocaloid`/
`ambient` are valid even though this particular frozen dataset happens to tag no artist with those two
genres — noted explicitly in `proposal_contracts/profiles/README.md` to avoid future confusion.

## Files touched
- `app/api/aica_api/models/proposal/world.py` (added `DriverProfileRecord`)
- `app/api/aica_api/services/driver_profile_store.py` (new)
- `app/api/tests/proposal/test_driver_profile_store.py` (new, 18 tests)
- `proposal_contracts/profiles/{README.md, profile-anime-fan.json, profile-wellness-calm.json,
  profile-jrock-fitness.json, profile-neutral-default.json}` (new)

## Test tails
```
$ uv run pytest tests/proposal/test_driver_profile_store.py -q
..................
18 passed in 0.47s

$ uv run pytest tests/proposal -q
........................................................................ [ 12%]
... (8 rows of dots) ...
583 passed in 3.30s

$ uv run pytest -q   # full backend suite
... 
1602 passed, 3 skipped in 38.37s
```

## Concerns / follow-ups for later units
- No router wiring in this unit (out of scope per task) — `DriverProfileConflictError` →
  409 and `DriverProfileNotFoundError` → 404 mapping is left as documented contract for whichever
  later task adds the `profiles` router (research.md R4/summary table lists a "profiles CRUD" router).
- `save_profile`'s validation deliberately lets raw `pydantic.ValidationError` propagate rather than
  wrapping it in a custom exception type — matches "invalid → raise with a field-level message" in the
  task text literally (`ValidationError.errors()` already is field-level), but a future router unit will
  need to catch `pydantic.ValidationError` specifically (not just the two custom exceptions here) to
  produce its 422 response.
- Built-in profile JSON files are intentionally *partial* dicts (only the fields that make each profile
  distinctive); all other `DriverProfile` fields fill from the model's own defaults on load. This differs
  from `seeds/`, where full `World` completeness is a first-class, tested requirement — did not add an
  equivalent "every A.1/A.2 field present" assertion for profiles since neither the task text nor
  data-model.md asks for profile completeness, only World completeness.
- Did not extend the isolation-guard test (`test_p1_isolation_imports.py`) — it globs `models/proposal/*.py`
  only (services aren't in scope for that particular test, and `world.py` was already covered), and
  `driver_profile_store.py`'s own imports were manually kept to the allowed set
  (`aica_api.models.proposal.*`, `aica_api.config`, `aica_api.storage.file_store`, stdlib, pydantic) —
  worth a follow-up if a later task wants a services-level isolation guard too.
