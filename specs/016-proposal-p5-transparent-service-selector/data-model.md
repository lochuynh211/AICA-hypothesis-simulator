# Phase 1 Data Model — P5 Transparent Service-Selector

All additions to the neutral contract are **optional** (default absent/None) so
`mock_service_selector_v1`'s existing output still validates. Field names track
the algorithm doc §14 explainability contract. Serialization: `mode="json"`,
`−0 → +0`, deterministic.

## 1. `FeatureContribution` (EXTEND — `models/proposal/service_output.py`)

Existing (unchanged, required): `feature_id: str`,
`feature_value: str|float|int`, `response_coefficient: float`, `weight: float`,
`contribution: float`.

New optional §14 fields:

| Field | Type | Meaning (algorithm §14) |
|---|---|---|
| `source_reference` | `str \| None` | e.g. "Slide 67 driver row"; `null` if hypothesis-only |
| `raw_value` | `str \| float \| int \| None` | `x_i` world snapshot / candidate-map entry |
| `normalization_function` | `str \| None` | e.g. `"(x/100)^gamma"`, `"2*rate/100-1"`, `"ordinal_map"` |
| `normalized_evidence` | `float \| None` | `e_i` ∈ `[0,1]` or `[−1,+1]` |
| `response_provenance` | `str \| None` | `cdc_su_explicit` / `service_definition` / `normalized_context_hypothesis` / `rest_action_hypothesis` / `post_rest_hypothesis` / `cdc_su_direct_candidate_feature` / `neutral_source_silent` / `confidence_shrinkage_v1` |
| `customer_override` | `float \| None` | the reviewer-entered response coefficient when this cell was overridden (algorithm §4.2: the cell **retains its original `response_provenance`** AND carries `customer_override` with the changed value — override is a separate field, not a provenance value) |
| `normalized_feature_response` | `float \| None` | `r_i = clamp(e_i·a_i, −1, +1)` |
| `hierarchy_path` | `str \| None` | e.g. `"Situation/Driver state/drowsiness"` |
| `base_weight` | `float \| None` | pre-multiplier flattened weight |
| `purpose_multiplier` | `float \| None` | §6.2 subgroup multiplier applied |
| `effective_weight` | `float \| None` | `w_i` (== existing `weight`; kept explicit for the §14 row) |
| `status` | `str \| None` | `used` / `neutral` / `zero_weight` / `missing` / `invalid` |

Validation: when present, `normalized_evidence ∈ [−1,+1]`,
`response_coefficient ∈ [−1,+1]`, `normalized_feature_response ∈ [−1,+1]`,
`effective_weight ∈ [0,1]`. `status ∈` the enum above. (Enforced softly — the
package guarantees them; a violating value is a package bug surfaced by tests,
not a silent clamp.)

## 2. `DominanceReadout` (NEW optional object)

Per-candidate and/or top-level configuration readout (§6.4):

| Field | Type | Meaning |
|---|---|---|
| `status` | `str` | `default_dominance_preserved` \| `dominance_not_guaranteed` |
| `w_d` | `float` | `W_D` = Σ weights of Driver State + Driving Environment + Recovery |
| `w_l` | `float` | `W_L = 1 − W_D` |
| `required_gap` | `float` | `2·W_L / W_D` |
| `material_safety_gap` | `float` | the package's configured gap (default `1.00`) |
| `safety_share` | `float` | == `w_d` (the ~0.79 readout) |
| `safety_share_warning` | `bool` | `safety_share < safety_share_warning_floor` (default floor `0.40`) |

## 3. `RankedCandidate` (EXTEND)

Existing (unchanged): `rank`, `candidate_id: ServiceId`, `score: float|None`,
`rationale: list[str]`, `supporting_feature_ids: list[str]`,
`opposing_feature_ids: list[str]`, `uncertainty: str|None`,
`feature_contributions: list[FeatureContribution]`.

New optional fields:

| Field | Type | Meaning |
|---|---|---|
| `situation_fit` | `float \| None` | Σ contributions of Situation features (explanatory, not a sort key) |
| `preference_fit` | `float \| None` | Σ Preference features |
| `history_fit` | `float \| None` | Σ History features |
| `strongest_support` | `{feature_id, contribution} \| None` | max positive `k_i` |
| `strongest_oppose` | `{feature_id, contribution} \| None` | min negative `k_i` (null if none) |
| `dominance` | `DominanceReadout \| None` | per-candidate dominance view |

Invariant (test, not model validator): `situation_fit + preference_fit +
history_fit` reconciles to the unclamped `Σ k_i` within `1e-12`; `score` is that
sum clamped to `[−1,+1]`.

## 4. `ServiceSelectorOutput` (EXTEND)

Existing (unchanged): `decision_type: ServiceDecisionType`,
`ranked_candidates`, `excluded_candidates`, `unused_available_features`,
`missing_features`, `next_package_runtime_state: dict`,
`algorithm_provenance: dict`. Existing validators (≤3 ranked, contiguous ranks
from 1, `no_proposal ⇒ empty`) unchanged.

New optional fields:

| Field | Type | Meaning |
|---|---|---|
| `dominance` | `DominanceReadout \| None` | run-level (config) dominance readout — same object shape |
| `effective_weights` | `dict[str,float] \| None` | resolved `w_i` per feature id (Σ=1), for the "resolved beside entered" evidence (FR-018) |
| `resolved_config_versions` | `dict \| None` | parameter/hyperparameter/response-profile versions recorded in evidence |

`algorithm_provenance` (existing free dict) additionally carries
`package_id`/`contract_version`/`schema_version`/`purpose`/`extensions_on` — no
schema change needed (already `dict`).

## 5. Package `evaluate()` I/O (contract, not a stored model)

- **Input** (`context`, built by `_build_service_context`, unchanged shape):
  `trigger_purpose`, `lifecycle_stage`, `allowed_service_ids` (eligible subset),
  `eligible_candidates`, `excluded_candidates`, `feature_snapshot` (all A.1
  fields), `feature_provenance`, `parameters`, `hyperparameters` (incl.
  `confidence_shrinkage_v1`), `enabled_feature_extensions` (unused by the service
  package — confidence is a hyperparameter), `run_seed` (ignored — deterministic).
- **Output**: a `ServiceSelectorOutput`-shaped dict (see §1–§4). Errors are raised
  as exceptions / returned as non-conforming shapes → `dispatch_selector`
  converts to `AlgorithmEvidence.error` (categories: `invalid_request`,
  `invalid_catalog`, `invalid_configuration`, `algorithm_exception`,
  `invalid_result_shape`, `candidate_outside_allowed_set`).

## 6. Externalized `package.json` configuration (structural + numeric)

- `service_response_profiles` (§5.2.1/§5.2.3/§5.2.4 per ServiceId × feature),
  `road_response_profiles` (§5.2.2), `response_anchor_map`, `usage_ordinal_map`,
  `recency_ordinal_map`, `scene_taxonomy`, `missing_policy`, `top_k`,
  `tie_breaker`, `material_safety_gap` — parameters.
- §6.1 hierarchy weights (category/subgroup/leaf ratios), §6.2 purpose
  multipliers, `gamma_drowsiness/fatigue/monotony`,
  `route_tag_saturation`/`destination_tag_saturation`, `monotony_medium_min`/
  `monotony_high_min`, `safety_share_warning_floor`, response-coefficient override
  slots, and `confidence_shrinkage_v1` (bool, default `false`) — hyperparameters.

## 7. Frozen fixtures (data)

- `proposal_contracts/fixtures/service/worked-example.json` — the §10 inattentive②
  world; golden `humming_karaoke = +0.772349`.
- `proposal_contracts/fixtures/service/contrast-*.json` — the §11 13 one-field
  pairs (drowsiness/fatigue/monotony low↔high; normal↔congested; highway↔mountain;
  day↔night; child absent↔present; oshi mode off↔on; recency; overall usage;
  recovery; route_music vs inattentive purpose) with the expected reorder
  direction.
