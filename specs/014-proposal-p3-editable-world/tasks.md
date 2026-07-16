---
description: "Task list — P3 Editable World, Driver Profiles & Contrast (feature 014)"
---

# Tasks: Editable Synthetic World, Driver Profiles & Contrast (P3)

**Input**: `specs/014-proposal-p3-editable-world/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Included (TDD). Contract/integration tests are required for contract surfaces (Constitution
"Contract surfaces are tested first"). Write the test, watch it fail for the intended reason, then implement.

**Organization**: By user story — **US1 = P3a** (world + profile store + read-only catalog + seeds),
**US2 = P3b** (contrast clones + diff), **US3 = P3c** (wire the real content selector). Each story is an
independently testable increment.

**Paths**: backend `app/api/aica_api/…`, backend tests `app/api/tests/proposal/…`, frontend
`app/frontend/src/…`, frontend tests `app/frontend/tests/…`.

**Invariants for every task**: proposal module stays isolated from the trigger `aica_api.models`; frozen
dataset is read-only; no network/LLM at runtime; JA default; backend is the authority.

---

## Phase 1: Setup

- [ ] T001 Add `proposal_profiles_dir` (`AICA_PROPOSAL_PROFILES_DIR`, default `<repo>/proposal_profiles`) and `proposal_worlds_dir` (`AICA_PROPOSAL_WORLDS_DIR`, default `<repo>/proposal_worlds`) to `app/api/aica_api/config.py`; add `proposal_profiles/` and `proposal_worlds/` to `.gitignore`.
- [ ] T002 [P] Create `proposal_contracts/seeds/` with a `.gitkeep` and a short `README.md` (committed base-seed worlds, canonical `SeedWorld` shape, promoted from the generator workspace — not hand-edited).

## Phase 2: Foundational (blocking prerequisites for all stories)

- [ ] T003 [P] Write tests for the read-only dataset/catalog model in `app/api/tests/proposal/test_dataset_model.py`: `CatalogRef`/`DatasetProvenance` parse from the committed `dataset_manifest.json`; provenance exposes `dataset_id`/`dataset_version`/`dataset_hash`/`tier`; model is immutable (no edit API).
- [ ] T004 Implement `app/api/aica_api/models/proposal/dataset.py` (read-only `CatalogRef`, `DatasetProvenance`) to pass T003; reuse the frozen `Song` model from `song_schema.py`.
- [ ] T005 [P] Write tests for `DatasetCatalogRegistry` in `app/api/tests/proposal/test_dataset_registry.py`: loads the frozen dataset by id; validates every `Song` (invalid dataset → quarantined in an errors list, never partially used); exposes provenance; frozen files are byte-unchanged after load.
- [ ] T006 Implement `app/api/aica_api/services/dataset_catalog_registry.py` (read-only loader over `settings.proposal_dataset_dir`, `get_catalog`/`list_datasets`/provenance) to pass T005; validate songs via `Song.model_validate` (the frozen `Song` model already enforces synthetic-id/`.invalid`/ranges/cross-object identity — the same checks `mdg.validator.validate_song` wraps). **Do NOT add `mdg` as a runtime dependency** (it creates a cyclic `aica-api`↔`mdg` coupling and its editable install collides on the `tests` package).
- [ ] T007 [P] Write tests for the typed world model in `app/api/tests/proposal/test_world_model.py`: `ControlInputs` (purpose/stage compatibility), `Situation` (ranges/enums), `DriverProfile` (preference/history/additional-proposed/genre fields), and `World` assemble/validate; every A.1/A.2 field is present exactly once.
- [ ] T008 Implement `app/api/aica_api/models/proposal/world.py` — `ControlInputs`, `Situation`, `DriverProfile`, `World` (no `project()` yet) to pass T007. Reuse `enums.py`; keep isolated from trigger models.
- [ ] T009 [P] Write the projection golden test `app/api/tests/proposal/test_world_projection.py`: `World.project()` emits the P0.5 fixture grouping (`situation`/`preference`/`history`/`additional_proposed`[/`genre_affinity_v1`] + `catalog` + `_service_id`) with `feature_provenance` from the disposition registry; assert byte-equality against a checked-in expected snapshot; assert the output is accepted by the real content selector's `evaluate` input contract.
- [ ] T010 Implement `World.project()` in `models/proposal/world.py` to pass T009 (deterministic mapping of driver-profile fields into preference/history/additional_proposed/genre buckets; provenance from `content_feature_dispositions.v1.json`).
- [ ] T011 Extend the import-guard test (`app/api/tests/proposal/test_import_guard.py` or equivalent) to cover `models/proposal/{world,dataset}.py` and the new services — no import of the trigger `aica_api.models`.

**Checkpoint**: dataset loads read-only with provenance; typed World validates and projects to the tested selector shape.

## Phase 3: User Story 1 — Build a complete world & manage driver profiles (P3a) — Priority P1

**Goal**: Load a complete base seed, edit every world field with validation, and create/save/reuse driver
profiles; run records a setup snapshot. (Selectors still mock.)

**Independent test**: Load a seed → all groups populated & editable → save a named profile & reload it →
invalid edit rejected with a field-level message → run → setup snapshot records versions + provenance →
reload seed restores the identical world.

### Backend — seeds

- [ ] T012 [P] [US1] Write `app/api/tests/proposal/test_seed_store.py`: 5 representative base seeds load; each is a complete `World` (every A.1/A.2 field initialized); round-trip (load→dump→load) is identical; references validate against the frozen catalog.
- [ ] T013 [US1] Add `SeedWorld` to `models/proposal/world.py` and implement `app/api/aica_api/services/world_seed_store.py` (`list_seeds`/`get_seed` over `proposal_contracts/seeds/`) to pass T012.
- [ ] T014 [US1] Implement a tested one-time promotion script `scripts/promote_seeds.py` (or an `mdg` CLI subcommand) that maps `generation_workspace/worlds.json` into the canonical `SeedWorld` shape and **completes** every field; run it to emit the 5 representative seeds into `proposal_contracts/seeds/*.json`; commit them. Add `app/api/tests/proposal/test_seed_promotion.py` asserting the promoted seeds validate + round-trip.

### Backend — driver-profile store

- [ ] T015 [P] [US1] Write `app/api/tests/proposal/test_driver_profile_store.py`: built-in profiles list; save a user profile → appears in list & reloads identically; delete a user profile (built-in delete → 409); invalid profile rejected with field-level message; references validated when loaded into a world.
- [ ] T016 [US1] Add `DriverProfileRecord` to `models/proposal/world.py` and implement `app/api/aica_api/services/driver_profile_store.py` (built-in set + user CRUD over `settings.proposal_profiles_dir`, atomic `file_store`) to pass T015.

### Backend — validation & setup snapshot

- [ ] T017 [P] [US1] Write `app/api/tests/proposal/test_world_validation.py`: enum/range/purpose-stage violations and unknown catalog references each produce a field-level `{path,code,message}`; a valid world yields no issues.
- [ ] T018 [US1] Implement `app/api/aica_api/services/world_validation.py` (`validate_world(world, catalog)`) to pass T017. Reference validation is done **directly against the supplied catalog** (set-membership of track/artist ids) — **NOT** via `mdg` (the `mdg` runtime dependency was removed; do not reintroduce it).
- [ ] T019 [P] [US1] Write `app/api/tests/proposal/test_setup_snapshot.py`: creating a run freezes a `SetupSnapshot` (seed/clone/profile id, dataset id+hash, algorithm ids + contract versions, parameter-set versions, provenance); reopening renders it without recompute.
- [ ] T020 [US1] Add `SetupSnapshot` to `models/proposal/world.py`; update `models/proposal/proposal_run.py` to carry `setup_snapshot` (replacing the opaque `world_snapshot`) to pass T019.

### Backend — routers (typed world, seeds, profiles, datasets read-only)

- [ ] T021 [P] [US1] Write `app/api/tests/proposal/test_ep_world_setup.py`: `GET /datasets`, `GET /datasets/{id}/catalog` (read-only + provenance, no edit route), `GET /seeds`, `GET /seeds/{id}`, profile CRUD endpoints, `POST /worlds/validate` — per `contracts/proposal-p3-api.md`.
- [ ] T022 [US1] Implement the read-only dataset/catalog, seeds, profile-CRUD, and world-validate routes in `app/api/aica_api/routers/proposal.py` to pass T021.
- [ ] T023 [US1] Update `POST /api/proposal/runs` to accept a typed `World` (validated + projected) and freeze a `SetupSnapshot`; reject unknown-shape worlds with a 422 field-level message. Update `app/api/tests/proposal/test_ep_create_run.py` / add cases.

### Frontend

- [ ] T024 [P] [US1] Add TypeScript types + client methods in `app/frontend/src/api/proposalClient.ts` (`getDatasets`, `getCatalog`, `getSeeds`, `getSeed`, profiles CRUD, `validateWorld`) and world/profile/seed types.
- [ ] T025 [US1] Replace the flat `featureSnapshot` in `app/frontend/src/state/proposalStore.ts` with typed `world` (control_inputs/situation/driver_profile/catalog_ref), `seeds`, `profiles`, `datasets` slices; JA default preserved; isolation from `runStore` preserved. Update `app/frontend/tests/proposalStore*.test.ts`.
- [ ] T026 [US1] Rebuild `app/frontend/src/components/proposal/panels/WorldPanel.tsx`: Control inputs (incl. dataset selector + read-only `DatasetProvenanceBanner`), Situation (all fields editable), Driver profile (preference+history editable, `genre_affinity_v1` toggle), plus `SeedPicker` and `DriverProfilePicker` (load/save/delete). Per-field `ProvenanceBadge`. New components `SeedPicker.tsx`, `DriverProfilePicker.tsx`, `DatasetProvenanceBanner.tsx`, read-only `CatalogView.tsx`.
- [ ] T027 [P] [US1] Vitest `app/frontend/tests/proposal_world_panel_p3.test.tsx`: seed load populates all groups; profile save/load/delete; invalid edit shows a field-level message; catalog banner shows provenance and offers no edit/import; JA default.

**Checkpoint (US1 / P3a)**: complete editable world + reusable profiles + read-only catalog + setup snapshot, screen runnable, selectors still mock.

## Phase 4: User Story 2 — Clone a world and change one variable (P3b) — Priority P2

**Goal**: Clone-and-change a seed on one variable and show a deterministic field-level diff.

**Independent test**: Clone changing one field → diff lists exactly that field (before/after) and nothing
else; clone is a complete valid world; diff is identical on repeat.

- [ ] T028 [P] [US2] Write `app/api/tests/proposal/test_world_clone.py`: cloning with one override yields a complete valid world; `diff` lists exactly the overridden path(s) with before/after; deterministic on repeat; invalid override/reference → 422; supports the §5 one-variable presets.
- [ ] T029 [US2] Add `WorldClone` (+ `FieldOverride`/`FieldDiff`) to `models/proposal/world.py` and implement `create_clone`/diff in `app/api/aica_api/services/world_seed_store.py` (persist to `settings.proposal_worlds_dir`), to pass T028.
- [ ] T030 [US2] Implement `POST /api/proposal/worlds/clone` (+ list/get/delete clones) in `routers/proposal.py`; extend `app/api/tests/proposal/test_ep_world_setup.py`.
- [ ] T031 [P] [US2] Frontend: clone-and-change control + `WorldDiffView.tsx` in `WorldPanel`; store/client `cloneWorld`; Vitest `app/frontend/tests/proposal_world_clone.test.tsx` (diff renders exactly the changed field, deterministic).

**Checkpoint (US2 / P3b)**: contrast clones with an exact, deterministic field-level diff.

## Phase 5: User Story 3 — See the content proposal react (P3c) — Priority P3

**Goal**: STEP 2 runs the **real** transparent content selector so a different profile yields a different,
deterministic content proposal; failures surface as algorithm errors.

**Independent test**: Two worlds differing only in a scored profile dimension → different plans, reasoning
cites the difference; same world twice → identical plan; forced selector error → algorithm-error (not a
faked plan); unsupported service → clear message.

- [ ] T032 [US3] Add `family: content_selector` and `approach: transparent` to `packages/aica_transparent_content_selector_v1/package.json`; write `app/api/tests/proposal/test_real_content_manifest.py` asserting the registry now loads it into the transparent content slot and the P6 direct-import harness is unaffected.
- [ ] T033 [P] [US3] Write `app/api/tests/proposal/test_step2_real_content.py`: STEP 2 dispatches the real content package over `World.project()` + frozen-catalog candidates + `_service_id`; identical world → identical `CompletePlan`; two worlds differing in a scored profile dimension → different `CompletePlan`; selector raise/invalid → `algorithm_error` event; unsupported service → 422 message; no eligible plan → explicit `no_proposal`.
- [ ] T034 [US3] Update `POST /api/proposal/runs/{id}/select-service` in `routers/proposal.py` to build the content context (projected world + catalog map + `_service_id`) and route to the real content package via `services/proposal_selector.dispatch_selector`; persist `CompletePlan` or `algorithm_error`; to pass T033.
- [ ] T035 [P] [US3] Frontend: `ContentProposalPanel` renders the real `CompletePlan` (ordered items + per-item reasoning) and algorithm-error/unsupported/no-proposal states; scope the "MOCK DATA" marker to the service panel only. Vitest `app/frontend/tests/proposal_content_real.test.tsx`.
- [ ] T036 [US3] Add the milestone-exit contrast integration test `app/api/tests/proposal/test_contrast_demo.py`: build two worlds via clone that differ in one scored profile dimension (e.g. hobby/genre usage), run STEP 1→STEP 2 on each, assert the two content plans differ and the differing feature appears in the reasoning (SC-004).

**Checkpoint (US3 / P3c)**: profile changes visibly change the real content proposal; failures visible.

## Phase 6: Polish & Cross-Cutting

- [ ] T037 [P] Generate `proposal_contracts/schema/{world,dataset}.schema.json` via `python -m aica_api.models.proposal.export_schema`; add a schema-consistency test.
- [ ] T038 [P] Regression: `cd app/api && uv run pytest` (full backend incl. trigger) and `cd app/frontend && npm test && npm run build` all green; add/adjust an isolation test asserting no proposal edit mutates trigger state. **Boundary guard (FR-021):** assert P3 adds no real **service** ranking, no motion/catalog/schedule eligibility narrowing, and no journey-progression endpoints — the service selector stays the P1 mock and only the content selector is real.
- [ ] T039 [P] Determinism/read-only assertions: a test confirming the frozen dataset files are byte-unchanged after a full P3 session; reopen-run renders stored world/snapshot/plan without recompute.
- [ ] T040 [P] Docs: update `docs/master/aica_proposal_simulator_specification.md` §8/§9 only if the typed World clarifies them; ensure `docs/master/aica_proposal_simulator_milestones.md` §5/§17 and the design record match the shipped scope; refresh `specs/014-proposal-p3-editable-world/quickstart.md` if flows changed.
- [ ] T041 `docker compose config` valid; run the `quickstart.md` demonstration flow end-to-end (E2E) and capture evidence for each acceptance criterion (SC-001…SC-008).

---

## Dependencies & order

- **Setup (T001–T002)** → **Foundational (T003–T011)** → **US1 (T012–T027)** → **US2 (T028–T031)** → **US3 (T032–T036)** → **Polish (T037–T041)**.
- US2 and US3 both depend on Foundational + US1 (they need the typed World + project + seeds). US2 and US3 are otherwise independent of each other and could be built in either order after US1.
- Within a phase, `[P]` tasks touch different files and may run in parallel; each implementation task depends on its paired test task (TDD: red → green).

## Parallel execution examples

- Foundational: T003, T005, T007, T009 (tests, different files) in parallel; then their implementations.
- US1: T012, T015, T017, T019, T021, T024, T027 (tests/independent FE) in parallel where files differ.

## MVP scope

**US1 (P3a)** alone is a shippable increment: a complete, validated, editable world with reusable driver
profiles and read-only catalog provenance, running the (still mock) selectors. **US3 (P3c)** delivers the
headline demonstration (profile → different real content proposal) and is the milestone-exit criterion.

## Format validation

All tasks use `- [ ] Txxx [P?] [US?] description + file path`; Setup/Foundational/Polish carry no story
label; US phases carry `[US1]`/`[US2]`/`[US3]`.
