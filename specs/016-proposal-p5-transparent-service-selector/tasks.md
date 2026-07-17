---
description: "Task list for P5 — Transparent Service-Selector Package"
---

# Tasks: P5 — Transparent Service-Selector Package

**Input**: Design documents from `specs/016-proposal-p5-transparent-service-selector/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — this milestone is built TDD (write the failing test, watch it fail for the right reason, implement the smallest change). Contract/evidence/math surfaces get contract+integration tests per the constitution.

**Organization**: Grouped by user story (US1–US4 from spec.md). US1 is the MVP.

## Path Conventions

- Package: `packages/aica_transparent_service_selector_v1/`
- Backend model: `app/api/aica_api/models/proposal/service_output.py`
- Backend tests: `app/api/tests/proposal/test_p5_*.py`
- Frontend: `app/frontend/src/api/proposalClient.ts`, `app/frontend/src/components/proposal/`
- Fixtures: `proposal_contracts/fixtures/service/`
- Run backend tests: `cd app/api && uv run python -m pytest`; frontend: `cd app/frontend && npm test`.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create the package skeleton `packages/aica_transparent_service_selector_v1/` with empty `algorithm.py` (module docstring + `def evaluate(context: dict) -> dict: ...` stub raising `NotImplementedError`), `README.md` (pointing to the authoritative algorithm doc + design), and a `package.json` stub with `id`, `family: "service_selector"`, `approach: "transparent"`, `kind: "service_selector"`, `algorithm.type: "python_module"`, `algorithm.entrypoint: "algorithm.py"`, `supported_services` (all service ids the matrix can produce), `contract_version`, `schema_version`.
- [x] T002 [P] Create the fixtures directory `proposal_contracts/fixtures/service/` and add a README noting these are frozen golden worlds authored from the algorithm doc §10/§11 (never score-derived).
- [x] T003 [P] Verify the package is discovered: add `app/api/tests/proposal/test_p5_registry.py` asserting `ProposalPackageRegistry` loads `aica_transparent_service_selector_v1` into the `service_selector`/`transparent` slot with no load error, and that the mock still loads. (Fails until T001 manifest is valid.)

**Checkpoint**: package is registered and slotted; no behavior yet.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Externalized config + extended contract + goldens that ALL stories build on.

- [x] T004 Populate `packages/aica_transparent_service_selector_v1/package.json` with the FULL externalized configuration from data-model.md §6: `parameters` = `service_response_profiles` (§5.2.1/§5.2.3/§5.2.4 per ServiceId × feature, each cell `{coefficient, provenance, source_reference}`), `road_response_profiles` (§5.2.2), `response_anchor_map`, `usage_ordinal_map`, `recency_ordinal_map`, `scene_taxonomy`, `missing_policy`, `top_k`, `tie_breaker`, `material_safety_gap`; `hyperparameters` = §6.1 hierarchy weights (category/subgroup/leaf ratios), §6.2 purpose-multiplier table, `gamma_drowsiness/fatigue/monotony`, `route_tag_saturation`/`destination_tag_saturation`, `monotony_medium_min`/`monotony_high_min`, `safety_share_warning_floor`, and `confidence_shrinkage_v1` (bool default false). Values copied verbatim from the algorithm doc.
- [x] T005 [P] Author `proposal_contracts/fixtures/service/worked-example.json` — the §10 inattentive② world (drowsiness 80, fatigue 60, congested, highway, night, monotony 75, 2 route tags, 1 dest tag, child, group, oshi reg+on, recency long_unused, usage high, scene high, acceptance 75, recovery 70) as a full `evaluate()` context; record the golden `humming_karaoke = +0.772349` and `music_playlist ≈ +0.132` in a sidecar comment/README.
- [x] T006 Write failing test `app/api/tests/proposal/test_p5_contract_extension.py`: (a) the CURRENT mock output dict validates through the extended `ServiceSelectorOutput` unchanged; (b) a fully-populated real-shaped dict (all §14 optional fields + `dominance` + subtotals) validates and bounds hold. Run — fails (fields don't exist yet).
- [x] T007 Extend `app/api/aica_api/models/proposal/service_output.py` per contracts/service_output_extension.md: add the optional §14 fields to `FeatureContribution`, add `DominanceReadout`, add optional `situation_fit/preference_fit/history_fit/strongest_support/strongest_oppose/dominance` to `RankedCandidate`, add optional `dominance/effective_weights/resolved_config_versions` to `ServiceSelectorOutput`. Keep every existing validator; add NO new required field. Make T006 pass.
- [x] T008 [P] Extend the frontend types in `app/frontend/src/api/proposalClient.ts` to mirror the optional §14 fields + `DominanceReadout` (all `?:`); add a Vitest type/rendering-safety test that the mock's lean output still type-checks and renders (no crash on absent fields).
- [x] T009 Verify `_build_service_context` (`app/api/aica_api/routers/proposal.py`) actually delivers every A.1 field the package scores: add `app/api/tests/proposal/test_p5_context_fields.py` asserting a typed-World run's `feature_snapshot` contains drowsiness/fatigue/traffic/road/night/monotony/route_tags/destination_tags/child/group/oshi_registered/oshi_mode + candidate-indexed `service_recency_state/service_usage_level/scene_service_usage_level/service_proposal_acceptance_rate/service_recovery_rate/*_confidence`. If any is absent, extend the projection additively (not the package). 

**Checkpoint**: config + contract + goldens ready; scorer can be built against them.

---

## Phase 3: User Story 1 — Rank eligible services with a real, inspectable score (P1) 🎯 MVP

**Goal**: Real `service_fit` ranking of eligible candidates, worked example reproduced, drawn only from the eligible set. **Independent test**: run the worked-example world → `humming_karaoke` top at `+0.772349`, above `music_playlist`, all candidates ∈ eligible set.

- [x] T010 [P] [US1] Write failing `app/api/tests/proposal/test_p5_service_math.py::test_weight_resolution` — assert the WeightResolver reproduces the §6.2 normalized-weight table for all 4 purposes (Σw=1 within 1e-12, each cell matches the doc).
- [x] T011 [P] [US1] Write failing `test_p5_service_math.py::test_worked_example` — `evaluate(worked-example.json)` yields `humming_karaoke.score == +0.772349` (±1e-12) and ranks it above `music_playlist`.
- [x] T012 [P] [US1] Write failing `app/api/tests/proposal/test_p5_features.py` — per-feature normalization: `(x/100)^γ` for drowsiness/fatigue/monotony (incl. 0/100 boundaries, γ bounds); road categorical `e=1`; oshi mode off→−1/on→+1 + invalid `oshi_registered=false ∧ oshi_mode=on` rejected; usage/recency/acceptance/recovery ordinal & `2·rate/100−1` maps; route/dest tag saturation + unknown-tag handling; scene-mean aggregation; missing candidate entry → neutral/disclosed.
- [x] T013 [P] [US1] Write failing `app/api/tests/proposal/test_p5_response_matrix.py` — every §5.2.1/§5.2.2/§5.2.3/§5.2.4 cell (all 5 post-rest incl. `call_response_stopped`) equals the doc coefficient; `radio_style` neutral except oshi; mountain opposes high-interaction; direct features `+1.0`; every eligible candidate×feature cell has coefficient+provenance+source/null.
- [x] T014 [P] [US1] Write failing `app/api/tests/proposal/test_p5_eligibility_ranking.py` — candidates only from `allowed_service_ids`; `(service_fit desc, candidate_id asc)` tie-break; `top_k=3`; empty eligible → `no_proposal`; low/negative fit still ranked; a candidate outside the eligible set → algorithm error (via dispatch).
- [x] T015 [US1] Implement the FeatureNormalizer + SceneResolver in `algorithm.py` (all 17 evidence functions, §5.7 scene taxonomy) — read γ/saturation/maps from hyperparameters by direct index (missing key → `invalid_configuration`). Make T012 pass.
- [x] T016 [US1] Implement the WeightResolver (normalize siblings → base = cat×subgroup×leaf → apply purpose multipliers → renormalize Σ=1) in `algorithm.py`. Make T010 pass.
- [x] T017 [US1] Implement the ResponseResolver (candidate + road profiles from `parameters`) + CandidateScorer (`r_i=clamp(e_i·a_i)`, road `r=a_road`, `k_i=w_i·r_i`, `service_fit=clamp(Σk_i)`) + InputValidator (§9 step 1 validations) + Ranker (§9 step 7). Make T011, T013, T014 pass.
- [x] T018 [US1] Make the transparent package the default service package the proposal screen offers (frontend package-slot selection) while keeping the mock selectable; add/adjust a test that the default service slot resolves to `aica_transparent_service_selector_v1`.
- [x] T019 [US1] Add `app/api/tests/proposal/test_p5_run_integration.py` — create a proposal run + `select-service` with the transparent package against a typed-World seed; assert the persisted `ProposalRunLog` evidence has `output` with real ranked candidates from the eligible set and a `SERVICE_SELECTED` event; error paths produce `ALGORITHM_ERROR` not a fabricated ranking.

**Checkpoint**: US1 independently testable — real ranking end-to-end. **MVP complete.**

---

## Phase 4: User Story 2 — Read the reasoning behind each ranking (P1)

**Goal**: Full §14 trace + subtotals + support/oppose + dominance, rendered in Panel ③. **Independent test**: expand a candidate → all 17 rows with value→e·a=r×w=k + provenance; subtotals reconcile; dominance readout shown.

- [x] T020 [P] [US2] Write failing `test_p5_service_math.py::test_subtotals_reconcile` — situation/preference/history subtotals sum to the unclamped `Σk_i` within 1e-12 for the worked example and a negative-fit case; subtotals are never used as a sort key.
- [x] T021 [P] [US2] Write failing `test_p5_service_math.py::test_dominance_invariant` — for every built-in purpose `W_D·1.00 > 2·W_L`, `status=default_dominance_preserved`, `safety_share` matches the doc (~.788/.823/.725/.729); an adversarial dominant-gap=1.00 pair keeps the higher-safety candidate first; an invariant-violating custom weight set still evaluates but emits `dominance_not_guaranteed` + required gap.
- [x] T022 [P] [US2] Write failing `test_p5_features.py::test_feature_gate_completeness` — every A.1 contract row appears in evidence marked `used` or in `unused_available_features`; 0 rows silently dropped; CDC-SU vs Additional-proposed provenance distinguished; the two confidence fields are `available_but_not_used` (extension off).
- [x] T023 [US2] Implement the EvidenceBuilder in `algorithm.py`: populate every §14 `FeatureContribution` field (source_reference, raw_value, normalization_function, normalized_evidence, response_coefficient+provenance, normalized_feature_response, hierarchy_path, base_weight, purpose_multiplier, effective_weight, status), per-candidate subtotals + strongest_support/oppose, per-candidate + top-level `dominance`, `effective_weights`, `resolved_config_versions`, `unused_available_features`, `missing_features`. Make T020, T021, T022 pass.
- [x] T024 [P] [US2] Enrich Panel ③ (`app/frontend/src/components/proposal/ServiceProposalPanel*.tsx`): render score, the three subtotals, strongest support/oppose, the dominance readout (status + safety_share %), and an expandable per-feature contribution table (`feature_id · raw → e·a = r × w = k` + provenance). Bilingual, JA default; add i18n labels. Graceful fallback when fields absent (mock).
- [x] T025 [P] [US2] Add a Vitest test (`ServiceProposalPanel.test.tsx`) rendering a real-shaped candidate (asserts 17 rows, subtotals, dominance visible) AND a mock-shaped candidate (asserts lean fallback, no empty headers, no crash).
- [x] T025a [P] [US2] (FR-023) Add `app/api/tests/proposal/test_p5_no_probability_claims.py` asserting the package output + evidence never labels `service_fit` as an acceptance probability, recovery probability, or safety certification (scan rationale/labels/provenance strings for forbidden phrasings), and add the matching guard to the Panel ③ i18n labels (a Vitest assertion that no dominance/score label uses "probability"/"確率"/"certified"/"安全保証").

**Checkpoint**: US2 independently testable — "why A above B?" answerable from the UI + evidence.

---

## Phase 5: User Story 3 — Tune the hypothesis and see the explanation change (P2)

**Goal**: Edited weights/multipliers/response coefficients change the ranking/explanation; entered + resolved values recorded. **Independent test**: raise route-context weight → route-preferred services move; both entered+resolved weights in evidence.

- [x] T026 [P] [US3] Write failing `test_p5_service_math.py::test_purpose_multiplier_reorder` — same worked-example snapshot under `route_music` vs `inattentive` reorders music vs humming (route/dest weight shift), matching the doc §10 narrowing.
- [x] T027 [P] [US3] Write failing `test_p5_service_math.py::test_sibling_scale_invariance` + `test_editable_override` — scaling all sibling weights by a constant changes nothing; a customer response-coefficient override (finite, in [−1,+1]) changes the ranking, retains original provenance + adds `customer_override`; out-of-range/NaN/inf coefficient rejected as `invalid_configuration`.
- [x] T028 [US3] Ensure `evaluate()` records both reviewer-entered and resolved-normalized weights (`effective_weights` + entered ratios in `resolved_config_versions`) and recomputes/records dominance after every config resolve. Make T026, T027 pass. (Router already freezes hyperparameters per run — verify, don't re-implement.)
- [x] T029 [P] [US3] Add `app/api/tests/proposal/test_p5_editable_run.py` — two runs of the same world (default vs raised route-context weight) produce different rankings, both evidence blocks carry entered+resolved values; an invariant-breaking edit run records `dominance_not_guaranteed` and still ranks.

**Checkpoint**: US3 independently testable — the hypothesis is tunable and the change is visible + recorded.

---

## Phase 6: User Story 4 — Optionally weaken sparse history via confidence (P3)

**Goal**: Opt-in `confidence_shrinkage_v1` hyperparameter; off==baseline, on shrinks sparse acceptance/recovery. **Independent test**: identical acceptance rate, low vs high confidence → equal when off, low contributes less when on.

- [x] T030 [P] [US4] Write failing `app/api/tests/proposal/test_p5_confidence_shrinkage.py` — (a) FIREWALL: with `confidence_shrinkage_v1=false`, `evaluate()` output equals the no-extension baseline byte-for-byte across the worked example + contrast fixtures, and the two confidence fields are `available_but_not_used`; (b) with `=true`, two candidates with identical acceptance rate but different confidence get different (lower-confidence-smaller) acceptance contributions, and the affected rows carry `response_provenance=confidence_shrinkage_v1`; (c) missing confidence ⇒ 1.0, disclosed.
- [x] T031 [US4] Implement the confidence-shrinkage branch in the FeatureNormalizer/EvidenceBuilder: when the hyperparameter is true, `e_acceptance ← e_acceptance·clamp(conf_acc[c],0,1)` and `e_recovery ← e_recovery·clamp(conf_rec[c],0,1)`; when false, exact baseline + confidence fields marked available-but-not-used. Make T030 pass.
- [x] T032 [P] [US4] Surface the `confidence_shrinkage_v1` toggle in the Panel ③ algorithm-parameter surface (bool, default off, bilingual label); add a Vitest test that toggling it is reflected in the run request's hyperparameters and its state shows in evidence.

**Checkpoint**: US4 independently testable — opt-in extension delivered without disturbing the baseline.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T033 [P] Author the §11 13 one-field contrast fixtures `proposal_contracts/fixtures/service/contrast-*.json` and `app/api/tests/proposal/test_p5_contrast_golden.py` asserting each documented reorder direction (drowsiness/fatigue/monotony low↔high; normal↔congested; highway↔mountain; day↔night; child; oshi mode; recency; overall usage; recovery; route_music vs inattentive).
- [x] T034 [P] Add `app/api/tests/proposal/test_p5_determinism.py` — identical frozen inputs+config reproduce identical output within 1e-12; canonical serialization is byte-equal on re-run; `−0→+0`.
- [x] T035 [P] Add an isolation guard test `app/api/tests/proposal/test_p5_isolation.py` — the package and `service_output.py` import nothing from `aica_api.models` (trigger); grep-style AST/import assertion mirroring the P4 isolation guard.
- [x] T036 Run the FULL proposal + trigger suites and confirm green: `cd app/api && uv run python -m pytest tests/proposal/ tests/ -q` (baseline 838 proposal + trigger). Fix any regression caused by the contract extension.
- [x] T037 [P] Write `packages/aica_transparent_service_selector_v1/README.md` fully (symbol chain summary, provenance, config surface, confidence-shrinkage note, links to the algorithm doc + this spec).
- [x] T038 Reconcile the SpecKit artifacts + master docs to the shipped implementation (spec.md, plan.md, data-model.md if the projection was extended in T009; confirm milestone §17 + algorithm §5.4/§5.6/§19 already amended). Update the `m*`/P-status memory note is out of scope here (done at merge).
- [x] T039 Run the E2E exit demo from quickstart.md (`docker compose up`, transparent package, worked-example world) and capture evidence for each acceptance criterion (SC-001…SC-010); record results in the milestone completion report.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T009)** block everything.
- **US1 (T010–T019)** is the MVP and must precede US2 (the trace is emitted by the US1 scorer). US2 (T020–T025) → US3 (T026–T029) → US4 (T030–T032). US3/US4 depend on US1's scorer + US2's evidence builder but are independently testable increments.
- **Polish (T033–T039)** after all stories; T036 (full regression) and T039 (E2E) are the closing gates.
- Within a phase, `[P]` tasks touch different files (tests vs impl, backend vs frontend, distinct fixtures) and may run in parallel. Implementation tasks that share `algorithm.py` (T015–T017, T023, T028, T031) are sequential.

## Parallel Execution Examples

- Foundational: T005 (fixture) ∥ T008 (frontend types) ∥ T006 (contract test) while T004 (config) proceeds.
- US1 tests: T010 ∥ T011 ∥ T012 ∥ T013 ∥ T014 authored together (all fail), then implement T015→T016→T017 sequentially in `algorithm.py`.
- US2: T024 (Panel ③) ∥ T025 (Vitest) run alongside backend T023.
- Polish: T033 ∥ T034 ∥ T035 ∥ T037 in parallel; then T036, then T038, then T039.

## Implementation Strategy

MVP = Phase 1 + Phase 2 + Phase 3 (US1): a real, eligible, worked-example-correct ranking wired as the default. Ship/review that, then layer US2 (explainability + panel), US3 (tunable), US4 (confidence extension), and close with Polish (contrasts, determinism, isolation, full regression, E2E demo).
