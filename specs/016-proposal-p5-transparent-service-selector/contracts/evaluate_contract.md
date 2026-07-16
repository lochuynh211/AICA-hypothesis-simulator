# Contract — `aica_transparent_service_selector_v1.evaluate(context) -> dict`

Authoritative math: `docs/master/aica_transparent_service_proposal_algorithm.md`
(§3–§14). This contract is the operational restatement the tests bind to.

## Purity & determinism

- Pure function: no file/network I/O, no clock, no randomness, no `aica_api`
  import. `run_seed` is ignored. Identical `context` (+ config versions) ⇒
  identical dict (1e-12; same-runtime byte-equal after canonical serialization).
- Stateless: output `next_package_runtime_state = {}`, every candidate
  `uncertainty = null`.

## Input `context` (dict)

| Key | Type | Use |
|---|---|---|
| `trigger_purpose` | str enum | selects the §6.2 multiplier column; control input, never scored |
| `lifecycle_stage` | str enum | selects the candidate family + stopped snapshot; never scored |
| `allowed_service_ids` | list[str] | the **eligible** set (P4-narrowed); candidates MUST come only from here |
| `eligible_candidates` | list[{candidate_id}] | eligible candidates to score |
| `excluded_candidates` | list[{candidate_id, platform_reason}] | copied through to output unchanged |
| `feature_snapshot` | dict | all A.1 world/driver features (drowsiness…recovery, candidate-indexed maps) |
| `feature_provenance` | dict | feature-origin provenance (carried to evidence) |
| `parameters` | dict | resolved structural parameters (§6 data-model) |
| `hyperparameters` | dict | resolved numeric hyperparameters incl. `confidence_shrinkage_v1` |
| `enabled_feature_extensions` | list[str] | ignored by the service package (confidence is a hyperparameter) |

## Pipeline (algorithm §9)

1. **Validate** contract/versions; purpose; purpose/stage compatibility; feature
   types/ranges; oshi consistency (`oshi_registered=false ∧ oshi_mode=on` ⇒
   invalid); hierarchy/multiplier finiteness; response-profile completeness for
   every eligible candidate. Any failure ⇒ typed error (never a fabricated rank).
2. **Confirm constraints** — every eligible candidate ∈ `allowed_service_ids`;
   copy `excluded_candidates` through.
3. **Resolve weights once** — normalize sibling ratios, multiply category ×
   subgroup × leaf ⇒ 17 base weights, apply purpose multipliers, renormalize to
   Σ=1; record base/multiplier/effective.
4. **Build evidence** — normalize scalar/contextual features once; candidate-
   indexed features inside the candidate loop; apply stopped snapshot per stage.
5. **Score each candidate** — `r_i = clamp(e_i·a_i, −1, +1)` (road: `e=1`,
   `r=a_road`); `k_i = w_i·r_i`; `service_fit = clamp(Σ k_i, −1, +1)`; assert the
   unclamped sum ∈ range within tolerance.
6. **Subtotals** — situation/preference/history reconstruct the unclamped sum
   (explanatory, never a sort key).
7. **Rank** — sort `(service_fit desc, candidate_id asc)` at full precision;
   take `top_k` (3).
8. **No-proposal** — `no_proposal` only when the eligible list is empty; a low or
   negative `service_fit` never suppresses.

## Confidence-shrinkage hyperparameter

- `hyperparameters["confidence_shrinkage_v1"]` (bool, default `false`).
- **false** ⇒ features 16/17 use `e = 2·rate/100 − 1` verbatim; the two
  confidence fields are added to `unused_available_features`. Output identical to
  baseline.
- **true** ⇒ `e_acceptance ← e_acceptance · clamp(confidence_acc[c], 0, 1)`,
  `e_recovery ← e_recovery · clamp(confidence_rec[c], 0, 1)`; missing confidence ⇒
  `1.0` and the feature's `status`/evidence disclose it; the affected rows carry
  `response_provenance = confidence_shrinkage_v1`. Shrinking toward 0 makes a
  lower-confidence rate contribute strictly less magnitude than an identical
  higher-confidence rate.

## Output (dict, `ServiceSelectorOutput`-shaped)

- `decision_type`: `ranked_candidates` | `no_proposal`.
- `ranked_candidates`: ≤3, ranks contiguous from 1, each with `score` and the
  §14 per-feature `feature_contributions` (all 17 rows), subtotals,
  support/oppose, and `dominance`.
- `excluded_candidates`: passed through (platform reasons).
- `unused_available_features`: additional-simulator features (motion,
  minutes-to-rest, active-service, rejections, schedule) + the two confidence
  fields when the extension is off; unknown tags.
- `missing_features`: candidate-map misses reported neutral.
- `dominance`, `effective_weights`, `resolved_config_versions` at top level.
- `next_package_runtime_state = {}`, `algorithm_provenance` with ids/versions.

## Error categories (via `dispatch_selector` → `AlgorithmEvidence.error`)

`invalid_request` (purpose/stage/pair), `invalid_catalog` (candidate outside the
frozen row), `invalid_configuration` (weights/multipliers/profiles/versions/
missing hyperparameter key), `algorithm_exception` (unexpected raise),
`invalid_result_shape` (non-dict / schema-invalid),
`candidate_outside_allowed_set` (ranked/excluded id ∉ eligible set). Every error
sets `output=None` and emits an `ALGORITHM_ERROR` event — never a fabricated
ranking.
