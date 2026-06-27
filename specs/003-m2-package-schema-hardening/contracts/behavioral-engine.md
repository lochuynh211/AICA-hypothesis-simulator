# Contract: behavioral engine context (raw_state + feature_groups)

The tick engine computes per-tick driver/vehicle state from profiles + frozen plan
and builds the algorithm context. **Pure** given (profiles, frozen plan, tick index,
prior state, history) — no time/random.

## Per-tick update (research R1/R2)
- Position: `effective_speed_kph = traffic_jam_kph if jam else
  speed_profile[segment_type]`; `distance_km += effective_speed_kph * tick_seconds /
  3600`; `route_fraction = min(1, distance_km / total_route_distance_km)`.
- Driver: drowsiness/fatigue/attention advance additively from the profile rate
  components (night/monotony/jam/>60min/mountain), clamped 0–100; component deltas
  recorded.
- Vehicle: `steeringInstabilityLevel`, `pedalAbnormalityLevel`, rolling-window
  `laneDepartureCount`/`adasWarningCount`.

## Context shape
```jsonc
{
  "raw_state": {
    "drowsinessLevel": 62.1, "fatigueLevel": 55.0, "attentionLevel": 40.3,
    "speedKph": 90, "steeringInstabilityLevel": 48.2, "pedalAbnormalityLevel": 12.0,
    "laneDepartureCount": 1, "adasWarningCount": 0, "nextRestSpotMin": 8.0,
    "routeFraction": 0.42, "continuousDrivingMin": 50.4, "isNight": false,
    "weatherRiskLevel": 0.0, "segmentType": "highway"
  },
  "feature_groups": {
    "normalized": { "drowsiness_score": 0.62, "fatigue_score": 0.55,
                    "driving_anomaly_score": 0.48, "rest_window_score": 0.7, ... },
    "ordinal":    { "drowsiness_level": "moderate", "fatigue_level": "high",
                    "signal_duration": "sustained", "rest_spot_eta": "near", ... }
  }
}
```
- `binning.py` derives `feature_groups` from `raw_state`. `declarative_rule` consumes
  `feature_groups.ordinal`; `weighted_score` consumes `raw_state` /
  `feature_groups.normalized`.
- Constitution IV: no raw *external-service* numeric exists (Maps is M4); when it
  does, it is bounded into `route_facts` at ingestion. `raw_state` (simulator-internal,
  reproducible) is persisted per tick.

## Contract tests
- Determinism: same profile + plan → identical `raw_state` sequence across two runs.
- Speed-driven position; `>60min` continuous-driving fatigue term engages after 60
  sim-minutes; recovery action reduces drowsiness/fatigue per `recovery_model`.
- `feature_groups.ordinal` are strings, `normalized` are 0–1; both present each tick.
- The re-authored friend-drive scenario fires exactly one REST_PROPOSAL via the
  profile-driven progression (no `drowsiness_schedule`).
- `raw_state` + `feature_groups` + driver/vehicle updates persisted in each TickEvent.
