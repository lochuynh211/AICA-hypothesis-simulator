# AICA Hypothesis Simulator Runtime Workflow

**Document type:** Master runtime workflow design
**Status:** Draft v1
**Related documents:**

- `docs/master/aica_hypothesis_simulator_specification.md`
- `docs/master/aica_hypothesis_simulator_architecture.md`
- `docs/master/aica_hypothesis_simulator_milestones.md`
- `others/aica_transparent_hybrid_trigger_algorithm_proposal.md`
- `others/aica_trigger_condition_skeleton.png`

---

## 1. Purpose

This document defines how the AICA Hypothesis Simulator should work during setup, generated-plan creation, simulation playback, trigger evaluation, interaction pauses, replay, and evidence export.

The chosen runtime model is:

```text
Setup presets + route analysis
→ generated frozen event plan
→ deterministic tick engine
→ trigger algorithm evaluation
→ interaction pause when needed
→ append-only evidence log
→ replay or export
```

The simulator should not pre-generate every tick. It should generate concrete scenario events before start, then calculate state on each tick from the frozen event plan, selected profiles, current route position, and user actions.

---

## 2. Runtime Design Choice

### 2.1 Rejected Alternative: Fully Pre-Generated Tick Timeline

In this model, the simulator would generate every tick before playback.

This is not recommended for V1 because user actions such as accepting rest guidance, choosing a later rest spot, or accepting wakefulness content can change future driver and route state. A fully pre-generated tick timeline would need to be recalculated after those actions.

### 2.2 Chosen Model: Generated Event Plan + Deterministic Tick Engine

The simulator should generate only concrete scenario events before start:

- traffic jam timing and location;
- dynamic weather timing when enabled;
- rest opportunity timeline;
- route progress checkpoints;
- other scenario backbone events.

During playback, the simulator calculates current state on each tick. The result remains deterministic because the generated event plan is frozen after start.

### 2.3 Rejected Alternative: Fully Dynamic Simulation

In this model, traffic jams, weather changes, and other events could appear dynamically at any tick.

This is not recommended for V1 because it makes evidence replay and algorithm review harder. Reviewers need to know whether a changed trigger result came from the algorithm, user action, or newly generated simulation events.

---

## 3. Setup Model

The setup model has separate layers so test users can understand which values are directly chosen, which values are derived, and which values are generated.

### 3.1 Trigger Package

The selected AICA algorithm package.

Examples:

- rule-based rest proposal package;
- weighted-score rest proposal package;
- `aica_transparent_hybrid_trigger_v1` Python package.

### 3.2 Scenario Backbone

The scenario backbone defines the review situation and default assumptions.

It includes:

- use case;
- review focus;
- default route intent;
- allowed user actions;
- default driver model profile;
- default vehicle behavior profile;
- default initial state;
- default generated-event settings.

The scenario backbone should not hard-code every tick.

### 3.3 Route Setup

The test user selects:

- start location;
- end destination;
- one candidate route from Google Maps or a local route fixture.

The test user may choose among multiple route options, but route style should be recognized by the simulator rather than manually declared as fiction.

### 3.4 Route-Derived Facts

After route selection, the simulator derives route facts.

Examples:

- total route distance;
- estimated route duration;
- route segments;
- segment type:
  - `highway`;
  - `normal_road`;
  - `mountain_road`;
  - `sightseeing_road`;
- rest spot positions;
- toll road usage when available;
- traffic-aware duration when available;
- route progress checkpoints.

Google Maps may not provide a direct `mountain_road` or `sightseeing_road` label. The simulator should derive those classifications from available route data, local route fixtures, and simulator classification rules. V1 can prioritize `highway` and `normal_road`, with `mountain_road` and `sightseeing_road` supported through fixtures or route tags when automatic classification is insufficient.

### 3.5 User-Controlled Presets

Presets express experiment intent. They are deterministic inputs chosen before simulation.

Examples:

- initial driver state;
- initial vehicle state;
- driver model profile;
- vehicle behavior profile;
- numeric speed profile by road style;
- traffic jam enabled/disabled;
- traffic jam severity;
- weather preset;
- simulation tick seconds;
- trigger hyperparameters;
- run mode.

### 3.6 Numeric Speed Profile

Speed should be numeric so each tick can be calculated exactly.

Example:

```yaml
speed_profile:
  normal_road_kph: 45
  sightseeing_road_kph: 35
  mountain_road_kph: 30
  highway_kph: 90
  traffic_jam_kph: 15
```

The route segment type is derived from the route. The speed profile defines how the simulated driver behaves on that route type.

### 3.7 Generated Event Plan

The generated event plan turns route facts and presets into concrete events before simulation starts.

Example:

```yaml
generated_event_plan:
  tick_seconds: 30
  traffic_events:
    - id: traffic_jam_001
      start_min: 42
      duration_min: 18
      affected_segment_id: highway_segment_3
      speed_kph: 15
  weather_events: []
  rest_opportunities:
    - id: rest_spot_a
      route_position_km: 28.4
    - id: rest_spot_b
      route_position_km: 51.2
```

Before start, the test user may:

- review the generated event summary;
- regenerate events;
- edit allowed advanced generated-event details;
- go back to setup.

After start, the generated event plan is frozen.

---

## 4. Deterministic Tick Loop

The simulator calculates state on each tick.

Core loop:

```text
while destination_not_reached:
  1. Advance simulation clock by tick_seconds.
  2. Determine current route segment from route position.
  3. Determine active generated events at this simulation time.
  4. Calculate effective speed.
  5. Advance route position.
  6. Update route and rest state.
  7. Update driver state from driver model profile.
  8. Update vehicle state from vehicle behavior profile.
  9. Update rolling vehicle event counts.
  10. Build skeleton-aligned feature groups.
  11. Build trigger algorithm context.
  12. Call trigger package.
  13. Append tick and decision trace to run log.
  14. Pause if proposal or required interaction exists.
```

### 4.1 Speed Calculation

V1 should use a simple traffic override rule:

```text
if traffic_jam_active:
    effective_speed_kph = speed_profile.traffic_jam_kph
else:
    effective_speed_kph = speed_profile[current_segment_type]
```

Distance advanced:

```text
distance_advanced_km =
  effective_speed_kph * tick_seconds / 3600
```

Example:

```text
tick_seconds = 30
current_segment_type = highway
effective_speed_kph = 90
distance_advanced_km = 0.75
```

### 4.2 Route State Update

Each tick updates:

- current route position;
- distance to destination;
- estimated time to destination;
- current segment type;
- next rest spot distance;
- next rest spot time;
- rest spot passed/reachable state;
- traffic jam active state;
- low-speed duration.

### 4.3 Driver State Update

Driver progression should be controlled by a separate driver model profile.

Example profile shape:

```yaml
driver_model_profile:
  id: fatigue_sensitive_driver
  drowsiness_model:
    base_growth_per_min: 0.08
    night_add_per_min: 0.04
    monotony_add_per_min: 0.03
    traffic_jam_add_per_min: 0.02
  fatigue_model:
    base_growth_per_min: 0.06
    continuous_driving_add_per_min_after_60_min: 0.04
    mountain_road_add_per_min: 0.04
    traffic_jam_add_per_min: 0.03
  attention_model:
    base_recovery_per_min: 0.01
    monotony_drop_per_min: 0.05
    drowsiness_drop_factor: 0.2
    active_content_recovery_per_min: 0.04
  recovery_model:
    short_rest_drowsiness_recovery: 20
    short_rest_fatigue_recovery: 15
    long_rest_drowsiness_recovery: 35
    long_rest_fatigue_recovery: 30
```

Driver state changes should be traceable by component:

```yaml
driver_update:
  previous_drowsiness: 42.0
  delta:
    base: 0.04
    night: 0.02
    highway_monotony: 0.01
  next_drowsiness: 42.07
```

### 4.4 Vehicle State Update

Vehicle behavior should be controlled by a separate vehicle behavior profile.

The simulator does not need real vehicle physics. It needs deterministic, believable vehicle signals for trigger review.

Example profile shape:

```yaml
vehicle_behavior_profile:
  rolling_window_seconds: 300
  steering_instability:
    base_level: 5
    drowsiness_factor: 0.25
    fatigue_factor: 0.15
    mountain_road_add: 8
    traffic_jam_reduce: 4
  lane_departure:
    enabled_on:
      - highway
      - normal_road
    drowsiness_threshold: 65
    fatigue_threshold: 70
    count_when_threshold_exceeded: 1
  pedal_abnormality:
    base_level: 3
    fatigue_factor: 0.12
    traffic_jam_add: 10
    mountain_road_add: 5
  adas_warning:
    lane_departure_warning_threshold: 1
    steering_instability_warning_threshold: 55
```

Continuous values:

- `steeringInstabilityLevel`;
- `pedalAbnormalityLevel`.

Rolling-window counts:

- `laneDepartureCount`;
- `adasWarningCount`.

Default rolling window:

```yaml
rolling_window_seconds: 300
```

Each tick:

```text
1. Calculate steering and pedal levels.
2. Generate lane departure or ADAS warning events when thresholds are crossed.
3. Append events to vehicle event history.
4. Drop events older than rolling_window_seconds.
5. Count recent events for algorithm input.
```

---

## 5. Skeleton-Aligned State And Features

The simulator should align its state and feature groups with `others/aica_trigger_condition_skeleton.png`.

The skeleton describes this flow:

```text
monitoring data
→ feature collection and accumulation
→ tuning data
→ feature accumulation and monitoring
→ trigger detection
→ fire control
→ proposal firing
```

### 5.1 Raw Simulation State

The simulator should maintain raw state that can feed the trigger skeleton.

```yaml
simulation_state:
  trip:
    elapsed_drive_time_min: number
    distance_driven_km: number
    distance_to_destination_km: number
  driver:
    drowsinessLevel: number
    fatigueLevel: number
    attentionLevel: number
    responseDelayMs: number
    voiceEnergyLevel: number
  route:
    current_segment_type: string
    nextRestSpotDistanceKm: number
    nextRestSpotMin: number
    highwayRemainingMin: number
    trafficJamAheadMin: number
    monotonousRoadRemainingMin: number
    familiarRouteRatio: number
    recommendedNearbyPlaceAvailable: boolean
    routeUnusualnessLevel: number
  vehicle:
    speedKph: number
    steeringInstabilityLevel: number
    laneDepartureCount: number
    pedalAbnormalityLevel: number
    adasWarningCount: number
  context:
    isNight: boolean
    weatherRiskLevel: number
    traffic_jam_active: boolean
    lowSpeedDurationMin: number
  passenger:
    childOnboard: boolean
  proposalHistory:
    lastProposalTimeSec: number
    lastProposalCategory: string
    lastProposalResult: string
    proposalCountLast30Min: number
    acceptanceRateRecent: number
```

### 5.2 Feature Groups

The simulator should build shared feature groups before calling the trigger package.

```yaml
feature_groups:
  driving_achievement:
    elapsed_drive_time_score: number
    distance_driven_score: number
  current_driver_state:
    drowsiness_score: number
    fatigue_score: number
    attention_drop_score: number
  future_fatigue_factor:
    traffic_jam_score: number
    long_highway_score: number
    weather_risk_score: number
  recovery_possibility:
    rest_window_score: number
    rest_scarcity_score: number
  unstimulated_state:
    monotony_score: number
    familiar_route_score: number
    low_speed_repetition_score: number
  route_information_level:
    characteristic_route_score: number
    recommended_place_score: number
    route_unusualness_score: number
  child_passenger:
    child_onboard: boolean
```

The simulator calculates raw state and shared skeleton-aligned feature groups. The trigger package may calculate package-specific scores from those features.

This keeps the simulator aligned with the AIP/AICA trigger skeleton without hard-coding one algorithm's internal formula into the simulator core.

---

## 6. Trigger Algorithm Evaluation

At each tick, the simulator builds an algorithm context:

```yaml
algorithm_context:
  simulation_time_sec: number
  raw_state: object
  feature_groups: object
  parameters: object
  hyperparameters: object
  proposal_history: object
  user_action_history: object
  package_runtime_state: object
```

The trigger package returns a normalized decision result:

- result type;
- features or feature references;
- scores;
- state labels;
- candidates;
- fire-control result;
- selected candidate;
- proposal when fired;
- explanation;
- next package runtime state.

Suppressed candidates are still recorded in the trace.

---

## 7. Interaction And Pause Rules

Simulation pauses when the test user needs to make a decision.

Pause cases:

- AICA proposal appears;
- rest spot arrival;
- rest option selection is required;
- content option selection is required;
- expert override edit is requested;
- blocking algorithm or simulation error occurs;
- destination is reached.

When paused:

- simulation time stops;
- route position does not advance;
- driver state does not change;
- vehicle state does not update;
- algorithm is not called repeatedly;
- wall-clock audit timestamps may continue.

After user action:

```text
1. Backend validates the action.
2. Backend appends user action event.
3. Backend applies declared action effects.
4. Backend persists run log.
5. Simulation resumes from the same simulation_time_sec.
```

### 7.1 Action Effects

Action effects should be declared and deterministic.

Examples:

```yaml
accept_rest_guidance:
  active_guidance: rest_guidance
  target_rest_spot_id: selected_rest_spot

choose_later_rest_spot:
  active_guidance: rest_guidance
  target_rest_spot_id: later_rest_spot

accept_humming_karaoke:
  active_content: humming_karaoke
  driver_model_effect: active_content_support

take_short_rest:
  drowsiness_recovery: configured_value
  fatigue_recovery: configured_value
```

### 7.2 Active Rest Guidance Fire-Control Rule

If rest guidance is already active, duplicate rest proposals should be suppressed.

If risk becomes urgent, the trigger package may fire an escalation proposal.

Suppression trace:

```yaml
fire_control:
  suppressed: true
  reason: rest_guidance_already_active
```

Escalation trace:

```yaml
fire_control:
  fired: true
  override: true
  reason: urgent_risk_during_active_rest_guidance
```

---

## 8. Replay, Regenerate, And New Simulation

### 8.1 Regenerate

Regenerate is allowed only before the run starts.

It means:

```text
same setup presets
→ generate a different concrete event plan
```

After start, the generated event plan is frozen.

### 8.2 Interactive Replay

Interactive replay uses the same deterministic conditions but collects fresh user actions.

It keeps:

- same trigger package;
- same package version;
- same route;
- same route-derived facts;
- same presets;
- same generated event plan;
- same initial state;
- same hyperparameters.

It does not auto-repeat previous user choices.

Interactive replay should create a new run log linked to the original:

```yaml
run_id: run_002
replay_of: run_001
generated_plan_id: plan_abc
```

### 8.3 Evidence Replay

Evidence replay uses an existing log file to play back exactly what happened.

It is read-only:

- same setup;
- same generated plan;
- same user actions;
- same expert overrides when any exist;
- same recorded algorithm outputs;
- same timing.

V1 evidence replay should not recalculate algorithm decisions. It should display the recorded log exactly.

Later versions may add verification replay, where the simulator reruns the algorithm and compares recalculated outputs with recorded outputs.

### 8.4 New Simulation

Any setup change creates a new simulation:

- different route;
- different package;
- different hyperparameters;
- different initial driver state;
- different speed profile;
- different driver profile;
- different vehicle profile;
- different generated plan.

---

## 9. Run Modes

### 9.1 Standard Simulation

Standard simulation is the default mode.

It is deterministic from:

- setup snapshot;
- selected route;
- route-derived facts;
- generated event plan;
- profiles;
- user actions.

It is the best mode for evidence and replay.

### 9.2 Expert Override Simulation

Expert override is selected globally before start:

```yaml
run_mode: expert_override
```

It allows manual state edits while paused.

Each edit requires:

- field edited;
- old value;
- new value;
- reason;
- simulation time;
- wall-clock time.

Example:

```yaml
expert_override_event:
  simulation_time_sec: 3600
  target: driver.drowsinessLevel
  previous_value: 72
  new_value: 50
  reason: "Assume humming karaoke helped more than default model"
```

Expert override runs are marked:

```yaml
evidence_status: non_standard
```

Expert override should not allow manual edits to algorithm-owned runtime internals such as smoothing state or persistence counters in V1.

---

## 10. Run Log Contents

The run log is the append-only evidence record.

It should include:

- run metadata;
- setup snapshot;
- route snapshot;
- route-derived facts;
- preset snapshot;
- generated event plan;
- tick events;
- route updates;
- driver updates;
- vehicle updates;
- feature groups;
- algorithm decision trace;
- proposal events;
- user action events;
- expert override events;
- feedback events;
- final summary;
- errors.

Destination reached:

```text
simulation pauses
final state is logged
test user can export JSON
optional Markdown summary can be added later
```

---

## 11. Error Handling

### 11.1 Route Analysis Error

If Google Maps cannot provide route data:

- show error;
- allow retry;
- allow local fixture route fallback;
- do not start simulation without route facts.

### 11.2 Generated Plan Error

If presets conflict with route facts, the simulator should either choose a valid fallback or block start with a clear error.

Example:

```text
traffic jam enabled, but no valid segment can receive traffic jam event
```

### 11.3 Tick Engine Error

If state calculation fails:

- pause simulation;
- append `simulation_error` event;
- show error in UI;
- do not silently continue.

### 11.4 Algorithm Error

If package evaluation fails:

- append `algorithm_error` event;
- show error in trace panel;
- pause simulation unless the error is configured as non-blocking.

### 11.5 Evidence Replay Error

If an old log references missing package files or route assets, evidence replay should still display the recorded log visually and show a warning that live verification is unavailable.

---

## 12. V1 Verification Expectations

V1 should verify:

- same setup plus same generated plan produces the same tick states;
- same evidence log produces the same visual evidence replay;
- traffic jam speed overrides route speed;
- numeric speed profile calculates route progress exactly;
- driver state changes deterministically from the driver model profile;
- vehicle continuous levels are deterministic;
- vehicle rolling-window counts work;
- simulation time stops during interaction pause;
- active rest guidance suppresses duplicate rest proposals;
- urgent risk can override active guidance suppression;
- algorithm errors are logged and visible;
- generated event plan is frozen after start.

---

## 13. Summary

The simulator should work as a deterministic review environment, not as an uncontrolled driving game.

The selected design is:

```text
route-derived facts
+ user-controlled presets
→ generated frozen event plan
→ deterministic tick state engine
→ skeleton-aligned feature groups
→ trigger package decision
→ interaction pause
→ append-only evidence log
```

This supports the transparent hybrid trigger algorithm while keeping the simulator generic enough for later package types and AICA use cases.
