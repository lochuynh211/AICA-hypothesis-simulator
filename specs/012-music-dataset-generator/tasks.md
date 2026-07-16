# Tasks: P2 — Synthetic Music Dataset Generation & Validation

**Feature dir**: `specs/012-music-dataset-generator/` · **Branch**: `proposal-p2-soundcharts-dataset`
**Inputs**: plan.md, spec.md (US1–US7), research.md (R1–R10), data-model.md, contracts/{cli-commands,llm-handoff,error-taxonomy}.md, quickstart.md

**Approach**: TDD (write the failing test, watch it fail for the intended reason, implement the smallest change, refactor). Contract surfaces (Song-schema conformance, validator rules, deterministic transform, genre map) are tested first per the constitution. All generator paths are relative to the repo-root package `music_dataset_generator/` unless noted. Deterministic tests use committed recorded fixtures (no network/agent); live tests carry `@pytest.mark.live`.

**Story independence**: US1 (deterministic transform, MVP) is testable on committed cache fixtures without US2's live harvest. US2 produces the cache. US3–US7 layer on top. US1 is the recommended MVP.

---

## Phase 1: Setup

- [ ] T001 Scaffold the repo-root package: create `music_dataset_generator/pyproject.toml` (name `music-dataset-generator`, deps `pydantic>=2`, `httpx`; `[tool.uv.sources] aica-api = {path = "../app/api", editable = true}`; console entry `mdg = "mdg.cli:main"`), `music_dataset_generator/mdg/__init__.py` (`GENERATOR_VERSION`, `PROMPT_TEMPLATE_VERSION`, `VALIDATION_RULES_VERSION = "1.0.0"`), and `music_dataset_generator/README.md`.
- [ ] T002 [P] Create `music_dataset_generator/mdg/config.py` resolving `--workspace`/`AICA_GENERATION_WORKSPACE_DIR` (default repo-root `generation_workspace/`) and `--dataset-dir`/`AICA_PROPOSAL_DATASET_DIR` (default `proposal_contracts/dataset/`), and reading Soundcharts creds from env only (`SOUNDCHARTS_APP_ID`/`SOUNDCHARTS_API_KEY`) — never written to any file.
- [ ] T003 [P] Add `AICA_GENERATION_WORKSPACE_DIR` and `AICA_PROPOSAL_DATASET_DIR` resolvers to `app/api/aica_api/config.py` following the existing `AICA_*_DIR` pattern (so P3 can locate the frozen dataset).
- [ ] T004 [P] Add `generation_workspace/` to repo-root `.gitignore`; create committed dirs `proposal_contracts/dataset/.gitkeep`, `proposal_contracts/test_cases/.gitkeep`, `proposal_contracts/build_reports/.gitkeep`.
- [ ] T005 Create `music_dataset_generator/tests/conftest.py` (fixture loader resolving `tests/fixtures/`, `live` marker registration + `--run-live` gate) and `music_dataset_generator/tests/fixtures/.gitkeep`.
- [ ] T006 [P] Create the CLI skeleton `music_dataset_generator/mdg/cli.py` (`argparse` dispatcher `python -m mdg <stage>` with subcommands from `contracts/cli-commands.md`, each raising `NotImplementedError` for now) and `music_dataset_generator/mdg/__main__.py`.

---

## Phase 2: Foundational (blocking prerequisites)

- [ ] T007 [P] Write `music_dataset_generator/tests/test_errors.py` asserting every error code from `contracts/error-taxonomy.md` exists and that fatal vs. miss vs. data categories are distinguishable — confirm failing.
- [ ] T008 Implement `music_dataset_generator/mdg/errors.py` (typed exception classes / code enum for all design §9 + data-spec §22 codes; `judge_disagreement` is a data status, not an exception); make T007 pass.
- [ ] T009 [P] Write `music_dataset_generator/tests/test_models.py`: `DatasetManifest` (dataset_kind literal, synthetic_only False, required version fields), `CoveragePlan`/`CoverageCell`, `CandidateName` (rejects any isrc/audio key), `LineageEntry`, `LedgerEntry`, `TestCase`, `BuildReport`, `ContrastPairSpec` per data-model.md — confirm failing.
- [ ] T010 Implement `music_dataset_generator/mdg/models.py` (all Pydantic v2 models per data-model.md); make T009 pass.
- [ ] T011 [P] Write `music_dataset_generator/tests/test_song_schema_reuse.py` asserting `from aica_api.models.proposal.song_schema import Song` imports and validates a hand-authored real-name/verbatim-audio fixture (synthetic IDs, `.invalid` URLs) — confirm the one-way dependency works.
- [ ] T012 [P] Write `music_dataset_generator/tests/test_handoff.py`: `handoff.write_input()` emits schema-valid JSON; `handoff.read_output()` validates against the stage schema and rejects malformed / isrc-bearing / audio-bearing output — confirm failing.
- [ ] T013 Implement `music_dataset_generator/mdg/handoff.py` (generic input-write + schema-checked output-read) and add per-stage JSON schemas under `music_dataset_generator/mdg/prompts/schemas/`; make T012 pass.

---

## Phase 3: US1 — Reproducible frozen catalog (Priority P1) 🎯 MVP

**Goal**: Deterministic transform (S0 plan → bin → select → map → validate/repair → freeze) over a committed raw-response cache produces a byte-identical, schema-valid, coverage-complete, label-free frozen catalog + manifest + hash.
**Independent test**: `python -m mdg transform` over `tests/fixtures/cache/` twice → identical catalog+hash; every record synthetic/valid/label-free; demonstration coverage/quota met.

- [ ] T014 [P] [US1] Add committed recorded fixtures: `music_dataset_generator/tests/fixtures/cache/` (a handful of real `by-isrc` payloads spanning cells/languages/eras + ≥1 negative-fixture source) and `tests/fixtures/lineage.json`.
- [ ] T015 [P] [US1] Write `music_dataset_generator/tests/test_coverage_plan.py`: 36 cells, band ranges (§10.2), quotas, language targets (~30 JA/~6 EN/0 other), ≥3 eras, ≥12 contrast pairs — confirm failing.
- [ ] T016 [US1] Implement `music_dataset_generator/mdg/coverage/plan.py` (S0 deterministic plan; ledger-relative hook stubbed to empty ledger for now); make T015 pass.
- [ ] T017 [P] [US1] Write `music_dataset_generator/tests/test_binner.py`: energy/tempo/profile bands + valence/mode/acousticness + humming_ease/full_karaoke_ease bands from real audio arithmetic (worked example §7) — confirm failing.
- [ ] T018 [US1] Implement `music_dataset_generator/mdg/binner.py` (S3 binning; coverage arithmetic only, no score); make T017 pass.
- [ ] T019 [P] [US1] Write `music_dataset_generator/tests/test_selector.py`: pigeonhole admission by real audio; `wrong_cell` guess lands in actual cell; multi-per-cell allowed; ledger-identity skip; no score/label in selection — confirm failing.
- [ ] T020 [US1] Implement `music_dataset_generator/mdg/selector.py` (S3 selection); make T019 pass.
- [ ] T021 [P] [US1] Write `music_dataset_generator/tests/test_mapper.py`: real record → `Song` dict — real names/verbatim audio kept, `timeSignature`→`time_signature`, duration→ms, `synthetic-` IDs, `.invalid` URLs, real ISRC kept, synthesized album/markets/popularity/negative-fixture restrictions — confirm failing.
- [ ] T022 [US1] Implement `music_dataset_generator/mdg/mapper.py` (S4; seed-pinned deterministic ID allocation + fixture placement per FR-029); make T021 pass.
- [ ] T023 [P] [US1] Write `music_dataset_generator/tests/test_validator.py`: passes valid fixtures; raises `cross_object_identity_mismatch`, `synthetic_identity_violation`, range/flag violations, and `coverage_contract_failed` on an unmet target (data-spec §17) — confirm failing.
- [ ] T024 [US1] Implement `music_dataset_generator/mdg/validator.py` (S5; wraps `Song` schema + §17 rule families); make T023 pass.
- [ ] T025 [P] [US1] Write `music_dataset_generator/tests/test_repair.py`: each §18 repair deterministic + logged; **2 failed repairs → `catalog_generation_failed`** (worked example §7) — confirm failing.
- [ ] T026 [US1] Implement `music_dataset_generator/mdg/repair.py` (S5 2-strike loop); make T025 pass.
- [ ] T027 [P] [US1] Write `music_dataset_generator/tests/test_freeze.py`: `dataset_manifest` fields + `dataset_hash`; frozen catalog contains no `recommended`/`best_for_world`/`target_rank`/score/label key (FR-019); `generated_at` supplied externally (no wall-clock) — confirm failing.
- [ ] T028 [US1] Implement `music_dataset_generator/mdg/freeze.py` (S6) and wire the `transform` CLI subcommand (S3→S6 over cache) in `cli.py`; make T027 pass.
- [ ] T029 [P] [US1] Write `music_dataset_generator/tests/test_transform_reproducible.py`: same cache + seed → **byte-identical** catalog+manifest+hash across two runs, with no network/agent (SC-001) — confirm failing.
- [ ] T030 [US1] Make T029 pass (stabilize ordering: sorted iteration, seed-pinned tie-breaks); refactor S3–S6 for determinism.
- [ ] T031 [P] [US1] Write `music_dataset_generator/tests/test_firewall.py`: no score/rank/label/target enters S0–S6; `why_fits_cell`/`web_evidence` never reach a `Song`; cell derives only from binned audio (SC-002 firewall); **no Soundcharts credential value appears in any committed artifact** (manifest/lineage/build report/catalog) (FR-011); the deterministic transform performs no network I/O (FR-032) — confirm failing, then ensure passing.

**Checkpoint**: US1 delivers the reproducible frozen catalog on fixtures — the MVP.

---

## Phase 4: US2 — Live Soundcharts harvest (Priority P1)

**Goal**: LLM naming (handoff) → MusicBrainz+Deezer ISRC resolution → by-ISRC harvest with audio/language gates → raw cache + lineage, real audio deciding the cell.
**Independent test**: with MB/Deezer live and Soundcharts live-or-fixture, harvest fills needed cells with lineage; misses logged; language/cell gates enforced.

- [ ] T032 [P] [US2] Write `music_dataset_generator/tests/test_sources_clients.py` (recorded HTTP fixtures): Soundcharts `by-isrc` parse (audio/languageCode/duration-seconds/genres), MusicBrainz + Deezer ISRC parse — confirm failing.
- [ ] T033 [US2] Implement `music_dataset_generator/mdg/sources/soundcharts.py` (httpx client, env creds, quota counter, `by-isrc`/`by-uuid`; `search` stub raising `strategy_unavailable`); make Soundcharts part of T032 pass.
- [ ] T034 [P] [US2] Implement `music_dataset_generator/mdg/sources/musicbrainz.py` (≤1 req/s, User-Agent) and `music_dataset_generator/mdg/sources/deezer.py`; make the rest of T032 pass.
- [ ] T035 [P] [US2] Write `music_dataset_generator/tests/test_resolver.py`: MB+Deezer reconcile → deduped candidate ISRCs ordered original-release-first; year ±1 match; no ISRC → `song_not_found_in_sources` (R2) — confirm failing.
- [ ] T036 [US2] Implement `music_dataset_generator/mdg/sources/resolver.py` (S2b); make T035 pass.
- [ ] T037 [P] [US2] Write `music_dataset_generator/tests/test_harvest.py`: candidate walk advances past `isrc_not_in_soundcharts`/`audio_unavailable`; `language_mismatch` discards (never relabels); populated-audio stored to cache+lineage — confirm failing.
- [ ] T038 [US2] Implement `music_dataset_generator/mdg/harvest/cache.py` (raw cache + lineage I/O) and `music_dataset_generator/mdg/harvest/by_isrc.py` (S2c gates); make T037 pass.
- [ ] T039 [P] [US2] Write `music_dataset_generator/tests/test_probe.py`: probe over ~15 ISRCs; `<60% (<9/15)` populated audio → `isrc_probe_gate_failed` (FR-008) — confirm failing.
- [ ] T040 [US2] Implement the `probe` CLI subcommand + `music_dataset_generator/mdg/harvest/by_uuid.py` (S2a) and wire `harvest`/`resolve`/`name` subcommands in `cli.py`; make T039 pass.
- [ ] T041 [P] [US2] Add `music_dataset_generator/tests/test_live_harvest.py` (`@pytest.mark.live`): end-to-end name→resolve→by-isrc on a tiny real cell (skipped without `--run-live`/key).

**Checkpoint**: US2 populates the cache the US1 transform consumes — live or from fixtures.

---

## Phase 5: US3 — Loopable, resumable, additive generation (Priority P2)

**Goal**: carry-over ledger makes loops additive and non-redundant; coverage plan is ledger-relative.

- [ ] T042 [P] [US3] Write `music_dataset_generator/tests/test_ledger.py`: identity keys (isrc/uuid/NFKC name); append-only; accepted+miss recorded with reason/cell/loop — confirm failing.
- [ ] T043 [US3] Implement `music_dataset_generator/mdg/ledger.py`; make T042 pass.
- [ ] T044 [US3] Wire ledger-relative coverage into `coverage/plan.py` (remaining + enrichment) and ledger exclusion into `name`/`resolver`/`by_isrc`; update `tests/test_coverage_plan.py` for loop-2 remaining targets.
- [ ] T045 [P] [US3] Write `music_dataset_generator/tests/test_loop_carryover.py`: loop 2 re-proposes 0 ledgered names, re-resolves 0 ledgered `(title,artist)`, re-fetches 0 ledgered ISRC/UUID, retries 0 known misses; enrichment adds to covered cells; transform over accumulated cache stays byte-identical (SC-007) — confirm passing after T043/T044.

**Checkpoint**: generation is resumable and quota-frugal across loops.

---

## Phase 6: US4 — Interchangeable candidate strategies (Priority P2)

**Goal**: both `candidate_source` strategies implemented; downstream is strategy-agnostic.

- [ ] T046 [P] [US4] Write `music_dataset_generator/tests/test_strategy_search.py` (recorded fixtures): `soundcharts_search` front-half (S0.5/S1a/S1.5/S2a) produces a shortlist and terminates at cache+lineage; a **live** search call raises `strategy_unavailable` (FR-009) — confirm failing.
- [ ] T047 [US4] Implement `music_dataset_generator/mdg/harvest/search.py` (S1a) + the Strategy A handoff prompts/schemas in `mdg/prompts/` and wire `--candidate-source` selection; make T046 pass.
- [ ] T048 [P] [US4] Write `music_dataset_generator/tests/test_strategy_parity.py`: a fixed raw-response cache yields a byte-identical catalog regardless of which `candidate_source` populated it (SC-008) — confirm passing.

**Checkpoint**: both strategies feed one strategy-agnostic transform.

---

## Phase 7: US5 — Genre mapping into the frozen 12-vocab (Priority P2)

**Goal**: sub-first `real→12-vocab` map; `genre_affinity_v1` off reproduces the no-extension result.

- [ ] T049 [P] [US5] Write `music_dataset_generator/tests/test_genre_map.py`: totality over the 34 roots (seeded from `others/soundchart_song_genres.json`); sub-override beats root-fallback (`{j-pop,city pop}`→`city pop`, `{soundtrack,anime}`→`anime`); unmapped → `genre_unmappable_to_vocabulary`→`missing_neutral`; vocab unchanged (SC-006) — confirm failing.
- [ ] T050 [US5] Implement `music_dataset_generator/mdg/genre_map.py` (§13 tables) and wire `artist_genres` writing into `mapper.py` (using `aica_api` genre-extension shape); make T049 pass.
- [ ] T051 [P] [US5] Write `music_dataset_generator/tests/test_genre_off_equivalence.py`: with `genre_affinity_v1` disabled, the catalog reproduces the no-extension P6 ranking exactly (SC-005) — confirm passing.

**Checkpoint**: genre extension is opt-in and contract-preserving.

---

## Phase 8: US6 — Worlds, base seeds, contrast pairs (Priority P2)

**Goal**: ≥15 base worlds + 12 one-variable contrast pairs, post-freeze, referencing catalog IDs.

- [ ] T052 [P] [US6] Write `music_dataset_generator/tests/test_worlds.py`: worlds generated only after freeze; every history/oshi/usage reference resolves to a catalog ID (`world_reference_failed` otherwise); reload restores the same world — confirm failing.
- [ ] T053 [US6] Implement `music_dataset_generator/mdg/worlds.py` (S7 deterministic fixtures + LLM profile-composition handoff) + `worlds` CLI subcommand; make T052 pass.
- [ ] T054 [P] [US6] Write `music_dataset_generator/tests/test_contrast_pairs.py`: exactly the 12 required one-variable pairs, each differing in one variable, with stated expected directions (§15) — confirm passing.

**Checkpoint**: certifiable worlds exist against the frozen catalog.

---

## Phase 9: US7 — Blind judge, cross-check, P6 certification (Priority P3)

**Goal**: blind LLM labels + P6 cross-check test-case set; P6 contrast reversal certification.

- [ ] T055 [P] [US7] Write `music_dataset_generator/tests/test_judge.py`: label committed **before** score reveal (SC-009); `agreement` recorded after reveal; test-case artifact carries judge provenance; catalog stays label-free (FR-026) — confirm failing.
- [ ] T056 [US7] Implement `music_dataset_generator/mdg/judge.py` (S8 handoff + cross-check) + `judge` CLI subcommand; make T055 pass.
- [ ] T057 [P] [US7] Write `music_dataset_generator/tests/test_certify.py`: loads P6 `evaluate` by file path; the 12 contrast pairs **reverse** across their worlds (SC-004); a non-reversing pair emits a re-harvest signal, never a numeric tweak (FR-027) — confirm failing.
- [ ] T058 [US7] Implement `music_dataset_generator/mdg/certify.py` (S9) + `certify` CLI subcommand; make T057 pass.

**Checkpoint**: two-evaluator test-case set + reversal certification complete.

---

## Phase 10: Polish, live run & cross-cutting

- [ ] T059 [P] Implement the `report` CLI subcommand → committed `proposal_contracts/build_reports/build_report.json` (candidate_source, loop, new-vs-skipped, quota, probe result, repairs, coverage checklist, agreement stats, errors).
- [ ] T060 [P] Write `music_dataset_generator/RUNBOOK.md` (exact CLI + LLM-handoff order per quickstart.md) and finalize the committed prompt templates in `mdg/prompts/`.
- [ ] T061 Apply the P2 design §8 master-doc amendments **at freeze** (data spec §3/§7.1 manifest kind + synthetic_only:false; §9.2/§23.4/§24 real names; §17.3 relax names/ISRC; §19/§23.4 determinism re-scope; §21.1/§17.7 genre map + `genre_unmappable_to_vocabulary`; language/era axes; MusicBrainz/Deezer provenance) in `docs/master/aica_synthetic_music_data_and_generation_specification.md`.
- [ ] T062 **Live run** (operator supplies Soundcharts key): `probe` + full 36-song `demonstration` harvest → freeze real catalog into `proposal_contracts/dataset/<dataset_id>/`; record quota usage in the build report; run `certify` to confirm the 12 reversals on the real catalog.
- [ ] T063 [P] Regression gate: run `cd app/api && uv run pytest tests/proposal` (P0.5/P6 suites) and confirm green; confirm the runtime API package has 0 imports of `mdg` (grep) — SC-012.
- [ ] T064 [P] Full generator suite `cd music_dataset_generator && uv run pytest` green (deterministic); document the `-m live` invocation; ensure `smoke`/`stress` tiers produce valid catalogs.

---

## Dependencies & completion order

- **Setup (Phase 1)** → **Foundational (Phase 2)** block everything.
- **US1 (Phase 3)** = MVP; depends only on Phase 2 + committed cache fixtures.
- **US2 (Phase 4)** depends on Phase 2; produces the cache US1 consumes (parallelizable with US1 after Phase 2).
- **US3 (Phase 5)** depends on US2 (ledger spans acquisition) + US1 (transform reproducibility check).
- **US4 (Phase 6)** depends on US2 (shared harvest boundary).
- **US5 (Phase 7)** depends on US1 (mapper).
- **US6 (Phase 8)** depends on US1 (frozen catalog).
- **US7 (Phase 9)** depends on US6 (worlds) + US1 (catalog) + P6 package.
- **Polish (Phase 10)**: T061/T062 depend on all stages; T063/T064 last.

## Parallel opportunities

- Phase 1: T002, T003, T004 in parallel after T001.
- Phase 2: T007, T009, T011, T012 (tests) in parallel; implementations follow.
- Within each story, all `[P]` test tasks (different files) run in parallel before their implementations.
- After Phase 2, US1 and US2 can proceed in parallel (different modules), converging at the transform-over-live-cache and Phase 5.

## Implementation strategy

MVP = **US1** (reproducible frozen catalog on fixtures). Then US2 (live harvest) to produce the real cache, US3 (loop/ledger) for quota-frugal iteration, US4 (strategies), US5 (genre), US6 (worlds), US7 (judge/certify). Live 36-song harvest + master-doc amendments land in Polish (T061–T062).
