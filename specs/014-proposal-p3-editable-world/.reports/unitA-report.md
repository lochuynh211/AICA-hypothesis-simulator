# P3 Unit A Report — T003-T006: read-only dataset/catalog registry foundation

## Scope

Tasks T003, T004, T005, T006 from `specs/014-proposal-p3-editable-world/tasks.md` (Phase 2:
Foundational). Read-only loader for the frozen P2 dataset/catalog with provenance. No editing,
no mutation, no routers — those are later tasks (T021-T023).

## Files created

- `app/api/aica_api/models/proposal/dataset.py` — `DatasetVersion`, `DatasetProvenance`
  (`from_manifest()` classmethod, `to_catalog_ref()`), `CatalogRef`. All three models are
  `frozen=True` Pydantic models (immutable, no edit/mutate method). Reuses the frozen `Song`
  model from `song_schema.py` (not redefined).
- `app/api/aica_api/services/dataset_catalog_registry.py` — `DatasetCatalogRegistry` class.
  Mirrors the scan/index/error pattern of `services/proposal_package_registry.py`. Scans
  `settings.proposal_dataset_dir`, loads each dataset's `dataset_manifest.json` + `catalog.json`,
  validates every song via `mdg.validator.validate_song` (reused, not reimplemented) then builds
  `Song.model_validate(...)`. An invalid song quarantines the *entire* dataset into
  `list_errors()`; `get_catalog`/`get_provenance`/`list_datasets` never partially expose it.
  Public API: `list_datasets()`, `list_errors()`, `get_catalog(dataset_id)`,
  `get_provenance(dataset_id)`.
- `app/api/tests/proposal/test_dataset_model.py` — 8 tests (T003): parses the committed
  `dataset_manifest.json`, exposes `dataset_id`/`dataset_version`/`dataset_hash`/`tier`,
  `to_catalog_ref()` derivation, immutability (`frozen_instance` ValidationError on assignment),
  no edit/mutate method present.
- `app/api/tests/proposal/test_dataset_registry.py` — 10 tests (T005): real frozen dataset loads
  with zero errors, `list_datasets()`/`get_provenance()`/`get_catalog()` correctness (300 songs),
  unknown dataset_id → `None`, frozen files byte-unchanged before/after a full scan, one corrupted
  song quarantines the whole synthetic dataset (never partial), a valid custom dataset loads
  cleanly, missing-manifest dirs (e.g. `.gitkeep`) skipped silently, nonexistent dir → empty
  registry.

## Files changed

- `app/api/pyproject.toml` — added `music-dataset-generator` to `dependencies` (not dev-only,
  since the registry is production runtime code) with
  `[tool.uv.sources] music-dataset-generator = { path = "../../music_dataset_generator", editable = true }`.
  This is a **cyclic editable-package dependency** (mdg already depends on `aica-api` the same
  way, in the other direction) — verified this resolves and installs cleanly with `uv lock` /
  `uv sync` (both packages use hatchling, no build-time metadata cycle).
- `app/api/uv.lock` — regenerated via `uv lock` to add `music-dataset-generator` (httpx version
  resolved to the same pinned `0.28.1` already used by aica-api's dev group — no conflict).

## TDD process

For both units, I wrote the test file first, ran it to confirm RED for the intended reason
(`ModuleNotFoundError` for the not-yet-created module), then implemented the module and reran to
confirm GREEN. Verified by temporarily moving `dataset.py` aside and rerunning
`test_dataset_model.py` (collection error, correct reason), then restoring.

## Commands run and output tails

```
$ cd app/api && uv run pytest tests/proposal/test_dataset_model.py tests/proposal/test_dataset_registry.py -q
..................
18 passed in 0.78s
```

```
$ cd app/api && uv run pytest tests/proposal/test_p1_isolation_imports.py -q
..
2 passed in 0.38s
```

Full proposal suite (`uv run pytest tests/proposal -q`) hits a **pre-existing, unrelated**
collection failure (see Concerns below) that also reproduces bit-for-bit on the pre-change
baseline (verified via `git stash`). Re-run excluding exactly those 10 pre-existing broken files:

```
$ cd app/api && uv run pytest tests/proposal --ignore=tests/proposal/test_content_selector_contract.py \
    --ignore=tests/proposal/test_content_selector_contrasts.py \
    --ignore=tests/proposal/test_content_selector_determinism.py \
    --ignore=tests/proposal/test_content_selector_eligibility.py \
    --ignore=tests/proposal/test_content_selector_genre.py \
    --ignore=tests/proposal/test_content_selector_provenance.py \
    --ignore=tests/proposal/test_content_selector_response_weights.py \
    --ignore=tests/proposal/test_content_selector_scoring.py \
    --ignore=tests/proposal/test_content_selector_traits.py \
    --ignore=tests/proposal/test_song_schema.py -q
...
388 passed in 3.05s
```

Full backend (`uv run pytest`), excluding the same 10 files plus 3 more (pre-existing, same
root cause, in `tests/test_routes_recovery.py`, `tests/test_run_manager_recovery.py`,
`tests/test_tick_engine_recovery.py`):

```
$ cd app/api && uv run pytest --ignore=... (13 pre-existing broken files) -q
...
1387 passed, 3 skipped in 36.33s
```

No regressions: this is the same pass count structure as the pre-change baseline plus my 18 new
tests, confirmed by running the identical ignore-set against `git stash`'d baseline (same 10/13
errors reproduce identically with zero code changes).

## Self-review findings fixed

- Initially considered catching only `SongViolation`/`ValidationError` narrowly in the registry's
  `_scan`; broadened to `except Exception` (matching `ProposalPackageRegistry`'s own broad catch)
  so a malformed `catalog.json` (e.g. not a list, or a dict-shaped song entry) is quarantined
  as an error rather than raising out of the registry constructor.
- Verified `DatasetProvenance`/`CatalogRef` truly have no edit surface: explicit test asserts
  `hasattr(provenance, "edit"/"update"/"mutate"/"set")` is `False`, plus `frozen=True` rejects
  attribute assignment with a `pydantic.ValidationError` (`frozen_instance`).
- Confirmed the read-only invariant holds for real: `test_frozen_files_byte_unchanged_after_load`
  reads the real `dataset_manifest.json`/`catalog.json` bytes before and after a full
  `DatasetCatalogRegistry` scan and asserts equality (nothing in the registry ever opens these
  files for writing).

## Concerns

1. **Pre-existing, unrelated test-collection bug** (not introduced by this unit, not in
   T003-T006 scope): `app/api/tests/` has no `tests/__init__.py`, but several test modules
   (`tests/proposal/test_content_selector_*.py` [8 files], `tests/proposal/test_song_schema.py`,
   `tests/test_routes_recovery.py`, `tests/test_run_manager_recovery.py`,
   `tests/test_tick_engine_recovery.py`) do `from tests.proposal.conftest import ...` /
   `from tests.helpers_recovery import ...`, which fails with
   `ModuleNotFoundError: No module named 'tests.proposal'` / `'tests.helpers_recovery'` under
   plain `uv run pytest` (both `tests/proposal` and full `tests` invocations), causing
   `pytest` to abort collection entirely (`Interrupted: N errors during collection`) instead of
   running anything. I verified via `git stash` that this reproduces identically on the
   pre-change baseline (same 10 files broken running `tests/proposal`, same 13 running the full
   suite) — it is not something my change introduced, and fixing it is out of scope for
   T003-T006 (would require adding `tests/__init__.py` and/or fixing those imports, which touches
   files far outside this unit's assignment). Flagging so the milestone owner / later polish
   task (T038 "Regression: full backend green") is aware and can decide whether to fix it in a
   dedicated task.
2. Adding `music-dataset-generator` as a runtime (non-dev) dependency of `aica-api` creates a
   deliberate cyclic editable-package relationship (mdg → aica-api for the frozen `Song` model;
   aica-api → mdg for `validate_song`). It resolves and installs cleanly with `uv lock`/`uv sync`
   (verified) and is exactly the wiring research.md R3 calls for ("mdg is imported only for this
   read-side validation"), but it is a new architectural coupling worth the reviewer's attention.
3. `list_datasets()`/summary/provenance responses are proposal-shaped dicts consistent with
   `contracts/proposal-p3-api.md`'s `GET /datasets` response fields (`dataset_id`,
   `dataset_version`, `dataset_hash`, `tier`, `synthetic_only`, `song_count`), but no router
   exists yet — that's T021/T022, not this unit.
