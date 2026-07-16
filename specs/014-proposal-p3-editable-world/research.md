# Phase 0 Research — P3 Editable World, Driver Profiles & Contrast

All Technical-Context unknowns are resolved below. No `NEEDS CLARIFICATION` remains.

## R1 — Projection target: the shape the content selector actually consumes

**Decision**: `World.project()` MUST emit the grouped `feature_snapshot` the P6 content package was already
tested against — the P0.5 world-fixture shape — not a flat dict.

**Evidence**: `proposal_contracts/fixtures/worlds/night-highway-baseline.json` top-level groups are
`situation`, `preference`, `history`, `additional_proposed` (+ a sibling `genre_affinity_v1` block and
`_genre_extension_enabled` when the extension is on). The real selector
(`packages/aica_transparent_content_selector_v1/algorithm.py`) reads exactly these:
`snap["situation"]`, `snap["preference"]`, `snap["history"]`, `snap["_service_id"]`,
`context["feature_snapshot"]["catalog"]`, and the genre-affinity block (`artist_genres`,
`usage_by_genre`, `scene_genre_usage`). The test harness `app/api/tests/proposal/conftest.py:build_content_context`
confirms `feature_snapshot` must carry a `catalog` map and the selected service id.

**Consequence**: The typed `World` groups for editing/UI are **control_inputs + situation + driver_profile**
(per the owner's model), but `project()` re-buckets driver_profile fields into the selector's
`preference` / `history` / `additional_proposed` / `genre_affinity_v1` buckets and adds `catalog` +
`_service_id`. A golden test pins `project(seed)` byte-for-byte against a checked-in expected snapshot, and
a cross-check asserts `project(seed)` is accepted by the real selector. FR-007 is corrected from "flat" to
"grouped". No change to `SelectorInput` / P0.5 contracts.

**Alternatives rejected**: (a) a flat snapshot — the selector would not read it; (b) inventing a new
grouping — would diverge from the tested fixtures and risk silent scoring drift.

## R2 — Wiring the real content selector into STEP 2 (P3c)

**Decision**: Register the real content package in the existing content-selector/transparent slot and invoke
it through the existing `services/proposal_selector.dispatch_selector`, exactly as the mock is invoked
today; a raise / invalid shape becomes an `algorithm_error` evidence event (Constitution II/V).

**Findings**:
- `dispatch_selector(context, package, packages_dir, ...)` already loads a package's `algorithm.py`,
  calls `evaluate(context)`, validates the return into `CompletePlan`, and emits `algorithm_error` on any
  failure. This is the adapter path P3c reuses unchanged.
- **Gap**: the real package manifest (`packages/aica_transparent_content_selector_v1/package.json`) declares
  `kind: content_selector`, `contract_version`, `algorithm`, `supported_services`, `parameters`,
  `hyperparameters`, `label` — but **not** the `family` / `approach` fields `ProposalPackageManifest`
  requires. **Task**: add `family: content_selector` and `approach: transparent` to that manifest
  (additive; the P6 direct-import harness reads other keys and is unaffected). Then the registry loads it
  into the transparent content slot and it becomes selectable in STEP 2.
- The package `supported_services` = `music_playlist`, `humming_karaoke`, `full_karaoke`. If the (mock)
  service chosen in STEP 1 is outside this set, STEP 2 surfaces the existing unsupported-service message
  (P1 already handles this) rather than a wrong proposal.
- **Candidates = frozen catalog.** P3 adds no eligibility narrowing (P4). The content context's
  `feature_snapshot.catalog` is built from the frozen dataset songs (the same map shape the P6 tests use).

**Determinism**: the selector is pure (no I/O/clock/random per its docstring); identical world + frozen
catalog ⇒ identical `CompletePlan`. Replay renders the recorded plan without recompute (Constitution III).

**Alternatives rejected**: teaching the registry to read `kind` as `family` (more code, leaves two naming
conventions); keeping the mock and faking contrast (violates the demo's purpose and Constitution I/V).

## R3 — Catalog is read-only; reuse P2 validation only for load-validation

**Decision**: The catalog is the frozen P2 dataset, loaded **read-only**. No in-app editing, no derived
versions, no `catalog_editor` service, no `proposal_datasets_dir` (all withdrawn in the Scope Revision).

**Reuse**: On load, validate each song against the frozen `Song` model (`models/proposal/song_schema.py`)
— the same model `mdg.validator.validate_song` uses — so an invalid dataset is quarantined with an error
rather than partially used. `mdg` is imported only for this read-side validation; no hashing/derivation is
needed. The `dataset_hash` for provenance display is read from the committed `dataset_manifest.json`.

**Alternatives rejected**: catalog editing + derived versions — explicitly cut by the owner (catalog is
changed only by re-running P2).

## R4 — Driver-profile store (first-class, saveable, reusable)

**Decision**: Driver profiles are a first-class store: a few **built-in** named profiles shipped in a
stable app-readable dir, plus **user-saved** profiles persisted (atomic `file_store`) under a new
git-ignored `proposal_profiles/` dir (`AICA_PROPOSAL_PROFILES_DIR`). Endpoints: list / get / save / delete.
A profile is the `DriverProfile` sub-structure (preference + history + additional-proposed profile fields +
genre extension). Loading a profile into a world validates its references against that world's catalog.

**Rationale**: The owner elevated profiles to first-class (clarify Q3). Reuses the proven per-file atomic
persistence pattern of `proposal_run_manager` / the planned `world_seed_store`.

**Alternatives rejected**: profile as an embedded, non-saveable block (owner chose the full store).

## R5 — Seeds & clones storage

**Decision**: **Base seeds** are committed, app-readable artifacts under `proposal_contracts/seeds/`
(SeedWorld shape), promoted from `generation_workspace/worlds.json` by a one-time, tested authoring script
and **completed** so every A.1/A.2 field is initialized. **Clones** are user artifacts persisted under a
git-ignored `proposal_worlds/` dir (`AICA_PROPOSAL_WORLDS_DIR`). Reference validation reuses
`mdg.worlds.validate_world_references`.

**Rationale**: Seeds are review fixtures (committed, deterministic, golden-tested); clones are ephemeral
user work (local, isolated, like runs). The generator workspace is a build area not read at runtime.

**Scope**: ship the **5 representative** seeds named in §5; offer the §5 one-variable contrast changes as
clone presets.

## R6 — Setup snapshot & typed World on run-create

**Decision**: `CreateProposalRunBody.world_snapshot: dict` becomes a validated typed `World`; the router
`project()`s it for the selector context and freezes a `SetupSnapshot` (seed/clone/profile id, catalog
version+hash, algorithm ids + contract versions, parameter-set versions, per-field provenance) into
`ProposalRunLog` in place of the opaque dict. Proposal is pre-release, so an unknown-shape world is rejected
with a clear 422 (no legacy migration).

## R7 — Isolation, determinism, and no-network invariants

- All new `models/proposal/*` and `services/*` stay isolated from the trigger `aica_api.models`
  (import-guard test extended).
- No network/LLM at runtime anywhere in P3 (catalog is local frozen JSON; selector is pure Python).
- Trigger simulator untouched; proposal store/dirs remain separate; regression suites must stay green.

## Summary of new/changed surfaces

| Area | New/changed |
|---|---|
| Models | `world.py` (World, ControlInputs, Situation, DriverProfile, SeedWorld, WorldClone, SetupSnapshot, project()), `dataset.py` (read-only catalog + provenance) |
| Services | `dataset_catalog_registry.py` (read-only), `world_seed_store.py`, `driver_profile_store.py`, `world_validation.py`; extend `proposal_selector` usage for the real content package |
| Packages | add `family`/`approach` to the real content manifest |
| Routers | read-only `datasets`/`catalog`; `seeds`; `profiles` CRUD; `worlds/clone`+diff; `worlds/validate`; typed `World` + `SetupSnapshot` on run-create; STEP 2 → real content selector |
| Config | `proposal_profiles_dir`, `proposal_worlds_dir` (git-ignored). (No `proposal_datasets_dir` — catalog read-only.) |
| Artifacts | `proposal_contracts/seeds/*.json` (5 seeds) + promotion script; generated `world`/`dataset` schemas |
| Frontend | real WorldPanel (seed picker, all groups editable, profile store, genre toggle, clone+diff, read-only catalog provenance); real content proposal in STEP 2 |
