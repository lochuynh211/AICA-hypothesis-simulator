# aica_transparent_service_selector_v1 — Transparent Service Selector (P5)

The real, inspectable replacement for `mock_service_selector_v1`'s fixed
illustrative ranking. Scoring math is authoritative in
**`docs/master/aica_transparent_service_proposal_algorithm.md`**; the P5
milestone's own spec/plan/tasks live under
`specs/016-proposal-p5-transparent-service-selector/`.

Unit A (T001) shipped the package skeleton — a manifest that registers into
the `service_selector`/`transparent` slot and a stub `evaluate()` that raised
`NotImplementedError`.

Unit B (T004-T005, T010-T017) replaces the stub with the real numerically-
critical scoring core: `FeatureNormalizer` + `SceneResolver` (all 17 evidence
functions, §5.7 scene taxonomy), `WeightResolver` (hierarchical
normalization + §6.2 purpose multipliers), `ResponseResolver` (§5.2 candidate
+ road response profiles from the fully-externalized `package.json`
`parameters`), `CandidateScorer`, `InputValidator`, and `Ranker`. The §10
worked example (`humming_karaoke` under inattentive② / active driving)
reproduces to the doc's own published precision — see
`proposal_contracts/fixtures/service/worked-example.golden.md` for the full
e/a/r/w/k reconciliation and a documented ~1.4e-6 rounding artifact in the
doc's own headline figure (verified bug-free via independent exact-rational
recomputation).

**Documented limitation (carried from Unit A):** the frozen purpose/stage
matrix resolves `during_rest_stopped` to an **empty** candidate family — its
§5.2.3 "during-rest actions" (e.g. `rest_duration_suggestion`,
`nap_guidance`) are not `ServiceId` members at all. This package therefore
implements **no** during-rest response profiles; an eligible-candidate list
under that stage is always empty in practice (`no_proposal`), and a caller
that erroneously supplies a candidate for that stage is rejected before
scoring (`candidate_stage_family` validation in `evaluate()`).

Unit B deliberately emits only the *minimum* §14 explainability row per
feature contribution (`feature_id`/`feature_value`/`response_coefficient`/
`weight`/`contribution`) plus the cheap-to-populate optional fields that
fall out of the same computation (raw value, normalization detail,
provenance, hierarchy path, base/purpose/effective weight, status). It does
**not** compute the `situation_fit`/`preference_fit`/`history_fit`
subtotals, `strongest_support`/`strongest_oppose`, or the §6.4 `dominance`
readout — those are a later unit's (US2 `EvidenceBuilder`) responsibility
per `tasks.md` T020-T023.

Confidence-shrinkage (`confidence_shrinkage_v1`, opt-in, default `off`) is
declared as a hyperparameter here (data-model.md §6) but its shrinkage
*behavior* is a later unit's responsibility (T030-T031); with the default
`off`, the two confidence fields are simply reported in
`unused_available_features`.
