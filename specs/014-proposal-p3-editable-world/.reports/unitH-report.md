# Unit H report — T028-T031 (US2 / P3b: contrast clones + deterministic field-level diff)

## Scope
Implemented US2 of feature 014 (P3): clone a base seed, change one (or more) variables via a
dotted/bracketed override path, and produce a deterministic field-level diff — the contrast mechanism
the demo relies on.

## Backend

- `app/api/aica_api/models/proposal/world.py`: added `FieldOverride {path, value}`,
  `FieldDiff {path, before, after}`, `WorldClone {clone_id, base_seed_id, overrides, world, diff}`.
  Automatically covered by the existing glob-based import-guard test (no trigger `aica_api.models`
  import, no `mdg`).
- `app/api/aica_api/services/world_clone_store.py` (new): `WorldCloneStore.create_clone(base_world,
  base_seed_id, overrides, catalog=None)` applies each override at its dotted/bracketed path onto a deep
  copy of the base world's JSON dump, re-validates structurally via `World.model_validate`, optionally
  re-validates catalog references via the existing (non-`mdg`) `services/world_validation.validate_world`,
  computes the diff by reading the *same* overridden paths back out of the base/clone dumps (never a
  whole-object diff, so it can never produce a spurious entry), and persists atomically under
  `settings.proposal_worlds_dir`. `list_clones` / `get_clone` / `delete_clone` round out the store.
  `InvalidOverrideError` carries `.issues: list[ValidationIssue]` for 422 field-level responses.
- `app/api/aica_api/routers/proposal.py`: `POST /api/proposal/worlds/clone` (201; 404 unknown
  `base_seed_id`; 422 on `InvalidOverrideError`), `GET /api/proposal/worlds/clones`,
  `GET /api/proposal/worlds/clones/{clone_id}` (404), `DELETE /api/proposal/worlds/clones/{clone_id}`
  (204) — wired via `_get_clone_store()` mirroring the existing `_get_seed_store()`/`_get_profile_store()`
  pattern.

## Frontend

- `app/frontend/src/api/proposalClient.ts`: `FieldOverride`, `FieldDiff`, `WorldClone`,
  `WorldCloneSummary` types + `cloneWorld`, `listClones`, `getClone`, `deleteClone`.
- `app/frontend/src/state/proposalStore.ts`: new `clones`/`activeClone`/`selectedCloneId` slice +
  `SET_CLONES` / `CLONE_CREATED` (replaces the whole world with the clone's world, sets
  `activeClone`/`selectedCloneId`/`selectedSeedId`) / `CLEAR_ACTIVE_CLONE` actions. Isolated from
  `runStore` (existing isolation test unaffected).
- `app/frontend/src/components/proposal/WorldClonePicker.tsx` (new): base-seed selector, the 9 milestone
  §5 one-variable presets (18 variant buttons — one per side of each pair: motion, drowsiness, fatigue,
  min-until-rest, oshi_mode, upcoming event, recent rejection, acceptance confidence, genre_affinity_v1),
  plus an arbitrary custom path/value override (JSON-coerced).
- `app/frontend/src/components/proposal/WorldDiffView.tsx` (new): renders `state.activeClone.diff` as a
  path/before/after table; renders nothing when there is no active clone; dismissible.
- Wired into `WorldPanel.tsx` directly below `SeedPicker`.

## Tests (TDD: written first, watched red, then implemented green)

- `app/api/tests/proposal/test_world_clone.py` (new, 25 tests): single/multi-override diffs list exactly
  the changed path(s); deterministic on repeat; unknown/malformed path, invalid value, and dangling
  catalog reference each raise `InvalidOverrideError`; all 9 §5 presets produce the expected single-field
  diff; list/get/delete round-trip; visible across store instances.
- `app/api/tests/proposal/test_ep_world_setup.py`: +11 endpoint tests for clone/list/get/delete (201 with
  exact diff, 404 unknown seed/clone, 422 unknown path / invalid value / dangling reference, deterministic
  repeat, round-trip).
- `app/frontend/tests/proposal_world_clone.test.tsx` (new, 6 tests): preset selection calls `cloneWorld`
  with the right base seed + override; `WorldDiffView` renders exactly the changed field (table has
  exactly 1 header + 1 diff row); custom override path/value works; deterministic render on repeat call;
  `CLONE_CREATED` updates the store (world + `selectedCloneId`); dismiss clears `activeClone` only.

## Verification

- `cd app/api && uv run pytest tests/proposal/test_world_clone.py -q` → 25 passed.
- `cd app/api && uv run pytest tests/proposal -q` → 666 passed (no regression).
- `cd app/api && uv run pytest -q` (full backend incl. trigger) → 1685 passed, 3 skipped.
- `cd app/frontend && CI=true npx vitest run` → 51 files / 494 tests passed (pre-existing, unrelated
  `act(...)` console warnings only, no failures).
- `cd app/frontend && npm run build` → clean (373 KB / 109 KB gzip bundle).

## Commit

`feat(p3): T028-T031 contrast clones + deterministic field-level diff`

## Concerns / follow-ups

- The frontend presets pick fixed absolute target values (e.g. drowsiness → 90/10) rather than toggling
  relative to the base seed's current value; if a base seed already sits at that value the resulting diff
  is a no-op override with `before == after` (still a valid, persisted clone — just not a visible
  contrast). Acceptable for the deliverable; a future pass could compute the toggle from the loaded base
  world instead of a hardcoded constant.
- `WorldClonePicker`'s custom-value input coerces via `JSON.parse` with a string fallback — this is
  reasonable for numbers/booleans/objects/arrays but means a literal unquoted word is treated as a plain
  string (correct) while an unquoted number/bool is parsed as intended; no further validation is done
  client-side (the backend 422 is the source of truth for invalid values).
- No dedicated `list clones` / `reload clone` UI beyond the store slice — `listClones`/`getClone`/
  `deleteClone` are wired in the API client and store-ready, but the panel doesn't yet surface a "recent
  clones" browser. Not required by T028-T031's brief (which scoped the UI to create + diff-view); can be
  added if a later unit needs it.
