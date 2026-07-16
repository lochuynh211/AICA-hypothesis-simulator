---
description: "Task list for P6 — Transparent Music Content-Selector Package"
---

# Tasks: Transparent Music Content-Selector Package (P6)

**Input**: Design documents from `/specs/011-p6-content-selector/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/evaluate_contract.md, quickstart.md

**Tests**: REQUIRED (TDD) — the milestone workflow mandates test-first, and the constitution
requires contract-surface tests (algorithm outputs, decision traces) before implementation.

**Organization**: Grouped by user story (spec.md). All six stories operate on the same single
`algorithm.py`; the pipeline is built as an incremental vertical slice — US1 delivers a
runnable, explained plan (MVP); later stories layer eligibility, provenance, genre, and
determinism.

## Path Conventions

- Package: `packages/aica_transparent_content_selector_v1/`
- Tests: `app/api/tests/proposal/`
- Fixtures: `proposal_contracts/fixtures/`
- Run (local fallback): `cd app/api && /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest tests/proposal/ -k content_selector -q`
- Run (canonical): `docker compose exec api uv run pytest tests/proposal/ -k content_selector`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package scaffolding and test harness.

- [ ] T001 Create package directory and manifest skeleton `packages/aica_transparent_content_selector_v1/package.json` (id, version, bilingual label, `algorithm.type=python_module`, `entrypoint=algorithm.py`, `compatible_scenario_types=["proposal_content"]`, empty `parameters`/`hyperparameters` to be filled in T006).
- [ ] T002 Create `packages/aica_transparent_content_selector_v1/algorithm.py` skeleton: module docstring (pipeline overview, purity contract), `_clamp` helper, section comments, and a `def evaluate(context: dict) -> dict:` stub returning `invalid_request`.
- [ ] T003 [P] Create `packages/aica_transparent_content_selector_v1/README.md` skeleton (provenance, contract link, hyperparameter reference placeholder).
- [ ] T004 [P] Extend `app/api/tests/proposal/conftest.py` with a content-selector context assembler + a JSON song-DB/world loader fixture (the loader does all file I/O; the package never does) and a manifest-defaults loader.
- [ ] T005 [P] Author the smoke song-DB fixture `proposal_contracts/fixtures/catalog/smoke-catalog.json` (valid `Song` records incl. artist IDs, release dates, karaoke-flag variants) — algorithm-blind, trait-separated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The frozen hyperparameter tables, trait derivation, and weight resolution — every
scoring story depends on these. ⚠ No user story can complete before this phase.

- [ ] T006 Populate `package.json` `hyperparameters` with the full frozen defaults: `trait_composition_matrix` (Table 1), `context_response_matrix` (Table 2 incl. ⚠ signs), `hierarchy_weights` (§6.1), `purpose_multipliers` (§6.2), `genre_affinity_maps` (§5.7 + vocabulary), `age_era_affinity` (§5.5), `norm_bounds`, `history_curves` (§5.3), `lighting_lookup`, and scalars (`plan_item_count`, `fixed_humming_segment_sec`, `directional_hypothesis`, `skip_exclusion_window`, `content_category_weights`, `parameter_set_version`, `formula_version`).
- [ ] T007 [P] Test `app/api/tests/proposal/test_content_selector_traits.py`: each trait column sums to 1; every trait output ∈ [0,1]; `tempo` uses `norm_tempo` for arousal but `tempo_ease` for singability; `key`/`time_signature`/`liveness` never affect a trait; signed `A_s=2·arousal−1`, `V_s=2·valence−1`. (MUST fail first.)
- [ ] T008 Implement trait derivation (§4.4) in `algorithm.py` (arousal, valence, humming_ease, full_karaoke_ease from Audio Features via `trait_composition_matrix`+`norm_bounds`); make T007 pass.
- [ ] T009 [P] Test `app/api/tests/proposal/test_content_selector_response_weights.py`: `base×purpose×mask` → normalized `Σ effective_weight = 1`; masked leaves contribute 0 and renormalize; a purpose multiplier on a masked subgroup creates no active weight; zero denominator → `invalid_configuration`. (MUST fail first.)
- [ ] T010 Implement effective-weight resolution (§6.1–6.3) in `algorithm.py`; make T009 pass.

---

## Phase 3: User Story 1 — Ranked, explained song plan (Priority: P1) 🎯 MVP

**Goal**: Return one ordered, fully explained `complete_plan` for a music service, with no
aggregate plan score.

**Independent test**: Feed a fixed world+service+catalog; assert exactly `plan_item_count`
items, ordered by `item_fit`, each with traits + per-feature contributions + bilingual reasons;
no `plan_score`; every item cites a catalog Track ID.

- [ ] T011 [P] [US1] Test `app/api/tests/proposal/test_content_selector_contract.py`: `complete_plan` shape validates against `aica_api.models.proposal.content_output.CompletePlan` **and** `proposal_contracts/schema/content_output.schema.json`; exact item count; ordered `(item_fit desc, id asc)`; **no** `plan_score`/`aggregate_score`/`plan_fit` (field-name scan); every `item_id` in catalog. (MUST fail first.)
- [ ] T012 [P] [US1] Test `app/api/tests/proposal/test_content_selector_scoring.py`: six mood features compute `a_i=α·A_s+β·V_s`; `r_i=e_i·a_i`; the §10 worked block reproduces **+0.187** within `1e-12`; all-neutral world → mood block 0; `|a_i|≤1`; valence β never negative; each direct/exact-ID row uses `+1`. (MUST fail first.)
- [ ] T013 [US1] Implement response coefficients (§5.1–5.4) in `algorithm.py`: six mood features from traits; `Song singability` (humming_ease/full_karaoke_ease → `2·ease−1`, masked 0 for playlist); direct/exact-ID rows (`+1` match); make T012 pass.
- [ ] T014 [US1] Implement the `item_fit` chain (`clamp(Σ w_i·r_i,−1,+1)`), fixed feature order, sort `(item_fit desc, Track ID asc)`, and take `plan_item_count`.
- [ ] T015 [US1] Implement service gating (FR-003a: present+supported → proceed; None → `invalid_request`; non-music → `unsupported_recipe`), `PlanMode` per service (playlist/humming with `driving_lyrics=false`+`fixed_segment_sec`/full-karaoke stopped-only+simulated queue), `expected_duration_sec` (summed durations vs `count×fixed_segment`), optional `LightingConfiguration` (compatible services only, never affects order), and bilingual `{ja,en}` rationale (FR-016); assemble `CompletePlan`; make T011 pass.
- [ ] T016 [US1] Implement per-item `ItemFeatureContribution` rows (`e_i,a_i,alpha/beta or exact_match,r_i,base_weight,purpose_multiplier,mask,effective_weight,contribution,formula_version`) and `algorithm_provenance` (versions, active vs context-only lists, matrix versions, normalized weights, sort/tie-break, duration basis, ordered Track IDs) per §14.

**Checkpoint**: US1 delivers a runnable, explained, contract-valid playlist/humming/full-karaoke plan.

---

## Phase 4: User Story 2 — Context changes reverse plan mood (Priority: P1)

**Goal**: A single driver/environment field change reverses (not rescales) calm/active order.

**Independent test**: Six single-field contrasts each reverse ordering; a route-only change
does not reorder.

- [ ] T017 [P] [US2] Author contrast fixtures under `proposal_contracts/fixtures/worlds/` and `.../catalog/`: six single-field world pairs (low/high drowsiness, fatigue, monotony; normal/congested; highway/mountain; day/night) + a route-A/route-B pair, over a trait-separated (calm↔active, bright↔dark) catalog.
- [ ] T018 [P] [US2] Test `app/api/tests/proposal/test_content_selector_contrasts.py`: each of the six contrasts **reverses** the calm/active ranking; the route-only contrast produces **no** rank change; `directional_hypothesis=soothe_destress` default and the `keep_alert` sign-flip both behave as specified. (MUST fail first.)
- [ ] T019 [US2] Wire the `directional_hypothesis` knob (⚠ fatigue/traffic/night α sign) into the response matrix lookup in `algorithm.py`; make T018 pass.

**Checkpoint**: The two-axis reversal hypothesis is demonstrated.

---

## Phase 5: User Story 3 — Hard eligibility & safety dominate (Priority: P1)

**Goal**: Ineligible/unsafe songs are excluded before scoring and never reinstated; full
karaoke refused while moving.

**Independent test**: A top-scoring but ineligible song is absent + listed excluded; full
karaoke while driving → typed stopped-required; too-few eligible → `insufficient_eligible_items`.

- [ ] T020 [P] [US3] Test `app/api/tests/proposal/test_content_selector_eligibility.py`: schema/identity, playability, market, restriction, explicit-under-child, recent-skip window, duplicate, humming/full-karaoke flags, full-karaoke stopped-motion; flags never change score; `insufficient_eligible_items`; `no_proposal`; missing trait-required audio field → `invalid_catalog`. (MUST fail first.)
- [ ] T021 [US3] Implement hard eligibility (§7) in `algorithm.py` — runs before scoring, records `excluded_items` reason codes, no score can reinstate; make the eligibility cases of T020 pass.
- [ ] T022 [US3] Implement the typed decision/error outcomes (§13: `full_karaoke_requires_stopped`, `insufficient_eligible_items`, `no_proposal`, `invalid_catalog`, `invalid_configuration`, `unsupported_recipe`/`unsupported_service`); make the remaining T020 cases pass.

**Checkpoint**: Safety/grounding cannot be reversed by score.

---

## Phase 6: User Story 4 — Complete, provenance-marked feature contract (Priority: P2)

**Goal**: Every §9/A.2 content row is used / context-only / available-but-not-used with
visible provenance; history factors move only their own contribution.

**Independent test**: Every disposition-registry row appears in the plan's active or
context-only lists with provenance; a single history change moves only that feature.

- [ ] T023 [P] [US4] Test `app/api/tests/proposal/test_content_selector_provenance.py`: the plan's `algorithm_provenance` active/context-only lists + `unused_available_features`/`missing_features` cover **every** row in `content_feature_dispositions.v1.json` (none dropped) with feature-origin + response provenance; a recent-skip/acceptance/recovery change moves only its own contribution. (MUST fail first.)
- [ ] T024 [US4] Implement the disposition-registry-driven feature loop in `algorithm.py`: score the Preference/History exact-ID features (played/skipped/changed/catalog-item-usage/acceptance/recovery via `history_curves`), oshi gate + exact-artist match, `age_band` era affinity (§5.5); emit `missing_neutral` for absent scored fields; populate context-only/available/missing lists; make T023 pass.

**Checkpoint**: The independent content contract is complete and transparent.

---

## Phase 7: User Story 5 — Genre extension opt-in & off-equivalent (Priority: P2)

**Goal**: With `genre_affinity_v1` off, the six genre features are context-only and ordering
equals the Spotify-only baseline; on, they contribute via best-match genre affinity.

**Independent test**: Extension-off ordering is byte-identical to the pre-extension baseline;
extension-on adds genre contributions without changing child safety.

- [ ] T025 [P] [US5] Test `app/api/tests/proposal/test_content_selector_genre.py`: extension **off** → six genre leaves mask 0/context-only and ordering byte-identical to baseline; **on** → mask 1, `a_i=clamp(max_{g∈G_song} g_target[g],−1,+1)`, empty `G_song` → `missing_neutral` (no redistribution); explicit-child safety unchanged either way. (MUST fail first.)
- [ ] T026 [US5] Implement genre best-match scoring (§5.7) in `algorithm.py` (Tier-1 tag→genre maps + Tier-2 `usage_by_genre`/`scene_genre_usage` curves; mask flip driven by `enabled_feature_extensions`); make T025 pass.

**Checkpoint**: The extension is a clean, reversible opt-in.

---

## Phase 8: User Story 6 — Deterministic, replayable plan (Priority: P2)

**Goal**: Identical inputs+versions reproduce identical plan+evidence.

**Independent test**: Two runs of identical frozen inputs are byte-equivalent.

- [ ] T027 [P] [US6] Test `app/api/tests/proposal/test_content_selector_determinism.py`: same inputs+versions twice → byte-equivalent plan + evidence (`1e-12` tolerance); `−0` serialized as `+0`; stable tie-break by ascending Track ID. (MUST fail first.)
- [ ] T028 [US6] Ensure deterministic evaluation in `algorithm.py`: fixed feature ordering, full-precision ranking with display-only rounding, `−0→+0` normalization, no clock/RNG; make T027 pass.

**Checkpoint**: The transparent replay boundary holds.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Complete `packages/aica_transparent_content_selector_v1/README.md`: provenance to the algorithm doc, the `evaluate()` contract, the full hyperparameter reference, and run instructions.
- [ ] T030 [P] Regression + isolation gate: run the full backend suite (`pytest`), confirm it stays green, confirm no trigger code/test/package changed, and grep the package for any `aica_api` import (must be none).
- [ ] T031 Consistency sync: verify `algorithm.py` behavior matches content-algo §5.5 (age/era), §5.7 (genre), §6 (weights); reconcile the P6 design doc / master doc if any drift emerged during implementation.
- [ ] T032 Run the quickstart milestone-exit demonstration end to end (all `content_selector` tests + full backend suite green; six reversals; route-no-change; genre off==baseline; §10 block=+0.187; CompletePlan+schema validation; no aggregate score).

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** → **US1 (P3, MVP)** → then US2/US3/US4/US5/US6 → **Polish (P9)**.
- Foundational (T006–T010) blocks all scoring stories.
- US1 (T011–T016) is the MVP and must precede US2 (contrasts verify US1 scoring) and US4/US5 (which add feature families to the same loop). US3 (eligibility) depends only on Setup+Foundational+US1 assembly and can run after US1.
- US6 (determinism) should run last among stories (covers the full assembled output).
- Within a phase, `[P]` tasks touch different files (tests vs manifest vs fixtures) and can run in parallel; implementation tasks on `algorithm.py` are sequential.

## Parallel Opportunities

- Setup: T003, T004, T005 in parallel.
- Each story's test-authoring task `[P]` runs while the previous story's implementation is reviewed (tests are separate files).
- Fixture authoring (T005, T017) parallel with manifest/test work.

## Acceptance-criterion → task coverage

| Criterion | Implementation | Verification |
|---|---|---|
| SC-001 plan count/order/no-aggregate | T014, T015 | T011 |
| SC-002 six reversals + route no-change | T013, T019 | T018 |
| SC-003 catalog grounding | T014 | T011 |
| SC-004 eligibility/safety non-reversible | T021, T022 | T020 |
| SC-005 genre off == baseline | T026 | T025 |
| SC-006 determinism | T028 | T027 |
| SC-007 every contract row marked | T024 | T023 |
| SC-008 worked block +0.187 / all-neutral 0 | T013, T014 | T012 |
| SC-009 regression, no trigger change | — | T030 |

## Implementation Strategy

- **MVP = Phases 1–3** (Setup + Foundational + US1): a runnable, contract-valid, explained plan.
- Deliver incrementally, one story per phase, each independently testable, committing at every
  green checkpoint (TDD: write the failing test, confirm it fails for the right reason,
  implement the smallest change, refactor, re-run the affected layer).
