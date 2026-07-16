# Phase 1 Data Model — P4 Eligibility & Discrete Journey Engine

All models live under the isolated `aica_api.models.proposal` namespace (no import of the
trigger `aica_api.models` or `aica_api.algorithms`). Enums extend `enums.py`.

## New enums (`enums.py`)

### JourneyActionType
`accept`, `reject`, `postpone`, `choose_another`, `request_more`, `complete`, `continue`,
`stop`, `motion_change`, `rest_spot_arrived`, `rest_started`, `rest_completed`.

### PlaybackState
`idle`, `active`, `backgrounded`, `paused`, `completed`, `stopped`.

### DiscreteEventType — new members (added to the existing enum)
`SERVICE_REJECTED`, `CONTENT_STARTED`, `MOTION_CHANGED`, `CONTINUE_REQUESTED`,
`RETURN_TO_PREVIOUS_CONTENT`, `REST_STARTED`, `POSTPONED`, `CHOOSE_ANOTHER`, `REQUEST_MORE`,
`NO_ELIGIBLE_CANDIDATE`.
*(Existing kept: `OPPORTUNITY_OPENED`, `SERVICE_SELECTED`, `CONTENT_SELECTED`,
`TRIGGER_PURPOSE_CHANGED`, `REST_SPOT_ARRIVED`, `REST_COMPLETED`, `CONTENT_COMPLETED`,
`ALGORITHM_ERROR`.)*

### ProposalRunStatus — new members
`content_started`, `content_completed`, `content_stopped`.
*(Existing kept: `created`, `service_selected`, `content_selected`, `error`.)*

### EligibilityReasonCode
`screen_dependent_while_driving`, `stopped_only_while_driving`, `full_karaoke_requires_stopped`,
`missing_required_entity`, `catalog_item_unavailable`, `not_in_allowed_row`.

## ServiceCapability / ServiceCapabilities (`service_capabilities.py`)

```
ServiceCapability:
  service_id: ServiceId
  driving_capable: bool
  screen_dependent: bool
  stopped_only: bool
  background_on_motion: bool          # true only for live_viewing in v1
  lighting_compatible: bool
  requires_entity: str | None         # e.g. "oshi"; None if no entity requirement

ServiceCapabilities:
  capabilities_version: str           # "v1"
  services: dict[ServiceId, ServiceCapability]   # all 14 present
  classmethod load(path) -> ServiceCapabilities  # mirrors matrix.PurposeStageServiceMatrix.load
  def get(service_id) -> ServiceCapability
```

**Validation**: every `ServiceId` member must be present (loader raises on a missing service);
`background_on_motion=true` requires `screen_dependent=true` (a non-screen service has nothing to
background). Golden test binds the artifact to spec §7.1/§7.2.

## EligibilityExclusion / EligibilityResult (`eligibility.py`)

```
EligibilityExclusion:
  service_id: ServiceId
  reason_codes: list[EligibilityReasonCode]     # >=1; NO score field (invariant)

EligibilityResult:
  eligible: list[ServiceId]                      # subset of the allowed row, order preserved
  excluded: list[EligibilityExclusion]
  # invariant: set(eligible) ∪ {e.service_id} == allowed row; disjoint
```

**Invariant (test-enforced)**: no field named `score`, `fit`, `weight`, or `utility` appears on
`EligibilityExclusion`/`EligibilityResult`.

**Mapping to the frozen selector-input contract**: `EligibilityResult` is the internal engine
type. When building the service context, `eligible` → `SelectorInput.eligible_candidates`
(`CandidateRef`) and each `EligibilityExclusion` → `SelectorInput.excluded_candidates`
(`ExcludedCandidate{candidate_id, platform_reason}`) with `platform_reason` = the reason code(s)
(join multiple with `","`). No change to the frozen `selector_input.py` shapes. An empty `eligible`
set (e.g. the empty `during_rest_stopped` matrix row — `SelectorInput.allowed_service_ids` is
non-empty-validated) short-circuits to a `NO_ELIGIBLE_CANDIDATE` outcome without dispatching a
selector.

## JourneyState (extend `journey.py`)

```
JourneyState:
  lifecycle_stage: LifecycleStage           # existing
  motion_state: MotionState                 # existing
  active_service_id: ServiceId | None       # existing (kept)
  active_plan_id: str | None                # existing (kept)
  # NEW:
  playback_state: PlaybackState = idle
  current_plan_ref: str | None = None       # ref to the committed CompletePlan/plan id
  previous_content: PreviousContent | None = None
  rejected_service_ids: list[ServiceId] = []

PreviousContent:
  service_id: ServiceId | None
  plan_ref: str | None
```

Additive: all new fields have defaults so existing persisted runs deserialize unchanged.

## JourneyAction (request) / JourneyTransition (engine output)

The pure engine entry point is `apply_action(run_log, action, *, now, capabilities=None)
-> JourneyTransition` — `now` is the router-minted timestamp and `capabilities` is the loaded
`ServiceCapabilities` (required by `motion_change` for the background/stop decision and re-eligibility;
other actions ignore it). The engine performs no clock/IO/randomness.

```
JourneyAction:                              # request body → engine input
  action_type: JourneyActionType            # note: the "continue" member is named continue_ (value "continue")
  payload: dict = {}                        # e.g. {"motion_state": "driving"},
                                            #      {"selected_service_id": "..."},
                                            #      {"post_rest": {"drowsiness_level": .., "fatigue_level": ..}}

JourneyTransition:                          # pure engine return (not persisted directly)
  events: list[DiscreteEvent]
  new_journey_state: JourneyState
  new_status: ProposalRunStatus
  rejected: TransitionRejection | None      # set when a precondition fails (FR-012)

TransitionRejection:
  code: str                                 # e.g. "invalid_precondition", "no_eligible_candidate"
  message: str                              # bilingual "EN / JA"
```

## JourneyPreview (`proposal_journey_preview.py`)

```
JourneyPreview:
  binding: bool = False                     # always False
  steps: list[PreviewStep]

PreviewStep:
  label: str                                # bilingual "EN / JA"
  lifecycle_stage: LifecycleStage
  note: str | None
```

## Relationships & lifecycle

- `create_proposal_run` → resolve matrix row → `resolve_eligibility(row, motion, capabilities,
  readiness)` → `EligibilityResult`; eligible set feeds `dispatch_selector`; `excluded` rides the
  STEP-1 `AlgorithmEvidence` (existing `excluded_candidates` field) with reason codes.
- Journey status flow (happy path):
  `service_selected → content_selected → [accept] content_started → [complete] content_completed
   → [continue] (new opportunity) | [stop] content_stopped (previous_content restored)`.
- Service-action flow: `service_selected → [reject] service_selected (next eligible) | [choose_
  another] service_selected | [request_more] service_selected | [postpone] opportunity-open`.
- Motion/rest transitions may be applied at appropriate states; `rest_completed` opens a fresh
  opportunity (re-running eligibility + mock selector) under the new stage.
