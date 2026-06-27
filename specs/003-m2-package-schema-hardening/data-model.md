# Phase 1 Data Model: M2 Package & Schema Hardening

New + extended Pydantic models (backend) mirrored in `api/types.ts`. Only M2
additions/changes are listed; M1 models persist unless noted.

## Profiles (`models/profile.py`) — NEW

### DriverModelProfile
`id`; `drowsiness_model{base_growth_per_min, night_add_per_min, monotony_add_per_min,
traffic_jam_add_per_min}`; `fatigue_model{base_growth_per_min,
continuous_driving_add_per_min_after_60_min, mountain_road_add_per_min,
traffic_jam_add_per_min}`; `attention_model{base_recovery_per_min,
monotony_drop_per_min, drowsiness_drop_factor, active_content_recovery_per_min}`;
`recovery_model{short_rest_drowsiness_recovery, short_rest_fatigue_recovery,
long_rest_drowsiness_recovery, long_rest_fatigue_recovery}`.

### VehicleBehaviorProfile
`rolling_window_seconds` (default 300); `steering_instability{base_level,
drowsiness_factor, fatigue_factor, mountain_road_add, traffic_jam_reduce}`;
`lane_departure{enabled_on:[segment_type], drowsiness_threshold, fatigue_threshold,
count_when_threshold_exceeded}`; `pedal_abnormality{base_level, fatigue_factor,
traffic_jam_add, mountain_road_add}`; `adas_warning{lane_departure_warning_threshold,
steering_instability_warning_threshold}`.

### SpeedProfile
`normal_road_kph, sightseeing_road_kph, mountain_road_kph, highway_kph,
traffic_jam_kph` (all int kph).

**Validation**: rates ≥ 0; thresholds in 0–100; segment-type keys valid.

## Scenario (`models/scenario.py`) — EXTENDED
Add `driver_profile: DriverModelProfile`, `vehicle_profile: VehicleBehaviorProfile`,
`speed_profile: SpeedProfile`, `is_night: bool`, `presets` (monotony tags,
traffic/weather presets). **Remove** `event_presets.drowsiness_schedule` (replaced by
the engine). `RouteSegment.type` now also used by speed profile lookup. Validators:
profiles present; `at` monotonic + one rest facility (unchanged).

## Route facts + event plan (`models/run.py`) — EXTENDED

### RouteFacts (full)
`total_route_distance_km`, `estimated_route_duration_min`, `route_segments[]`
(`segment_type` ∈ highway/normal_road/mountain_road/sightseeing_road, `start_km`,
`length_km`), `rest_spot_positions[]` (km), `route_progress_checkpoints[]`.

### EventPlan (full)
`tick_seconds`, `traffic_events[]` (`id, start_min, duration_min,
affected_segment_id, speed_kph`), `weather_events[]`, `rest_opportunities[]`
(`id, route_position_km`). Frozen at run start.

### RunPlanDraft — NEW (in-memory, not persisted until frozen)
`plan_id`, `package_id`, `scenario_id`, `route_facts`, `effective_setup`
(parameters/hyperparameters/profiles/presets/run_mode), `draft_event_plan`,
`validation_errors[]`.

### TickState — EXTENDED
add `raw_state: dict[str, float|int|bool|str]`, `feature_groups: {normalized:
dict[str,float], ordinal: dict[str,str]}`, numeric `distance_km`,
`continuous_driving_min`.

### RunState — EXTENDED
add `package_runtime_state: dict` (default `{}`), frozen `route_facts`,
`event_plan` (full), selected `driver_profile`/`vehicle_profile`/`speed_profile`,
`run_mode` ("standard"), `evidence_status` ("standard"),
`initial_parameters`/`current_parameters`,
`initial_hyperparameters`/`current_hyperparameters`,
`original_values`/`modified_values`.

## Decision (`models/decision.py`) — EXTENDED
`explanation: str | LocalizedText | list[str|LocalizedText]` where `LocalizedText =
{ja: str, en: str}` (string fallback accepted). `scores`/`states`/`candidates`/
`selected_category` already present (M1) — now populated by `weighted_score`.
`Candidate.strength` ∈ gentle/clear/strong; `Candidate.state` label string.

## Package (`models/package.py`) — EXTENDED
`algorithm.type` Literal adds `"weighted_score"`. `ProposalDef.message` localized
(M1). Hyperparameters for weighted_score: category weights, thresholds
(suggest/recommend/urgent), `minimum_risk_for_rest_bonus`, priority order.

## Log (`models/log.py`) — EXTENDED
`TickEvent` carries (in addition to the decision trace): `raw_state`,
`feature_groups`, `driver_update` (component deltas), `vehicle_update`,
`package_runtime_state`. `RunLog` carries the EXTENDED RunState snapshot fields +
`original_values`/`modified_values`. New event: `ActionEvent.action` accepts
`decline`. Append-only + persist-after-every-event unchanged.

## State transitions (run)
`created → playing` (first tick) → `paused` (proposal) → `playing`/`completed`
(action: accept_rest→completed, postpone→playing, **decline→playing/completed**) →
`completed` (route end). Run creation only from a frozen `plan_id`.
