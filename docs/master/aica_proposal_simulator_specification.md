# AICA Service And Content Proposal Simulator — Consolidated Specification Draft v1

**Document status:** Consolidated draft for review; feature model approved in design discussion  
**Primary audience:** Product, algorithm, UX, architecture, and engineering reviewers  
**Purpose:** Specify the proposal algorithms and their standalone-but-composable simulator from proposal opportunity through pre-rest, rest, and post-rest completion.  
**Detailed decision record:** `docs/master/aica_proposal_design_reference_draft.md`  
**Milestone plan:** `docs/master/aica_proposal_simulator_milestones.md`  
**Transparent content algorithm:** `docs/master/aica_transparent_content_proposal_algorithm.md`<br>
**Shared synthetic music data:** `docs/master/aica_synthetic_music_data_and_generation_specification.md`<br>
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

The detailed V1 content focus is music playlist, humming karaoke, and full stopped karaoke. Each detailed recipe returns one ordered plan of five songs by default; the customer can change the count in settings. Oshi data may influence item fit and compatible lighting may be attached as presentation metadata. The service catalog represents all in-car candidates described in the source material, while the default selector can use only the candidates enabled by the current purpose/stage matrix.

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
  → show one ordered concrete-content plan
  → user approve / reject / edit / recompute
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
| Transparent service selector | Trigger purpose + lifecycle stage + stage-allowed services + the complete independent Section 8 feature table | Up to 3 ranked services with factor contributions |
| Constrained LLM service selector | Same neutral controls/facts/candidates | Up to 3 structured service judgments with cited fields |
| Transparent content selector | Same controls + the complete independent Section 9 feature table + selected stage-allowed service/catalog | One ordered concrete plan with per-item fit and factor contributions |
| Constrained LLM content selector | Same neutral controls/facts/catalog | One structured, catalog-grounded concrete plan with cited fields/items |

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
  package_feature_contract: object      # complete independent Section 8 or Section 9 snapshot
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

### 5.4 Neutral output contracts

The service-selector output is:

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

The content-selector output is intentionally different because it returns one
plan, not ranked plan candidates:

```yaml
decision_type: complete_plan | no_proposal | insufficient_eligible_items | unsupported_recipe | invalid_request | invalid_catalog | invalid_configuration
selected_service_id: string
requested_item_count: integer
returned_item_count: integer
ordered_items:
  - position: integer
    item_id: string
    item_fit: number                 # transparent package; null for LLM package
    rationale: array
    feature_contributions: array     # transparent package; empty for LLM package
mode: object
expected_duration_sec: integer
lighting_configuration: object|null
approval_policy: string
completion_rule: string
next_transition_policy: string
excluded_items: array
unused_available_features: array
missing_features: array
algorithm_provenance: object
```

There is no aggregate plan score and no content-plan candidate ranking. The
detailed transparent semantics are defined in
`aica_transparent_content_proposal_algorithm.md`.

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
| `humming_karaoke` | Simulated humming karaoke | Audio-first fixed humming segment, no driving lyrics screen | Compatible |
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
| `full_karaoke` | Simulated full-track karaoke | Stopped-only full-track interaction | Compatible |
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

Slides 38–40 provide detailed definitions for the principal media services. Slide 26 additionally names conversation, multisensory relaxation, and connected video recommendation. These Slide-26-only services remain lower-fidelity service-catalog entries so all source contexts are visible, but the default Slides 64–65 constraint matrix does not make them eligible until a separately versioned flow enables them. They have no transparent content recipe in V1 and therefore return `unsupported_recipe` if directly requested. Outdoor delivery is not introduced.

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

## 8. Feature Contract — Service Proposal, One Independent Table

The service selector owns this complete feature contract. Rows follow the CDC-SU order—Situation, Preference, History—then place every simulator proposal at the end under Additional proposed. P0 is dominant safety/eligibility context, P1 primary situation, P2 contextual relevance, P3 personalization/history, and P4 weak novelty/tie-breaking.

| Category | Subcategory | Feature name | Field and value type | Reason to use | Priority | Source |
|---|---|---|---|---|---:|---|
| Situation | Current driver state | Drowsiness level | `drowsiness_level` — number 0–100 | Rank services appropriate to current drowsiness and safety need. | P0 | Slides 66–67 |
| Situation | Current driver state | Fatigue level | `fatigue_level` — number 0–100 | Rank services appropriate to fatigue and recovery need. | P0 | Slides 66–67 |
| Situation | Driving environment | Traffic state | `traffic_state` — enum: `normal`, `congested` | Adjust service fit and interaction load in congestion. | P1 | Slides 66–67 |
| Situation | Driving environment | Road type | `road_type` — enum: `highway`, `local`, `mountain`, `parking` | Represent the specified highway context and normalized simulator road contexts. | P1 | Slides 66–67; normalized enum |
| Situation | Driving environment | Day/night state | `night_state` — enum: `day`, `night` | Adjust service fit for night driving. | P1 | Slides 66–67 |
| Situation | Driving environment | Road monotony | `monotony_level` — number 0–100 | Increase fit of engaging services on monotonous roads. | P1 | Slides 66–67 |
| Situation | Route and destination | Route characteristics | `route_tags` — string array | Match services to characteristic scenery, roads, or themes. | P1/P2 | Slides 66–67 |
| Situation | Route and destination | Destination characteristics | `destination_tags` — string array | Match services to home, leisure, event, or oshi destinations. | P1/P2 | Slides 66–67 |
| Situation | Passenger composition | Child present | `child_present` — boolean | Favor services suitable for a child passenger without inferring child state. | P2 | Slides 66–67 |
| Situation | Passenger composition | Multiple passengers | `multiple_passengers` — boolean | Favor services suitable for shared participation. | P2 | Slides 66–67 |
| Preference | Oshi information | Oshi registered | `oshi_registered` — boolean | Determine whether oshi-related services can be considered. | P2/P3 | Slides 66–67 |
| Preference | Oshi information | Oshi mode | `oshi_mode` — enum: `on`, `off` | Apply the user’s explicit oshi personalization setting. | P2/P3 | Slides 66–67 |
| Preference | Unused function | Service recency | `service_recency_state[service]` — map to `never`, `long_unused`, `recent` | Add a weak novelty signal for unused or long-unused services. | P4 | Slides 66–67 |
| Preference | Overall usage frequency | Service usage level | `service_usage_level[service]` — map to `never`, `low`, `medium`, `high` | Represent how often the user chooses each in-car service. | P3 | Slides 66–67 |
| Preference | Scene-specific tendency | Scene/service usage level | `scene_service_usage_level[scene][service]` — nested usage-level map | Represent service preference in comparable situations. | P3 | Slides 66–67 |
| History | Proposal result | Service proposal acceptance rate | `service_proposal_acceptance_rate[service]` — map to number 0–100 | Favor service proposals previously accepted more often. | P3 | Slides 66–67 |
| History | Recovery result | Service recovery rate | `service_recovery_rate[service]` — map to number 0–100 | Favor services associated with stronger synthetic recovery. | P3 | Slides 66–67 |
| Additional proposed | Motion safety | Driving/stopped state | `motion_state` — enum: `driving`, `stopped` | Apply content presentation eligibility before service ranking. | P0 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Rest-route feasibility | Minutes until rest spot | `estimated_min_until_rest_spot` — nullable non-negative integer | Check whether a pre-rest service fits the remaining drive. | P0/P1 | Simulator proposal |
| Additional proposed | Rest-route feasibility | Rest spot type | `rest_spot_type` — enum: `sa_pa`, `convenience_store`, `parking`, `oshi_spot`, `other`, `unknown` | Adapt the proposed rest journey to the available location. | P1/P2 | Simulator proposal |
| Additional proposed | Current proposal session | Active service | `active_service` — nullable service ID | Avoid conflicts and support continuation or switching. | P2/P3 | Simulator proposal |
| Additional proposed | Current proposal session | Recent service rejections | `recent_service_rejections` — timestamped service-ID array | Avoid immediately repeating a rejected proposal. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service acceptance confidence | `service_proposal_acceptance_confidence[service]` — map to number 0–1 | Limit the influence of sparse synthetic acceptance history. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service recovery confidence | `service_recovery_confidence[service]` — map to number 0–1 | Limit the influence of sparse synthetic recovery history. | P3 | Simulator proposal |
| Additional proposed | Schedule promotion | Scheduled event type | `scheduled_event_type` — enum: `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, `other` | Optionally let an event affect service choice. | P2 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Schedule promotion | Scheduled event timing | `scheduled_event_timing` — enum: `now`, `soon`, `later`, `unknown` | Represent whether event-relevant services are timely. | P2 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Schedule promotion | Scheduled event tags | `scheduled_event_tags` — string array | Match the event to live, radio, music, or oshi services. | P2 | Simulator proposal; concept from Slides 68–69 |

---

## 9. Feature Contract — Concrete Content Proposal, One Independent Table

The concrete-content selector owns the complete table below and can be reviewed without Section 8. Slide 68 says concrete-content selection analyzes the service-ordering information plus additional information; this table states every field directly. It uses the same columns and category order as the service table. Each service recipe independently records ranking applicability (`scored`, `context_only`, or `not_applicable`) and any hard-eligibility role.

| Category | Subcategory | Feature name | Field and value type | Reason to use | Priority | Source |
|---|---|---|---|---|---:|---|
| Situation | Current driver state | Drowsiness level | `drowsiness_level` — number 0–100 | Select appropriate genre, tempo, intensity, and content form. | P0 | Slides 68–69 |
| Situation | Current driver state | Fatigue level | `fatigue_level` — number 0–100 | Select appropriate content intensity and duration. | P0 | Slides 68–69 |
| Situation | Driving environment | Traffic state | `traffic_state` — enum: `normal`, `congested` | Adjust content energy, interaction load, and expected duration. | P1 | Slides 68–69 |
| Situation | Driving environment | Road type | `road_type` — enum: `highway`, `local`, `mountain`, `parking` | Choose road-appropriate content while preserving the specified highway case. | P1 | Slides 68–69; normalized enum |
| Situation | Driving environment | Day/night state | `night_state` — enum: `day`, `night` | Choose appropriate stimulation for night driving. | P1 | Slides 68–69 |
| Situation | Driving environment | Road monotony | `monotony_level` — number 0–100 | Prefer engaging concrete content as monotony increases. | P1 | Slides 68–69 |
| Situation | Route and destination | Route characteristics | `route_tags` — string array | Match songs, themes, and narratives to the route. | P1/P2 | Slides 68–69 |
| Situation | Route and destination | Destination characteristics | `destination_tags` — string array | Match songs, themes, and oshi content to the destination. | P1/P2 | Slides 68–69 |
| Situation | Passenger composition | Child present | `child_present` — boolean | Favor child-compatible genres and concrete items. | P2 | Slides 68–69 |
| Situation | Passenger composition | Multiple passengers | `multiple_passengers` — boolean | Favor content suitable for shared participation. | P2 | Slides 68–69 |
| Situation | Driving state | Driving/stopped state | `motion_state` — enum: `driving`, `stopped` | Apply content-mode and presentation restrictions. | P0 | Slides 68–70 |
| Preference | Oshi information | Oshi registered | `oshi_registered` — boolean | Determine whether oshi-related content can be considered. | P2/P3 | Slides 68–69 |
| Preference | Oshi information | Oshi mode | `oshi_mode` — enum: `on`, `off` | Apply the explicit oshi personalization setting. | P2/P3 | Slides 68–69 |
| Preference | Oshi information | Oshi ID | `oshi_id` — nullable catalog entity ID | Match the registered favorite to concrete catalog items. | P2/P3 | Slides 68–72, 79; normalized UPro identity |
| Preference | Oshi information | Oshi type | `oshi_type` — enum: `artist`, `artist_member`, `group`, `character`, `voice_actor`, `franchise`, `creator`, `other` | Interpret exact, member, group, character, and related-entity matches. | P2/P3 | Slides 68–72, 79; normalized UPro identity |
| Preference | Oshi information | Oshi tags | `oshi_tags` — string array | Match controlled works, themes, genres, routes, and events. | P2/P3 | Slides 68–72, 79; normalized UPro identity |
| Preference | Unused function | Service recency | `service_recency_state[service]` — map to `never`, `long_unused`, `recent` | Retain the service-level novelty context used for the selected service. | P4 | Slides 68–69 |
| Preference | Overall usage frequency | Service usage level | `service_usage_level[service]` — usage-level map | Retain the user’s overall service-use tendency. | P3 | Slides 68–69 |
| Preference | Scene-specific tendency | Scene/service usage level | `scene_service_usage_level[scene][service]` — nested usage-level map | Retain service preference in a comparable situation. | P3 | Slides 68–69 |
| Preference | UPro information | Age band | `age_band` — enum configured by simulator | Support era and genre matching without exact age. | P3 | Slides 68–69 |
| Preference | UPro information | Gender | `gender` — enum plus `unknown` | Preserve the CDC-SU input; default transparent weight is zero. | P4/default 0 | Slides 68–69 |
| Preference | UPro information | Hobbies and interests | `hobby_interest_tags` — string array | Match genres and themes to registered interests. | P3 | Slides 68–69 |
| Preference | Unused content | Catalog item recency | `catalog_item_recency_state[item]` — map to `never`, `long_unused`, `recent` | Add weak item-level novelty. | P4 | Slides 68–70 |
| Preference | Unused content | Content-tag recency | `content_tag_recency_state[tag]` — map to `never`, `long_unused`, `recent` | Add weak genre/theme novelty when item history is sparse. | P4 | Slides 68–70 |
| Preference | Overall usage frequency | Content-tag usage level | `content_tag_usage_level[tag]` — usage-level map | Represent genre and theme preference. | P3 | Slides 68–70 |
| Preference | Overall usage frequency | Catalog item usage level | `catalog_item_usage_level[item]` — usage-level map | Represent song, video, or item preference. | P3 | Slides 68–70 |
| Preference | Scene-specific tendency | Scene/content-tag usage level | `scene_content_tag_usage_level[scene][tag]` — nested usage-level map | Represent genre/theme preference in comparable situations. | P3 | Slides 68–70 |
| Preference | Playback and user operations | Played items | `played_items` — timestamped item-ID array | Use recent playback while controlling repetition. | P3 | Slides 69, 71, 72, 79 |
| Preference | Playback and user operations | Skipped items | `skipped_items` — timestamped item-ID array | Avoid recently skipped or disliked items. | P2/P3 | Slides 69, 71, 72, 79 |
| Preference | Playback and user operations | Cancelled content plans | `cancelled_content_plans` — timestamped plan record array | Avoid repeating cancelled plans. | P2/P3 | Slides 68–69 |
| Preference | Playback and user operations | Changed-from items | `changed_from_items` — timestamped item-ID array | Learn from items the user replaced. | P2/P3 | Slides 69, 71, 72, 79 |
| History | Proposal result | Service proposal acceptance rate | `service_proposal_acceptance_rate[service]` — map to number 0–100 | Keep service-level acceptance context visible to content selection. | P3 | Slides 68–69 |
| History | Recovery result | Service recovery rate | `service_recovery_rate[service]` — map to number 0–100 | Keep service-level recovery context visible to content selection. | P3 | Slides 68–69 |
| History | Schedule | Scheduled event type | `scheduled_event_type` — enum: `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, `other` | Match concrete content to an upcoming event type. | P2 | Slides 68–70 |
| History | Schedule | Scheduled event timing | `scheduled_event_timing` — enum: `now`, `soon`, `later`, `unknown` | Represent proximity of the event. | P2 | Slides 68–70 |
| History | Schedule | Scheduled event tags | `scheduled_event_tags` — string array | Match content to the event, artist, theme, or franchise. | P2 | Slides 68–70 |
| History | Proposal result | Content proposal acceptance rate | `content_proposal_acceptance_rate[key]` — map to number 0–100 | Favor item, tag, genre, or plan proposals accepted more often. | P3 | Slides 68–70 |
| History | Recovery result | Content recovery rate | `content_recovery_rate[key]` — map to number 0–100 | Favor content associated with stronger synthetic recovery. | P3 | Slides 68–70 |
| Additional proposed | Rest-route feasibility | Minutes until rest spot | `estimated_min_until_rest_spot` — nullable non-negative integer | Ensure the concrete plan fits before arrival. | P0/P1 | Simulator proposal |
| Additional proposed | Rest-route feasibility | Rest spot type | `rest_spot_type` — rest-spot enum | Adapt concrete content to the upcoming stopped context. | P1/P2 | Simulator proposal |
| Additional proposed | Current proposal session | Active service | `active_service` — nullable service ID | Keep the content plan compatible with the active service. | P2/P3 | Simulator proposal |
| Additional proposed | Current proposal session | Recent service rejections | `recent_service_rejections` — timestamped service-ID array | Avoid content plans attached to a just-rejected service. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service acceptance confidence | `service_proposal_acceptance_confidence[service]` — map to number 0–1 | Limit sparse service-level acceptance evidence. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service recovery confidence | `service_recovery_confidence[service]` — map to number 0–1 | Limit sparse service-level recovery evidence. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Completed items | `completed_items` — timestamped item-ID array | Distinguish completion from playback start. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Manually selected items | `manually_selected_items` — timestamped item-ID array | Treat explicit choice as stronger evidence than passive playback. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Repeated items | `repeated_items` — timestamped item-ID array | Capture deliberate repeats while respecting repetition caps. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content acceptance confidence | `content_proposal_acceptance_confidence[key]` — map to number 0–1 | Limit sparse content-level acceptance evidence. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content recovery confidence | `content_recovery_confidence[key]` — map to number 0–1 | Limit sparse content-level recovery evidence. | P3 | Simulator proposal |

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

The complete normative design is
`docs/master/aica_transparent_content_proposal_algorithm.md`. This section is
the simulator-level contract summary.

### 12.1 Boundary and supported recipes

The content selector is independent of the service selector. It receives the
already selected `selected_service_id` as a control fact, but never consumes a
service score, rank, rationale, package state, or feature transformation.

Baseline-mode V1 has detailed recipes only for:

- `music_playlist` (Slide 71);
- `humming_karaoke` (Slide 72);
- `full_karaoke` (Slide 79).

Other service IDs use the shared recipe-registry interface and return
`unsupported_recipe` until a versioned recipe is implemented. They are not
represented by artificial lower-fidelity content templates.

### 12.2 Pipeline

1. Validate the controls and complete independent Section 9 baseline snapshot.
2. Confirm the selected service is permitted by the frozen purpose/stage row.
3. Resolve its versioned recipe, ranking-applicability matrix, and eligibility rules.
4. Validate the frozen Spotify-compatible Track, Audio Features, and simulator-flag catalog snapshot.
5. Apply common and recipe-specific hard exclusions before scoring.
6. Normalize scored context into signed evidence and activate purpose/recipe weights.
7. Derive each song's selected-service response coefficient from its Spotify-based activation, then calculate transparent responses, contributions, and `item_fit`.
8. Sort by `item_fit` descending, then stable item ID.
9. Select the first N unique items in that same playback order.
10. Return one complete plan or a typed insufficient/no-eligible result with full evidence.

### 12.3 Item scoring

For catalog item j, selected service s, purpose p, and active baseline factor i:

```text
e_i = normalize_feature_i(raw_value_i)
a_i(j,s) = candidate_response_i(frozen_item_metadata_j, recipe_s)
r_i(j,s) = clamp(e_i × a_i(j,s), -1, +1)
q_i(p,s) = base_weight_i × purpose_multiplier[p][subgroup(i)] × scoring_applicability[i][s]
w_i(p,s) = q_i(p,s) / sum(q_active)
item_fit(j,s) = clamp(sum_i(w_i(p,s) × r_i(j,s)), -1, +1)
```

This deliberately mirrors the transparent service selector. The difference is
the origin of activation-responsive candidate profiles: service coefficients
are human-configured heuristics, while a song coefficient is derived as
`2 × selected_service_activation(song) - 1`. Low signed evidence therefore
favors calm songs and high signed evidence favors active songs.

Every response, weight, and signed contribution is shown. There is no
aggregate score for the finished plan.

### 12.4 Detailed music behavior

All three recipes request five ordered songs by default. The customer can
change `plan_item_count` in settings. A successful plan contains exactly the
configured number; too few eligible songs produce `insufficient_eligible_items`.

- **Music playlist:** requires a playable Track and is the only V1 recipe that
  activates direct item novelty.
- **Humming karaoke:** requires the simulator
  `humming_karaoke_available` flag, which defaults to `1`; its relative proxy
  is derived from Spotify Audio Features and it uses a fixed simulated segment,
  not a claimed provider chorus.
- **Full karaoke:** requires the simulator `full_karaoke_available` flag, which
  defaults to `1`, and stopped motion; its relative proxy is derived from
  Spotify Audio Features and does not claim provider lyrics or karaoke assets.

Spotify-only V1 has no song route, destination, event, child-appeal,
group-appeal, lyric, chorus, or semantic fields. Baseline inputs requiring those
relations remain visible but context-only with zero ranking mask. Exact oshi
matching uses Spotify Artist IDs.

For activation-responsive content factors, drowsiness, fatigue, and monotony
use signed `0..100 -> -1..+1` normalization. Traffic, road, and day/night use
versioned signed categorical profiles. Each normalized feature response is the
signed evidence multiplied by the song's activation-derived response
coefficient.

All three may use playback/operation history. Compatible lighting is attached
after song selection as presentation metadata and does not change `item_fit`.

---

## 13. Constrained LLM Algorithms

### 13.1 LLM service selector

The LLM service package receives only eligible service records, exclusions, approved feature fields, and its own package configuration. It returns up to three services using the common output schema.

### 13.2 LLM content selector

The LLM content package receives the selected service, eligible synthetic catalog records, full approved feature snapshot, and service recipe. It returns one catalog-grounded ordered plan using the neutral content output contract; it does not return plan candidates or an aggregate plan score.

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
- service-candidate or content-item differences;
- fields ignored by each package;
- validation and uncertainty;
- resulting journey behavior.

No approach is labeled correct automatically.

---

## 14. Source Applicability Matrix Policy

Slide 70 and detailed service Slides 71–80 are not perfectly consistent. The system must preserve this uncertainty explicitly.

For every service and baseline field, a versioned content recipe stores:

```text
ranking_applicability = scored | context_only | not_applicable
eligibility_role = true | false
evidence_normalizer_version
candidate_response_function_version
source_reference
rationale
```

For detailed music V1:

- every field used by the content algorithm is stated directly in its independent Section 9 contract;
- Slide 70 provides the default broad applicability baseline;
- a detailed service slide may enable a field it explicitly lists;
- the customer can edit applicability and compare both interpretations;
- eligibility never contributes a score and remains separately visible;
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

The normative shared music-data and generation design is
`docs/master/aica_synthetic_music_data_and_generation_specification.md`.
It belongs to the whole simulator, not to either proposal algorithm package.

Catalog records are synthetic, versioned, and editable. Each V1 song has these
separate namespaces:

| Namespace | Examples | Owner |
|---|---|---|
| `spotify_track` | exact Spotify-compatible Track fields: title, performing artists, album/release, duration, explicit/playability policy, IDs and links | Fictional Spotify-compatible catalog |
| `spotify_audio_features` | exact pinned Audio Features fields including energy, tempo, danceability, loudness, valence, speechiness, and instrumentalness | Fictional Spotify-compatible catalog |
| `simulation_flags` | `humming_karaoke_available: 1`, `full_karaoke_available: 1` | Explicit simulator assumptions; eligibility only |
| world/history data | driver, route, passengers, UPro/oshi, usage, operations, schedule, proposal/recovery histories | Simulation scenario |

Track, artist, and album identities have stable synthetic IDs. V1 does not
invent separate singer, composer, lyricist, arranger, member, semantic, route,
destination, chorus, or singability metadata. Transparent activation and
karaoke-ease proxies are derived at decision time from Audio Features and are
not stored as provider facts.

Signed world evidence, activation response coefficients, and normalized
feature responses are also decision-time values. They are never generated or
stored as song metadata.

The approved generator is staged:

1. stable fictional Track, Artist, and Album IDs are allocated;
2. an LLM generates fictional Spotify-compatible Track objects from the schema;
3. an LLM generates synthetic Audio Features for assigned coverage cells;
4. deterministic validation checks schema, range, identity, and coverage;
5. a separate pass generates worlds, direct-ID histories, and contrasts; and
6. validation freezes the complete simulator dataset.

The generator receives schemas, field semantics, fictional controls, and a
seed—not live Spotify content. Synthetic IDs are visibly marked and HTTP links
use the reserved `.invalid` domain. The deprecated Audio Features contract is a
pinned fixture schema and is not assumed to be available at runtime.

No live LLM call occurs during a deterministic transparent simulation run. The
demonstration tier contains 36 balanced fictional songs, plus smaller fixtures
and a future 500+ item stress tier.

### 15.3 Contrast data

The simulator supplies complete base worlds plus clone-and-change contrasts. The comparison screen shows:

- changed input fields;
- changed eligibility;
- score/reason deltas;
- service-rank or content-item-order deltas;
- changed ordered content plan;
- changed journey preview.

One-variable contrasts are preferred for explanation, while multi-variable worlds remain editable for realistic exploration.

The detailed music contrast suite includes calm and active candidate songs.
Low/high drowsiness, low/high fatigue, normal/congested traffic,
highway/mountain road, day/night, and low/high monotony must demonstrate the
declared reversal of signed activation responses rather than merely scaling the
same song order.

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
| `CONTENT_REJECTED` | Update concrete rejection history and allow edit or recomputation of the single plan. |
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
- Show the single ordered concrete plan and user actions.
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
- Every service selector receives exactly the enabled rows in the independent Section 8 table.
- Every content selector receives exactly the enabled rows in the independent Section 9 table; it does not depend on the Section 8 contract.
- Evidence labels every field `cdc_su_baseline`, `normalized_cdc_su_concept`, or `proposed_addition`.
- Preference, usage history, proposal history, runtime state, constraints, and configuration are visibly distinct.
- `trigger_purpose` and `lifecycle_stage` control the flow/candidate set but are not treated as personal or situation feature scores.
- `child_state` and UI pagination do not enter ranking.
- Per-service used/unused feature evidence is available.

### 19.2 Algorithm correctness

- The selector cannot return a candidate outside the frozen Slides 64–65 purpose/stage constraint row.
- All four package families can be selected independently.
- Packages do not consume each other’s scores or rankings.
- Transparent and LLM approaches conform to the same neutral contract for their selector type.
- Transparent outputs show contribution-level math.
- LLM outputs are catalog-grounded, schema-valid, and cite supplied fields.
- An empty eligible service-candidate or content-item set yields an explicit `no_proposal` result.
- The transparent content selector supports detailed recipes only for playlist, humming karaoke, and full karaoke; another service returns `unsupported_recipe`.
- The transparent content selector returns one ordered plan, never plan candidates or an aggregate plan score.
- Each included music item exposes `item_fit` and reconstructable signed feature contributions.
- Content traces expose normalized evidence, candidate response coefficient, normalized feature response, weight, and contribution using the same terms as the service selector.
- Calm songs outrank active songs on an activation factor when its evidence is negative; active songs outrank calm songs when the evidence is positive.
- All three detailed music recipes request five items by default; a customer setting can change the count.
- Fewer eligible items than the configured count return `insufficient_eligible_items`; zero returns `no_proposal`.

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
- Music data separates Spotify-compatible Track and Audio Features objects, explicit simulator availability flags, and runtime world/history evidence.
- Both karaoke flags default to `1`, remain customer-editable, and affect eligibility only.
- No AICA/LLM-enriched song traits participate in Spotify-only V1 scoring.
- Every generated music artifact is visibly synthetic, validated, versioned, frozen, and provenance-linked before a transparent run.
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
| Complete concrete-content input data | Slide 68 |
| Concrete-content judgment features | Slide 69 |
| Per-service applicability | Slide 70 |
| Detailed playlist/humming/full-karaoke inputs | Slides 71, 72, 79 |
| End/continue/restore behavior | Slides 81–82 |
| Stage-constrained/LLM proposal concepts | `aica_stage_constrained_llm_proposal_selector_spec.md` |
| Transparent music item scoring, recipes, evidence, and tests | `aica_transparent_content_proposal_algorithm.md` |
| Shared synthetic Spotify-compatible music data and staged generation | `aica_synthetic_music_data_and_generation_specification.md` |

Where this specification deliberately refines an ambiguous source concept, the decision and rationale are preserved in `aica_proposal_design_reference_draft.md`.
