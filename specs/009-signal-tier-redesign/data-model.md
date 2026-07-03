# Phase 1 — Data Model: Signal-Tier Re-design

Authoritative math: `others/aica_trigger_algorithms_math_comparison.md` Part 2. This file states the
data shapes the implementation must produce.

## 1. Tiered signals (the raw-state contract)

Every per-tick signal belongs to exactly one tier. The tick engine emits all three tiers; the adapter
context carries them (see `contracts/tiered-context.md`).

| Tier | Signals | Editable at setup | Notes |
|---|---|---|---|
| **1 — Fixed** | `isNight`, `familiarRoute`, `childPassenger`, `weatherRiskLevel`, route/segments, rest options | some (scenario constants) | constant for the whole run |
| **2 — Dynamic** | `segmentType`, `motionState`, `continuousDrivingMin`, `speedKph`, `routeFraction`, `nextRestSpotMin`, `isTrafficJam`, `recoveryPhase` | read-only (derived) | `= f(fixed + elapsed time + user actions)` |
| **3 — Simulated** | `drowsiness`, `fatigue` (latent) · `anomaly_rate` (sensor) | curve params editable | drowsiness/fatigue deterministic; anomaly_rate seeded-stochastic |

**Removed from the tick output**: `attentionLevel`, `steeringInstabilityLevel`, `pedalAbnormalityLevel`,
`laneDepartureCount`, `adasWarningCount`, and all `*RemainingMin` / `restSpotDensityNext30Min` look-ahead.

Each **simulated** signal carries a human-readable `explanation` string (for the setup info-popover),
sourced from the package/scenario metadata, e.g.:
- `drowsiness`: "accumulates over driving time; faster at night / on monotonous roads / in jams."
- `anomaly_rate`: "rare anomaly events; more frequent as drowsiness rises; one seeded stream, replayable."

## 2. Scenario schema (rewritten in place)

```jsonc
{
  "id": "uc01_fatigue_recovery_v0_1",
  "version": "0.2.0",                       // bumped; new shape
  "type": "uc01_fatigue",
  // Tier-1 fixed context:
  "is_night": false, "child_passenger": true, "familiar_route": true,
  "route_intent": { "segments": [ ... ] },
  "speed_profile": { ... },
  "presets": { "total_route_distance_km": 120, "traffic_events": [], "weather_events": [] },
  "recovery_options": [ ... ],
  "total_duration_seconds": 7200, "tick_seconds": 60,

  // Tier-3 simulated-signal parameters (renamed from driver_profile):
  "driver_signal_params": {
    "drowsiness": { "base_growth_per_min": 0.9, "night_add_per_min": 0.3,
                    "monotony_add_per_min": 0.3, "traffic_jam_add_per_min": 0.1 },
    "fatigue":    { "base_growth_per_min": 0.3, "continuous_add_per_min_after_60_min": 0.2,
                    "mountain_road_add_per_min": 0.2, "traffic_jam_add_per_min": 0.05 },
    "recovery":   { "short_rest_drowsiness_recovery": 20.0, ... }
  },
  "anomaly_signal_params": {
    "lambda_base": 0.02, "lambda_gain": 0.15, "theta": 40.0, "window_min": 5.0
  },
  "run_seed_default": 42                     // seed suggested at setup; frozen per run
  // NOTE: vehicle_profile, initial_state.drowsiness_level REMOVED
}
```

**Loader rules**: reject a scenario that still contains `driver_profile` / `vehicle_profile` (old shape)
with a clear "incompatible — re-author" error; require `driver_signal_params` and `anomaly_signal_params`.

## 3. Simulated-signal generators

### 3a — Driver signals (deterministic) — `driver_signals.py` (renamed from `driver_model.py`)

```
drowsiness[t] = clamp₀₋₁₀₀( drowsiness[t−1]
   + (base + night·isNight + monotony·isMonotonous + jam·isTrafficJam) · Δt/60 )
fatigue[t]    = clamp₀₋₁₀₀( fatigue[t−1]
   + (base + continuous·[continuousMin≥60] + mountain·isMountain + jam·isTrafficJam) · Δt/60 )
```
Seeded from `scenario.driver_signal_params`; recovery reduces both on rest. **`attention` removed.**

### 3b — Anomaly signal (seeded Poisson) — `anomaly_signal.py` (NEW)

See `contracts/anomaly-generator.md`. Produces the discrete `spike[t]` and the rolling
`anomaly_rate[t]` (count over `window_min`). Carries its rolling window in run state.

## 4. RunConfig (gains a seed)

| Field | Type | Notes |
|---|---|---|
| `package_id` | str | selected algorithm |
| `scenario_id` | str | selected scenario |
| `hyperparameter_overrides` | dict | changed-from-default only |
| `run_seed` | int | **frozen at run start** into the event plan; drives `anomaly_rate` |
| `expert_override` | bool | existing, unchanged |

Resolved hyperparameters = manifest defaults ⊕ overrides (adapter injects into `context`).

## 5. Compact Hybrid — features & scores (package re-design)

Runtime state (in `package_runtime_state`, advance while `motionState=MOVING`): `jam_min, hw_min, mono_min`,
plus the existing smoothed features/scores/counters.

```
drowsiness      = drowsiness / 100
fatigue         = fatigue / 100
driving_anomaly = clamp( anomaly_rate / K )                      # K in manifest
env_load        = clamp( 0.5·(isTrafficJam?1:clamp(jam_min/20)) + 0.3·clamp(hw_min/60) + 0.2·(weatherRiskLevel/100) )
monotony        = clamp( 0.6·clamp(mono_min/30) + 0.4·(isNight?1:0) )
rest_window     = bins(nextRestSpotMin)                          # banded (Principle IV)
rest_scarcity   = clamp( (nextRestSpotMin − 10) / 50 )
familiar_route  = familiarRoute ? 1 : 0

base_safety_risk          = clamp( w_drowsiness·drowsiness + w_fatigue·fatigue + w_driving_anomaly·driving_anomaly + w_env·env_load )
rest_required_score       = clamp( base_safety_risk + [base≥minimum_risk]·(w_rest_window·rest_window + w_rest_scarcity·rest_scarcity) )
monotony_prevention_score = clamp( w_monotony·monotony + w_env_mono·env_load + w_familiar·familiar_route )
```
Defaults (manifest): `w_drowsiness 0.40, w_fatigue 0.25, w_driving_anomaly 0.25, w_env 0.10, minimum_risk 0.45,
w_rest_window 0.10, w_rest_scarcity 0.08, w_monotony 0.45, w_env_mono 0.30, w_familiar 0.25, K 5`,
plus smoothing α and the existing thresholds/persistence/fire-control values.
Smoothing, velocity, persistence, REST/MONOTONY state machines, fire-control, priority: **unchanged**.

## 6. NRI — unchanged

`S_total = S_base + S_env + S_realtime`. `S_realtime` reads Tier-3a `drowsiness`/`fatigue`
(now present → live, no longer 0). All params already in its manifest. No look-ahead, no anomaly_rate.

## 7. InstantResult (ephemeral preview shape)

Returned by the non-persisting evaluate path; never stored.

```jsonc
{
  "fired": true,
  "fire": { "category": "rest_required", "strength": "gentle", "tick": 29, "time_min": 29.0 },
  "peak_score": 0.71, "threshold": 0.60,
  "score_series": [ { "t": 0, "score": 0.02 }, ... ],   // rest_required_score per tick (for the curve)
  "segments": [ { "type": "urban", "from_min": 0, "to_min": 12 }, ... ],
  "rest_spot": { "at_km": 60, "eta_min": 30 },
  "rest_option": { "id": "nap_karaoke", "auto_chosen": true, "recovery_from_min": 60, "to_min": 66 },
  "completed_min": 118,
  "seed": 42,
  "overrides": [ { "key": "w_drowsiness", "default": 0.40, "value": 0.45 }, ... ],
  "error": null                                          // or an algorithm_error descriptor (never a fake decision)
}
```
`fired:false` → `fire:null`, `peak_score` still reported vs `threshold` (the "no trigger" case).
