# P3 — Editable Synthetic World, Catalog, And Contrast Clones — Design

**Date:** 2026-07-16
**Milestone:** P3 (per `docs/master/aica_proposal_simulator_milestones.md` §5)
**Branch:** `proposal-p3-editable-world` (off `develop`)
**Status:** Approved design → **re-scoped during `/speckit-clarify` (2026-07-16)** — see the Scope Revision
below. The SpecKit spec `specs/014-proposal-p3-editable-world/spec.md` is authoritative where this record
and it differ.

## Scope Revision (2026-07-16 clarification — owner decision)

Two owner decisions during clarification changed P3's scope from this record's original form. **The net
P3 scope is:**

1. **Catalog is READ-ONLY.** The song catalog is built and frozen in P2; it is changed only by re-running
   P2, never edited in-app. **In-app catalog editing is CUT from P3** — decisions **D3/D6/D7** below about
   catalog editing, derived-dataset versioning, and the `catalog_editor` service / `proposal_datasets_dir`
   are **withdrawn**. The catalog is loaded read-only with provenance. (Milestones §5's catalog-editing
   acceptance criterion is deferred; recorded in the milestone §17 reconciliation.)
2. **Driver profiles are a first-class store** (create / save / list / load / delete; a few built-in named
   profiles) — strengthening **D2**.
3. **The real transparent CONTENT selector is wired in** so a different driver profile yields a *visibly
   different* content proposal over the frozen catalog (the demonstration of algorithmic effectiveness that
   motivates the editable world). The **service** selector stays the P1 mock. The content selector runs
   over the frozen catalog as candidates with **no P4 eligibility narrowing yet**. This intentionally pulls
   the "wire the real content package" work forward from the later P6-wiring milestone; it does **not** add
   real service ranking, eligibility, or the journey engine.

**Revised three vertical slices:** **P3a** typed World + driver-profile store + dataset/catalog read-only
loader + base seeds + full editable feature surface + validation + setup snapshot → **P3b** contrast clones
+ field-level diff → **P3c** wire the real transparent content selector (STEP 2) so profile/situation
changes change the content proposal; service selector stays mock.

Sections below are the original record; where they describe catalog editing (D3/D6/D7, the `catalog_editor`
service, `proposal_datasets_dir`, the `POST …/catalog-edit` route, US2 catalog editing) they are
**superseded** by this revision. Everything about the typed World, projector, seeds, clones, driver
profile, validation, setup snapshot, and P1-UI-preservation stands.

Prerequisites **P0.5** (415a99b), **P6** (5151ed4), **P2** (5ebec22), **P1** (75c0ac9) are all merged
into `develop` and green (`uv run pytest tests/proposal` → 456 passed; full suite documented green at
the P1 merge: 1475 backend / 491 frontend). The frozen P2 dataset
(`proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-demonstration-seed-1042/`, 300
songs, `dataset_hash` in the manifest), the versioned matrix, the disposition registry, and the
committed base-seed worlds + contrast pairs (`generation_workspace/worlds.json`,
`contrast_pairs.json`) are all present.

P1 delivered the standalone 3-panel Proposal screen running on an **opaque, unvalidated
`world_snapshot` dict**, mock driver profiles, and mock selectors. **P3 formalizes the world**: a typed,
editable World (control inputs + situation + driver profile), the frozen P2 dataset loaded as the
in-app catalog with in-app schema-aware editing, complete base seeds, and one-variable contrast clones —
**without changing P1's approved 3-panel UI/UX** (`specs/013-proposal-p1-screen-foundation/ui-mockup.html`)
and **without introducing real scoring, eligibility narrowing, or the journey engine** (those are P4/P5/P6-wiring).

---

## 1. Scope boundary (smallest runnable slices)

P3 delivers **a typed editable world + the frozen catalog (loadable and editable) + complete seeds +
contrast clones**, as **one SpecKit feature `014-proposal-p3-editable-world`** in three runnable
vertical slices:

- **P3a** — typed `World` model + dataset/catalog **loader** (read the frozen P2 dataset by
  id/version/hash, show provenance) + **base-seed load** + the **full editable feature surface** (every
  A.1 service + A.2 content field, grouped as world data, not algorithm params) + **validation**
  (enum/range/reference on edit and load) + the **`SetupSnapshot`** that records versions + per-field
  provenance. The mock selectors keep returning fixed outputs; the world they consume is now real, typed,
  and validated.
- **P3b** — **in-app catalog editing** (`spotify_track` / `spotify_audio_features` / `simulation_flags`)
  through schema-aware controls; **saving re-validates → a new derived dataset version + hash**; the
  frozen dataset is never mutated.
- **P3c** — **contrast clones** (clone-and-change a seed) + a **field-level diff**.

**Explicitly out of scope (unchanged from the milestone):** real transparent/LLM scoring (P5 / P6-wiring /
P8 / P9); motion / catalog / schedule **eligibility narrowing** and the **discrete-event journey engine**
(P4); any **customer catalog import** (the in-app catalog *is* the frozen P2 dataset); **regenerating**
the dataset (edits re-validate, never re-run the generator). The two `constrained_llm` selector slots stay
declared-but-empty.

**Demonstration slice (end of P3):** Open the Proposal app → **① World**: pick a **base seed** (loads a
complete world: control inputs + situation + a driver profile) → the **catalog** panel shows the frozen
dataset's provenance (id / version / hash) and its 300 songs → edit any situation/profile field (validated
live) → optionally toggle `genre_affinity_v1` → **clone-and-change** the seed on one variable and see the
**field-level diff** → edit a catalog song (e.g. change `energy`) and **save → new derived dataset version +
hash** → run STEP 1 / STEP 2 (still mock selectors) against the real typed world → the run's
`SetupSnapshot` records seed + catalog + algorithm + parameter-set versions and per-field provenance →
reopen from `proposal_runs/` renders the same complete world.

---

## 2. Key decisions (resolved during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D0 | **One feature `014`, three vertical slices P3a/P3b/P3c.** All P3 acceptance criteria land in this milestone; each slice leaves the app runnable and reviewable. | Mirrors P2's P2a/P2b/P2c staging. The milestone is the largest proposal milestone; slicing bounds each review surface without dropping any AC. |
| D1 | **World model is strictly separate from algorithm parameters.** The **① World panel** owns the world model only: **control inputs + situation + driver profile**. Algorithm **parameters/hyperparameters stay in the ②/③ selector panels** (non-feature setup), exactly as P1 ships them. | Direct user instruction and the P1 mockup: params are setup, not world. Keeps the boundary the constitution requires (features vs non-feature setup) structurally visible in the layout. |
| D2 | **Preference + history belong to a Driver profile.** A `DriverProfile` is a reusable, loadable, editable entity bundling preference (oshi/UPro, service & content usage levels, scene usage, content-use/recency) + history (proposal acceptance/recovery rates + confidence, playback/operation history, schedule). A seed embeds one profile. | User instruction. P1 already badged preference/history "from profile" and had a profile selector; P3 formalizes it. Lets a profile be reused across situations/seeds. |
| D3 | **"Additional proposed" is a per-field provenance tag, not a category/panel.** Fields with `feature_origin = proposed_addition` (rest-spot type, active service, recent rejections, evidence confidence, detailed oshi, granular playback ops) are folded by nature into **Situation** (scene/session) or **Driver profile** (history/confidence) and shown with the existing per-field provenance badge. | User asked what "additional proposed" is. It is a provenance origin in Appendix A, not an algorithm concept. Surfacing it as a scary top-level group would confuse; the badge already communicates provenance. |
| D4 | **`genre_affinity_v1` is an opt-in toggle inside the Driver profile.** It adds per-driver `usage_by_genre` / `scene_genre_usage`; **only the content algorithm scores it, and only when enabled** — otherwise the fields are carried as `context_only` and ignored. The song→genre mapping (`artist_genres`) is **catalog-side** (from the dataset), not the driver. | User asked what "affinity genre" is and whether it belongs to an algorithm. It is a driver-profile extension consumed by the content selector; the catalog side is dataset metadata. Off by default (Spotify-only V1 default). |
| D5 | **Typed `World` replaces the opaque `world_snapshot`; a deterministic `project()` flattens it to the flat `SelectorInput.feature_snapshot`.** No selector or P0.5/P6 contract changes — the flat snapshot the selectors already consume is produced by the projector. | The whole world today is `dict[str, Any]` with zero validation (backend seam #1). Formalizing it upstream and projecting down keeps the frozen selector contract untouched. |
| D6 | **Frozen dataset is immutable; catalog edits create a new *derived* dataset version.** Edits write to a writable `proposal_datasets/` dir (git-ignored, like `proposal_runs/`) as `dataset_id = <base>-edited-<n>` with `derived_from` + a fresh `dataset_hash`. Re-validation reuses the P2 building blocks directly. | The frozen dataset is the replay boundary (constitution III + milestone determinism gate) and must never be mutated. "Generated artifacts are changed through schema-aware editors, never hand-edited" is satisfied by the in-app editor + re-validation; a derived version keeps provenance honest. |
| D7 | **Reuse the P2 (`mdg`) validation/hash building blocks; do not re-implement.** `mdg.validator.validate_song`, `mdg.repair.validate_and_repair`, `mdg.freeze.{assert_label_free, compute_dataset_hash, build_manifest}`, `mdg.worlds.validate_world_references`. | These already validate against the *same* frozen `Song` model (`models/proposal/song_schema.py`) and produce the manifest/hash. Re-implementing would risk divergence from the P2 freeze contract. |
| D8 | **Keep P1's 3-panel UI/UX; retire the "MOCK DATA" badge only for the world/catalog surface.** No 4th "Setup" panel is reintroduced. The § in the milestone text about "parameters/hyperparameters as separate setup panels (Panel ②)" is satisfied by P1's per-panel setup (params distinct from features). | User: "make sure everything coherent with P1 UI/UX." Resolves the §17-style Panel-② divergence by honoring the invariant (features vs non-feature setup are separate), not the literal 4-panel layout P1 already reversed. Selectors stay mock, so their panels keep a mock marker. |

---

## 3. Backend contracts (`app/api/aica_api/models/proposal/`)

All new modules live in the **isolated** `models/proposal/` subpackage (no import of the trigger
`aica_api.models`; enforced by the existing import-guard test).

**Reused unchanged:** `SelectorInput` (flat `feature_snapshot` + `feature_provenance` + `catalog_version`),
`enums.py` (`TriggerPurpose`, `LifecycleStage`, `MotionState`, `ServiceId`, `UsageLevel`, `GenreLiteral`,
`FeatureOriginProvenance`, …), `song_schema.py` (`Song`), `genre_extension.py` (`GenreAffinityV1`),
`matrix.py`, the disposition registry (`dispositions/content_feature_dispositions.v1.json`).

**New in P3 — `models/proposal/world.py`:**

- **`DriverProfile`** — `profile_id`, `label {ja,en}`, and the **preference + history** field groups:
  UPro (`age_band`, `gender`), oshi (`oshi_registered`, `oshi_mode`, `oshi_id?`, `oshi_type?`,
  `oshi_tags`), service usage (`service_usage_level`, `service_recency_state`,
  `scene_service_usage_level`), content usage (`usage_by_genre?`, `scene_genre_usage?` — gated on the
  extension; `catalog_item_usage_level`, `catalog_item_recency_state`, `content_proposal_acceptance_rate`,
  `content_recovery_rate`, `content_*_confidence`), playback/operation history (`played_items`,
  `skipped_items`, `completed_items`, `manually_selected_items`, `repeated_items`, `changed_from_items`,
  `cancelled_content_plans`, `direct_item_history`), service proposal performance
  (`service_proposal_acceptance_rate`, `service_recovery_rate`, `service_*_confidence`), schedule
  (`scheduled_event_type`, `scheduled_event_timing`, `scheduled_event_tags`),
  `genre_affinity_v1_enabled: bool = False`. IDs referencing the catalog (`oshi_id`, item histories) are
  validated against the loaded dataset (D7).
- **`Situation`** — the momentary scene: `drowsiness_level`, `fatigue_level`, `traffic_state`,
  `road_type`, `night_state`, `monotony_level`, `route_tags`, `destination_tags`, `child_present`,
  `multiple_passengers`, `motion_state`, `estimated_min_until_rest_spot?`, `rest_spot_type`,
  `active_service?`, `recent_service_rejections`. Range/enum-validated (drowsiness/fatigue/monotony
  `0–100`, minutes `≥0`, enums typed).
- **`ControlInputs`** — `trigger_purpose`, `lifecycle_stage`, `motion_state`, `matrix_version`,
  `dataset_id` (catalog selection). Purpose/stage compatibility reuses the shared rule.
- **`World`** — `control_inputs: ControlInputs`, `situation: Situation`, `driver_profile: DriverProfile`,
  `catalog_ref: CatalogRef` (`dataset_id`, `dataset_version`, `dataset_hash`). Method
  **`project() → (feature_snapshot: dict, feature_provenance: dict[str, FeatureProvenanceEntry])`** —
  the single deterministic flattener to the P0.5 `SelectorInput` shape; provenance per field is sourced
  from the disposition registry.
- **`SeedWorld`** — `seed_id`, `label {ja,en}`, `description {ja,en}`, and a complete `World`. Loaded from
  `proposal_contracts/seeds/`. Golden-tested: reload restores the identical complete world.
- **`WorldClone`** — `clone_id`, `base_seed_id`, `overrides: list[FieldOverride]` (`path`, `value`), and a
  computed `diff: list[FieldDiff]` (`path`, `before`, `after`). Deterministic; references validated.
- **`SetupSnapshot`** — records the world + `seed_id?` / `clone_id?`, `matrix_version`, `dataset_id` +
  `dataset_hash`, `service_package_id` + `content_package_id` + their contract versions,
  `parameter_set_version`s, and the per-field provenance map. Embedded into `ProposalRunLog` in place of
  the opaque `world_snapshot`.

**Dataset/catalog model — `models/proposal/dataset.py`:** `DatasetManifest` mirror (id, versions, hash,
`derived_from?`, `tier`, `synthetic_only`, provenance note), `CatalogSong` = the frozen `Song`. Validation
delegates to `mdg`.

---

## 4. Services

- **`services/dataset_catalog_registry.py`** (`DatasetCatalogRegistry`, isolated; peer to
  `ProposalPackageRegistry`) — scans `settings.proposal_dataset_dir` (frozen) **and**
  `settings.proposal_datasets_dir` (derived, writable) for `dataset_manifest.json` + `catalog.json`
  (+ `genre_affinity_v1.json`); indexes by `dataset_id`; exposes provenance (id/version/hash/derived_from);
  validates every song against `Song` on load and reports invalid datasets in an errors list (never
  partially used). `get_catalog(dataset_id)`, `list_datasets()`.
- **`services/catalog_editor.py`** — `apply_edit(base_dataset_id, edits) → new DatasetManifest`:
  applies field-level song edits, re-validates each edited song (`mdg.validator.validate_song` /
  `validate_and_repair`), enforces `mdg.freeze.assert_label_free`, recomputes
  `mdg.freeze.compute_dataset_hash`, rebuilds the manifest (`build_manifest`, `derived_from = base`,
  incremented version), and writes atomically to `proposal_datasets/<new-id>/`. Never touches the frozen
  dir. Invalid edits are rejected with useful messages (which song, which field, why).
- **`services/world_seed_store.py`** — `list_seeds()`, `get_seed(seed_id)` (from
  `proposal_contracts/seeds/`); `create_clone(base_seed_id, overrides)` (computes diff, validates,
  persists to `proposal_worlds/` via the atomic `file_store`), `list_clones()`, `get_clone()`,
  `delete_clone()`.
- **`services/world_validation.py`** — `validate_world(world, catalog) → list[ValidationIssue]`:
  enum/range checks (mostly structural via Pydantic) + **reference checks** (`oshi_id`, item-history keys,
  `active_service`, played/skipped/… item ids) against the loaded catalog, reusing
  `mdg.worlds.validate_world_references`. Returns actionable messages.

**Seed authoring (one-time, tested):** a small committed script/CLI maps the generator's nested
`generation_workspace/worlds.json` shape into the canonical `SeedWorld` shape and **completes** every
field (§5: "each seed initializes all fields"), emitting the 5 representative complete seeds +
the required contrast-pair seeds into `proposal_contracts/seeds/`. A golden test asserts the promoted
seeds validate and round-trip. Seeds are committed artifacts.

---

## 5. Routers (`routers/proposal.py`, additive)

- `GET /api/proposal/datasets` — list datasets (frozen + derived) with provenance/version/hash + errors.
- `GET /api/proposal/datasets/{dataset_id}/catalog` — the catalog songs (paginated) + manifest.
- `POST /api/proposal/datasets/{dataset_id}/catalog-edit` — apply edits → **new derived dataset**
  (returns new id/version/hash); 422 with per-field messages on invalid edits.
- `GET /api/proposal/seeds` · `GET /api/proposal/seeds/{seed_id}` — base seeds (complete worlds).
- `POST /api/proposal/worlds/clone` — clone-and-change a seed → clone + field-level diff.
  `GET/DELETE` clones under `/api/proposal/worlds/…`.
- `POST /api/proposal/worlds/validate` — validate a world against its catalog → issue list.
- **`POST /api/proposal/runs`** — the request body gains a typed **`World`** path: when `world` is
  supplied it is validated, `project()`ed to the grouped `feature_snapshot` for the selector context, and
  a `SetupSnapshot` is frozen into the run. **As implemented, the endpoint keeps a dual path:** the legacy
  `world_snapshot: dict` body remains a supported alternate (the P1 mock flow + inherited P1 tests still
  use it), and the typed `world` path is preferred when present; a body with neither a valid `world` nor a
  `world_snapshot` is rejected with a clear 422. (The original design intent was to reject all untyped
  worlds outright, but the dual path was kept to avoid a breaking migration of the green P1 suite; the
  legacy `world_snapshot` path is a fast-follow retirement candidate.)

New config: `proposal_datasets_dir` (`AICA_PROPOSAL_DATASETS_DIR`, default `<repo>/proposal_datasets/`)
and `proposal_worlds_dir` (`AICA_PROPOSAL_WORLDS_DIR`, default `<repo>/proposal_worlds/`), both
git-ignored like `proposal_runs/`.

---

## 6. Frontend (P1 3-panel UI/UX preserved)

- **`state/proposalStore.ts`** — new slices: `world` (typed: control_inputs / situation / driver_profile /
  catalog_ref), `seeds`, `selectedSeedId`, `datasets`, `activeDatasetId`, `catalog`, `clones`,
  `worldValidationIssues`. The old flat `featureSnapshot` is replaced by the typed world; the store still
  sends the world to the backend (which projects it). JA-default preserved; isolation from `runStore`
  preserved.
- **`api/proposalClient.ts`** — `getDatasets`, `getCatalog`, `editCatalog`, `getSeeds`, `getSeed`,
  `cloneWorld`, `validateWorld` (+ existing calls).
- **`components/proposal/panels/WorldPanel.tsx`** — becomes the real editor, same section order as the P1
  mockup:
  - **Control inputs** (trigger signal · car state · matrix version · **dataset/catalog selector**).
  - **Situation** — all scene fields as real controls (P1 already has most).
  - **Driver profile** — a **profile selector** + editable preference + history (the P1 read-only JSON
    dumps become real controls) + the **`genre_affinity_v1` toggle**.
  - **Seed picker** (loads a complete world) + **Clone-and-change** control → **DiffView**.
  - **Catalog viewer/editor** (provenance/version/hash banner + song list; schema-aware edit → save → new
    version) — behind a disclosure to keep the default view calm, matching P1's grid discipline.
- New small components: `SeedPicker`, `CatalogView` + `SongEditor`, `WorldDiffView`, `DatasetProvenanceBanner`.
  Reuse `ProvenanceBadge` per field; every label bilingual via `t()`; JA default.
- The permanent "MOCK DATA" badge is scoped to the **selector panels only** (they remain mock until
  P5/P6-wiring); the world/catalog surface is real.

---

## 7. Test strategy (TDD, per slice)

**P3a** — `World`/`Situation`/`DriverProfile`/`ControlInputs` schema + range/enum validators; `project()`
→ flat `feature_snapshot` (+ provenance from the disposition registry) golden test; `DatasetCatalogRegistry`
loads the frozen dataset, exposes id/version/hash, validates songs, quarantines invalid datasets; seed
load + **round-trip golden** (reload restores identical complete world); world reference validation with
useful messages; `SetupSnapshot` recorded on run create; import-guard (no trigger imports); frontend
Vitest: seed picker loads a world, all feature groups editable, provenance badges, JA default.

**P3b** — catalog edit → re-validate (valid edit succeeds; invalid edit rejected with per-field message);
**frozen dataset immutability** (edit never writes the frozen dir); new derived dataset has a *different*
hash + `derived_from`; `assert_label_free` enforced on the edited catalog; frontend: song editor →
save → new version banner.

**P3c** — clone-and-change produces a **deterministic field-level diff**; only the changed field differs;
reference validation on clones; frontend: DiffView renders before/after.

**Cross-cutting** — full **trigger regression** stays green; proposal-store edits never mutate `runStore`;
`docker compose up` E2E demonstration slice (§1).

Verification commands: `cd app/api && uv run pytest` · `cd app/frontend && npm test` ·
`npm run build` · `docker compose config` · `docker compose up`.

---

## 8. Cross-milestone quality gates (P3 posture)

- **Boundary** — world / dataset / selectors / eligibility / journey / evidence stay separated; P3 adds
  the **world** and **dataset/catalog** boundaries as first-class typed surfaces, distinct from the
  selectors (which stay mock) and from algorithm params (which stay in the selector panels).
- **Feature** — every A.1/A.2 row is editable and carries a provenance/disposition; none is silently
  dropped; `genre_affinity_v1` fields are `context_only` when the toggle is off.
- **Determinism / Grounding** — the frozen dataset is never mutated (immutable replay boundary); edited
  datasets are *derived*, versioned, and hash-stamped; synthetic identity (`synthetic-` ids, `.invalid`
  urls) is re-validated on every edit; no live LLM/network call.
- **Evidence** — `SetupSnapshot` records seed/clone + dataset + algorithm + parameter-set versions and
  per-field provenance; reopening a run renders the same complete world.
- **Regression** — the trigger simulator continues to pass its tests; the proposal module stays isolated.
- **Human-judgment** — no world/catalog edit becomes a correctness claim.

---

## 9. §17 source-reconciliation records (resolved in P3)

- **Base-seed location & shape — RESOLVED (P3).** The committed generator seeds
  (`generation_workspace/worlds.json`, nested `trigger/driver/environment/…` shape) are **promoted** at
  authoring time into a stable, app-readable `proposal_contracts/seeds/` dir in the canonical `SeedWorld`
  shape (control_inputs + situation + driver_profile), **completed** so every A.1/A.2 field is
  initialized. The generator workspace remains a build area; the app reads only the promoted seeds. A
  golden test guards the promotion.
- **Panel ② "separate setup" vs P1's 3-panel — RESOLVED (P3).** Honor the invariant (algorithm
  parameters/hyperparameters are non-feature setup, kept distinct from world features) via P1's approved
  per-panel setup; do **not** reintroduce a 4th Setup panel. The **① World panel owns the world model
  only**; params live in the ②/③ selector panels. Reconcile the milestone §5 wording accordingly.
- **Post-rest 4→5, schedule ownership, content Additional-proposed coverage, field renames,
  control-input naming** — already RESOLVED in P1/P0.5; inherited unchanged.

---

## 10. Files (indicative)

**Additive edits:** `app/api/aica_api/config.py` (2 new dirs), `app/api/aica_api/routers/proposal.py`
(new routes + typed `World` on run-create), `.gitignore` (`proposal_datasets/`, `proposal_worlds/`),
`app/frontend/src/App.tsx`/`state/proposalStore.ts` (world slices). Master-doc reconciliation is limited
to the **milestones doc** (§5 Panel-② note + §17 two resolved items — done at design time); the
consolidated spec's §8/§9 feature tables already match the typed `World` groups and need no edit, and the
approved 4-panel `aica_proposal_overview_en_ja.html` reference is left untouched (P1 already carries the
approved 3-panel `ui-mockup.html`).

**New (backend):** `models/proposal/{world,dataset}.py`;
`services/{dataset_catalog_registry,catalog_editor,world_seed_store,world_validation}.py`;
seed-promotion script/CLI + `proposal_contracts/seeds/*.json`; `proposal_contracts/schema/{world,dataset}.schema.json`
(generated via `export_schema`).

**New (frontend):** `api/proposalClient.ts` additions; `components/proposal/{SeedPicker,CatalogView,
SongEditor,WorldDiffView,DatasetProvenanceBanner}.tsx`; expanded `panels/WorldPanel.tsx`.

**Master-doc reconciliation:** `docs/master/aica_proposal_simulator_milestones.md` (§5 Panel-② note; §17
two items marked resolved), `docs/master/aica_proposal_simulator_specification.md` (§8/§9 world-model shape
aligned to the typed `World`).
