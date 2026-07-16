# Unit F report — T021/T022/T023 P3 routers (datasets/seeds/profiles/validate + typed-world run + SetupSnapshot)

## Status
COMPLETE. TDD: wrote `test_ep_world_setup.py` (20 tests) and extended `test_ep_create_run.py` (+9 tests)
first, confirmed both were red for the intended reason (404s for the not-yet-wired routes; 422s for the
still-required legacy top-level fields), then implemented until green. Full backend suite green afterward
(no regressions).

## What was built

### Router — `app/api/aica_api/routers/proposal.py` (additive)

New service constructors (mirroring the existing `_get_registry()` per-request-instantiation pattern —
registries/stores are built fresh per request from `settings.*`, so monkeypatched env vars in tests take
effect immediately with no app-lifetime caching to invalidate):
- `_get_dataset_registry()` → `DatasetCatalogRegistry(settings.proposal_dataset_dir)`
- `_get_seed_store()` → `WorldSeedStore(settings.proposal_seeds_dir)`
- `_get_profile_store()` → `DriverProfileStore(settings.proposal_profiles_dir)`

New endpoints, in contract order:

1. `GET /api/proposal/datasets` → `{datasets, errors}` from `DatasetCatalogRegistry.list_datasets()` /
   `.list_errors()`.
2. `GET /api/proposal/datasets/{dataset_id}/catalog?offset&limit` → `{provenance, total, songs}`.
   `limit` is `int | None = None` (omit both params → full catalog from `offset` onward, matching a
   simple "read-only catalog view" use case as well as pagination). 404 for an unknown/quarantined
   `dataset_id`. No edit/import route exists anywhere in the router (verified by a test hitting
   POST/PUT on the same path → 404/405).
3. `GET /api/proposal/seeds` → `{seeds: [...]}` summaries; `GET /api/proposal/seeds/{seed_id}` → the
   full `SeedWorld` (already shaped exactly as the contract's `{seed_id, label, description, world}`);
   404 unknown.
4. Driver-profile CRUD: `GET /api/proposal/profiles`, `GET /api/proposal/profiles/{profile_id}` (404),
   `POST /api/proposal/profiles` (201, body `{label, profile}`, catches `pydantic.ValidationError` →
   422 with `exc.errors()` as field-level `detail`), `DELETE /api/proposal/profiles/{profile_id}` (204;
   catches `DriverProfileConflictError` → 409, `DriverProfileNotFoundError` → 404).
5. `POST /api/proposal/worlds/validate` — body `{world: World}` (a new local `ValidateWorldBody`, not
   exported/schema-tracked). Resolves the catalog via
   `DatasetCatalogRegistry.get_catalog(world.control_inputs.dataset_id)`; if the dataset id is unknown,
   returns `{valid: false, issues: [{path: "control_inputs.dataset_id", code: "unknown_dataset", ...}]}`
   rather than a 500. Otherwise delegates to `world_validation.validate_world(world, catalog)` and
   returns `{valid, issues}`. Note: structural violations (bad enum/out-of-range) never reach this logic
   for a fresh HTTP body — FastAPI/pydantic already reject them as a 422 at body-parse time, since
   `ValidateWorldBody.world: World` is a real typed field. `validate_world`'s Rules 1-2 exist for a World
   that was constructed then mutated in-memory bypassing the constructor (already the case before this
   unit) — this endpoint's practical value for a fresh request is almost entirely Rule 3 (catalog
   references) + the new unknown-dataset guard.

### Router — typed-world run creation (T023)

`CreateProposalRunBody` gained, additively:
- `world: World | None = None` — the P3 typed-world path; wins over `world_snapshot` when both are
  present (checked via `if body.world is not None`, not a truthiness/precedence flag).
- `trigger_purpose`/`lifecycle_stage`/`motion_state` changed from required to `... | None = None` —
  pydantic can't express "required unless `world` is set" declaratively, so a new helper
  `_resolve_run_setup(body)` does it explicitly: if `body.world` is set, derives the three values from
  `body.world.control_inputs` (an explicit top-level override, if also supplied, still wins — `or`
  short-circuits on the falsy-but-valid-enum-member concern doesn't apply since these are non-empty enum
  values, never falsy); else requires all three top-level and raises 422 if any is missing (preserving
  the pre-P3 "required" contract for the legacy path).
- `origin_seed_id` / `origin_clone_id` / `origin_profile_id: str | None = None` — optional hints not
  spelled out in the abstract contract JSON but required by the task text ("origin = seed/clone/profile
  id if supplied in the body, else none"); frozen verbatim into `SetupSnapshot.origin`.
- A new top-level guard: `if body.world is None and not body.world_snapshot: raise 422` ("Request must
  include either a typed 'world' or a non-empty 'world_snapshot'"). Existing P1 tests are unaffected —
  they always send a non-empty `world_snapshot`.

New helper `_freeze_setup_snapshot(body, world=..., matrix_version=..., service_pkg=..., content_pkg=...,
service_hyperparameters=...)`:
1. Resolves the catalog for `world.control_inputs.dataset_id` via `DatasetCatalogRegistry`; unknown
   dataset id → 422 with a field-level `[{path, code: "unknown_dataset", message}]` detail (never a
   500, never a fabricated snapshot).
2. Runs `world_validation.validate_world(world, catalog)`; any issues → 422 with
   `[issue.model_dump() for issue in issues]` as `detail` (field-level, matching the contract's "422 →
   invalid world (field-level)").
3. Calls `world.project()` → `(feature_snapshot, feature_provenance)`; builds a plain
   `world_snapshot` dict (`{feature_snapshot, feature_provenance (dumped), catalog_version:
   world.catalog_ref.dataset_hash}`) — this is what feeds `_build_service_context` unchanged (it already
   only reads `.get("feature_snapshot")`/`.get("feature_provenance")`/`.get("catalog_version")`, so no
   change was needed there) and what gets persisted into `ProposalRunLog.world_snapshot` for backward
   compatibility with every existing reader of that field (list/get/reopen, STEP 2's
   `_build_content_context`, etc.).
4. Resolves `service_parameter_set_version` from the *actually-resolved* service hyperparameters dict
   (`hyperparameters.get("parameter_set_version", service_pkg.version)`) — both shipped mock packages
   declare a `parameter_set_version` hyperparameter (default `"1.0.0"`), so this reads the real
   setup-time-frozen value, falling back to the package's own `version` field only if a package doesn't
   declare the hyperparameter. `content_parameter_set_version` uses the content package's *manifest
   defaults* (STEP 2/content hyperparameters aren't resolved until `select-service` is called later —
   out of scope for this unit — so create-run can only snapshot what the content package would default
   to, not what STEP 2 will actually use; this mirrors how `content_contract_version` is already known at
   create time from the manifest alone).
5. Builds and returns the `SetupSnapshot` (`origin`, `matrix_version`, `dataset_id`+`dataset_hash`,
   both packages' ids+contract versions, both parameter-set versions, `feature_provenance`).

`create_proposal_run` then: computes `trigger_purpose/lifecycle_stage/motion_state` via
`_resolve_run_setup`; if `body.world` is set, calls `_freeze_setup_snapshot` and uses its returned
`world_snapshot`/`setup_snapshot` for everything downstream (service context, `prm.create_run`); if not,
behaves exactly as before (`body.world_snapshot`, `setup_snapshot=None`). STEP-1 mock-service dispatch,
event/evidence construction, and journey-state logic are byte-for-byte unchanged from before this unit —
only the *source* of `trigger_purpose`/`lifecycle_stage`/`motion_state`/`world_snapshot` changed.

### Service — `app/api/aica_api/services/proposal_run_manager.py`

`create_run(...)` gained one additive keyword-only parameter: `setup_snapshot: SetupSnapshot | None =
None`, passed straight through to the `ProposalRunLog` constructor (which already had the field from a
prior unit). Every other existing caller/call-shape is unaffected (default `None`).

## Back-compat approach (summary)

- Both `world` and `world_snapshot` are accepted; `world` wins when both are present (checked with `is
  not None`, so an explicitly-`null` `world` in the JSON body correctly falls through to the legacy
  path).
- The legacy `world_snapshot` path (`world` omitted or `null`) is **100% unchanged** — same required
  top-level `trigger_purpose`/`lifecycle_stage`/`motion_state`, same opaque dict persisted, same `None`
  `setup_snapshot`. All 12 pre-existing `test_ep_create_run.py` tests pass unmodified.
- A request with neither a typed `world` nor a non-empty `world_snapshot` is rejected with a clear 422
  before any package/matrix resolution happens.

## Files touched
- `app/api/aica_api/routers/proposal.py` — 8 new endpoints + typed-world run-create migration (imports:
  `BilingualLabel`, `DriverProfile`, `DriverProfileRecord`, `SeedWorld`, `SetupSnapshot`,
  `SetupSnapshotOrigin`, `World` from `models.proposal.*`; `DatasetCatalogRegistry`,
  `DriverProfileConflictError`, `DriverProfileNotFoundError`, `DriverProfileStore`, `WorldSeedStore`,
  `ValidationIssue`, `validate_world` from `services.*`).
- `app/api/aica_api/services/proposal_run_manager.py` — `create_run` gained `setup_snapshot` kwarg.
- `app/api/tests/proposal/test_ep_world_setup.py` (new, 20 tests) — every new endpoint, happy path +
  404/409/422.
- `app/api/tests/proposal/test_ep_create_run.py` (+9 tests) — typed-world 201 + `SetupSnapshot` shape,
  purpose/stage/motion derivation from `world.control_inputs`, origin-hint recording, reopen renders the
  persisted snapshot, back-compat path has `setup_snapshot: null`, 422 field-level on an invalid typed
  world, 422 on neither `world` nor `world_snapshot`, `world` precedence over a simultaneously-present
  `world_snapshot`.

## Test tails

```
$ uv run pytest tests/proposal/test_ep_world_setup.py tests/proposal/test_ep_create_run.py -q
..........................................                               [100%]
42 passed in 1.51s

$ uv run pytest tests/proposal -q
........................................................................ [ 11%]
... (9 rows of dots) ...
632 passed in 4.68s

$ uv run pytest -q   # full backend suite
........................................................................ [  4%]
... (22 rows of dots, 3 skipped) ...
1651 passed, 3 skipped in 39.77s
```

## Concerns / follow-ups for later units

- `origin_seed_id`/`origin_clone_id`/`origin_profile_id` are new request-body fields not literally
  enumerated in `contracts/proposal-p3-api.md`'s abstract `POST /api/proposal/runs` JSON sketch (which
  only lists `{world, service_package_id, mode?, service_parameters?, service_hyperparameters?, run_seed,
  simulation_time}`). They're additive/optional and required by the task text's explicit
  `SetupSnapshot.origin` freezing instruction — a later unit (frontend wiring, T024-T027) should send
  these when the reviewer loaded a seed/clone/profile so `origin` isn't always all-`None` in practice.
- `content_parameter_set_version` in the frozen `SetupSnapshot` reflects the content package's *manifest
  default* hyperparameters at create time, not whatever overrides STEP 2 (`select-service`) will actually
  resolve later — there's no way to know the real STEP-2 value before STEP 2 runs. If a future unit wants
  the snapshot to reflect the *actual* content parameter-set version used, it would need to update
  `setup_snapshot` again at `select-service` time (an additive change to `update_state`/the snapshot
  itself) — out of scope here since the task explicitly scoped `select-service`/STEP 2 wiring to a later
  unit (T032-T034).
- `GET /api/proposal/datasets/{dataset_id}/catalog`'s `limit` defaults to `None` (full catalog), not a
  fixed page size — chosen because the contract text doesn't specify a default and a full 300-song
  catalog is a reasonable, simple default for a read-only reference surface; a later frontend unit should
  pass an explicit `limit` if it wants true pagination UX rather than relying on this default.
- Did not touch `worlds/clone` (US2/T028-T031) or the real content-selector wiring (US3/T032-T036) — both
  explicitly out of scope per the task instructions ("clone is a LATER unit", "this unit does not touch
  STEP-2 content wiring").
