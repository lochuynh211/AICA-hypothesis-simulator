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
- Confirm the inheritance rule: CDC-SU service baseline + enabled service extensions + CDC-SU content baseline + enabled content extensions.
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
- Implement schedule relevance as an optional service-layer extension, clearly separated from the CDC-SU service baseline.
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
- The package contract distinguishes the mandatory CDC-SU service baseline from separately enabled service extensions.
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
  - inherited service context;
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

- The package receives the CDC-SU service baseline, enabled service extensions, CDC-SU content baseline, and enabled content extensions as separate provenance groups.
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

### A.1 CDC-SU baseline service features — Slides 66–67

- Driver state: `drowsiness_level`, `fatigue_level`.
- Driving environment: `traffic_state`, `road_type` (source-aligned `highway`, with additional normalized enum values), `night_state`, `monotony_level`.
- Route/destination: `route_tags`, `destination_tags`.
- Passenger composition: `child_present`, `multiple_passengers`.
- Oshi preference: `oshi_registered`, `oshi_mode`.
- Unused/usage preference: `service_recency_state[service]`, `service_usage_level[service]`, `scene_service_usage_level[scene][service]`.
- Past performance: `service_proposal_acceptance_rate[service]`, `service_recovery_rate[service]`.

### A.2 Proposed additional service features

- Motion safety: `motion_state`.
- Rest-route feasibility: `estimated_min_until_rest_spot`, `rest_spot_type`.
- Current proposal session: `active_service`, `recent_service_rejections`.
- Evidence reliability: `service_proposal_acceptance_confidence[service]`, `service_recovery_confidence[service]`.
- Optional promotion of CDC-SU content schedule into service selection: `scheduled_event_type`, `scheduled_event_timing`, `scheduled_event_tags`.

### A.3 CDC-SU content-specific baseline — Slides 68–70

Content selection inherits A.1 and any enabled A.2 fields, then adds:

- Driving/stopped state: `motion_state`.
- UPro setup: `age_band`, `gender`, `hobby_interest_tags`.
- Unused/usage preference: `catalog_item_recency_state[item]`, `content_tag_recency_state[tag]`, `content_tag_usage_level[tag]`, `catalog_item_usage_level[item]`, `scene_content_tag_usage_level[scene][tag]`.
- Playback/user operations: `played_items`, `skipped_items`, `cancelled_content_plans`, `changed_from_items`.
- Schedule: `scheduled_event_type`, `scheduled_event_timing`, `scheduled_event_tags`.
- Past performance: `content_proposal_acceptance_rate[key]`, `content_recovery_rate[key]`.

`motion_state` and schedule fields are stored once. Their use in service selection is an extension; their use in concrete-content selection is CDC-SU baseline behavior.

### A.4 Proposed additional concrete-content features

- Detailed oshi identity: `oshi_id`, `oshi_type`, `oshi_tags`.
- Granular operation history: `completed_items`, `manually_selected_items`, `repeated_items`.
- Evidence reliability: `content_proposal_acceptance_confidence[key]`, `content_recovery_confidence[key]`.

### A.5 Boundary checklist

- `trigger_purpose` remains an explicit required routing/control input from the trigger side.
- `lifecycle_stage` remains an explicit required journey/runtime input.
- Purpose/stage service constraints are resolved before feature-based ranking.
- Service capability and content readiness remain constraint/catalog metadata.
- Catalog records and algorithm parameters/hyperparameters remain non-feature inputs.
- Each feature definition carries provenance: `cdc_su_baseline`, `normalized_cdc_su_concept`, or `proposed_addition`.
- UI state never enters an algorithm request.
- `child_state` is not introduced; the explicit `trigger_purpose` field is required.
