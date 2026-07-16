# Unit G report — T024-T027 real World panel (seeds/profiles/datasets) + typed-world create-run

## Status
COMPLETE. Backend (T003-T023) was already merged onto this branch by prior units (unitC/unitD etc.) —
this unit is purely frontend: TDD-style rebuild of the World panel over the real P3 endpoints.

## What was built

### `app/frontend/src/api/proposalClient.ts`
Added TS types mirroring `app/api/aica_api/models/proposal/{world,dataset,enums}.py` verbatim
(`ControlInputs`, `Situation`, `DriverProfile`, `World`, `CatalogRef`/`DatasetVersion`/`DatasetProvenance`/
`DatasetSummary`, `SeedSummary`/`SeedWorld`, `ProfileSummary`/`DriverProfileRecord`, `WorldValidationIssue`,
plus every enum as a string-literal union) and client methods `getDatasets`, `getCatalog`, `getSeeds`,
`getSeed`, `listProfiles`, `getProfile`, `saveProfile`, `deleteProfile`, `validateWorld`. Extended
`CreateProposalRunBody` with optional `world`, `origin_seed_id`, `origin_clone_id`, `origin_profile_id`
(back-compat `world_snapshot` untouched).

### `app/frontend/src/state/proposalStore.ts` (rebuilt)
Replaced the flat `featureSnapshot: Record<string, unknown>` with a typed `world: World` slice
(`control_inputs`/`situation`/`driver_profile`/`catalog_ref`), plus `seeds`/`profiles`/`datasets`/`catalog`
caches, `selectedSeedId`/`selectedProfileId`, and `worldValidationIssues`. New actions:
`SET_SITUATION_FIELD`, `SET_DRIVER_PROFILE_FIELD`, `SET_GENRE_EXTENSION_ENABLED` (preserves entered
`usage_by_genre`/`scene_genre_usage` across on/off toggles — only initializes them to `{}` the first
time, from `null`), `SET_USAGE_BY_GENRE`, `SET_SCENE_GENRE_USAGE`, `ADD_GENRE_SCENE`/`REMOVE_GENRE_SCENE`,
`SET_DATASET`, `LOAD_SEED` (replaces the whole world + mirrors `control_inputs` into the top-level
`triggerPurpose`/`lifecycleStage`/`motionState`), `LOAD_PROFILE`/`CLEAR_SELECTED_PROFILE`,
`SET_DATASETS`/`SET_SEEDS`/`SET_PROFILES`/`SET_CATALOG`/`SET_WORLD_VALIDATION_ISSUES`.
`triggerPurpose`/`lifecycleStage`/`motionState` remain top-level fields (kept in sync with
`world.control_inputs`/`world.situation.motion_state` by the reducer) for backward compatibility with
`ServiceProposalPanel` and existing tests. `uiLanguage` still defaults `'ja'`; the module still imports
nothing from `runStore` (isolation preserved, `proposalStore.isolation.test.ts` updated + still green).
Default world uses the one frozen P2 dataset id/hash (matches every committed seed).

### New components (`app/frontend/src/components/proposal/`)
- `SeedPicker.tsx` — fetches `getSeeds()` on mount, `getSeed(id)` + `LOAD_SEED` dispatch on Load.
- `DriverProfilePicker.tsx` — fetches `listProfiles()`; Load (`getProfile` + `LOAD_PROFILE`), Save-as
  (label ja/en inputs → `saveProfile` → refresh list → auto-select the new profile), Delete (blocked for
  `builtin` records, `deleteProfile` + refresh + `CLEAR_SELECTED_PROFILE` if it was the active one).
- `DatasetProvenanceBanner.tsx` — read-only `dataset_id`/version/hash/tier; no button/input anywhere
  (asserted by test).
- `CatalogView.tsx` — read-only `<details>` disclosure of the loaded catalog page (id/name/artists).
- `fieldEditors.tsx` — generic, reusable REAL editors: `TextListEditor` (string[]), `RecordEditor`
  (`Record<string, string|number>`, enum-key or free-text key, enum-value or number-value), 
  `NestedRecordEditor` (two-level maps — scene→{genre/service→level}), `ItemListEditor` (timestamped
  `{id_field, ts_field}` lists), `GenreUsageTable` (fixed 12-genre × UsageLevel table).

### `app/frontend/src/components/proposal/panels/WorldPanel.tsx` (rebuilt)
Same 5 section labels/order as P1 (`world-section-label` testid, count unchanged): Trigger signal → Car
state (+ dataset selector + `DatasetProvenanceBanner` + `CatalogView`) → World·situation (all 15
`Situation` fields, incl. the 4 "additional proposed" scene fields with real controls: nullable number/
select, and an item-list editor for `recent_service_rejections`) → Preference & history (all ~34
`DriverProfile` fields as real controls, grouped into 6 sub-headers: Oshi info / UPro info / Usage&scene
tendency / Playback&operations / History rates&confidence / Scheduled event; plus the
`genre_affinity_v1_enabled` toggle + `GenreUsageTable` + scene-genre `NestedRecordEditor`, shown only when
enabled) → Driver profile (`DriverProfilePicker`, LAST). A `SeedPicker` sits above section 1 since loading
a seed replaces the *whole* world, not one section. Every field row carries `data-world-field={key}` (a
non-testid marker used only by the badge-coverage test to disambiguate a field's own row from a complex
editor's internal sub-controls, which reuse the `feature-field-<key>-...` testid prefix) and exactly one
`ProvenanceBadge`. Catalog stays strictly read-only — no edit/import control anywhere in the panel.

### Typed world + origin ids on create-run
`ServiceProposalPanel.handleRun` now sends `world: state.world`, `origin_seed_id: state.selectedSeedId`,
`origin_profile_id: state.selectedProfileId` (dropped the old ad-hoc `world_snapshot` construction — the
backend's `world` path wins and freezes the `SetupSnapshot`). `trigger_purpose`/`lifecycle_stage`/
`motion_state` are still sent top-level too (kept for the existing `proposal_service_panel.test.tsx`
assertions and because they're always in sync with `world.control_inputs` via the reducer).

### STEP 1 / STEP 2 preserved
Neither `ServiceProposalPanel` nor `ContentProposalPanel` needed structural changes beyond the
`createRun` body — both still read/dispatch `state.runLog`/evidence exactly as before, so the mock
service selector (STEP 1) and mock content selector (STEP 2) flows are untouched and their existing
tests (`proposal_service_panel.test.tsx`, `proposal_content_panel.test.tsx`) pass unmodified.

## Tests
Wrote `tests/proposal_world_panel_p3.test.tsx` FIRST (8 tests): JA default; seed load populates
control_inputs/situation/driver_profile; a preference/history field (`service_usage_level`) is a real
editable control, not a JSON dump (asserted by absence of `{`/`[` in its rendered text plus presence of
add-row controls); editing a History rate field updates the store; profile save calls `saveProfile` and
the new profile appears in the picker's `<option>` list; profile delete calls `deleteProfile`; the
`genre_affinity_v1` toggle shows/hides `genre-fields` WITHOUT discarding an entered `usage_by_genre` value
across on→off→on; the dataset provenance banner shows id/version/hash and has zero buttons/textboxes.

Updated pre-existing tests that the rebuild necessarily changed the internals of:
- `proposal_world_panel.test.tsx` — same P1 assertions (section order/count, trigger/lifecycle/motion
  controls, badge presence), `SET_FEATURE_FIELD`→`SET_SITUATION_FIELD`/`featureSnapshot`→
  `world.situation`, and the old "driver-profile-select merges fields" test replaced with "the
  DriverProfilePicker (`profile-picker-select`) renders after the last section label" (document-position
  check) since profile loading is now async/client-backed (covered in depth by the new P3 test file).
- `proposal_provenance_badge_worldpanel.test.tsx` — the old test hardcoded a P1-era 12-key field list and
  an exact total-badge count; P3 has ~48 fields across situation+driver-profile, so the exact count was
  fragile. Rewrote as a structural invariant test using the new `data-world-field` row marker: every world
  field row has exactly one adjacent badge (kept the road_type-vs-drowsiness distinct-provenance
  assertion and added a motion_state-specific check).
- `proposalStore.isolation.test.ts` — `SET_FEATURE_FIELD`→`SET_SITUATION_FIELD`,
  `state.featureSnapshot.*`→`state.world.situation.*` in the two affected assertions; isolation from
  `runStore` still verified identically.

## Test tails
```
$ cd app/frontend && CI=true npx vitest run
 Test Files  50 passed (50)
      Tests  488 passed (488)

$ cd app/frontend && npm run build
✓ 100 modules transformed.
✓ built in 1.86s

$ cd app/api && uv run pytest -q
1651 passed, 3 skipped in 39.49s   # unaffected — no backend files touched
```
`npx tsc --noEmit` shows pre-existing, unrelated repo-wide noise (trigger-side `RouteStatus.tsx`/
`ScenarioBeats.tsx`/`MapSurface.tsx`/`DecisionTracePanel.tsx`/`runStore.ts` type mismatches, and a
`Cannot find name 'global'` issue affecting several `*.test.tsx` files under `tests/` that predate this
unit) — confirmed zero errors from any file this unit touched or added.

## Concerns / follow-ups for later units
- Catalog-referencing free-text fields (`oshi_id`, `catalog_item_usage_level`, `content_proposal_acceptance_rate`,
  etc.) use plain text/number key entry rather than a catalog-backed picker — `POST /worlds/validate`
  already surfaces unknown-reference issues field-by-field, but the World panel doesn't yet call
  `validateWorld`/render `worldValidationIssues` inline (the store slice + action exist, wiring the call
  and rendering `{path,code,message}` next to the offending field is not yet done — a natural next unit,
  and the contract explicitly separates it from T024-T027).
- `scene_service_usage_level`/`scene_content_tag_usage_level`/`scene_genre_usage` scenes are added/removed
  by free-text scene name (no catalog-derived scene vocabulary suggestion).
- `DriverProfilePicker`'s delete flow re-fetches the full profile list rather than optimistically
  removing the deleted entry — simplest correct option given `listProfiles()` is already cheap and
  re-scanned server-side per call (mirrors the backend's own re-scan-on-list convention).
- World clone/contrast (P3b, T028-T031) and the real content selector wiring (P3c, T032-T036) are out of
  scope for this unit, per the task boundary.
