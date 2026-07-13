# AICA Service And Content Proposal Simulator — Consolidated Specification Draft v1

**Document status:** Consolidated draft for review; feature model approved in design discussion  
**Primary audience:** Product, algorithm, UX, architecture, and engineering reviewers  
**Purpose:** Specify the proposal algorithms and their standalone-but-composable simulator from proposal opportunity through pre-rest, rest, and post-rest completion.  
**Detailed decision record:** `docs/master/aica_proposal_design_reference_draft.md`  
**Milestone plan:** `docs/master/aica_proposal_simulator_milestones.md`  
**Source basis:** `others/CDC-SU_specplan.md` Slides 1–7, 26, 38–44, 64–82; `others/aica_stage_constrained_llm_proposal_selector_spec.md`.

---

## 1. Executive Summary

This phase adds a proposal simulator to the current AICA Hypothesis Simulator. It begins when a proposal opportunity exists. It does not decide when the original trigger fires, but it receives the trigger’s selected `trigger_purpose` as a required input.

The subsystem answers two separate questions:

1. **Service proposal:** Which in-car service should AICA offer now?
2. **Concrete-content proposal:** Once a service is chosen, which playlist, songs, mode, video, quiz, or other concrete plan should AICA offer?

Each question supports two independent algorithm approaches:

- a transparent, customer-editable scoring hypothesis;
- a constrained LLM proposal hypothesis.

The detailed V1 content focus is music playlist, humming karaoke, full stopped karaoke, oshi setup, and compatible lighting. The service catalog represents all in-car candidates described in the source material, while the default selector can use only the candidates enabled by the current purpose/stage matrix.

The proposal screen has its own editable synthetic context and discrete-event simulation. Its proposal opportunity includes `trigger_purpose`, `lifecycle_stage`, the resolved stage-specific service constraints, and the approved feature snapshot. It shares the existing application and backend, and its contracts are designed so a future adapter can feed these values from the trigger and journey runtime.

Feature provenance is source-first: Slides 66–70 define the mandatory CDC-SU baseline, while simulator-proposed additions are separately identified and may be enabled or disabled without changing what the source specification says.

Safety is dominant. Impermissible behavior is excluded, permissible choices are ranked with overwhelming safety priority, and the driver retains the ability to accept, reject, change, postpone, or request more proposals.

---

## 2. Product Boundary

### 2.1 In scope

- Begin from a proposal opportunity containing one explicit Slide-26 trigger purpose, a lifecycle stage, and its applicable service constraints.
- Rank service candidates from current features.
- Let the user or quick mode select a service.
- Generate and rank concrete content for that service.
- Simulate approval, rejection, change, delivery, completion, and continuation.
- Simulate linked pre-rest, rest, and post-rest phases.
- Recompute at discrete transitions.
- Provide transparent evidence and customer feedback capture.
- Provide built-in, editable synthetic driver, route, history, schedule, oshi, and catalog data.
- Compare algorithms using frozen identical snapshots in separate runs.
- Prepare a future integration boundary to the tick-driven trigger simulator.

### 2.2 Out of scope for V1

- Trigger detection or fire-control calculation.
- A production sensor/data ingestion pipeline.
- Customer-imported media catalogs.
- Training or fitting a model from real user data.
- Automatic claims that a proposal is safe, rational, accepted, or effective.
- Probabilistic synthetic user behavior.
- Clinical/physiological validation of recovery.
- Autonomous enforcement of a rest decision.
- Outdoor-service recommendation as an independent service domain.
- Tick-level cooldown/retrigger integration.

### 2.3 Core principle

```text
The simulator exposes a proposal hypothesis for human review.
It does not certify the hypothesis or force the driver to follow it.
```

---

## 3. End-To-End Functional Model

### 3.1 Main flow

```text
Proposal opportunity
  → read trigger purpose and lifecycle stage
  → resolve Slides 64–65 allowed-service constraints
  → build frozen feature snapshot
  → hard service eligibility
  → service-selector package
  → show up to 3 service candidates
  → user choice or quick top-choice
  → hard content eligibility
  → content-selector package
  → show up to 3 concrete plans
  → user approve / reject / edit / request more
  → deterministic journey/playback engine
  → completion or context transition event
  → recompute next immediate action when required
  → continue, change, or return to previous content
```

### 3.2 Rolling-horizon rest journey

The UI may preview a future chain, but the engine commits only the immediate action.

Example:

```text
NOW — driving, rest is advisable
  Offer: guide to rest spot
  Preview: humming karaoke for the 12-minute drive
  Preview: nap at the rest spot
  Preview: stopped full karaoke after nap

AFTER ACCEPTANCE
  Commit route guidance and separately confirm humming karaoke

AT REST-SPOT ARRIVAL
  Recompute using stopped context; confirm rest activity

AFTER REST COMPLETION
  Recompute using post-rest values; propose stopped recovery content

AT RETURN TO DRIVING
  stop/switch screen-dependent content and restore permitted playback
```

The preview is explanatory. Each boundary is a fresh decision based on the latest snapshot.

### 3.3 Trigger purpose and lifecycle are required control inputs

`trigger_purpose` is supplied explicitly as one of:

- `rest_recommended` — ①休憩が推奨される状態;
- `inattentive_driving_prevention_recovery` — ②漫然運転予防・疲労回復向け提案;
- `route_music` — ③ルートに応じた音楽提案;
- `child_passenger_experience` — ④子供同乗時向け提案.

`lifecycle_stage` is supplied from the journey runtime. Required V1 values are:

- `before_rest_until_stop`;
- `during_rest_stopped`;
- `after_rest_before_restart`;
- `active_driving_content` for the single-stage flow used by purposes ②–④.

These values are mandatory algorithm inputs because they select the proposal flow and allowed service set. They are control/runtime inputs, not preference or situation features, and they do not replace `drowsiness_level`, `motion_state`, route features, or other ranking evidence.

---

## 4. Architecture And Separation

### 4.1 Logical components

| Component | Owns | Must not own |
|---|---|---|
| Proposal screen | Editing, run controls, comparisons, evidence, feedback | Hidden ranking rules |
| Proposal simulation world | Trigger purpose, lifecycle stage, synthetic entities, current snapshot, events, user actions | Algorithm scoring |
| Proposal orchestrator | Contract validation, purpose/stage constraint resolution, and selector sequencing | Candidate utility |
| Service-selector package | Service ranking logic and package-local state | Concrete item selection |
| Content-selector package | Concrete plan logic and package-local state | Service ranking |
| Eligibility validator | Motion/capability/availability constraints | Preference ranking |
| Journey/playback engine | Apply accepted plan, advance state, end/switch/restore | Re-rank candidates |
| Evidence recorder | Immutable inputs, outputs, actions, provenance | Declaring correctness |

### 4.2 Same backend, separate context

The proposal simulator is a new screen and run type in the existing application. It uses common authentication/deployment/storage conventions where applicable, but its setup state and active run state remain distinct from trigger simulation.

### 4.3 Future composition contract

Both standalone and integrated operation create the same `ProposalOpportunity`:

```text
StandaloneProposalWorld → ProposalOpportunity
TriggerTickAdapter       → ProposalOpportunity
```

Selector packages receive only the neutral opportunity snapshot, including its explicit trigger purpose, lifecycle stage, and resolved allowed-service IDs. They do not know which producer created it.

---

## 5. Package Model

### 5.1 Required package families

| Package family | Input focus | Output focus |
|---|---|---|
| Transparent service selector | Trigger purpose + lifecycle stage + stage-allowed services + CDC-SU service baseline + enabled service extensions | Up to 3 ranked services with factor contributions |
| Constrained LLM service selector | Same neutral controls/facts/candidates | Up to 3 structured service judgments with cited fields |
| Transparent content selector | Same controls + CDC-SU service baseline + enabled service extensions + CDC-SU content baseline + enabled content extensions + selected stage-allowed service/catalog | Up to 3 concrete plans with factor contributions |
| Constrained LLM content selector | Same neutral controls/facts/catalog | Up to 3 structured concrete plans with cited fields/items |

### 5.2 Independence rule

Packages share contracts, enums, schemas, and platform validation only. A package must never consume another package’s score, ranking, rationale, runtime state, or internal feature transformation.

A run records one selected service package and one selected content package. Cross-approach comparison creates separate runs from the same frozen setup.

### 5.3 Common selector input

Conceptual fields:

```yaml
contract_version: string
opportunity_id: string
simulation_time: string-or-number
trigger_purpose: rest_recommended | inattentive_driving_prevention_recovery | route_music | child_passenger_experience
lifecycle_stage: before_rest_until_stop | during_rest_stopped | after_rest_before_restart | active_driving_content
allowed_service_ids: array
feature_snapshot:
  service_features: object
  content_additional_features: object   # content selector only
feature_provenance:                     # field -> baseline/normalized/addition + source reference
  field_id: object
enabled_feature_extensions: array
selected_service_id: string|null        # content selector only
eligible_candidates: array
excluded_candidates: array-with-platform-reason
parameters: object
hyperparameters: object
package_runtime_state: object
catalog_version: string
run_seed: string
```

The platform resolves the Slides 64–65 purpose/stage constraints and supplies exclusions as facts; it does not pre-rank eligible candidates.

### 5.4 Common selector output

```yaml
decision_type: ranked_candidates | no_proposal
ranked_candidates:
  - rank: integer
    candidate_id: string
    score: number|null
    rationale: array
    supporting_feature_ids: array
    opposing_feature_ids: array
    uncertainty: string|null
excluded_candidates: array
unused_available_features: array
missing_features: array
next_package_runtime_state: object
algorithm_provenance: object
```

Content candidates add concrete plan items, duration, mode, lighting configuration, approval policy, completion rule, and next-transition policy.

---

## 6. Safety And Eligibility Policy

### 6.1 Purpose/stage service constraints

Candidate construction starts from the versioned Slides 64–65 matrix in Section 7.5. The current `trigger_purpose` and `lifecycle_stage` select one row. A selector cannot introduce a service outside that row.

The constrained set is then narrowed by motion, catalog readiness, schedule availability, and other platform eligibility facts. Feature-based scoring or LLM judgment happens only after both steps.

```text
catalog services
∩ purpose/stage allowed services
∩ motion/capability/readiness availability
= candidates visible to the selector
```

### 6.2 Hard exclusions

Hard exclusions apply only to impermissible or unavailable behavior. Examples:

- screen-dependent full karaoke while `motion_state=driving`;
- a stopped-only stretch video while driving;
- an oshi-specific plan when the required synthetic oshi catalog item does not exist;
- a live/radio plan whose scheduled synthetic event is not active when live availability is required;
- a content item not present or disabled in the built-in catalog.

The eligibility reason is shown independently from algorithm rationale.

### 6.3 Dominant safety ranking

Among eligible candidates, safety fit is overwhelmingly more important than entertainment, novelty, or weak historical preference.

The transparent default uses lexicographic safety bands:

1. assign a documented safety-fit band;
2. rank higher safety-fit bands first;
3. apply the configurable utility score only within the same band;
4. expose every band and contribution.

Packages may test an alternative super-weight formula, but the configuration must demonstrate that accumulated lower-priority factors cannot overcome the defined safety separation.

### 6.4 Advisory behavior

Even a high-safety proposal provides allowed user actions. At minimum the UI must support appropriate combinations of:

- accept;
- reject;
- postpone;
- choose another candidate;
- request more candidates;
- stop current content.

The product wording describes consequences and rationale without claiming control of the driver.

---

## 7. Service Catalog

### 7.1 Driving-oriented services

| ID | Service | Typical delivery | Lighting |
|---|---|---|---|
| `music_playlist` | Music playlist recommendation | Fixed-count streaming playlist | Compatible |
| `humming_karaoke` | Chorus-focused humming karaoke | Audio-first, guide vocal, no driving lyrics screen | Compatible |
| `call_response_driving` | Simple call-and-response practice | Audio/background music | Compatible |
| `quiz` | Voice quiz set | Audio interaction | Not used |
| `ranking_creation` | Two-choice ranking activity | Voice interaction, resulting playlist | Not used |
| `radio_style` | Short synthetic radio-style update | Audio | Not used |
| `conversation_audio` | Conversation / おしゃべり | Audio-first dialogue template | Not used |

### 7.2 Stopped/rest-oriented services

| ID | Service | Typical delivery | Lighting |
|---|---|---|---|
| `live_viewing` | Selected live video set | Screen while stopped; policy-controlled background on motion | Compatible |
| `stretch_video` | One short in-car stretch video | Screen while stopped | Not used |
| `full_karaoke` | Full karaoke song and optional queue | Lyrics/screen while stopped | Compatible |
| `call_response_stopped` | Call-and-response video | Screen while stopped | Compatible |
| `oshi_reexperience` | Oshi-related spot guide/episode | Navigation and spoken episode | Not used |
| `relaxation_multisensory` | Multisensory relaxation | Editable stopped in-cabin template | Recipe-defined |
| `linked_video_recommendation` | Connected video recommendation | Lower-fidelity in-cabin review template | Recipe-defined |

### 7.3 Rest actions

`trigger_purpose=rest_recommended` activates the rest-support journey as orchestration context; `rest_support_journey` is not a competing media service that the selector must infer. The journey may contain:

- rest spot and guidance;
- rest-method and duration suggestion;
- seat-adjustment confirmation;
- nap guidance;
- rest-extension check;
- non-binding slots for permissible pre-rest and post-rest content.

These rest actions are executed by the journey engine and are not ranked as song/media catalog items. At `during_rest_stopped`, the permitted rest proposal types may be ranked by the applicable proposal package. Content slots are recomputed and confirmed at the relevant transition.

### 7.4 Source breadth policy

Slides 38–40 provide detailed definitions for the principal media services. Slide 26 additionally names conversation, multisensory relaxation, and connected video recommendation. These Slide-26-only services remain lower-fidelity catalog entries so all source contexts are visible, but the default Slides 64–65 constraint matrix does not make them eligible until a separately versioned flow enables them. The simulator must label their UX/content recipes as provisional. Outdoor delivery is not introduced.

### 7.5 Default purpose/stage service matrix

| Trigger purpose | Lifecycle stage | Default allowed proposal types | Source |
|---|---|---|---|
| `rest_recommended` | `before_rest_until_stop` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` | Slide 64, driving content |
| `rest_recommended` | `during_rest_stopped` | `rest_duration_suggestion`, `rest_method_suggestion`, `seat_adjustment`, `nap_guidance`, `rest_extension_check` | Slide 2 and related rest flow |
| `rest_recommended` | `after_rest_before_restart` | `live_viewing`, `stretch_video`, `full_karaoke`, `oshi_reexperience` | Slide 64, stopped content |
| `inattentive_driving_prevention_recovery` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` | Slide 65 |
| `route_music` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` | Slide 65 |
| `child_passenger_experience` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` | Slide 65 |

The matrix is versioned and editable for hypothesis comparison, but a run freezes the selected version. Any customer modification is evidence-visible. The content selector receives the same trigger purpose and lifecycle stage and may select concrete content only for the already selected, stage-allowed service.

---

## 8. Feature Contract — Service Proposal, CDC-SU Baseline First

### 8.1 Provenance and priority rules

The authoritative baseline is CDC-SU Slides 66–67. An implementation field may normalize a source concept into a bounded value, but the document must distinguish that normalization from a genuinely new feature. Proposed simulator additions are isolated in Section 8.3.

| Priority | Default interpretation |
|---|---|
| P0 | Dominant safety or immediate eligibility context |
| P1 | Primary situation fit |
| P2 | Contextual relevance |
| P3 | Personalization or historical support |
| P4 | Weak novelty/tie breaker |

### 8.2 CDC-SU baseline service features

| CDC-SU category/concept | Priority | Contract field | Value/use | Source |
|---|---:|---|---|---|
| Situation — current driver state | P0 | `drowsiness_level` | 0–100 normalized drowsiness; dominant situation/safety fit. | Slides 66–67 |
| Situation — current driver state | P0 | `fatigue_level` | 0–100 normalized fatigue; dominant situation/safety fit. | Slides 66–67 |
| Situation — driving environment: congestion | P1 | `traffic_state` | `normal`, `congested`; interaction-load and service fit. | Slides 66–67 |
| Situation — driving environment: highway | P1 | `road_type` | `highway` is source-aligned; `local`, `mountain`, `parking` are normalization extensions in the same enum. | Slides 66–67 |
| Situation — driving environment: night | P1 | `night_state` | `day`, `night`. | Slides 66–67 |
| Situation — driving environment: monotonous road | P1 | `monotony_level` | 0–100 normalization. | Slides 66–67 |
| Situation — characteristic route | P1/P2 | `route_tags` | Editable tags such as sea, mountain, city, night-view, or oshi-related. | Slides 66–67 |
| Situation — characteristic destination | P1/P2 | `destination_tags` | Editable tags such as home, leisure, event, or oshi spot. | Slides 66–67 |
| Situation — child passenger | P2 | `child_present` | Boolean presence; no child-state inference. | Slides 66–67 |
| Situation — multiple passengers | P2 | `multiple_passengers` | Boolean group context. | Slides 66–67 |
| Preference — oshi registration | P2/P3 | `oshi_registered` | Boolean. | Slides 66–67 |
| Preference — oshi mode | P2/P3 | `oshi_mode` | `on`, `off`. | Slides 66–67 |
| Preference — unused/long-unused service | P4 | `service_recency_state[service]` | `never`, `long_unused`, `recent`; weak novelty input. | Slides 66–67 |
| Preference — overall usage frequency | P3 | `service_usage_level[service]` | `never`, `low`, `medium`, `high`. | Slides 66–67 |
| Preference — scene-specific tendency | P3 | `scene_service_usage_level[scene][service]` | Service usage tendency in a comparable scene. | Slides 66–67 |
| Past performance — proposal acceptance | P3 | `service_proposal_acceptance_rate[service]` | Editable 0–100 synthetic rate. | Slides 66–67 |
| Past performance — recovery rate | P3 | `service_recovery_rate[service]` | Editable 0–100 synthetic indicator. | Slides 66–67 |

### 8.3 Proposed additional service features

| Proposed category | Priority | Contract field | Reason for addition | Default policy |
|---|---:|---|---|---|
| Driver/motion safety | P0 | `motion_state` | Applies driving/stopped service eligibility earlier. CDC-SU defines it for concrete-content selection, not Slides 66–67 service ordering. | Enabled as hard eligibility. |
| Rest-route feasibility | P0/P1 | `estimated_min_until_rest_spot` | Tests whether proposed pre-rest content fits the remaining drive. | Enabled only for `rest_recommended`. |
| Rest-route feasibility | P1/P2 | `rest_spot_type` | Distinguishes `sa_pa`, `convenience_store`, `parking`, `oshi_spot`, `other`, or unavailable. | Enabled only for `rest_recommended`. |
| Current proposal session | P2/P3 | `active_service` | Prevents conflicts and supports continuation/switching. | Enabled. |
| Current proposal session | P3 | `recent_service_rejections` | Prevents immediate repetition after rejection. | Enabled with configurable recency. |
| Evidence reliability | P3 | `service_proposal_acceptance_confidence[service]` | Limits sparse/synthetic acceptance evidence. | Optional; neutral if unavailable. |
| Evidence reliability | P3 | `service_recovery_confidence[service]` | Limits sparse/synthetic recovery evidence. | Optional; neutral if unavailable. |
| Schedule promoted to service selection | P2 | `scheduled_event_type` | Allows an event to affect selection of live/radio/oshi-related services. CDC-SU defines schedule for concrete content. | Optional extension. |
| Schedule promoted to service selection | P2 | `scheduled_event_timing` | `now`, `soon`, `later`, `unknown`. | Optional extension. |
| Schedule promoted to service selection | P2 | `scheduled_event_tags` | Matches an event to a service. | Optional extension. |

---

## 9. Feature Contract — Concrete Content, CDC-SU Baseline First

### 9.1 Inheritance contract

Slide 68 requires concrete content to reuse information already analyzed for service ordering. The actual contract is:

```text
ContentProposalFeatures
  = CDC-SU baseline service features
  + enabled proposed service additions
  + CDC-SU content-specific baseline features
  + proposed content-specific additions
```

`motion_state` and the three schedule fields are single stored fields. CDC-SU requires them for concrete-content consideration; their earlier use by the service selector is an optional Section 8.3 promotion, not duplicated data.

The content selector receives the same `trigger_purpose`, `lifecycle_stage`, and frozen constraint context. Each recipe declares every available field as `used` or `available_but_not_used`; silent dropping is invalid.

### 9.2 CDC-SU content-specific baseline features

| CDC-SU category/concept | Priority | Contract field | Value/use | Source |
|---|---:|---|---|---|
| Situation — driving/stopped state | P0 | `motion_state` | `driving`, `stopped`; content-mode and presentation restriction. | Slides 68–70 |
| Preference — UPro age | P3 | `age_band` | Editable age band. | Slides 68–69 |
| Preference — UPro gender | P4/default 0 | `gender` | Optional; transparent default weight is zero because relevance is weak and bias risk is material. | Slides 68–69 |
| Preference — UPro hobbies/interests | P3 | `hobby_interest_tags` | Editable tags for genre/theme matching. | Slides 68–69 |
| Preference — unused/long-unused item | P4 | `catalog_item_recency_state[item]` | `never`, `long_unused`, `recent`; item-level normalization. | Slides 68–70 |
| Preference — unused/long-unused theme | P4 | `content_tag_recency_state[tag]` | Tag-level normalization for sparse item history. | Slides 68–70 |
| Preference — overall content usage | P3 | `content_tag_usage_level[tag]` | Genre/theme usage tendency. | Slides 68–70 |
| Preference — overall item usage | P3 | `catalog_item_usage_level[item]` | Song/video/item usage tendency. | Slides 68–70 |
| Preference — scene-specific tendency | P3 | `scene_content_tag_usage_level[scene][tag]` | Genre/theme usage in a comparable scene. | Slides 68–70 |
| Playback/user operation — played | P3 | `played_items` | Ordered item IDs with recency. | Slides 69, 71, 72, 79 |
| Playback/user operation — skipped | P2/P3 | `skipped_items` | Ordered item IDs with recency. | Slides 69, 71, 72, 79 |
| Playback/user operation — cancelled | P2/P3 | `cancelled_content_plans` | Normalized record of cancelled proposed/active content. | Slides 68–69 |
| Playback/user operation — changed | P2/P3 | `changed_from_items` | Item IDs replaced by the user. | Slides 69, 71, 72, 79 |
| Past performance — schedule type | P2 | `scheduled_event_type` | `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, `other`. | Slides 68–70 |
| Past performance — schedule timing | P2 | `scheduled_event_timing` | `now`, `soon`, `later`, `unknown`. | Slides 68–70 |
| Past performance — schedule tags | P2 | `scheduled_event_tags` | Event/content match. | Slides 68–70 |
| Past performance — proposal acceptance | P3 | `content_proposal_acceptance_rate[key]` | 0–100 by item, tag, genre, or plan type. | Slides 68–70 |
| Past performance — recovery rate | P3 | `content_recovery_rate[key]` | 0–100 synthetic indicator. | Slides 68–70 |

Driver/environment context, route/destination, passenger composition, oshi registration/mode, unused-service state, service usage tendencies, and service-level past performance are inherited from Section 8.2. Enabled Section 8.3 extensions are also inherited for contract consistency.

### 9.3 Proposed additional concrete-content features

| Proposed category | Priority | Contract field | Reason for addition | Default policy |
|---|---:|---|---|---|
| Detailed oshi identity | P2/P3 | `oshi_id` | Concrete catalog matching requires an identity, not only registration/on/off. | Enabled when oshi setup and mode are active. |
| Detailed oshi identity | P2/P3 | `oshi_type` | Distinguishes character, artist, group, franchise, and other relation types. | Enabled with detailed oshi setup. |
| Detailed oshi identity | P2/P3 | `oshi_tags` | Matches works, themes, genres, routes, and events. | Enabled with detailed oshi setup. |
| Granular operation history | P3 | `completed_items` | Distinguishes completion from playback start. | Optional. |
| Granular operation history | P3 | `manually_selected_items` | Makes explicit user choice visible separately from passive playback. | Optional. |
| Granular operation history | P3 | `repeated_items` | Captures deliberate repeats subject to repetition caps. | Optional. |
| Evidence reliability | P3 | `content_proposal_acceptance_confidence[key]` | Limits sparse acceptance evidence. | Optional; neutral if unavailable. |
| Evidence reliability | P3 | `content_recovery_confidence[key]` | Limits sparse recovery evidence. | Optional; neutral if unavailable. |

---

## 10. Non-Feature Inputs And Configuration

The following are important inputs but are not features:

| Type | Examples | Owner/use |
|---|---|---|
| Trigger control | `trigger_purpose` | Required input from the trigger side; selects the Slide-26 proposal purpose. |
| Runtime state | `lifecycle_stage`, previous content, active plan | Required stage input from journey engine/orchestrator. |
| Purpose/stage constraints | matrix version and `allowed_service_ids` | Platform/orchestrator limits candidates before ranking. |
| Eligibility metadata | motion allowance, screen dependence, service capability, content readiness | Catalog and platform validator |
| Invocation metadata | proposal opportunity ID, start source, quick/interactive mode | Orchestrator/UI |
| Catalog data | service records, media items, oshi entities, lighting compatibility | Built-in editable synthetic catalogs |
| Algorithm configuration | weights, thresholds, priors, caps, prompt version, model settings | Selected package |
| UI state | candidate page, selected panel, open editor | UI only; never ranking input |

Prohibited V1 fields include `child_state`, unexplained `service_preferences`, and `current_candidate_page`. `trigger_purpose` and `lifecycle_stage` are required control inputs, not ranking features.

---

## 11. Transparent Service-Selector Algorithm

### 11.1 Pipeline

1. Validate `trigger_purpose`, `lifecycle_stage`, and the feature snapshot; record missing fields.
2. Confirm that the platform-supplied candidates comply with the frozen purpose/stage matrix.
3. Accept the further eligible/excluded service lists after motion/readiness checks.
4. Convert each used feature to a documented bounded factor value.
5. Assign each eligible service a safety-fit band.
6. Compute package-local category contributions.
7. Apply confidence shrinkage to acceptance/recovery history.
8. Apply recent-rejection and novelty policy within configured limits.
9. Rank by safety band and then total utility.
10. Return up to three candidates and factor-level evidence.
11. Return `no_proposal` if no eligible candidate exists.

### 11.2 Default score structure

```text
utility_service(s) =
    W_driver      × driver_fit(s)
  + W_environment × environment_fit(s)
  + W_passenger   × passenger_fit(s)
  + W_route       × route_fit(s)
  + W_session     × session_fit(s)
  + W_preference  × preference_fit(s)
  + W_history     × history_fit(s)
  + W_schedule    × schedule_fit(s)
  + W_novelty     × novelty_fit(s)
```

Default ordering intent:

```text
P0 driver safety/motion
≫ P1 situation/route timing
> P2 passenger/route/schedule
> P3 preference/history
> P4 novelty
```

Every mapping and coefficient is editable. The package must show raw feature, normalized value, coefficient, signed contribution, cap, and final contribution.

CDC-SU baseline factors are always identified as such. `W_session`, `W_schedule`, confidence shrinkage, and other extension contributions are evaluated only when their corresponding extension is enabled. The trace must show the provenance and enabled/disabled state beside every contribution.

### 11.3 Confidence shrinkage

The package should use a configurable neutral prior, for example:

```text
effective_rate = confidence × observed_rate
               + (1 - confidence) × neutral_prior
```

This is a transparent hypothesis, not a statistical claim about the synthetic data.

---

## 12. Transparent Concrete-Content Algorithm

### 12.1 Pipeline

1. Receive `trigger_purpose`, `lifecycle_stage`, the selected stage-allowed service, and the feature snapshot separated into CDC-SU baseline and enabled-extension provenance groups.
2. Reject a request if the selected service is outside the frozen purpose/stage matrix.
3. Load the service’s versioned recipe and applicability matrix.
4. Accept platform-eligible synthetic catalog items.
5. Generate a bounded set of candidate plans from catalog items and modes.
6. Apply motion/content constraints.
7. Score driver/environment/route/passenger fit where the recipe marks them used.
8. Score UPro/oshi/content-use/history/schedule fit where used.
9. Apply repetition, skip, rejection, and duration policies.
10. Build lighting configuration only for compatible services.
11. Rank within safety band and return up to three plans.

### 12.2 Music plan scoring

Conceptually:

```text
utility_content(p) =
    W_safety       × safety_fit(p)
  + W_service_goal × selected_service_fit(p)
  + W_situation    × situation_fit(p)
  + W_route        × route_destination_fit(p)
  + W_passenger    × passenger_fit(p)
  + W_upro         × upro_fit(p)
  + W_oshi         × oshi_fit(p)
  + W_usage        × usage_fit(p)
  + W_operations   × operation_history_fit(p)
  + W_schedule     × schedule_fit(p)
  + W_performance  × confidence_shrunk_performance(p)
  + W_novelty      × novelty_fit(p)
```

Candidate-plan attributes may include tempo/energy band, genre/tags, era, artist/oshi relation, child/group suitability, duration, chorus/full-song form, guide vocal, lyric-screen requirement, event relation, route relation, and lighting compatibility.

### 12.3 Detailed V1 music behavior

**Music playlist**

- fixed, configurable item count;
- generated from synthetic streaming catalog;
- may use driver/environment/route/passenger/UPro/oshi/usage/history/schedule/recovery inputs according to recipe;
- provides a short plan explanation;
- allows customer/user adjustment before playback;
- lighting may be enabled.

**Humming karaoke**

- chorus-focused plan while driving;
- guide vocal enabled by default;
- no lyrics screen while driving;
- user approval required for the proposed plan;
- item additions and guide-vocal changes may be simulated;
- destination relevance can be enabled to reflect detailed Slide 72 despite the Slide 70 matrix discrepancy;
- lighting may be enabled.

**Full karaoke**

- stopped-only for full lyrics/screen experience;
- proposes one initial song for user approval;
- user may reject and choose another or add a simulated queue;
- movement transition applies the configured background/stop policy;
- destination relevance can be enabled to reflect detailed Slide 79;
- lighting may be enabled, with post-nap intensity explicitly reviewable.

### 12.4 Other services

V1 provides lower-fidelity, editable plan templates for quiz, ranking, radio-style, conversation, call-and-response, live viewing, stretch, oshi reexperience, multisensory relaxation, connected video recommendation, and the rest-support journey. They remain rankable service candidates but do not require the same catalog depth as the three detailed music services.

---

## 13. Constrained LLM Algorithms

### 13.1 LLM service selector

The LLM service package receives only eligible service records, exclusions, approved feature fields, and its own package configuration. It returns up to three services using the common output schema.

### 13.2 LLM content selector

The LLM content package receives the selected service, eligible synthetic catalog records, full approved feature snapshot, and service recipe. It returns only catalog-grounded plans.

### 13.3 Required guardrails

- Strict schema validation.
- Request fields are grouped by CDC-SU baseline versus enabled additions; disabled additions are omitted and cannot influence the result.
- Candidate IDs must exist in supplied candidates/catalog.
- Rationale must cite supplied feature IDs.
- No invented user fact, event, song, oshi, route, effect, or availability.
- Hard exclusions cannot be reversed by the model.
- No hidden dependency on another package’s rank/score.
- No-proposal is valid and required when appropriate.
- Validation failure is recorded; retry/fallback is explicit.
- Model, prompt, schema, temperature/configuration, request hash, and response are persisted.
- Concise decision rationale is displayed; private chain-of-thought is not requested or shown.

### 13.4 LLM output review

The UI must let the customer compare:

- transparent factor contributions;
- LLM cited reasons;
- candidate differences;
- fields ignored by each package;
- validation and uncertainty;
- resulting journey behavior.

No approach is labeled correct automatically.

---

## 14. Source Applicability Matrix Policy

Slide 70 and detailed service Slides 71–80 are not perfectly consistent. The system must preserve this uncertainty explicitly.

For every service and feature group, a versioned recipe stores:

```text
used
available_but_not_used
required
optional
source_reference
rationale
```

For detailed music V1:

- all CDC-SU service baseline fields and enabled service extensions remain in the input contract;
- Slide 70 provides the default broad applicability baseline;
- a detailed service slide may enable a field it explicitly lists;
- the customer can edit applicability and compare both interpretations;
- evidence states which recipe version produced the result.

---

## 15. Synthetic World And Catalogs

### 15.1 Editable world entities

The setup screen exposes:

- explicit trigger purpose;
- starting lifecycle stage and purpose/stage constraint-matrix version;
- driver-state values;
- environment values;
- passenger values;
- route/destination/rest-spot values;
- active/rejected service session state;
- service-use preferences;
- past service proposal metrics and confidence;
- UPro setup;
- detailed oshi setup;
- content-use preference and recency;
- playback/user-operation history;
- concrete proposal metrics and confidence;
- schedule;
- catalog and service availability;
- algorithm package, parameters, and hyperparameters;
- journey events and post-rest outcomes.

### 15.2 Built-in synthetic media catalog

Catalog records are synthetic and editable. No customer import is required.

Minimum music-item attributes:

| Attribute | Purpose |
|---|---|
| `item_id`, `title`, `artist_id` | Stable synthetic identity |
| `content_type` | Song, chorus karaoke, full karaoke, live video, etc. |
| `genre_tags`, `theme_tags`, `era_band` | UPro/content preference match |
| `energy_band`, `tempo_band` | Situation/recovery hypothesis |
| `oshi_relation_ids/tags` | Oshi match |
| `route_tags`, `destination_tags` | Context match |
| `child_suitable`, `group_suitable` | Passenger match |
| `duration_sec` | Journey feasibility |
| `chorus_available`, `guide_vocal_available` | Humming mode generation |
| `lyrics_screen_required` | Motion eligibility |
| `lighting_compatible`, `lighting_patterns` | Presentation modifier |
| `event_tags` | Schedule match |
| `enabled` | Synthetic readiness |

Service and other-content records use equivalent explicit metadata.

### 15.3 Contrast data

The simulator supplies complete base worlds plus clone-and-change contrasts. The comparison screen shows:

- changed input fields;
- changed eligibility;
- score/reason deltas;
- rank deltas;
- changed selected plan;
- changed journey preview.

One-variable contrasts are preferred for explanation, while multi-variable worlds remain editable for realistic exploration.

### 15.4 No manufactured user truth

Interactive decisions are entered by the customer. Quick mode simply selects rank 1. Post-rest drowsiness/fatigue and historical recovery values are explicit synthetic inputs. The simulator does not randomly generate an “accepted” or “recovered” outcome and then present it as evidence.

---

## 16. Discrete Event Simulation

### 16.1 Minimum events

| Event | Effect |
|---|---|
| `PROPOSAL_OPPORTUNITY_OPENED` | Freeze trigger purpose, lifecycle stage, constraint version, feature snapshot, and invoke the service selector. |
| `TRIGGER_PURPOSE_CHANGED` | Apply a newly supplied purpose, select its valid lifecycle flow, and open a new proposal opportunity. |
| `SERVICE_SELECTED` | Persist choice and invoke content selector if required. |
| `SERVICE_REJECTED` | Update session history and optionally show remaining/request-more candidates. |
| `CONTENT_SELECTED` | Commit plan to journey engine. |
| `CONTENT_REJECTED` | Update concrete rejection history and return to candidates. |
| `CONTENT_STARTED` | Set active content and playback state. |
| `CONTENT_COMPLETED` | Apply completion policy and optionally open a new opportunity. |
| `REST_SPOT_ARRIVED` | Set stopped motion and `lifecycle_stage=during_rest_stopped`. |
| `REST_STARTED` | Start configured nap/rest activity. |
| `REST_COMPLETED` | Apply explicit post-rest feature values, set `lifecycle_stage=after_rest_before_restart`, and open a post-rest opportunity. |
| `MOTION_CHANGED` | Enforce screen/background/stop policy; optionally recompute. |
| `CONTINUE_REQUESTED` | Extend or regenerate according to selected service policy. |
| `RETURN_TO_PREVIOUS_CONTENT` | Restore pre-proposal content. |

### 16.2 Recalculation rules

A new selector call is required when:

- the user requests a new proposal;
- a phase transition changes relevant facts;
- motion changes and invalidates the active plan;
- a proposal is rejected and the configured policy requests replacement;
- content completes and the policy calls for continuation/alternative;
- the customer edits context and presses recompute.

The system does not recompute on every simulated tick in V1.

---

## 17. Simulator Screen Requirements

### 17.1 Setup area

- Load, clone, rename, and reset a complete synthetic seed.
- Choose one explicit trigger purpose and a compatible starting lifecycle stage.
- Inspect or select the versioned Slides 64–65 service-constraint matrix.
- Edit every approved feature by category and priority.
- Edit synthetic catalogs and schedule.
- Edit selected package parameters/hyperparameters.
- Select service and content package independently.
- Select interactive or quick mode.
- Show non-feature inputs in distinct panels.
- Validate values before run.

### 17.2 Run area

- Show current trigger purpose, lifecycle stage, and motion state.
- Show the purpose/stage-allowed service set before feature-based ranking.
- Show current committed action and non-binding future preview.
- Show service candidates and user actions.
- Show concrete plans and user actions.
- Show content/rest progression and discrete events.
- Allow recompute after edits when the run policy permits.

### 17.3 Evidence area

- Input snapshot grouped by feature category.
- Eligibility decisions.
- Rank and factor contributions or LLM cited rationale.
- Used/unused/missing fields.
- Algorithm/catalog/configuration provenance.
- User decisions and event timeline.
- Comparison with a cloned run.
- Human review form and export.

### 17.4 Real-time editing

The standalone simulator initializes values and recalculates only when the customer requests recompute or an event requires it. Editing must not create hidden partial decisions. Each evaluation records the exact snapshot used.

---

## 18. Evidence, Determinism, And Comparison

Every decision record includes:

- run and opportunity IDs;
- simulation seed and cloned-from ID;
- trigger purpose, lifecycle stage, and purpose/stage constraint version;
- full immutable feature snapshot;
- lifecycle and non-feature context;
- eligible/excluded candidates;
- package and contract version;
- parameters and hyperparameters;
- catalog/recipe version;
- ranked output and rationale;
- user/quick-mode selection;
- next event and journey effect;
- human review, stored separately.

Transparent runs with identical inputs must reproduce exactly. LLM evidence preserves the exact request and response, and replay may use the recorded response. A new live LLM call is a new decision attempt even when configuration is identical.

---

## 19. Acceptance Criteria

### 19.1 Feature correctness

- Every proposal opportunity carries one valid `trigger_purpose`, a compatible `lifecycle_stage`, and a frozen purpose/stage constraint version.
- Every service selector receives the CDC-SU Slides 66–67 baseline and only the explicitly enabled Section 8.3 extensions.
- Every content selector receives the enabled service contract, the CDC-SU Slides 68–70 content baseline, and only the explicitly enabled Section 9.3 extensions.
- Evidence labels every field `cdc_su_baseline`, `normalized_cdc_su_concept`, or `proposed_addition`.
- Preference, usage history, proposal history, runtime state, constraints, and configuration are visibly distinct.
- `trigger_purpose` and `lifecycle_stage` control the flow/candidate set but are not treated as personal or situation feature scores.
- `child_state` and UI pagination do not enter ranking.
- Per-service used/unused feature evidence is available.

### 19.2 Algorithm correctness

- The selector cannot return a candidate outside the frozen Slides 64–65 purpose/stage constraint row.
- All four package families can be selected independently.
- Packages do not consume each other’s scores or rankings.
- Both approaches conform to the same neutral output contracts.
- Transparent outputs show contribution-level math.
- LLM outputs are catalog-grounded, schema-valid, and cite supplied fields.
- No valid candidate yields an explicit no-proposal result.

### 19.3 Safety behavior

- Driving/stopped constraints are enforced before ranking.
- Safety separation cannot be overcome by accumulated P2–P4 defaults.
- Driver choice remains available.
- Full screen-dependent karaoke is not offered as an active driving experience.
- Lighting appears only on compatible services.

### 19.4 Journey behavior

- `rest_recommended` progresses through the compatible before-rest, during-rest, and post-rest stages.
- Purposes ②–④ use the `active_driving_content` flow unless a future versioned flow says otherwise.
- A run can demonstrate service proposal, concrete proposal, acceptance/rejection, content completion, and restoration.
- A seeded run can demonstrate pre-rest humming, rest/nap, and post-rest full karaoke as separate recomputed decisions.
- Motion transition applies the configured content policy.
- Quick mode and interactive mode use the same algorithm result.

### 19.5 Simulation and evidence

- All synthetic data is built in and editable.
- Contrast clones preserve unchanged fields and show diffs.
- Transparent identical-input replay is deterministic.
- Simulation facts, algorithm output, and human judgment are clearly separated.
- Export contains enough information to reproduce or audit each decision.

---

## 20. Known Assumptions And Deferred Decisions

- Default numerical weights remain expert hypotheses and require customer review.
- Exact scene and tag taxonomies will be versioned with the synthetic catalogs.
- Source-slide applicability conflicts will be exposed through recipe versions.
- Production data availability, privacy, learning, and model validation are future work.
- Exact LLM provider/model selection is an implementation-time package decision.
- Combined trigger/proposal tick behavior is deferred, but the neutral adapter boundary is mandatory now.
- Detailed non-music concrete-content generation can follow after the music-focused vertical slice.

---

## 21. Traceability To Source Material

| Design area | Primary source |
|---|---|
| Overall proposal pipeline and contexts | CDC-SU Slide 26 |
| Rest, pre-rest humming, post-rest options | Slides 1–7 |
| Driving vs stopped service families | Slide 38 |
| Service descriptions and lighting | Slides 39–40 |
| Playlist and humming interactions | Slides 41–44 |
| Service ordering process/features | Slides 64–67 |
| Concrete-content inheritance/additional data | Slide 68 |
| Concrete-content judgment features | Slide 69 |
| Per-service applicability | Slide 70 |
| Detailed playlist/humming/full-karaoke inputs | Slides 71, 72, 79 |
| End/continue/restore behavior | Slides 81–82 |
| Stage-constrained/LLM proposal concepts | `aica_stage_constrained_llm_proposal_selector_spec.md` |

Where this specification deliberately refines an ambiguous source concept, the decision and rationale are preserved in `aica_proposal_design_reference_draft.md`.
