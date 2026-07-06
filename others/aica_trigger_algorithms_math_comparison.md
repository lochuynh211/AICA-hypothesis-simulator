# AICA Trigger Algorithms — Before & After (raw-state / feature re-design)

**Purpose.** Put both UC-01 trigger algorithms in one place in mathematical form, show how they use
raw states **today** (Part 1 — Before), and define the **target** design and exactly what changes
(Part 2 — After). This is the design input for the separation refactor.

Sources: Hybrid — `others/aica_transparent_hybrid_trigger_algorithm_proposal.md` +
`packages/aica_transparent_hybrid_trigger_v1/algorithm.py`. NRI — `others/20260630_発火ロジック検討用資料.md`
+ `packages/nri_fatigue_score_v1/algorithm.py`.

**Companion doc:** the setup-screen UX that surfaces these tiers/signals/formulation is in
`others/aica_setup_screen_uiux.md`. Together these two form the design input for the re-design feature.

---

# Part 1 — BEFORE (current implementation)

## 1.0 The four data categories

The NRI deck (slide 2) already draws the separation we want. We use it for both algorithms:

| Category | JA | Meaning | Owner |
|---|---|---|---|
| **Raw state** | 監視データ / 生データ | Observable data: CAN, route info, TMC | Simulator (shared) |
| **Feature** | 特徴量 | A quantity *derived* from raw states | Algorithm (private) |
| **Fire-control data** | 発火制御用データ | Proposal frequency / count / last result | Run state |
| **Tuning data** (hyperparameters) | チューニング用データ | Weights, thresholds, cooldowns | Setup config |

Raw-state nature legend: **C** = observable context · **S** = sensor/CAN signal · **L** = route
look-ahead · **λ** = latent driver condition (drowsiness/fatigue/attention as a level).

## 1.1 Hybrid — current math

Pipeline: `raw state → feature extraction → smoothing → category scores → velocity + persistence →
state machine → fire-control → priority → proposal`. Features clamped to [0,1]; `clamp(x)=max(0,min(1,x))`.

```
drowsiness      = clamp(drowsinessLevel / 100)                       [λ]
fatigue         = clamp(fatigueLevel   / 100)                       [λ]
driving_anomaly = clamp(steeringInstabilityLevel / 100)             [S]   (only steering wired; spec wanted max of 4)
attention_drop  = clamp(1 − attentionLevel / 100)                   [λ]
traffic_jam     = max( jam(trafficJamAheadMin), clamp(lowSpeedDurationMin/20) )   [L]
   jam(a) = 0.0 (a≤0) | 0.3 (0<a<10) | 0.6 (10≤a<30) | 1.0 (a≥30)
long_highway    = 0.0 (h<10) | 0.3 (10≤h<30) | 0.6 (30≤h<60) | 1.0 (h≥60)   h=highwayRemainingMin  [L]
weather_risk    = clamp(weatherRiskLevel / 100)                     [C]
future_fatigue  = clamp(0.45·traffic_jam + 0.35·long_highway + 0.20·weather_risk)
rest_window     = 0.0 (r≥9999) | 0.6 (r≤3) | 1.0 (r≤10) | 0.6 (r≤20) | 0.2 (else)   r=nextRestSpotMin  [C]
rest_scarcity   = 1.0 (d≤0) | 0.7 (d=1) | 0.4 (d=2) | 0.1 (d≥3)     d=restSpotDensityNext30Min  [L]
monotony        = clamp( 0.35·clamp(monotonousRoadRemainingMin/30) + 0.25·clamp(tunnelRemainingMin/15)
                       + 0.20·(isNight?1:0) + 0.20·clamp(lowSpeedDurationMin/20) )   [L]
familiar_route  = clamp(familiarRouteRatio)                        [L]
```

Smoothing `f̃[t] = α·f[t] + (1−α)·f̃[t−1]` (α=0.35), then category scores on the smoothed features:

```
base_safety_risk          = clamp( 0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly + 0.10·future_fatigue )
rest_required_score       = clamp( base_safety_risk + [base≥0.45]·(0.10·rest_window + 0.08·rest_scarcity) )
monotony_prevention_score = clamp( 0.30·monotony + 0.20·familiar_route + 0.25·attention_drop + 0.15·traffic_jam + 0.10·long_highway )
```

Then velocity, persistence (rest 2 / monotony 3 ticks; skip-if score>0.88 or velocity>0.08), REST /
MONOTONY state machines, fire-control (emergency override → cooldown → 30-min limit), priority
(rest before monotony, then higher score).

> **Provenance of `drowsinessLevel`/`fatigueLevel`/`attentionLevel` (the λ inputs).** These are **not**
> car signals — the simulator manufactures them:
> ```
> scenario driver_profile ─▶ driver_model (accumulates each tick):
>     drowsiness += (base + night·isNight + monotony·isMonotonous + jam·isTrafficJam)·Δt/60
>   ─▶ raw_state["drowsinessLevel"] ─▶ normalized/100 ─▶ Hybrid drowsiness feature
> ```
> So the Hybrid's dominant feature is the simulator's fabricated latent ÷ 100. Its *definition* lives
> in the **scenario `driver_profile`**. `steering` is then derived from that same latent
> (`steering = base + k·drowsiness`). This is the tangle the re-design fixes.

## 1.2 NRI — current math

One category (rest_required). A single cumulative rest-need score; rest-spot ETA is a post-fire filter,
never mixed into the score.

```
S_total  = S_base + S_env + S_realtime
S_base   = F_child·W_child + T_drive·W_base·M_night·M_fami       W_child=20, W_base=0.5; M_night=1.2 if night; M_fami=1.2 if familiar
S_env    = T_jam·W_jam + T_hw·W_hw + T_mono·W_mono               W_jam=0.8, W_hw=0.2, W_mono=0.3  (per cumulative min)
S_realtime = max(0, V_sleep − θ_sleep)·W_sleep + max(0, V_fatigue − θ_fatigue)·W_fatigue   θ=60, W=1.5 (ReLU dead-band)
fire ⇔ S_total ≥ threshold_fire (80);  post-fire filter: T_next ≤ 15 min OR no spot ahead
```

`T_drive/T_jam/T_hw/T_mono` accumulate only while MOVING, reset after a rest completes. Deck: `V_sleep`
is *camera-estimated drowsiness*, `V_fatigue` is *CAN/voice-estimated fatigue* — the "manifested-risk"
half, on top of the context-derived accumulation base.

## 1.3 Raw-state usage — side by side (current)

| Raw input | Nature | Hybrid | NRI | Note |
|---|---|:--:|:--:|---|
| `continuousDrivingMin` | C | | ✓ | NRI `T_drive`; Hybrid only via λ drowsiness |
| `isNight` | C | ✓ | ✓ | Hybrid monotony; NRI `M_night` |
| `familiarRoute` | C | ✓(ratio) | ✓ | Hybrid `familiar_route`; NRI `M_fami` |
| `childPassenger` | C | | ✓ | NRI `W_child` |
| `isTrafficJam` | C | | ✓ | NRI `T_jam` |
| `segmentType` | C | | ✓ | NRI `T_hw`,`T_mono` |
| `nextRestSpotMin` | C | ✓ | ✓ | Hybrid `rest_window`; NRI filter |
| `motionState`,`recoveryPhase` | C | ✓* | ✓ | recovery gating |
| `weatherRiskLevel` | C | ✓ | | Hybrid `future_fatigue` (sim hard-wires 0) |
| `drowsinessLevel`,`fatigueLevel` | λ | ✓ | ✓ | Hybrid weight-0.40/0.25; NRI `S_realtime` |
| `attentionLevel` | λ | ✓ | | Hybrid `attention_drop` |
| `steeringInstabilityLevel` | S | ✓ | | Hybrid `driving_anomaly` (0.25) |
| `pedal`/`lane`/`ADAS` | S | | | computed, used by nobody |
| `trafficJamAheadMin`,`lowSpeedDurationMin`,`highwayRemainingMin`,`monotonousRoadRemainingMin`,`tunnelRemainingMin`,`restSpotDensityNext30Min`,`familiarRouteRatio` | L | ✓ | | **never produced by the sim → those features are dead/sentinel today** |

## 1.4 What's wrong

1. **λ inputs mis-filed as raw states.** `drowsiness`/`fatigue`/`attention` are the algorithm's own
   features, but the simulator fabricates them (from context + time) and hands them over as if measured
   — so the Hybrid reads the answer instead of inferring it, and its definition lives in the scenario.
2. **Dead features.** Every **L** look-ahead input is unproduced → 5+ Hybrid features sit at 0/sentinel.
3. **Fake, redundant sensors.** `steering` etc. are deterministic re-derivations of the λ latent — zero
   independent information; `pedal`/`lane`/`ADAS` are computed and unused.
4. **Junk-drawer `raw_state`.** Scenario constants, dynamics, and fabricated signals are one flat dict.

---

# Part 2 — AFTER (target design)

## 2.1 Raw states — three tiers

| Tier | Meaning | Members |
|---|---|---|
| **1 — Fixed** | scenario constants | `isNight`, `familiarRoute`, `childPassenger`, weather setup, route/segments, rest options |
| **2 — Dynamic** | observable dynamics = f(fixed + time + user actions) | `segmentType`, `motionState`, `continuousDrivingMin`, `speedKph`, `routeFraction`, `nextRestSpotMin`, `isTrafficJam`, `recoveryPhase`, `weatherRiskLevel` |
| **3 — Simulated signals** | fabricated from Tiers 1–2 | **3a latent:** `drowsiness`, `fatigue` · **3b sensor:** `anomaly_rate` |

The simulator emits all three tiers; each algorithm uses what it wants (no observability tag — a
signal like drowsiness could plausibly be camera-sensed, so the observable/oracle line is ambiguous).

## 2.2 The one stochastic signal — `anomaly_rate` (seeded Poisson)

The **only** randomness in the whole simulation. A behavioral-anomaly event (lane-departure /
steering-jerk) that fires *sporadically*, more often as the driver tires. **Replayable**: all randomness
comes from a PRNG keyed by `(run_seed, tick, channel)` with `run_seed` frozen in the run config — no
global RNG, no `Math.random`, so replaying any tick reproduces the identical draw.

```
u(t) = prng( hash(run_seed, t, "anomaly") )                  # uniform (0,1), reproducible

λ[t]     = λ_base + λ_gain · max(0, drowsiness[t] − θ)/100    # events/min, rises with drowsiness
p[t]     = 1 − exp(−λ[t] · Δt_min)                           # P(≥1 event this tick)
spike[t] = 1  if u(t) < p[t]  else 0
anomaly_rate[t] = Σ spike over the last W minutes            # rolling count = the observable
```
Params (scenario `anomaly_signal_params`): `λ_base`, `λ_gain`, `θ`, window `W`.

## 2.3 Compact Hybrid — 8 features

```
# runtime-state accumulators (advance only while motionState = MOVING): jam_min, hw_min, mono_min

drowsiness      = drowsiness / 100                                    [3a]
fatigue         = fatigue / 100                                       [3a]
driving_anomaly = clamp( anomaly_rate / K )                           [3b]   ← event frequency, genuinely independent
env_load        = clamp( 0.5·(isTrafficJam ? 1 : clamp(jam_min/20)) + 0.3·clamp(hw_min/60) + 0.2·(weatherRiskLevel/100) )
monotony        = clamp( 0.6·clamp(mono_min/30) + 0.4·(isNight ? 1 : 0) )
rest_window     = 0.0 (r≥9999) | 0.6 (r≤3) | 1.0 (r≤10) | 0.6 (r≤20) | 0.2 (else)    r = nextRestSpotMin
rest_scarcity   = clamp( (nextRestSpotMin − 10) / 50 )
familiar_route  = familiarRoute ? 1 : 0

base_safety_risk          = clamp( 0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly + 0.10·env_load )
rest_required_score       = clamp( base_safety_risk + [base≥0.45]·(0.10·rest_window + 0.08·rest_scarcity) )
monotony_prevention_score = clamp( 0.45·monotony + 0.30·env_load + 0.25·familiar_route )
```

Smoothing (α), velocity, persistence, REST/MONOTONY state machines, fire-control, priority —
**unchanged** (§1.1). **8 features** (was 12); **0** route look-ahead; **1** stochastic signal.
`env_load` replaces the old `traffic_jam + long_highway + weather + future_fatigue` (no double-counting).

## 2.4 NRI — unchanged

Uses Tier 1/2 context for `S_base + S_env`, and Tier-3a `drowsiness`+`fatigue` for `S_realtime` (now
live because 3a genuinely exists). Uses neither `anomaly_rate` nor any look-ahead. Full math in §1.2.

## 2.5 Changes to make (before → after)

| Area | Before | After |
|---|---|---|
| `raw_state` | one flat dict | **3 tiers** (2.1) |
| λ drowsiness/fatigue | mis-filed raw states | **Tier-3a simulated signals**, explicit |
| `attention` | Hybrid feature | **dropped** (returns with a monotony-content loop) |
| vehicle sensors | 4 deterministic (`steering`/`pedal`/`lane`/`ADAS`), mostly unused | **1 seeded-Poisson `anomaly_rate`** |
| `driving_anomaly` | steering/100 (fake, redundant) | `clamp(anomaly_rate/K)` (real event modality) |
| route look-ahead (L) | 6 inputs, none produced → dead features | **removed**; Hybrid accumulates `jam_min`/`hw_min`/`mono_min` from current state |
| Hybrid features | 12 (5 dead) | **8, all live** |
| `traffic_jam`+`long_highway`+`weather`+`future_fatigue` | 4 double-counted features | **1 `env_load`** |
| `weatherRiskLevel` | hard-wired 0 | wire from `weather_events` (optional near-term) |
| names | `driver_model`, `vehicle_model`, `driver_profile` | driver-signal simulator; **delete** vehicle_model → anomaly-event simulator; `driver_signal_params` |
| randomness | none (fake sensors deterministic) | one seeded Poisson stream + `run_seed` in run config |
| NRI | — | unchanged (`S_realtime` now live) |

## 2.6 Deferred (with return path)

- **`attention`** → returns with a real monotony-content recovery loop.
- **richer sensors** (camera drowsiness, CAN steering/pedal) → return as *additional seeded stochastic
  signals* (continuous + Gaussian, or discrete + Poisson) — never deterministic double-derivation.
- **route look-ahead** → returns as banded raw states only if a scenario needs the resolution.
