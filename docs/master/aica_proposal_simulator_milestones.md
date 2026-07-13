# AICA Service And Content Proposal Simulator — Milestone Design Draft v1

**Document status:** Implementation milestone design  
**Source specification:** `docs/master/aica_proposal_simulator_specification.md`  
**Detailed design record:** `docs/master/aica_proposal_design_reference_draft.md`  
**Schedule style:** Capability milestones; no calendar estimates  
**Delivery strategy:** Contract-first, music vertical slice first, all-service ranking breadth second

---

## 1. Milestone Strategy

The proposal phase should be implemented inside the current application without coupling it to the current trigger run state.

Each milestone must leave a reviewable capability and preserve these boundaries:

```text
simulation world
≠ algorithm packages
≠ journey/playback engine
≠ reviewer evidence
```

The proposed sequence is:

```text
P0  — Scope and feature-contract freeze
P1  — Proposal screen and standalone run foundation
P2  — Synthetic world, catalogs, and contrast seeds
P3  — Eligibility and discrete journey engine
P4  — Transparent service-selector package
P5  — Transparent music content-selector package
P6  — End-to-end pre-rest/rest/post-rest vertical slice
P7  — Constrained LLM service-selector package
P8  — Constrained LLM content-selector package
P9  — Comparison, evidence, and customer review completeness
P10 — All-service breadth and stabilization
Post-V1 — Trigger-tick composition and real-data research
```

P0 is represented by the current specification set. Implementation starts at P1 only after review approval.

---

## 2. P0 — Scope And Feature-Contract Freeze

### Goal

Turn the design discussion into an agreed implementation baseline.

### Deliverables

- Approve the consolidated specification.
- Approve service and content feature inventories.
- Confirm two independent feature contracts: one complete service-proposal table and one complete concrete-content table, with identical columns and category order.
- Approve the feature/non-feature/constraint boundaries.
- Approve the four-value `trigger_purpose` contract, lifecycle stages, and Slides 64–65 service-constraint matrix.
- Approve the four independent package families.
- Record source-slide discrepancies for service applicability.
- Agree on naming and versioning rules.

### Acceptance criteria

- Product, algorithm, and simulator reviewers can identify every V1 input and its owner.
- No unexplained composite field such as `service_preferences` or `upro_information` remains.
- `trigger_purpose` and `lifecycle_stage` are documented as required control inputs, not ranking features.
- The documents explicitly prohibit package score/ranking sharing.
- Open numerical values are identified as tunable hypotheses, not missing hidden requirements.

### Output

- `aica_proposal_design_reference_draft.md`
- `aica_proposal_simulator_specification.md`
- `aica_proposal_simulator_milestones.md`
- `aica_proposal_overview_en_ja.html`

---

## 3. P1 — Proposal Screen And Standalone Run Foundation

### Goal

Create a separate proposal-simulation workflow inside the current application and backend.

### Scope

- Add a Proposal Simulator navigation entry and screen.
- Add an independent proposal setup store/context.
- Add a proposal run type and persistence namespace.
- Define versioned neutral contracts:
  - proposal opportunity;
  - trigger-purpose and lifecycle-stage enums;
  - purpose/stage allowed-service matrix;
  - service-selector input/output;
  - content-selector input/output;
  - discrete event;
  - journey state;
  - algorithm evidence.
- Add package-family registration and compatibility validation.
- Add placeholder/mock selector adapters returning fixed valid candidates.
- Add setup/run/review route skeletons.
- Keep trigger simulation behavior unchanged.

### Acceptance criteria

- The customer can open the proposal screen without creating a trigger run.
- Editing proposal setup does not modify the trigger setup.
- A standalone proposal run can be created, persisted, reopened, and deleted according to existing application policy.
- The backend can validate a mock service package and mock content package independently.
- A mock proposal opportunity can flow through both selector boundaries.
- The opportunity carries one valid trigger purpose, a compatible lifecycle stage, and resolved allowed-service IDs.
- Contracts contain no UI-specific state and no dependency on trigger tick objects.

### Verification focus

- Contract schema tests.
- Package compatibility tests.
- Persistence round-trip tests.
- Regression tests for current trigger screens/runs.

---

## 4. P2 — Synthetic World, Catalogs, And Contrast Seeds

### Goal

Give customers a complete editable world that can drive every approved feature without external data.

### Scope

- Implement editable `trigger_purpose`, starting `lifecycle_stage`, and service-constraint matrix version as control inputs outside the feature groups.
- Implement editable feature groups:
  - driver state;
  - driving environment;
  - passengers;
  - route features;
  - current proposal session;
  - personal service-use preference;
  - service proposal performance and confidence;
  - schedule;
  - UPro setup;
  - detailed oshi setup;
  - content-use preference and recency;
  - playback/user-operation history;
  - content proposal performance and confidence.
- Implement built-in editable service catalog.
- Implement built-in editable synthetic media and oshi catalogs.
- Implement parameters/hyperparameters as separate setup panels.
- Add complete base seeds.
- Add clone-and-change contrast seeds.
- Add validation for enums, ranges, IDs, references, and histories.
- Record seed and catalog versions.
- Record per-field provenance and source references in the setup snapshot.

### Recommended initial complete seeds

1. **Night highway, rest nearby, oshi on** — exercises safety, humming on the way, nap, and post-rest full karaoke.
2. **Ordinary daytime route, low risk** — tests non-safety preference and novelty without a strong rest context.
3. **Characteristic route and event destination** — tests route/destination relevance.
4. **Multiple passengers with child present** — tests passenger-friendly service ordering without child-state inference.
5. **Upcoming synthetic live/oshi event** — tests schedule effects.

Each seed must initialize all fields, even those irrelevant to the seed’s title.

### Required contrast clones

- Same world: `motion_state=driving` vs `stopped`.
- Same world: high vs low drowsiness.
- Same world: 8 vs 45 minutes to rest spot.
- Same world: oshi mode on vs off.
- Same world: upcoming event vs none.
- Same world: recent skip/rejection vs none.
- Same observed acceptance rate: high vs low confidence.

### Acceptance criteria

- Every approved feature is editable from the proposal setup.
- Non-features are displayed separately.
- No customer catalog import exists.
- Invalid catalog/history references are rejected with useful messages.
- A cloned setup shows exactly which fields differ.
- Reloading the same seed restores the same complete world.

### Verification focus

- Seed snapshot/golden tests.
- Catalog referential-integrity tests.
- Editor validation tests.
- Clone/diff determinism tests.

---

## 5. P3 — Eligibility And Discrete Journey Engine

### Goal

Implement deterministic motion/service constraints and lifecycle transitions before adding real ranking logic.

### Scope

- Implement the default Slides 64–65 purpose/stage allowed-service matrix.
- Resolve `allowed_service_ids` before motion/readiness eligibility.
- Implement platform hard-eligibility validator.
- Encode driving/stopped and screen-dependence rules.
- Encode synthetic availability/readiness and schedule availability.
- Encode lighting compatibility from Slides 39–40.
- Implement journey runtime states and discrete events.
- Implement current/previous content tracking.
- Implement acceptance, rejection, postpone, request-more, stop, and continue actions.
- Implement completion and return-to-previous-content policy.
- Implement movement transition behavior for stopped content.
- Implement non-binding journey preview separate from committed action.

### Acceptance criteria

- Full screen karaoke and stopped video cannot be activated as driving experiences.
- Lighting can be attached only to compatible services.
- Eligibility explanations are produced without assigning utility scores.
- A mocked accepted plan can advance through start, completion, continuation, and restoration.
- A motion change applies background/stop behavior deterministically.
- Trigger purpose and journey stage are passed as required control inputs and are never converted into preference/utility feature scores.
- A package cannot return a service outside the frozen purpose/stage row.
- User rejection does not dead-end the run when another eligible candidate exists.

### Verification focus

- State-transition table tests.
- Eligibility matrix tests.
- Motion-change tests.
- Completion/restoration tests.
- Advisory user-action tests.

---

## 6. P4 — Transparent Service-Selector Package

### Goal

Rank all service candidates using a fully inspectable expert scorecard.

### Scope

- Create the first transparent service-selector package.
- Validate `trigger_purpose`, `lifecycle_stage`, and the frozen allowed-service set before scoring.
- Implement documented feature normalization.
- Implement safety bands and dominant priority behavior.
- Implement category-level utility contributions.
- Implement service-use preference factors.
- Implement separate acceptance/recovery performance factors.
- Implement confidence shrinkage.
- Implement schedule relevance as service-table rows labeled `Additional proposed`, distinct from CDC-SU source rows.
- Implement recent rejection and weak novelty policies.
- Return up to three ranked services.
- Add editable package parameters/hyperparameters.
- Add factor-level evidence.

### Required explainability

For each candidate show:

- eligibility;
- safety band;
- raw feature value;
- normalized factor;
- coefficient;
- signed/capped contribution;
- total score;
- rank;
- opposing evidence;
- used/unused/missing feature list.

### Acceptance criteria

- The package receives the explicit trigger purpose and lifecycle stage and returns candidates only from `allowed_service_ids`.
- The package contract consumes its independent Section 8 table and distinguishes CDC-SU rows from enabled `Additional proposed` rows by provenance.
- The package marks every available feature used or unused.
- P2–P4 factors cannot move a candidate above a materially higher default safety band.
- Acceptance and recovery are separate from service-use preference.
- Low-confidence rates have less effect than identical high-confidence rates.
- Identical snapshots produce identical results.
- The customer can modify weights/mappings and see the changed explanation.

### Verification focus

- Per-factor unit tests.
- Safety-dominance property tests.
- Confidence-shrinkage tests.
- Contrast-seed golden rankings.
- Deterministic replay tests.

---

## 7. P5 — Transparent Music Content-Selector Package

### Goal

Generate and rank concrete plans for playlist, humming karaoke, and full stopped karaoke.

### Scope

- Create versioned service recipes and applicability matrices.
- Validate that the selected service is permitted for the explicit trigger purpose and lifecycle stage.
- Explicitly record Slide 70 vs detailed-slide differences.
- Generate bounded candidate plans from the built-in catalog.
- Implement content factor mappings for:
  - the complete Situation rows stated directly in the content contract;
  - UPro fields;
  - detailed oshi setup;
  - content-use preference and recency;
  - playback and user-operation history;
  - concrete acceptance/recovery and confidence;
  - schedule.
- Implement plan duration and journey feasibility.
- Implement repetition/skip/rejection policies.
- Implement playlist item ordering.
- Implement humming mode fields: chorus-only, guide vocal, no driving lyrics.
- Implement full karaoke stopped-only fields and simulated queue.
- Implement compatible lighting plan fields.
- Return up to three concrete plans.

### Acceptance criteria

- The package receives the complete independent Section 9 table and does not depend on the Section 8 contract; CDC-SU and `Additional proposed` provenance remain visible per row.
- Every recipe marks every field used or `available_but_not_used`.
- No plan references a nonexistent/disabled catalog item.
- CDC-SU skips/cancellations and any enabled granular-history extensions visibly affect their own factors, not an opaque preference scalar.
- Oshi mode off prevents oshi personalization without deleting the synthetic oshi profile.
- Humming driving plans contain no lyrics-screen requirement.
- Full karaoke active-screen plans require stopped motion.
- Lighting is present only for compatible services and is independently editable.
- Identical snapshots produce identical plans and evidence.

### Verification focus

- Recipe applicability tests.
- Catalog grounding tests.
- Playlist composition/order tests.
- Motion/mode tests.
- Oshi and schedule contrast tests.
- History and confidence contrast tests.

---

## 8. P6 — End-To-End Pre-Rest/Rest/Post-Rest Vertical Slice

### Goal

Demonstrate the central use case as multiple recomputed advisory decisions.

### Reference journey

```text
high drowsiness/fatigue while driving with `trigger_purpose=rest_recommended`
→ orchestrator activates rest guidance/journey
→ humming karaoke is selected for travel to rest spot
→ arrive and stop
→ select nap/rest method and duration
→ explicit rest-completed event applies post-rest feature values
→ recompute stopped service proposal
→ select full karaoke concrete song and lighting
→ content completes or driver returns to driving
→ enforce motion policy and restore previous content
```

### Scope

- Integrate transparent service and content selectors with the journey engine.
- Show the explicit trigger purpose, lifecycle stage, and currently allowed service set.
- Show current committed action and future preview separately.
- Add interactive mode.
- Add quick top-ranked mode.
- Allow context edits followed by explicit recompute.
- Add rejection/alternate candidate flow.
- Add event timeline and lifecycle display.

### Acceptance criteria

- The whole reference journey can be completed from one built-in seed.
- Each transition creates a new frozen snapshot when recomputation is required.
- Changing post-rest drowsiness/fatigue can change the next proposal.
- Previewed future content is not automatically committed.
- The driver/customer can reject every proposal and still progress/exit safely.
- Quick mode selects the same rank-1 result shown in interactive evidence.
- No probabilistic acceptance or recovery is generated.

### Verification focus

- End-to-end browser/API test.
- Event order and persisted state tests.
- Snapshot-boundary tests.
- Reject-all and motion-transition tests.

---

## 9. P7 — Constrained LLM Service-Selector Package

### Goal

Add an independent LLM approach for service ranking using the common contract.

### Scope

- Define strict request and response schemas.
- Define package-local prompt/policy.
- Supply the explicit trigger purpose, lifecycle stage, and only the stage-allowed eligible services.
- Supply only approved feature fields and eligible catalog services.
- Require feature-ID citations and concise rationale.
- Validate candidate IDs and hard exclusions.
- Add no-proposal, retry, timeout, and failure behavior.
- Persist model/prompt/configuration/request/response provenance.
- Add a deterministic recorded-response fixture mode for tests and demos.

### Acceptance criteria

- The package never reads the transparent package’s scores/ranks.
- The package cannot return a service outside the frozen purpose/stage constraint row.
- Output validates against the same neutral service-selector result schema.
- Invented service IDs or features are rejected.
- Hard exclusions cannot be reversed.
- Missing data and uncertainty are visible.
- Recorded fixture replay is stable.
- A live-model failure does not corrupt the simulation world.

### Verification focus

- Schema/grounding adversarial tests.
- Prompt fixture tests.
- Retry/fallback tests.
- Provenance persistence tests.
- Package-independence tests.

---

## 10. P8 — Constrained LLM Content-Selector Package

### Goal

Add an independent, catalog-grounded LLM approach for concrete music plans.

### Scope

- Supply trigger purpose, lifecycle stage, selected stage-allowed service, approved features, recipe, and eligible synthetic catalog subset.
- Require catalog IDs for every plan item.
- Require duration/mode/lighting/end-policy fields.
- Validate humming/full-karaoke motion policy.
- Require used/unused and supporting/opposing feature citations.
- Add recorded-response demo fixtures for major contrast seeds.
- Persist full provenance and validation results.

### Acceptance criteria

- No song, artist, oshi, event, or route fact can be invented outside the request.
- All returned modes are valid for the selected service and motion state.
- The package does not consume transparent content scores/ranks.
- Output uses the common content-selector result contract.
- Validation errors are visible and do not silently become valid plans.
- The same journey engine can execute validated transparent and LLM plans.

### Verification focus

- Catalog grounding/adversarial tests.
- Motion and service-policy tests.
- Structured-output retry tests.
- Recorded fixture replay tests.

---

## 11. P9 — Comparison, Evidence, And Customer Review Completeness

### Goal

Make differences between data, parameters, and algorithms easy for customers to understand and evaluate.

### Scope

- Add clone-and-compare workflow.
- Add side-by-side transparent vs LLM runs from a frozen setup.
- Add field-level setup diff.
- Add eligibility, rank, score/reason, and journey delta views.
- Add immutable decision snapshots.
- Add evidence export.
- Add structured human feedback:
  - understandable;
  - appropriate/inappropriate;
  - safety impression;
  - useful/not useful;
  - intrusive/not intrusive;
  - free comments.
- Keep human review separate from simulator and algorithm facts.

### Acceptance criteria

- Customers can tell exactly which input or configuration changed.
- The app never labels one algorithm correct automatically.
- Transparent and LLM evidence use method-appropriate explanations in a comparable frame.
- Excluded, unused, and missing fields are visible.
- Export is sufficient to reproduce a transparent decision and replay a recorded LLM decision.
- Feedback does not mutate an algorithm package during the run.

### Verification focus

- Comparison correctness tests.
- Evidence schema and export tests.
- Language/label consistency tests.
- Human-feedback separation tests.

---

## 12. P10 — All-Service Breadth And Stabilization

### Goal

Complete service-selector breadth and provide review-level content plans for the remaining source services.

### Scope

- Validate ranking support for:
  - call-and-response practice;
  - quiz;
  - ranking creation;
  - radio-style playback;
  - conversation;
  - live viewing;
  - stretch video;
  - oshi reexperience;
  - multisensory relaxation;
  - connected video recommendation;
  - rest-support journey and rest proposal types.
- Add lower-fidelity editable plan templates for these services.
- Complete source traceability and recipe documentation.
- Accessibility, bilingual labels where required, responsive layout, and error states.
- Performance and run-data size review.
- Regression and migration checks for current trigger simulation.
- Customer pilot checklist and known-limitations display.

### Acceptance criteria

- Every Slide 38–40 service and every additional Slide-26 service can be returned, excluded, selected, and executed at an explicitly documented review fidelity.
- Music playlist, humming, and full karaoke retain detailed content generation.
- Lighting matrix is complete and correct.
- No service bypasses motion eligibility.
- Source applicability choices are visible by recipe version.
- Existing trigger simulator remains operational.
- All V1 specification acceptance criteria pass.

---

## 13. Post-V1 — Trigger-Tick Composition

### Goal

Connect the proposal simulator to the current trigger simulation without changing selector contracts.

### Scope

- Implement `TriggerTickState → ProposalOpportunity` adapter.
- Carry the trigger algorithm’s selected `trigger_purpose` into the proposal opportunity and map journey progression to `lifecycle_stage`.
- Map current trigger signals/features to approved proposal features.
- Define what happens when proposal-required data is unavailable.
- Emit proposal opportunity only when trigger fire control authorizes it.
- Add tick-driven cooldown/reproposal orchestration.
- Share route/motion time progression while preserving separate package runtime states.
- Support a combined run evidence timeline.
- Retain standalone proposal-screen mode.

### Acceptance criteria

- Existing standalone snapshots still run unchanged.
- Selector packages cannot tell whether input came from standalone or tick simulation.
- Trigger algorithm and proposal algorithms share no scores or internal state.
- Combined evidence distinguishes trigger decision, service decision, content decision, and journey effect.
- Proposal context missing from the trigger world is surfaced, not invented.

---

## 14. Post-V1 Research Tracks

These are not prerequisites for the simulation V1:

- Real data-source availability and privacy analysis.
- Empirical weight/threshold calibration.
- User study design for acceptance and intrusiveness.
- Safety review and regulatory analysis.
- Recovery-effect measurement methodology.
- Customer media-catalog import policy.
- Learning/update pipeline from reviewed evidence.
- Production LLM reliability, cost, latency, and governance.

None should be represented as solved by synthetic simulation.

---

## 15. Cross-Milestone Quality Gates

Every milestone after P1 must satisfy:

1. **Boundary gate:** world, selectors, eligibility, journey, and evidence remain separated.
2. **Feature gate:** no unapproved/unavailable feature enters ranking.
3. **Safety gate:** hard constraints precede ranking; safety remains dominant and advisory.
4. **Determinism gate:** transparent identical-input replay remains exact.
5. **Grounding gate:** all selected records exist in the frozen synthetic catalog.
6. **Evidence gate:** every decision records inputs, configuration, output, and user action.
7. **Regression gate:** the current trigger simulator continues to pass its relevant tests.
8. **Human-judgment gate:** simulator results never become automatic correctness claims.

---

## 16. Suggested Release Boundaries

| Release | Included milestones | Review value |
|---|---|---|
| Internal contract preview | P1–P3 | Validate architecture, editable data, constraints, and journey states. |
| Transparent music vertical slice | P4–P6 | Customer can evaluate the full central proposal idea and tune explicit scores. |
| Algorithm comparison beta | P7–P9 | Customer can compare transparent and LLM approaches using identical synthetic worlds. |
| Proposal Simulator V1 | P10 | All services represented; music content detailed; evidence and UX stabilized. |
| Combined Simulator | Post-V1 composition | Trigger timing and proposal selection operate in one run through an adapter. |

The transparent music vertical slice is the first meaningful customer demonstration. It should not wait for the LLM packages, because it establishes the contracts, features, catalogs, journey behavior, and evidence that the LLM approach must also respect.

---

## Appendix A — Feature Implementation Checklist

This checklist prevents milestone implementation from shortening a category into an ambiguous aggregate field. P2 must make every item editable; P4/P5 must consume or explicitly mark it unused; P9 must show it in evidence.

### A.0 Required control inputs and default flow matrix

- `trigger_purpose`: `rest_recommended`, `inattentive_driving_prevention_recovery`, `route_music`, or `child_passenger_experience`.
- `lifecycle_stage`: `before_rest_until_stop`, `during_rest_stopped`, `after_rest_before_restart`, or `active_driving_content`.
- `allowed_service_ids`: resolved from the frozen Slides 64–65 matrix before motion/readiness filtering and ranking.

| Trigger purpose | Lifecycle stage | Default allowed proposal types |
|---|---|---|
| `rest_recommended` | `before_rest_until_stop` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `rest_recommended` | `during_rest_stopped` | `rest_duration_suggestion`, `rest_method_suggestion`, `seat_adjustment`, `nap_guidance`, `rest_extension_check` |
| `rest_recommended` | `after_rest_before_restart` | `live_viewing`, `stretch_video`, `full_karaoke`, `oshi_reexperience` |
| `inattentive_driving_prevention_recovery` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `route_music` | `active_driving_content` | Same Slide-65 driving-content set |
| `child_passenger_experience` | `active_driving_content` | Same Slide-65 driving-content set |

### A.1 Service-proposal independent feature contract

P2 must expose every row below in the service editor and request. P4 must consume it or mark it `available_but_not_used`; P9 must display it in evidence. The category order and provenance must remain unchanged.

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

### A.2 Concrete-content independent feature contract

P2 must expose every row below in the content editor and request. P5 must consume it or mark it `available_but_not_used`; P9 must display it in evidence. This contract is complete by itself and must not be assembled from the service contract.

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

### A.3 Boundary checklist

- `trigger_purpose` remains an explicit required routing/control input from the trigger side.
- `lifecycle_stage` remains an explicit required journey/runtime input.
- Purpose/stage service constraints are resolved before feature-based ranking.
- Service capability and content readiness remain constraint/catalog metadata.
- Catalog records and algorithm parameters/hyperparameters remain non-feature inputs.
- Each feature row carries provenance: `cdc_su_baseline`, `normalized_cdc_su_concept`, or `proposed_addition`.
- The service and content package requests are independently valid and independently reviewable.
- UI state never enters an algorithm request.
- `child_state` is not introduced; the explicit `trigger_purpose` field is required.
