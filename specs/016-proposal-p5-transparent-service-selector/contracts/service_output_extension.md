# Contract — `ServiceSelectorOutput` optional extension (backend + frontend)

Backward-compatibility rule: **every new field is optional** (Python default
`None`/absent; TS `?:`). The mock package (`mock_service_selector_v1`) emits none
of them and MUST still validate and render.

## Backend (`app/api/aica_api/models/proposal/service_output.py`)

Add optional fields exactly as listed in `data-model.md` §1–§4:

- `FeatureContribution` += `source_reference`, `raw_value`,
  `normalization_function`, `normalized_evidence`, `response_provenance`,
  `normalized_feature_response`, `hierarchy_path`, `base_weight`,
  `purpose_multiplier`, `effective_weight`, `status` — all `Optional`.
- New `DominanceReadout(BaseModel)` (all required within the object, but the
  object itself is optional on its parents).
- `RankedCandidate` += `situation_fit`, `preference_fit`, `history_fit`,
  `strongest_support`, `strongest_oppose`, `dominance` — all `Optional`.
- `ServiceSelectorOutput` += `dominance`, `effective_weights`,
  `resolved_config_versions` — all `Optional`.

Existing validators (≤3 ranked, contiguous ranks from 1, `no_proposal ⇒ empty`)
are untouched. No new required field. No `model_validator` that could reject the
mock.

**Test**: `test_p5_contract_extension.py` loads the mock package's current output
through the extended model (must pass) and the real package's output (all new
fields populated, `normalized_evidence`/`normalized_feature_response` ∈ [−1,+1]).

## Frontend (`app/frontend/src/api/proposalClient.ts`)

Mirror the optional fields on `FeatureContribution`, `RankedCandidate`, and
`ServiceSelectorOutput` TS types (all `?:`). Add a `DominanceReadout` type. The
existing `pickRationale()` positional-bilingual handling is unchanged.

**Panel ③ render contract** (`ServiceProposalPanel`):
- Always render `score` (existing) + rank + rationale.
- When present, render `situation_fit/preference_fit/history_fit`,
  `strongest_support/oppose`, the `dominance` readout (status + safety_share %),
  and an expandable per-feature table showing
  `feature_id · raw_value → e_i · a_i = r_i × w_i = k_i` + `response_provenance`.
- When absent (mock output), fall back to the current lean rendering — no crash,
  no empty section headers.
- Bilingual, Japanese default; new labels added to the i18n dictionary.

## Evidence & persistence

No change to `AlgorithmEvidence` shape: the richer `ServiceSelectorOutput` dict is
already stored as `evidence.output` (a free JSON object). `used_feature_ids`
(the 17 scored features) and `unused_available_features` continue to populate the
evidence gate. Redaction: the service context has no bulky catalog, so no
`evidence_input_snapshot` redaction is needed (unlike the content path).
