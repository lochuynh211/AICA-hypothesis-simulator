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

## 8. Service-Proposal Feature Model — CDC-SU First

### 8.1 Provenance rule and priority meaning

The feature contract starts with the concepts explicitly defined for service display ordering in CDC-SU Slides 66–67. Simulator additions are listed separately and must never be presented as source requirements.

| Priority | Meaning |
|---|---|
| P0 | Dominant safety or eligibility context. |
| P1 | Primary situational fit. |
| P2 | Contextual relevance. |
| P3 | Personalization and historical support. |
| P4 | Weak novelty/tie-breaking influence. |

Priority is a default design intent, not a hardcoded universal coefficient. Packages expose their actual mappings.

### 8.2 CDC-SU baseline service features

| CDC-SU category/concept | Priority | Simulator field | Representation and use | Source |
|---|---:|---|---|---|
| Situation — current driver state | P0 | `drowsiness_level` | Editable 0–100 normalization of drowsiness; dominant situation/safety fit. | Slides 66–67 |
| Situation — current driver state | P0 | `fatigue_level` | Editable 0–100 normalization of fatigue; dominant situation/safety fit. | Slides 66–67 |
| Situation — driving environment: congestion | P1 | `traffic_state` | `normal` or `congested`; changes interaction load and service fit. | Slides 66–67 |
| Situation — driving environment: highway | P1 | `road_type` | `highway` represents the source concept; `local`, `mountain`, and `parking` are simulator normalization extensions within the same field. | Slides 66–67 |
| Situation — driving environment: night | P1 | `night_state` | `day` or `night`. | Slides 66–67 |
| Situation — driving environment: monotonous road | P1 | `monotony_level` | Editable 0–100 normalization. | Slides 66–67 |
| Situation — characteristic route | P1/P2 | `route_tags` | Editable route tags such as sea, mountain, city, night view, or oshi-related. | Slides 66–67 |
| Situation — characteristic destination | P1/P2 | `destination_tags` | Editable destination tags such as home, leisure, event, or oshi spot. | Slides 66–67 |
| Situation — passenger composition: child | P2 | `child_present` | Boolean child presence; no child internal state is inferred. | Slides 66–67 |
| Situation — passenger composition: multiple people | P2 | `multiple_passengers` | Boolean group context. | Slides 66–67 |
| Preference — oshi registration | P2/P3 | `oshi_registered` | Enables services that require or benefit from oshi context. | Slides 66–67 |
| Preference — oshi mode | P2/P3 | `oshi_mode` | `on` or `off`; applies the explicit personalization setting. | Slides 66–67 |
| Preference — unused/long-unused service | P4 | `service_recency_state[service]` | `never`, `long_unused`, or `recent`; weak novelty input. | Slides 66–67 |
| Preference — overall usage frequency | P3 | `service_usage_level[service]` | `never`, `low`, `medium`, or `high`; service-level usage tendency. | Slides 66–67 |
| Preference — scene-specific tendency | P3 | `scene_service_usage_level[scene][service]` | Usage tendency in comparable scenes such as congestion or highway. | Slides 66–67 |
| Past performance — proposal acceptance | P3 | `service_proposal_acceptance_rate[service]` | Editable 0–100 synthetic rate. | Slides 66–67 |
| Past performance — recovery rate | P3 | `service_recovery_rate[service]` | Editable 0–100 synthetic recovery indicator. | Slides 66–67 |

### 8.3 Proposed additional service features

| Proposed category | Priority | Feature | Why proposed | Default policy |
|---|---:|---|---|---|
| Driver/motion safety | P0 | `motion_state` | Prevents a service-level proposal from conflicting with driving/stopped presentation requirements. CDC-SU introduces this for concrete content in Slides 68–69, not for service ordering in Slides 66–67. | Enabled; hard eligibility before score. |
| Rest-route feasibility | P0/P1 | `estimated_min_until_rest_spot` | Distinguishes a practical short pre-rest activity from content too long for the remaining journey. | Enabled for `rest_recommended`; otherwise unused. |
| Rest-route feasibility | P1/P2 | `rest_spot_type` | Distinguishes SA/PA, convenience store, parking, oshi spot, and other stopped contexts. | Enabled for `rest_recommended`; otherwise unused. |
| Current proposal session | P2/P3 | `active_service` | Avoids conflicting proposals and supports continuation/switching. | Enabled. |
| Current proposal session | P3 | `recent_service_rejections` | Prevents immediate repetition after user rejection while preserving a safety-dominant alternative. | Enabled with a configurable recency window. |
| Evidence reliability | P3 | `service_proposal_acceptance_confidence[service]` | Reduces the influence of a synthetic or sparse acceptance rate. | Optional; neutral when unavailable. |
| Evidence reliability | P3 | `service_recovery_confidence[service]` | Reduces the influence of a synthetic or sparse recovery rate. | Optional; neutral when unavailable. |
| Schedule promoted to service selection | P2 | `scheduled_event_type` | Allows live, radio, concert, or oshi-event relevance to affect which service is proposed. CDC-SU defines schedule for concrete-content selection in Slides 68–69, not service ordering. | Optional extension. |
| Schedule promoted to service selection | P2 | `scheduled_event_timing` | Distinguishes `now`, `soon`, `later`, and `unknown`. | Optional extension. |
| Schedule promoted to service selection | P2 | `scheduled_event_tags` | Matches a synthetic event to a service. | Optional extension. |

---

## 9. Concrete-Content Feature Model — CDC-SU First

### 9.1 Inheritance rule

Slide 68 states that concrete-content selection uses the information already analyzed for service ordering and then adds content-specific information. The simulator contract therefore is:

```text
ContentProposalFeatures
  = CDC-SU baseline service features
  + enabled proposed service additions
  + CDC-SU content-specific baseline features
  + proposed content-specific additions
```

`motion_state` and the three schedule fields are stored once. They are CDC-SU baseline inputs for concrete content; using those same fields earlier in service selection is an optional service-layer extension.

The content algorithm also receives the same `trigger_purpose`, `lifecycle_stage`, and allowed-service context. A per-service recipe marks each available feature as `used` or `available_but_not_used`.

### 9.2 CDC-SU content-specific baseline features

| CDC-SU category/concept | Priority | Simulator field | Representation and use | Source |
|---|---:|---|---|---|
| Situation — driving/stopped state | P0 | `motion_state` | `driving` or `stopped`; applies content-mode and presentation restrictions. | Slides 68–70 |
| Preference — UPro age | P3 | `age_band` | Editable age band rather than exact age. | Slides 68–69 |
| Preference — UPro gender | P4/default 0 | `gender` | Retained for source fidelity; transparent default weight is zero because relevance is weak and bias risk is material. | Slides 68–69 |
| Preference — UPro hobbies/interests | P3 | `hobby_interest_tags` | Editable registered tags for genre/theme matching. | Slides 68–69 |
| Preference — unused/long-unused concrete item | P4 | `catalog_item_recency_state[item]` | `never`, `long_unused`, or `recent`; item-level normalization of the unused-content concept. | Slides 68–70 |
| Preference — unused/long-unused content theme | P4 | `content_tag_recency_state[tag]` | Tag-level normalization used when item history is sparse. | Slides 68–70 |
| Preference — overall content usage | P3 | `content_tag_usage_level[tag]` | Genre/theme usage tendency. | Slides 68–70 |
| Preference — overall item usage | P3 | `catalog_item_usage_level[item]` | Song/video/item usage tendency. | Slides 68–70 |
| Preference — scene-specific content tendency | P3 | `scene_content_tag_usage_level[scene][tag]` | Genre/theme usage in comparable scenes. | Slides 68–70 |
| Preference/history — played content | P3 | `played_items` | Ordered played song/video IDs with recency. | Slides 69, 71, 72, 79 |
| Preference/history — skipped content | P2/P3 | `skipped_items` | Ordered skipped item IDs with recency. | Slides 69, 71, 72, 79 |
| Preference/history — cancellation | P2/P3 | `cancelled_content_plans` | Normalized record of cancelled proposed/active content. | Slides 68–69 |
| Preference/history — changed content | P2/P3 | `changed_from_items` | Item IDs replaced by the user. | Slides 69, 71, 72, 79 |
| Past performance — schedule | P2 | `scheduled_event_type` | `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, or `other`. | Slides 68–70 |
| Past performance — schedule timing | P2 | `scheduled_event_timing` | `now`, `soon`, `later`, or `unknown`. | Slides 68–70 |
| Past performance — schedule tags | P2 | `scheduled_event_tags` | Matches content to the synthetic event. | Slides 68–70 |
| Past performance — proposal acceptance | P3 | `content_proposal_acceptance_rate[key]` | Editable 0–100 rate by item, tag, genre, or plan type. | Slides 68–70 |
| Past performance — recovery rate | P3 | `content_recovery_rate[key]` | Editable 0–100 synthetic recovery indicator. | Slides 68–70 |

Oshi registration and mode, driver/environment context, route/destination, passengers, unused-service state, service usage, scene-specific service usage, and service performance are inherited from the CDC-SU service baseline rather than duplicated here.

### 9.3 Proposed additional concrete-content features

| Proposed category | Priority | Feature | Why proposed | Default policy |
|---|---:|---|---|---|
| Detailed oshi identity | P2/P3 | `oshi_id` | Concrete catalog matching requires the selected synthetic favorite, not only registration/on/off. | Enabled when `oshi_registered=true` and `oshi_mode=on`. |
| Detailed oshi identity | P2/P3 | `oshi_type` | Distinguishes character, artist, group, franchise, and other relation types. | Enabled with detailed oshi setup. |
| Detailed oshi identity | P2/P3 | `oshi_tags` | Matches works, genres, themes, eras, routes, and events. | Enabled with detailed oshi setup. |
| Granular operation history | P3 | `completed_items` | Distinguishes completion from a simple playback start. | Optional. |
| Granular operation history | P3 | `manually_selected_items` | Treats an explicit user choice as stronger evidence than passive playback. | Optional. |
| Granular operation history | P3 | `repeated_items` | Captures deliberate repeats while remaining subject to repetition caps. | Optional. |
| Evidence reliability | P3 | `content_proposal_acceptance_confidence[key]` | Reduces influence of sparse acceptance evidence. | Optional; neutral when unavailable. |
| Evidence reliability | P3 | `content_recovery_confidence[key]` | Reduces influence of sparse recovery evidence. | Optional; neutral when unavailable. |

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

1. keep every CDC-SU inherited baseline field and every enabled extension available in the neutral contract;
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
20. Rebuilt content features as inherited service features plus content-specific additions.
21. Reorganized both feature contracts so CDC-SU Slides 66–70 form the authoritative baseline and every simulator-proposed feature is separately labeled, enabled, and justified.

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
