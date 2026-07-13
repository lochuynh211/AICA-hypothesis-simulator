# AICA Service And Content Proposal — Design Reference Draft v1

**Document status:** Discussion record and design reference  
**Date consolidated:** 2026-07-13  
**Primary audience:** Product planners, algorithm designers, simulator designers, and future implementers  
**Purpose:** Preserve the complete design direction, corrections, rationale, and unresolved details from the proposal-algorithm design session. This is the detailed reference behind the consolidated specification; it is not itself the implementation contract.  
**Related source documents:**

- `others/CDC-SU_specplan.md`, especially Slides 1–7, 26, 38–44, and 64–82
- `others/aica_stage_constrained_llm_proposal_selector_spec.md`
- `docs/master/aica_hypothesis_simulator_specification.md`
- `docs/master/aica_hypothesis_simulator_architecture.md`

---

## 1. Why This Design Phase Exists

The current simulator concentrates on deciding **when a trigger should fire**. The next phase starts after a proposal opportunity exists and asks:

1. which service should be proposed;
2. which concrete content should be proposed within the selected service;
3. how the proposal should adapt across pre-rest, rest, and post-rest phases;
4. how a customer can inspect, edit, replay, and compare the decision without real customer data.

The immediate detailed-content focus is the music-related scope:

- music playlist recommendation;
- humming karaoke;
- full karaoke while stopped;
- favorite-character/artist setup (推し設定) as a personalization source;
- lighting as a compatible presentation modifier.

The design still represents the wider service catalog from the source material because the first algorithm selects a service, not merely a playlist or a rest option.

---

## 2. Governing Product Decisions

### 2.1 The algorithm receives an explicit trigger purpose

The trigger side supplies one required `trigger_purpose` value to the proposal subsystem:

| Value | Source purpose | Meaning |
|---|---|---|
| `rest_recommended` | ①休憩が推奨される状態 | The driver is tired now or future fatigue is expected; rest guidance and stage-specific pre/post-rest content are considered. |
| `inattentive_driving_prevention_recovery` | ②漫然運転予防・疲労回復向け提案 | Select permissible driving content for inattentive-driving prevention or recovery support. |
| `route_music` | ③ルートに応じた音楽提案 | Select content relevant to the route or destination. |
| `child_passenger_experience` | ④子供同乗時向け提案 | Select child-compatible in-cabin content. |

This value is an explicit routing/control input from Slide 26. It is not inferred from drowsiness, route, or passenger features and is not replaced by a scenario title.

The feature snapshot is still required. `trigger_purpose` selects the applicable proposal flow and service constraint set; features such as `drowsiness_level`, `route_tags`, and `child_present` rank the permitted candidates and explain their fit.

### 2.2 Lifecycle stage and service constraints are required inputs

The proposal opportunity also carries `lifecycle_stage`. It is runtime/control state, not a personal or situation feature, but it is mandatory because Slides 64–65 constrain which services can be considered in each flow.

Default V1 constraints are:

| Trigger purpose | Lifecycle stage | Default allowed proposal types |
|---|---|---|
| `rest_recommended` | `before_rest_until_stop` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `rest_recommended` | `during_rest_stopped` | `rest_duration_suggestion`, `rest_method_suggestion`, `seat_adjustment`, `nap_guidance`, `rest_extension_check` |
| `rest_recommended` | `after_rest_before_restart` | `live_viewing`, `stretch_video`, `full_karaoke`, `oshi_reexperience` |
| `inattentive_driving_prevention_recovery` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `route_music` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `child_passenger_experience` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |

The `during_rest_stopped` proposal types come from the rest execution flow in Slide 2 and the related stage-constrained draft. The other rows follow the service lists shown in Slides 64–65.

The platform resolves the versioned matrix into `allowed_service_ids` and supplies it to the selector. Motion, catalog readiness, and schedule availability may narrow that set further. The selector ranks only the remaining candidates; it cannot add a service forbidden by the purpose/stage constraints.

Slide-26-only future candidates remain visible in the editable service catalog but are disabled by the default Slides 64–65 matrix until a separately versioned flow explicitly enables them.

### 2.3 The scope is an end-to-end proposal journey

The simulated journey starts when a proposal opportunity is active and may cover:

```text
proposal opportunity
→ service candidates
→ selected service
→ concrete content candidates
→ user approval/rejection/change
→ content delivery
→ transition/recalculation
→ rest arrival and rest activity
→ post-rest proposal
→ end/continue/return to previous content
```

It includes pre-rest, rest, and post-rest behavior. A representative journey from Slides 1–7 is:

```text
rest guidance + nap suggestion
→ humming karaoke on the way to the rest spot
→ stop and nap
→ full karaoke, live viewing, stretch, or oshi experience after rest
→ resume the journey
```

This is one possible plan, not a mandatory sequence.

### 2.4 Safety is dominant but the product remains advisory

Safety must receive overwhelming priority. A lower-priority entertainment or preference factor must not outvote a materially safer proposal. At the same time, AICA proposes; it does not compel the driver.

The agreed distinction is:

- **Hard exclusion:** remove behavior that is impermissible or unavailable in the present motion/context, such as a screen-dependent full karaoke experience while driving.
- **Dominant safety weighting:** among permissible choices, use a very large safety contribution so unsafe-feeling entertainment cannot win through accumulated preference weights.
- **Driver choice:** always expose approval, rejection, change, or more-candidates actions where the service policy allows them.

The simulator must not claim that a score proves safety.

### 2.5 Preview the journey, commit only the next action

The system uses rolling-horizon planning:

- show a comprehensible preview of the likely pre-rest/rest/post-rest journey;
- commit only the immediate service/content action;
- recompute when the situation changes;
- reconfirm before a new phase or interaction mode begins.

This allows a reviewer to understand the overall idea without making a stale early decision binding after the vehicle stops or the user completes a nap.

### 2.6 Candidate presentation and quick mode

- Service selector: normally return three ranked service candidates.
- Content selector: return up to three concrete plans for the service selected by the user.
- Interactive mode: reviewer chooses, rejects, edits context, or requests more candidates.
- Quick mode: simulator automatically chooses the top valid candidate so the customer can check a configuration quickly.
- Automatic choice is a simulator convenience, not a production autonomy decision.

---

## 3. Simulator Placement And Future Integration

### 3.1 Separate screen, same application and backend

The proposal simulator will be a separate screen inside the current AICA Hypothesis Simulator. It should use the same backend and common application infrastructure, but maintain an independent proposal-simulation context.

This gives customers freedom to edit proposal features without first running or configuring the trigger algorithm.

### 3.2 Separate simulation world and algorithm engine

The design must preserve these boundaries:

| Component | Responsibility |
|---|---|
| Proposal simulation world | Explicit trigger purpose, lifecycle stage, synthetic driver, route, passengers, schedule, histories, catalogs, discrete events, and user actions. |
| Proposal algorithm package | Ranks services or concrete content from a neutral snapshot. |
| Journey/playback engine | Applies accepted actions, advances lifecycle state, plays content, and emits the next proposal opportunity. |
| Reviewer UI | Edits values, runs decisions, shows evidence, and records customer judgment. |

The world must not hide ranking logic, and packages must not mutate the world directly.

### 3.3 Event-driven V1 with a future tick adapter

V1 is discrete event-driven, not tick-by-tick. The initial values are editable and a decision runs on demand or in quick mode. Examples of events are:

- `PROPOSAL_OPPORTUNITY_OPENED`
- `SERVICE_SELECTED`
- `SERVICE_REJECTED`
- `CONTENT_SELECTED`
- `CONTENT_REJECTED`
- `REST_SPOT_ARRIVED`
- `REST_STARTED`
- `REST_COMPLETED`
- `MOTION_CHANGED`
- `CONTENT_COMPLETED`
- `CONTINUE_REQUESTED`
- `RETURN_TO_DRIVE`

Later, a proposal-opportunity adapter can construct the same neutral snapshot from the current trigger simulator’s selected trigger purpose, tick state, and journey state. The proposal packages therefore must not depend on screen state, tick counters, or trigger-specific runtime objects beyond the neutral `trigger_purpose` and `lifecycle_stage` values.

### 3.4 Merge path with the trigger simulator

The selected architecture is “separate now, composable later”:

```text
standalone proposal screen ──┐
                            ├─> neutral ProposalOpportunity input
trigger simulator adapter ──┘    (purpose + lifecycle + features)
                                          │
                                          v
                         service selector → content selector
                                          │
                                          v
                                  journey/playback engine
```

The same proposal opportunity contract will support both sources. In standalone mode the customer explicitly chooses the trigger purpose and starting lifecycle stage; in combined mode the trigger/journey orchestration supplies them. Combining the screens later should therefore be orchestration work, not a rewrite of the proposal algorithms.

---

## 4. Algorithm Package Decisions

### 4.1 Service selection and content selection are different algorithms

The source process separates “which service?” from “what exact content?” The design follows that separation.

Four independent package families are required:

1. transparent scoring service selector;
2. constrained LLM service selector;
3. transparent scoring concrete-content selector;
4. constrained LLM concrete-content selector.

A run chooses one service selector and one content selector. Comparisons replay the same frozen simulation input in separate runs.

### 4.2 Package independence

An algorithm package owns all of its own decision logic, including any scoring it needs. Packages may share only:

- versioned neutral input/output contracts;
- enums and validation types;
- catalog record schemas;
- explicit `trigger_purpose` and `lifecycle_stage` control values;
- versioned purpose/stage service constraints and platform eligibility results;
- platform hard-eligibility validation;
- deterministic simulation facts.

Packages must not share:

- scores;
- learned or synthetic preference models;
- rankings;
- utility functions;
- prompts or hidden reasoning policy;
- package runtime state;
- candidate-order decisions.

If an LLM approach performs a score-like judgment, that mechanism lives inside the LLM package. A later hybrid approach must be introduced as its own package rather than silently coupling the existing packages.

### 4.3 Common outputs

Both service approaches should return the same reviewable shape:

- eligible and excluded candidates;
- up to three ranked proposals;
- factor-level reasons;
- safety/eligibility explanation;
- missing/unused input disclosure;
- algorithm and configuration version;
- confidence/uncertainty statement appropriate to the method;
- no-proposal result when nothing is permissible.

The concrete-content approaches should additionally return:

- content plan ID and catalog references;
- ordered items or generated content outline;
- expected duration;
- relevant modes, such as chorus-only or guide-vocal;
- lighting compatibility and suggested intensity, if applicable;
- approval policy;
- end condition and next transition.

---

## 5. Transparent Scoring Without Training Data

No training data is currently available. The transparent approach is therefore an expert-authored, customer-editable multi-criteria scorecard, not a trained predictive model.

### 5.1 Interpretation of the score

The score means:

> “Given this explicitly configured hypothesis, how strongly does the candidate fit this synthetic situation?”

It does not mean:

- probability the driver will accept;
- measured recovery effect;
- production safety assurance;
- statistically validated utility.

### 5.2 Proposed calculation pattern

For candidate `c`:

```text
if hard_excluded(c, context):
    candidate is ineligible
else:
    safety_fit      = bounded weighted factor score
    situation_fit   = bounded weighted factor score
    route_fit       = bounded weighted factor score
    passenger_fit   = bounded weighted factor score
    preference_fit  = bounded weighted factor score
    history_fit     = confidence-shrunk historical factor score
    novelty_fit     = bounded weak factor score

    utility(c) =
        W_safety × safety_fit
      + W_situation × situation_fit
      + W_route × route_fit
      + W_passenger × passenger_fit
      + W_preference × preference_fit
      + W_history × history_fit
      + W_novelty × novelty_fit
```

The default must make `W_safety` dominant. A safer implementation may use a safety band before the utility score:

```text
rank first by safety band, then by utility within the band
```

This prevents many small entertainment signals from summing above a material safety difference while remaining transparent and configurable.

### 5.3 Historical values require confidence

Acceptance and recovery rates must be paired with evidence confidence or sample strength. A rate with no observations must not behave like a reliable 100% or 0% signal. The transparent package should shrink low-confidence values toward a neutral prior chosen in package configuration.

### 5.4 Customer validation is the goal

The simulator allows customers to alter weights, thresholds, factor mappings, feature values, and synthetic histories. It should show sensitivity and contrast, not automatically label the customer’s hypothesis rational or irrational.

---

## 6. Constrained LLM Approach

The LLM approach receives the same neutral snapshot and catalog candidates but makes its own independent selection.

It must:

- use only fields supplied in the request;
- preserve the CDC-SU-baseline versus enabled-addition grouping and never assume a disabled addition;
- obey hard eligibility supplied by the platform contract;
- return strict structured output;
- cite input field IDs and catalog IDs in its rationale;
- distinguish facts from interpretations;
- expose missing data and uncertainty;
- never invent an unavailable service, song, event, oshi, route tag, or recovery result;
- produce no proposal if no valid candidate exists;
- remain advisory and preserve user choice.

The simulator should display the LLM request snapshot, model/configuration identity, structured response, validation results, and any retry/fallback. Hidden chain-of-thought is neither required nor displayed; concise factor-based rationale is required.

---

## 7. Service Catalog Scope

### 7.1 Services represented

The source document’s in-car services are represented even though detailed concrete-content implementation initially emphasizes music:

**Driving-oriented services**

- music playlist recommendation;
- humming karaoke;
- call-and-response practice;
- quiz;
- ranking creation;
- radio-style playback.

**Stopped/rest-oriented services**

- live viewing;
- stretch video;
- full karaoke;
- stopped call-and-response practice;
- oshi reexperience.

**Slide-26 breadth represented at lower fidelity**

- conversation (`conversation_audio` / おしゃべり);
- multisensory relaxation (`relaxation_multisensory` / リラックス（多感覚連携）);
- connected video recommendation (`linked_video_recommendation` / 動画レコ（家電連携）), limited to an in-cabin review representation in the present scope.

**Rest-support proposal types**

- rest guidance/journey;
- rest-duration suggestion;
- rest-method suggestion;
- seat-adjustment confirmation;
- nap guidance;
- rest-extension check.

When `trigger_purpose=rest_recommended`, the orchestrator activates the rest-support journey; the selector does not need to infer or rank whether the journey exists. At `during_rest_stopped`, the applicable proposal package can rank the permitted rest proposal types. The journey preview may contain non-binding pre-rest/post-rest content slots, but those slots are recomputed and confirmed at their actual transition. Rest-support actions are owned and executed by the journey engine and are never confused with a song catalog item.

Slides 38–40 operationalize the main media services more precisely than Slide 26. Slide-26-only candidates remain lower-fidelity, explicitly labeled catalog entries for future flow versions; the default Slides 64–65 matrix keeps them ineligible so the current algorithm does not pretend their detailed UX is already specified.

### 7.2 Lighting decision

Lighting is a presentation modifier, not a standalone service candidate. Based on Slides 39–40:

| Service | Lighting compatibility |
|---|---|
| Music playlist | Yes |
| Humming karaoke | Yes |
| Call-and-response practice | Yes |
| Live viewing | Yes |
| Full karaoke | Yes |
| Quiz | No |
| Ranking creation | No |
| Radio-style playback | No |
| Stretch video | No |
| Oshi reexperience | No |

The simulator may expose lighting enabled/disabled, pattern, and intensity as content-plan fields. Motion and post-nap state should affect allowable intensity. The design does not claim physiological benefit.

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

The concrete-content selector owns the complete table below and can be reviewed without Section 8. Slide 68 says concrete-content selection analyzes the service-ordering information plus additional information; this table states every field directly. It uses the same columns and category order as the service table. Each service recipe still marks every field `used` or `available_but_not_used`.

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
| Additional proposed | Detailed oshi identity | Oshi ID | `oshi_id` — nullable catalog entity ID | Match the selected synthetic favorite to concrete catalog items. | P2/P3 | Simulator proposal |
| Additional proposed | Detailed oshi identity | Oshi type | `oshi_type` — enum: character, artist, group, franchise, other | Distinguish different favorite-entity relationships. | P2/P3 | Simulator proposal |
| Additional proposed | Detailed oshi identity | Oshi tags | `oshi_tags` — string array | Match works, themes, genres, routes, and events. | P2/P3 | Simulator proposal |
| Additional proposed | Granular operations | Completed items | `completed_items` — timestamped item-ID array | Distinguish completion from playback start. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Manually selected items | `manually_selected_items` — timestamped item-ID array | Treat explicit choice as stronger evidence than passive playback. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Repeated items | `repeated_items` — timestamped item-ID array | Capture deliberate repeats while respecting repetition caps. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content acceptance confidence | `content_proposal_acceptance_confidence[key]` — map to number 0–1 | Limit sparse content-level acceptance evidence. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content recovery confidence | `content_recovery_confidence[key]` — map to number 0–1 | Limit sparse content-level recovery evidence. | P3 | Simulator proposal |

---

## 10. Explicit Non-Features And Rejected Inputs

The design discussion corrected several category errors. These exclusions are important implementation guidance.

| Item | Decision | Reason |
|---|---|---|
| `trigger_purpose` | Required routing/control input, not a derived feature | The trigger side explicitly supplies one of the four Slide-26 purposes and the selector must not infer it. |
| `lifecycle_stage` | Required routing/runtime input, not a ranking feature | It is supplied from journey progression and selects the stage-specific flow in Slides 64–65. |
| `allowed_service_ids` / purpose-stage matrix | Required constraint input/configuration, not a feature | It limits the candidate set before feature-based ranking. |
| `child_state` | Do not use | Availability is not reliable; only `child_present` and `multiple_passengers` are approved. |
| `service_capabilities` | Constraint/catalog metadata, not a user feature | Used by platform eligibility validation. |
| `content_readiness` | Constraint/catalog metadata, not a user feature | Availability is separate from preference/context. |
| `output_channel` | Do not model as a feature | Presentation policy belongs to service/content metadata and motion constraints. |
| `outdoor` suitability | Out of present in-car scope | The simulator focuses on in-car services; oshi spot may be represented as a rest destination/journey action. |
| `proposal_start_mode` | Not a feature | It is invocation/session metadata. |
| `current_candidate_page` | Do not use | UI pagination state must never affect ranking. |
| `service_preferences` as an unexplained scalar | Rejected | Use observable/editable service usage levels instead. |
| `upro_information` | Category, not a feature | Split into `age_band`, optional `gender`, and `hobby_interest_tags`. |
| `journey_window` | Replaced | `estimated_min_until_rest_spot` and rest lifecycle events are clearer. |
| `route_destination_context` | Replaced | Use one Route Features category with route tags, destination tags, minutes to rest spot, and rest spot type. |
| Synthetic user response probability | Not in V1 | Customer manually evaluates proposals or quick mode selects top rank; simulator does not manufacture evidence of acceptance. |
| Automatic recovery truth | Not in V1 | Recovery values are editable synthetic scenario/history inputs, never validated outcomes. |

Parameters and hyperparameters are also not features. They are package configuration exposed separately in the simulator.

---

## 11. Synthetic Data Decisions

### 11.1 Built-in only, fully editable

V1 uses built-in synthetic media catalogs only. Customer import is out of scope. Customers may edit synthetic catalog records and all other synthetic data through the simulator.

### 11.2 A seed means a complete world

A seed should initialize:

- trigger purpose and starting lifecycle stage;
- driver state and environment;
- passenger context;
- route/destination/rest opportunity;
- service-use preference profile;
- proposal and content histories;
- UPro setup;
- oshi setup;
- schedule;
- service catalog and availability;
- media catalog;
- algorithm parameters and hyperparameters;
- discrete journey events;
- prior/active content and expected end behavior.

Every field remains editable after loading the seed.

### 11.3 Contrast sets, not narrow personas

Seeds should be broad enough to exercise all controls, with contrast presets built by changing a small number of causal fields while keeping the rest frozen. Useful contrast dimensions include:

- high vs low drowsiness;
- driving vs stopped;
- nearby vs distant rest spot;
- child present vs absent;
- characteristic route vs ordinary route;
- oshi mode on vs off;
- strong vs weak service usage;
- recent rejection vs no rejection;
- upcoming live event vs no schedule;
- recently skipped item vs manually selected item;
- strong historical rate with high confidence vs the same rate with low confidence.

The UI should show a field-level diff and resulting ranking delta so customers can see why a proposal changed.

### 11.4 Determinism

The frozen simulation snapshot, seed ID, catalog version, package version, parameters, hyperparameters, and user actions must be persisted. Identical inputs must reproduce the transparent package result. LLM runs should preserve request/response provenance and be replayable as recorded evidence even if a fresh model call may vary.

---

## 12. Service-Specific Applicability

Slide 70 defines a broad matrix, while detailed Slides 71, 72, and 79 sometimes include route/destination inputs even where Slide 70 shows route as unused. The agreed implementation-safe policy is:

1. state every applicable CDC-SU field and every enabled proposed field directly in the content contract;
2. define an explicit `used`/`available_but_not_used` matrix per service recipe and package version;
3. document source discrepancies rather than silently resolving them;
4. for the detailed music V1 recipes, prefer the detailed service slide when it explicitly supplies an input, but expose the switch so the customer can test both interpretations.

This is especially relevant for destination context in humming karaoke and full karaoke.

---

## 13. Journey And Ending Decisions

The journey engine—not the ranking package—owns content lifecycle.

For AI-initiated driving content, Slides 81–82 suggest completion after a fixed song/item count, then a continuation or alternate-content proposal. If rejected, the later combined trigger runtime may recheck after an interval. Standalone V1 creates a new proposal opportunity only through an explicit discrete event.

For stopped content:

- live viewing completes after a configured item count and may confirm continuation before driving;
- stretch completes after one video and can end automatically;
- full karaoke completes the selected song, with user-added reservations supported by simulated actions;
- if driving restarts, screen-dependent content must switch to a permitted background/audio behavior or stop according to the content policy;
- oshi reexperience completes after the configured episode/guide action.

The system should restore the content active before the proposal when the selected policy says “return to previous content.”

---

## 14. Evidence And Customer Review

Each run should preserve three clearly separated evidence types:

| Evidence type | Examples |
|---|---|
| Simulation facts | Feature snapshot, catalog, lifecycle state, events, user actions. |
| Algorithm evidence | exclusions, factor contributions or structured LLM reasons, ranking, selected plan. |
| Human review | rationale appears reasonable/unreasonable, safety impression, usefulness, intrusiveness, comments. |

The application must not convert human feedback into a verified algorithm label automatically.

Customer-facing trace should answer:

- What was available?
- What was excluded and why?
- Which feature affected which candidate?
- Why did the top candidate outrank the others?
- Which fields were missing or intentionally unused?
- What changes if one selected feature or parameter changes?
- What did the reviewer choose?
- What happened next in the journey?

---

## 15. Design Evolution And Corrections Preserved From The Session

The following changes were deliberately made during discussion:

1. Expanded from “rest option selector” to the full content-proposal context in Slide 26.
2. Initially assumed the algorithm inferred purpose from features; corrected after source review so one of the four Slide-26 `trigger_purpose` values is an explicit required input.
3. Expanded from one decision to pre-rest/rest/post-rest rolling-horizon planning.
4. Changed safety from coercive behavior to dominant advisory ranking plus hard impermissibility filters.
5. Chose a separate proposal screen and simulation context within the existing application/backend.
6. Chose event-driven V1, with a future adapter from trigger ticks.
7. Replaced narrow persona seeds with complete editable synthetic worlds and contrast clones.
8. Split transparent and LLM approaches into independent packages.
9. Split service proposal and concrete-content proposal into different algorithm package families.
10. Required each package to own its scoring/decision logic and share no rankings.
11. Defined lighting as a content modifier, based on Slides 39–40.
12. Reframed transparent scoring as an expert hypothesis because no training data exists.
13. Selected built-in editable synthetic catalogs only.
14. Rejected automatic claims that a proposal is rational, accepted, or effective; customers evaluate it.
15. Corrected `lifecycle_stage` from feature to required runtime/control input and added the Slides 64–65 purpose/stage service constraints.
16. Combined route and destination under one clear Route Features category.
17. Kept `motion_state` semantically under Driver State, then clarified its provenance: CDC-SU content baseline and simulator-proposed service-selection extension.
18. Separated personal service-use preference from service-proposal history.
19. Corrected `upro_information` from a feature into a category with concrete fields.
20. Rebuilt the content feature inventory from the service-ordering information plus the additional concrete-content information required by Slides 68–69.
21. Reorganized both feature contracts as independent tables with the same columns and category order; every simulator-proposed feature appears in the final rows for review.

---

## 16. Items Intentionally Deferred To Detailed Design/Implementation

The high-level and feature design is approved. These values remain package-level choices to be finalized during detailed algorithm implementation and customer tuning:

- exact default weights, safety bands, thresholds, and nonlinear mappings;
- exact neutral priors and confidence shrinkage formula;
- exact scene taxonomy used by scene-specific usage features;
- exact built-in synthetic catalog records and tag vocabulary;
- the per-service applicability matrix where source slides disagree;
- LLM provider/model and retry policy;
- precise UI layout;
- combined tick-driven cooldown and re-proposal behavior;
- production data acquisition, privacy, and learning pipelines;
- any empirical or safety validation program.

These are not hidden requirements. The milestone plan schedules them as explicit, reviewable deliverables.
