# Phase 1 Data Model — P1 Proposal Screen & Standalone Run Foundation

All entities are Pydantic v2 models in the **isolated** `app/api/aica_api/models/proposal/` subpackage
(must not import trigger models). Version constants come from `models/proposal/__init__.py`
(`CONTRACT_VERSION`, `SCHEMA_VERSION`) — never hardcode strings.

Legend: **[reused]** = frozen in P0.5/P6, unchanged; **[new]** = added by P1.

## Enums

- **TriggerPurpose** [reused]: `rest_recommended`, `inattentive_driving_prevention_recovery`,
  `route_music`, `child_passenger_experience`.
- **LifecycleStage** [reused]: `before_rest_until_stop`, `during_rest_stopped`,
  `after_rest_before_restart`, `active_driving_content`.
- **ServiceId** [reused]: the 14 catalog services (incl. `call_response_stopped`).
- **MotionState** [new]: `driving`, `stopped`.
- **ProposalPackageFamily** [new]: `service_selector`, `content_selector`.
- **ProposalPackageApproach** [new]: `transparent`, `constrained_llm`.
- **ServiceDecisionType** [new]: `ranked_candidates`, `no_proposal`.
- **DiscreteEventType** [new]: `OPPORTUNITY_OPENED`, `SERVICE_SELECTED`, `CONTENT_SELECTED`,
  `TRIGGER_PURPOSE_CHANGED`, `REST_SPOT_ARRIVED`, `REST_COMPLETED`, `CONTENT_COMPLETED`,
  `ALGORITHM_ERROR` (shape/enum only in P1; only the first three + ALGORITHM_ERROR are emitted).
- **ProposalRunStatus** [new]: `created`, `service_selected`, `content_selected`, `error`.
- **FeatureOriginProvenance** [reused]: `cdc_su_baseline`, `normalized_cdc_su_concept`, `proposed_addition`.

## ProposalOpportunity [new]

The neutral start-of-proposal record. No UI state; no trigger-tick dependency.

| Field | Type | Rules |
|---|---|---|
| `opportunity_id` | str | required, non-empty |
| `trigger_purpose` | TriggerPurpose | required |
| `lifecycle_stage` | LifecycleStage | required; **compatible** with `trigger_purpose` (validator) |
| `allowed_service_ids` | list[ServiceId] | required, non-empty; resolved from the frozen matrix |
| `simulation_time` | str \| int | required |
| `run_seed` | str | required |

**Validator — purpose/stage compatibility**: rest lifecycle stages (`before_rest_until_stop`,
`during_rest_stopped`, `after_rest_before_restart`) only with `rest_recommended`;
`active_driving_content` only with the three non-rest purposes. (Same rule as `SelectorInput`.)

## PurposeStageServiceMatrix [new]

Loaded from the frozen artifact `proposal_contracts/matrix/purpose_stage_matrix.v1.json`.

| Field | Type | Rules |
|---|---|---|
| `matrix_version` | str | e.g. `"v1"`; frozen per run |
| `rows` | list[MatrixRow] | the 6 spec §7.5 rows |

`MatrixRow`: `{ trigger_purpose, lifecycle_stage, allowed_service_ids: list[ServiceId] }`.
- **Validators**: every `(purpose, stage)` pair is compatible; the `after_rest_before_restart` row lists
  exactly `[live_viewing, stretch_video, full_karaoke, oshi_reexperience, call_response_stopped]` (5);
  all `allowed_service_ids` are valid `ServiceId`s.
- **Resolver** `resolve(purpose, stage) -> list[ServiceId]`: returns the row's services, or raises a typed
  error for an incompatible/unknown pair.

## SelectorInput [reused]

Common selector input (§5.3) — carries `trigger_purpose`, `lifecycle_stage`, `allowed_service_ids`,
`feature_snapshot`, `feature_provenance`, `enabled_feature_extensions`, `eligible_candidates`,
`excluded_candidates`, `parameters`, `hyperparameters`, `package_runtime_state`, `catalog_version`,
`run_seed`, `selected_service_id` (content only). Reused verbatim; the mock service/content contexts
are built from an opportunity + the edited params/hyperparameters.

## ServiceSelectorOutput [new]

Neutral service-selector result (§5.4 service side).

| Field | Type | Rules |
|---|---|---|
| `decision_type` | ServiceDecisionType | required |
| `ranked_candidates` | list[RankedCandidate] | **≤ 3**; empty iff `no_proposal` |
| `excluded_candidates` | list[ExcludedCandidate] | reused shape from `SelectorInput` |
| `unused_available_features` | list[str] | |
| `missing_features` | list[str] | |
| `next_package_runtime_state` | dict | |
| `algorithm_provenance` | dict | package id + contract/schema versions |

`RankedCandidate`: `{ rank: int (1-based, unique, ≤3), candidate_id: ServiceId, score: float | None,
rationale: list (bilingual), supporting_feature_ids: list[str], opposing_feature_ids: list[str],
uncertainty: str | None, feature_contributions: list[FeatureContribution] }`.

`FeatureContribution` (the reason breakdown row): `{ feature_id, feature_value (str|number),
response_coefficient: float, weight: float, contribution: float }`.

- **Validators**: `len(ranked_candidates) <= 3`; every `candidate_id ∈ allowed_service_ids`; ranks are
  contiguous from 1; `no_proposal` ⇒ empty `ranked_candidates`.

## CompletePlan [reused]

Content-selector output (§5.4 content side) — one ordered plan, `decision_type`, `ordered_items`
(each `item_fit` + `feature_contributions`), `mode`, `expected_duration_sec`, `lighting_configuration`,
`approval_policy`, `completion_rule`, `next_transition_policy`, `excluded_items`, error categories.
**Invariant preserved**: no `plan_score`/aggregate. Mock items reference real frozen-P2 track IDs.

## ProposalPackageManifest [new]

| Field | Type | Rules |
|---|---|---|
| `id` | str | unique |
| `version` | str | |
| `label` | {ja,en} | bilingual |
| `family` | ProposalPackageFamily | required |
| `approach` | ProposalPackageApproach | required |
| `contract_version` | str | |
| `algorithm` | { type: `"python_module"`, entrypoint, error_mode } | type fixed |
| `supported_services` | list[ServiceId] | content family only |
| `parameters` | dict | free-form param definitions (rendered editable) |
| `hyperparameters` | list[HyperparameterDef] | each `{ key, kind: matrix\|table\|map\|numeric\|enum\|string, label, default, … }` |

- **Slot** = `(family, approach)`; the four valid slots are enumerated as a constant. A manifest whose
  `(family, approach)` is not a known slot, or whose family-required fields are missing (e.g. a content
  manifest lacking `supported_services`), is **invalid** → errors list, never partially used.

## AlgorithmEvidence [new]

Per-evaluation evidence (backend-owned).

| Field | Type |
|---|---|
| `step` | `"service"` \| `"content"` |
| `package_id` | str |
| `contract_version` / `schema_version` / `matrix_version` | str |
| `input_snapshot` | dict (the exact `SelectorInput` used) |
| `output` | ServiceSelectorOutput \| CompletePlan \| None |
| `error` | { category, message } \| None |
| `used_feature_ids` / `unused_available_features` / `missing_features` | list[str] |

## DiscreteEvent [new] (shape only)

`{ event_type: DiscreteEventType, at: str|int, payload: dict }`. Appended to the run log for the mock
flow (`OPPORTUNITY_OPENED`, `SERVICE_SELECTED`, `CONTENT_SELECTED`, `ALGORITHM_ERROR`). No engine.

## JourneyState [new] (shape only)

`{ lifecycle_stage: LifecycleStage, motion_state: MotionState, active_service_id: ServiceId|None,
active_plan_id: str|None }`. Snapshot only; no progression logic in P1.

## ProposalRun / ProposalRunLog [new]

`ProposalRun` (summary): `{ run_id, status: ProposalRunStatus, opportunity_id, created_at,
service_package_id, content_package_id|None }`.

`ProposalRunLog` (append-only, persisted to `proposal_runs/<run_id>.json`):

| Field | Type |
|---|---|
| `run_id` | str (`prun_<YYYYMMDD-HHMMSS>_<6hex>`) |
| `created_at` | str (metadata, not part of the decision trace) |
| `opportunity` | ProposalOpportunity |
| `matrix_version` | str |
| `world_snapshot` | dict (feature snapshot + provenance + profile ref) |
| `service_package_id` / `content_package_id` | str / str\|None |
| `parameters` / `hyperparameters` | dict (SERVICE package overrides, frozen at run start — setup-time-only) |
| `content_parameters` / `content_hyperparameters` | dict (CONTENT package overrides; `{}` until STEP 2, then frozen by `select-service` — setup-time-only, FR-002a) |
| `journey_state` | JourneyState |
| `events` | list[DiscreteEvent] (append-only) |
| `evidence` | list[AlgorithmEvidence] (append-only) |
| `status` | ProposalRunStatus |

**Rules**: append-only; persisted atomically after each event; reopen renders from this log without
recomputation; created/edited entirely within `proposal_runs/` (never touches trigger `runs/`).

## Relationships

```
ProposalOpportunity ──(allowed_service_ids from)── PurposeStageServiceMatrix(matrix_version)
        │
        ├─ STEP 1 → ProposalPackageManifest(service_selector) ──evaluate──▶ ServiceSelectorOutput
        │                                                                        │ (choose rank)
        └─ STEP 2 → ProposalPackageManifest(content_selector) ──evaluate──▶ CompletePlan
                       (selected_service_id)
Each evaluate() → one AlgorithmEvidence; every step → one DiscreteEvent; all appended to ProposalRunLog.
```
