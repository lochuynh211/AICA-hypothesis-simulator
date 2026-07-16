# Tasks: P0.5 — Content Contract & Song-Schema Freeze

**Feature dir**: `specs/010-content-contract-freeze/` | **Branch**: `proposal-p0.5-content-schema-freeze`
**Inputs**: plan.md, spec.md, research.md, data-model.md, contracts/README.md, quickstart.md
**Tests**: REQUIRED (this milestone *is* a contract surface — constitution "contract surfaces tested first"; TDD per milestone Step 4).

All backend paths are under `app/api/`; frozen artifacts under repo-root `proposal_contracts/`. Local test command: `python -m pytest tests/proposal -q` (run from `app/api/`); canonical: `docker compose exec api uv run pytest tests/proposal`.

**Convention**: within each user story, write the failing test first, confirm it fails for the intended reason, then implement the smallest change to pass.

---

## Phase 1: Setup (shared scaffolding)

- [ ] T001 Create the isolated proposal contract subpackage skeleton `app/api/aica_api/models/proposal/__init__.py` with `CONTRACT_VERSION = "1.0.0"`, `SCHEMA_VERSION = "1.0.0"`, `GENRE_EXTENSION_VERSION = "genre_affinity_v1"` and empty re-export block (does NOT touch `app/api/aica_api/models/__init__.py`).
- [ ] T002 [P] Create repo-root frozen-artifact directories with `.gitkeep`: `proposal_contracts/schema/`, `proposal_contracts/dispositions/`, `proposal_contracts/fixtures/songs/{smoke,pairs,karaoke}/`, `proposal_contracts/fixtures/worlds/`, `proposal_contracts/fixtures/negative/`, plus `proposal_contracts/README.md` describing the artifacts and the "generated — do not hand-edit" rule.
- [ ] T003 [P] Add `AICA_PROPOSAL_CONTRACTS_DIR` (default repo-root `proposal_contracts/`) to `app/api/aica_api/config.py`, mirroring `AICA_PACKAGES_DIR`/`AICA_SCENARIOS_DIR`.
- [ ] T004 Create the test package `app/api/tests/proposal/__init__.py` and `app/api/tests/proposal/conftest.py` with a helper that resolves `proposal_contracts/` (via config) and loads JSON fixtures by relative path.

---

## Phase 2: Foundational (BLOCKS all user stories)

- [ ] T005 [P] Write `app/api/tests/proposal/test_enums.py` asserting each enum's exact member set (TriggerPurpose ×4, LifecycleStage ×4, ServiceId ×14, RestSpotType ×6, ContentDecisionType ×9, FeatureDisposition ×3, FeatureOriginProvenance ×3, ResponseCoefficientProvenance, GenreLiteral ×12, UsageLevel ×4) — confirm it fails (module absent).
- [ ] T006 Implement `app/api/aica_api/models/proposal/enums.py` with all enums per data-model.md §Enums; make T005 pass.

**Checkpoint**: enums importable; every downstream story can reference them.

---

## Phase 3: User Story 1 — Author & validate the content contract standalone (Priority: P1) 🎯 MVP

**Goal**: A downstream implementer can build and validate the common selector input and the `complete_plan` output from the frozen contract alone.
**Independent test**: Construct valid input + valid plan (both accepted); malformed variants rejected; no aggregate-score field exists.

- [ ] T007 [P] [US1] Write `app/api/tests/proposal/test_selector_input_contract.py`: valid content-variant input accepted; incompatible purpose/stage rejected; empty `allowed_service_ids` rejected; wrong enum rejected — confirm failing.
- [ ] T008 [P] [US1] Write `app/api/tests/proposal/test_content_output_contract.py`: valid transparent `complete_plan` accepted; LLM-shaped plan (`item_fit=null`, empty `feature_contributions`) accepted; unknown decision type rejected; assert **no** `plan_score`/`aggregate_score`/`plan_fit` field exists anywhere in `CompletePlan` or nested models — confirm failing.
- [ ] T009 [US1] Implement `app/api/aica_api/models/proposal/selector_input.py` (`SelectorInput`, `FeatureProvenanceEntry`, `CandidateRef`, `ExcludedCandidate`) with the non-empty-allowed-services and purpose/stage-compatibility validators; make T007 pass.
- [ ] T010 [US1] Implement `app/api/aica_api/models/proposal/content_output.py` (`CompletePlan`, `OrderedItem`, `ItemFeatureContribution`, `SongTraitValues`, `PlanMode`, `LightingConfiguration`, `ExcludedItem`) per data-model.md; make T008 pass.
- [ ] T011 [US1] Add the input/output models to the `proposal/__init__.py` re-exports; run `test_selector_input_contract.py` + `test_content_output_contract.py` green.

**Checkpoint**: US1 independently testable — content package I/O contract is frozen and validated.

---

## Phase 4: User Story 2 — Validate synthetic songs against the frozen song schema (Priority: P1)

**Goal**: The song schema accepts well-formed synthetic songs and rejects malformed ones at the offending field.
**Independent test**: All valid song fixtures accepted; all negative fixtures rejected for their specific rule.

- [ ] T012 [P] [US2] Author valid song fixtures: `proposal_contracts/fixtures/songs/smoke/song-000{1..5}.json` (5 valid songs, all three namespaces, `.invalid` links, `synthetic-` IDs), the three contrast pairs under `pairs/` (calm/active, bright/dark, acoustic/electric — differing only on the relevant audio fields), and one high-`instrumentalness` song under `karaoke/` with both flags `1`. Algorithm-blind (no scoring intent).
- [ ] T013 [P] [US2] Author negative song fixtures under `proposal_contracts/fixtures/negative/`, each isolating one rule: out-of-range `energy`, `mode:2`, `time_signature:8`, track↔audio-features `duration_ms` mismatch, non-`.invalid` URL, ID missing `synthetic-`, `simulation_flags` value `2`, and an unknown top-level namespace.
- [ ] T014 [P] [US2] Write `app/api/tests/proposal/test_song_schema.py`: every `songs/**` fixture accepted; every `negative/**` fixture raises `ValidationError` with the offending field in the error location; cross-object identity + synthetic-identity enforced; instrumental song still valid & flag-eligible — confirm failing.
- [ ] T015 [US2] Implement `app/api/aica_api/models/proposal/song_schema.py` (`SpotifyTrack` + sub-objects, `SpotifyAudioFeatures`, `SimulationFlags`, `Song`) with strictness per research D3 (`extra="forbid"` on `Song`/`SimulationFlags`, `extra="ignore"` inside Spotify objects), range invariants, cross-object identity + synthetic-identity validators; make T014 pass.
- [ ] T016 [US2] Add song-schema models to `proposal/__init__.py` re-exports; run `test_song_schema.py` green.

**Checkpoint**: US2 independently testable — song schema frozen; fixtures accepted/rejected as intended.

---

## Phase 5: User Story 3 — Every approved feature's disposition; nothing dropped (Priority: P1)

**Goal**: A machine-readable registry marks every Appendix A.2 content field with a disposition + provenance; cross-checked against the A.2 table.
**Independent test**: Every A.2 field present once with valid disposition; six genre-gated fields flagged; row-set equals A.2.

- [ ] T017 [P] [US3] Write `app/api/tests/proposal/test_dispositions.py`: every A.2 content field appears exactly once; every entry has a valid disposition + feature-origin (and response-provenance for scored); feature-origin and response-coefficient provenance are held in **separate fields and never conflated** (FR-020); exactly the six genre-gated fields flagged; scored categoricals carry `enum_responses`; and a cross-check parsing the Appendix A.2 field table in `docs/master/aica_proposal_simulator_specification.md` asserts row-set equality with the registry — confirm failing.
- [ ] T018 [US3] Implement `app/api/aica_api/models/proposal/dispositions.py` (`DispositionEntry` + `CONTENT_FEATURE_DISPOSITIONS` list, `registry_version="1"`) populating one entry per A.2 field per data-model.md/design §6.1 (15 scored, 6 genre-gated, oshi gates context_only, `oshi_id` scored, all remaining context_only/available_but_not_used); make T017 pass.
- [ ] T019 [US3] Add the registry to `proposal/__init__.py` re-exports; run `test_dispositions.py` green.

**Checkpoint**: US3 independently testable — disposition completeness + A.2 drift guard hold.

---

## Phase 6: User Story 4 — Optional genre extension shape, safely off by default (Priority: P2)

**Goal**: The `genre_affinity_v1` extension shape is frozen; off-by-default keeps the six genre-gated features context-only; enabling never overwrites core namespaces.
**Independent test**: Valid extension accepted; out-of-vocab genre / bad usage level / core-namespace overwrite rejected.

- [ ] T020 [P] [US4] Author world/feature snapshot fixtures under `proposal_contracts/fixtures/worlds/`: a night-highway world snapshot and a `genre_affinity_v1`-enabled variant (adds `artist_genres`, `usage_by_genre`, `scene_genre_usage`).
- [ ] T021 [P] [US4] Write `app/api/tests/proposal/test_genre_extension.py`: valid extension fixture accepted; out-of-vocabulary genre rejected; invalid usage level rejected; attempt to add a key inside a core song namespace rejected; extension-absent ⇒ the six genre-gated registry rows resolve as context-only — confirm failing.
- [ ] T022 [US4] Implement `app/api/aica_api/models/proposal/genre_extension.py` (`GenreAffinityV1`, `GENRE_VOCABULARY`) with `extra="forbid"` and the no-overwrite guard; make T021 pass.
- [ ] T023 [US4] Add the extension model to `proposal/__init__.py` re-exports; run `test_genre_extension.py` green.

**Checkpoint**: US4 independently testable — genre extension frozen; off-by-default equivalence holds.

---

## Phase 7: User Story 5 — Cross-document ambiguities resolved before freeze (Priority: P2)

**Goal**: §17 content items are resolved with rationale and control-input naming is canonical everywhere. (The master-doc edits were made in the design checkpoint commit `4b7fe5a`; this phase adds the automated guard and verifies the recorded resolutions.)

- [ ] T024 [P] [US5] Write `app/api/tests/proposal/test_docs_naming_consistency.py` asserting the dotted control-input form (`trigger.purpose` / `trigger.stage`) appears in no file under `docs/master/`, and that `docs/master/aica_proposal_simulator_milestones.md` §17 marks the four content-touching items RESOLVED — confirm current state (should pass immediately given the design-commit edits; if it fails, fix the docs).
- [ ] T025 [US5] Verify the four §17 resolutions are recorded with rationale in the milestone doc and design record; if any gap, correct the master doc (no new dotted usages introduced).

**Checkpoint**: US5 independently testable — naming consistency + §17 resolution guard green.

---

## Phase 8: Polish & cross-cutting

- [ ] T026 Implement `app/api/aica_api/models/proposal/export_schema.py` (`python -m aica_api.models.proposal.export_schema`) that writes `proposal_contracts/schema/{selector_input,content_output,song,genre_affinity_v1}.schema.json` from `model_json_schema()` and `proposal_contracts/dispositions/content_feature_dispositions.v1.json` from the registry (deterministic: sorted keys, stable indentation).
- [ ] T027 Run the exporter to generate and commit the frozen `schema/*.json` + `dispositions/*.json` artifacts.
- [ ] T028 [P] Write `app/api/tests/proposal/test_schema_export.py` (drift guard): committed schema + registry files byte-match a fresh in-memory export.
- [ ] T029 [P] Flesh out `proposal_contracts/README.md` with the version constants, artifact list, consumer note (P6/P2), and the regeneration command.
- [ ] T030 Run the full backend suite (`python -m pytest -q` from `app/api/`, and `docker compose exec api uv run pytest` if reachable) to confirm the existing trigger simulator remains green (regression gate, SC-007) and the new `tests/proposal/` suite is green.
- [ ] T031 Execute the quickstart acceptance walkthrough (SC-001…SC-006) and record evidence per success criterion.

---

## Dependencies & execution order

- **Setup (T001–T004)** → **Foundational (T005–T006)** must complete before any user story.
- **US1 (T007–T011)**, **US2 (T012–T016)**, **US3 (T017–T019)**, **US4 (T020–T023)**, **US5 (T024–T025)** depend only on Foundational; they touch disjoint files and are mutually parallelizable after T006.
- **Polish (T026–T031)** depends on all models existing: T026/T027 after US1–US4 models; T028 after T027; T030/T031 after everything.
- Within a story: fixtures + test tasks ([P]) → implementation → re-export/re-run.

## Parallel execution examples

- After T006: launch T007+T008 (US1), T012+T013+T014 (US2), T017 (US3), T020+T021 (US4), T024 (US5) in parallel — distinct files.
- Setup: T002 + T003 run in parallel (different files); T001 before T011/re-exports.

## Implementation strategy

- **MVP = User Story 1** (the frozen input/output content contract) — the single most valuable slice: it alone lets the content package be authored against a stable boundary.
- Deliver P1 stories (US1→US2→US3) first for the full "content package buildable + song schema + disposition completeness" core, then P2 stories (US4 genre extension, US5 doc guard), then Polish (export/drift-guard/regression).
- Each story is an independently testable increment; the existing trigger simulator is never modified (isolation, SC-007).
