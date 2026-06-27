# AICA Transparent Hybrid Trigger Algorithm Proposal

**Document type:** Algorithm proposal / hypothesis package design  
**Target system:** AICA Hypothesis Simulator  
**Algorithm name:** `aica_transparent_hybrid_trigger_v1`  
**Status:** Draft for review and implementation planning  
**Primary purpose:** Let a test user experience AICA trigger behavior in simulation, modify hyperparameters, replay scenarios, and provide review feedback.

---

## 1. Background and Purpose

The AICA simulator is a configurable environment for verifying trigger-algorithm hypotheses through scenario playback. The simulator itself does not decide whether an algorithm is correct. Instead, it allows the test user, usually the system proposer or algorithm proposer, to experience how the algorithm behaves in simulated driving contexts and then provide review feedback.

This proposal defines the first recommended trigger algorithm hypothesis package:

> **Transparent Hybrid Trigger Algorithm v1**

The algorithm is designed to be:

- transparent enough for business, UX, and system stakeholders to understand;
- configurable enough for parameter and hyperparameter experimentation;
- deterministic enough for scenario replay and before/after comparison;
- traceable enough to show why AICA fired, suppressed, or selected a proposal;
- extensible enough to later support rule-based, AI-based, or LLM-assisted alternatives.

This algorithm is not intended to be the final production algorithm. It is intended to be the first baseline hypothesis package for simulator verification.

---

## 2. Algorithm Positioning in AICA Simulator

AICA simulator runtime should be separated into:

```text
Hypothesis package
+ Scenario state
+ Test user action
→ Simulation playback
→ Decision trace
→ Test user review feedback
```

The algorithm described here belongs to the **hypothesis package** layer.

The simulator kernel should remain generic. It should load this algorithm package at runtime, execute it during playback, expose editable hyperparameters, and record the output trace.

---

## 3. Core Algorithm Concept

The algorithm follows this pipeline:

```text
Monitoring parameters
→ Feature extraction
→ Score calculation
→ Trend and persistence check
→ Trigger candidate generation
→ Fire-control check
→ Priority resolution
→ Proposal generation
→ Decision trace output
```

At every simulation tick, the algorithm evaluates the current state and returns one of the following:

```text
No proposal
Suppressed trigger candidate
Rest-required proposal
Monotony-prevention proposal
```

For v1, the algorithm focuses on two trigger categories:

1. **Rest Required / Dangerous Driving Prevention**
2. **Monotony / Inattentive Driving Prevention**

Additional categories, such as route-based music proposal or child-passenger proposal, can be added later using the same interface.

---

## 4. Parameter vs Feature

The simulator must distinguish **parameters** from **features**.

### 4.1 Parameter

A parameter is a raw scenario value, runtime state value, or editable input.

Examples:

```yaml
drowsinessLevel: 72
fatigueLevel: 65
tripDurationMin: 95
nextRestSpotMin: 7
trafficJamAheadMin: 20
highwayRemainingMin: 35
lastProposalResult: rejected
```

Parameters are visible in scenario configuration and may be modified by the test user depending on the simulator mode.

### 4.2 Feature

A feature is an algorithm-ready interpretation of one or more parameters. Features are normalized to `0.0–1.0` unless otherwise specified.

Examples:

```yaml
drowsiness_score: 0.72
fatigue_score: 0.66
future_fatigue_score: 0.58
rest_window_score: 0.85
rest_scarcity_score: 0.40
monotony_score: 0.74
```

### 4.3 Rule

```text
Parameter = raw input value
Feature = interpreted value used by the trigger algorithm
```

This distinction is important because the same parameter can affect multiple features, and the same feature can be calculated from multiple parameters.

---

## 5. Simulation Tick

The algorithm should run periodically during playback.

Recommended default:

```yaml
tick_seconds: 30
```

Each tick performs:

```text
1. Read current simulation state
2. Extract normalized features
3. Smooth scores over time
4. Calculate trigger scores
5. Evaluate state thresholds
6. Apply persistence rules
7. Apply fire-control rules
8. Resolve category priority
9. Generate proposal if allowed
10. Emit decision trace
```

---

## 6. Input State Model

The algorithm should receive a normalized simulation state.

```ts
type SimulationState = {
  timeSec: number;

  driver: {
    drowsinessLevel: number;          // 0-100
    fatigueLevel: number;             // 0-100
    attentionLevel?: number;          // 0-100
    responseDelayMs?: number;
    voiceEnergyLevel?: number;        // 0-100
    selfAwarenessOfFatigue?: "low" | "medium" | "high";
  };

  vehicle: {
    speedKph: number;
    steeringInstabilityLevel?: number; // 0-100
    laneDepartureCount?: number;
    pedalAbnormalityLevel?: number;    // 0-100
    adasWarningCount?: number;
  };

  route: {
    distanceToDestinationMin: number;
    nextRestSpotMin?: number;
    nextRestSpotDistanceKm?: number;
    restSpotDensityNext30Min?: number;
    highwayRemainingMin?: number;
    monotonousRoadRemainingMin?: number;
    tunnelRemainingMin?: number;
    familiarRouteRatio?: number;       // 0-1
  };

  environment: {
    isNight: boolean;
    trafficJamAheadMin?: number;
    lowSpeedDurationMin?: number;
    weatherRiskLevel?: number;         // 0-100
  };

  proposalHistory: {
    lastProposalTimeSec?: number;
    lastProposalCategory?: string;
    lastProposalResult?: "accepted" | "rejected" | "ignored" | "cancelled" | "completed";
    proposalCountLast30Min: number;
    acceptanceRateRecent?: number;     // 0-1
  };

  userProfile?: {
    longDistanceTolerance?: number;              // 0-1
    restProposalAcceptanceTendency?: number;     // 0-1
    fatigueRecoveryTendency?: number;            // 0-1
  };
};
```

---

## 7. Feature Extraction

All features should be normalized between `0.0` and `1.0`.

The following helper function is assumed:

```text
clamp(value, min, max)
```

---

### 7.1 Drowsiness Score

Default v1 formula:

```text
drowsiness_score = clamp(drowsinessLevel / 100, 0, 1)
```

Future extension:

```text
drowsiness_score =
  0.70 * camera_drowsiness_score
+ 0.20 * posture_abnormality_score
+ 0.10 * response_delay_score
```

---

### 7.2 Fatigue Score

Default v1 formula:

```text
fatigue_score = clamp(
  0.45 * normalized_fatigue_level
+ 0.25 * trip_duration_pressure
+ 0.15 * voice_abnormality_score
+ 0.15 * response_delay_score,
  0,
  1
)
```

Where:

```text
normalized_fatigue_level = fatigueLevel / 100
```

Default trip duration pressure:

```text
0.0 if tripDurationMin < 30
0.3 if 30 <= tripDurationMin < 60
0.6 if 60 <= tripDurationMin < 120
1.0 if tripDurationMin >= 120
```

If unavailable:

```text
voice_abnormality_score = 0
response_delay_score = 0
```

---

### 7.3 Driving Anomaly Score

```text
driving_anomaly_score = max(
  steering_instability_score,
  lane_departure_score,
  pedal_abnormality_score,
  adas_warning_score
)
```

Mappings:

```text
steering_instability_score = steeringInstabilityLevel / 100
pedal_abnormality_score = pedalAbnormalityLevel / 100
lane_departure_score = clamp(laneDepartureCount / 3, 0, 1)
adas_warning_score = clamp(adasWarningCount / 3, 0, 1)
```

If unavailable, each component defaults to `0`.

---

### 7.4 Traffic Jam Score

```text
traffic_jam_score =
  0.0 if trafficJamAheadMin = 0 or unavailable
  0.3 if 0 < trafficJamAheadMin < 10
  0.6 if 10 <= trafficJamAheadMin < 30
  1.0 if trafficJamAheadMin >= 30
```

If low-speed duration is available:

```text
traffic_jam_score = max(
  traffic_jam_score,
  clamp(lowSpeedDurationMin / 20, 0, 1)
)
```

---

### 7.5 Long Highway Score

```text
long_highway_score =
  0.0 if highwayRemainingMin < 10 or unavailable
  0.3 if 10 <= highwayRemainingMin < 30
  0.6 if 30 <= highwayRemainingMin < 60
  1.0 if highwayRemainingMin >= 60
```

---

### 7.6 Weather Risk Score

```text
weather_risk_score = clamp(weatherRiskLevel / 100, 0, 1)
```

If unavailable:

```text
weather_risk_score = 0
```

---

### 7.7 Future Fatigue Score

```text
future_fatigue_score = clamp(
  0.45 * traffic_jam_score
+ 0.35 * long_highway_score
+ 0.20 * weather_risk_score,
  0,
  1
)
```

---

## 8. Rest Opportunity Features

Rest opportunity should be split into two features because they represent different ideas.

### 8.1 Rest Window Score

Meaning:

```text
Is there a good rest place soon enough that proposing now is actionable?
```

Formula:

```text
if nextRestSpotMin is unavailable:
    rest_window_score = 0
else if nextRestSpotMin <= 3:
    rest_window_score = 0.6
else if nextRestSpotMin <= 10:
    rest_window_score = 1.0
else if nextRestSpotMin <= 20:
    rest_window_score = 0.6
else:
    rest_window_score = 0.2
```

Reasoning:

- Too close: driver may not have enough time to react.
- 3–10 minutes: ideal actionable window.
- 10–20 minutes: still useful, but may feel early.
- More than 20 minutes: weak timing relevance.

---

### 8.2 Rest Scarcity Score

Meaning:

```text
Are rest opportunities limited after this point?
```

Formula:

```text
if restSpotDensityNext30Min is unavailable:
    rest_scarcity_score = 0
else if restSpotDensityNext30Min <= 0:
    rest_scarcity_score = 1.0
else if restSpotDensityNext30Min == 1:
    rest_scarcity_score = 0.7
else if restSpotDensityNext30Min == 2:
    rest_scarcity_score = 0.4
else:
    rest_scarcity_score = 0.1
```

Reasoning:

AICA should be more willing to propose rest when the current or upcoming rest opportunity may be one of the few available opportunities.

---

## 9. Monotony Features

### 9.1 Monotonous Road Score

```text
monotonous_road_score = clamp(monotonousRoadRemainingMin / 30, 0, 1)
```

If unavailable:

```text
monotonous_road_score = 0
```

---

### 9.2 Tunnel Score

```text
tunnel_score = clamp(tunnelRemainingMin / 15, 0, 1)
```

If unavailable:

```text
tunnel_score = 0
```

---

### 9.3 Night Score

```text
night_score = 1.0 if isNight else 0.0
```

---

### 9.4 Low-Speed Repetition Score

```text
low_speed_repetition_score = clamp(lowSpeedDurationMin / 20, 0, 1)
```

If unavailable:

```text
low_speed_repetition_score = 0
```

---

### 9.5 Monotony Score

```text
monotony_score = clamp(
  0.35 * monotonous_road_score
+ 0.25 * tunnel_score
+ 0.20 * night_score
+ 0.20 * low_speed_repetition_score,
  0,
  1
)
```

---

### 9.6 Familiar Route Score

```text
familiar_route_score = clamp(familiarRouteRatio, 0, 1)
```

If unavailable:

```text
familiar_route_score = 0
```

---

### 9.7 Attention Drop Score

If attention level is available:

```text
attention_drop_score = clamp(1 - attentionLevel / 100, 0, 1)
```

If attention level is unavailable:

```text
attention_drop_score = clamp(
  0.5 * response_delay_score
+ 0.5 * voice_abnormality_score,
  0,
  1
)
```

If all inputs are unavailable:

```text
attention_drop_score = 0
```

---

## 10. Trigger Score Calculation

---

### 10.1 Base Safety Risk

```text
base_safety_risk = clamp(
  w_drowsiness      * drowsiness_score
+ w_fatigue         * fatigue_score
+ w_driving_anomaly * driving_anomaly_score
+ w_future_fatigue  * future_fatigue_score,
  0,
  1
)
```

Default weights:

```yaml
base_safety_risk:
  weights:
    drowsiness_score: 0.40
    fatigue_score: 0.25
    driving_anomaly_score: 0.25
    future_fatigue_score: 0.10
```

---

### 10.2 Rest Required Score

Rest required score is based on base safety risk plus rest timing bonus.

Rest opportunity should not trigger a rest proposal by itself. Therefore, rest opportunity bonus is only applied after minimum safety risk is reached.

```text
if base_safety_risk < minimum_risk_for_rest_bonus:
    rest_timing_bonus = 0
else:
    rest_timing_bonus =
      w_rest_window   * rest_window_score
    + w_rest_scarcity * rest_scarcity_score
```

Then:

```text
rest_required_score = clamp(
  base_safety_risk + rest_timing_bonus,
  0,
  1
)
```

Default hyperparameters:

```yaml
rest_required:
  minimum_risk_for_rest_bonus: 0.45
  bonus_weights:
    rest_window_score: 0.10
    rest_scarcity_score: 0.08
```

---

### 10.3 Monotony Prevention Score

```text
monotony_prevention_score = clamp(
  w_monotony        * monotony_score
+ w_familiar_route  * familiar_route_score
+ w_attention_drop  * attention_drop_score
+ w_traffic         * traffic_jam_score
+ w_highway         * long_highway_score,
  0,
  1
)
```

Default weights:

```yaml
monotony_prevention:
  weights:
    monotony_score: 0.30
    familiar_route_score: 0.20
    attention_drop_score: 0.25
    traffic_jam_score: 0.15
    long_highway_score: 0.10
```

---

## 11. Smoothing, Trend, and Persistence

### 11.1 Smoothing

To prevent proposals from temporary spikes, apply exponential smoothing.

```text
smoothed_score[t] =
  alpha * current_score[t]
+ (1 - alpha) * smoothed_score[t-1]
```

Default:

```yaml
smoothing:
  alpha: 0.35
```

---

### 11.2 Score Velocity

```text
score_velocity = smoothed_score[t] - smoothed_score[t-1]
```

Velocity is used to detect fast-rising risk.

---

### 11.3 Persistence

A trigger candidate becomes valid only if the score remains above threshold for a configured number of consecutive ticks.

Default:

```yaml
persistence:
  rest_required_ticks: 2
  monotony_prevention_ticks: 3
  tick_seconds: 30
```

Meaning:

```text
Rest required: threshold must persist for 60 seconds
Monotony prevention: threshold must persist for 90 seconds
```

### 11.4 Persistence Skip

Persistence can be skipped when risk is high or rising quickly.

```yaml
skip_persistence_if:
  rest_required_score_above: 0.88
  score_velocity_above: 0.08
```

---

## 12. Trigger States

The algorithm should produce states, not just numeric scores.

---

### 12.1 Rest Required State Machine

```text
REST_NORMAL
→ REST_WATCH
→ REST_SUGGEST
→ REST_RECOMMEND
→ REST_URGENT
→ REST_RECOVERY
```

Default thresholds:

```yaml
rest_state_thresholds:
  watch: 0.45
  suggest: 0.62
  recommend: 0.76
  urgent: 0.88
```

| State | Meaning | Proposal behavior |
|---|---|---|
| `REST_NORMAL` | No issue | No proposal |
| `REST_WATCH` | Risk rising | Silent monitoring |
| `REST_SUGGEST` | Mild concern | Gentle rest suggestion |
| `REST_RECOMMEND` | Clear concern | Clear rest recommendation |
| `REST_URGENT` | Strong safety concern | Strong rest recommendation, override allowed |
| `REST_RECOVERY` | Rest accepted or completed | Recovery / return flow |

---

### 12.2 Monotony State Machine

```text
MONOTONY_NORMAL
→ MONOTONY_WATCH
→ MONOTONY_CONTENT_SUGGEST
→ MONOTONY_ACTIVE_CONTENT
```

Default thresholds:

```yaml
monotony_state_thresholds:
  watch: 0.40
  suggest: 0.58
  strong_suggest: 0.75
```

| State | Meaning | Proposal behavior |
|---|---|---|
| `MONOTONY_NORMAL` | No concern | No proposal |
| `MONOTONY_WATCH` | Monotony increasing | Silent monitoring |
| `MONOTONY_CONTENT_SUGGEST` | Proposal useful | Suggest light content |
| `MONOTONY_ACTIVE_CONTENT` | User accepted content | Continue content until end/cancel/safety override |

---

## 13. Candidate Generation

### 13.1 Rest Candidate

A rest candidate exists when:

```text
rest_required_score >= rest_required.thresholds.suggest
```

Candidate strength:

```text
if rest_required_score >= urgent threshold:
    strength = strong
else if rest_required_score >= recommend threshold:
    strength = clear
else if rest_required_score >= suggest threshold:
    strength = gentle
```

### 13.2 Monotony Candidate

A monotony candidate exists when:

```text
monotony_prevention_score >= monotony_prevention.thresholds.suggest
```

Candidate strength:

```text
if monotony_prevention_score >= strong_suggest threshold:
    strength = clear
else:
    strength = gentle
```

---

## 14. Fire-Control Layer

Fire-control prevents excessive proposals but allows overrides for high-risk situations.

### 14.1 Fire-Control Inputs

```yaml
fire_control_inputs:
  last_proposal_time
  last_proposal_result
  proposal_count_last_30min
  proposal_acceptance_rate
  trigger_category
  trigger_strength
  score_velocity
```

### 14.2 Default Fire-Control Hyperparameters

```yaml
fire_control:
  default_min_interval_min: 10
  max_proposals_per_30min: 3

  result_based_cooldown_min:
    accepted: 5
    completed: 5
    rejected: 15
    ignored: 12
    cancelled: 10

  category_specific_cooldown_min:
    rest_required: 8
    monotony_prevention: 12

  emergency_override:
    rest_required_score: 0.88
    base_safety_risk: 0.82
    driving_anomaly_score: 0.75
    score_velocity: 0.08
```

### 14.3 Fire-Control Logic

```ts
function applyFireControl(candidate, state, config) {
  if (!candidate.exists) {
    return { fired: false, reason: "no_trigger_candidate" };
  }

  if (isEmergencyOverride(candidate, state, config)) {
    return {
      fired: true,
      suppressed: false,
      override: true,
      reason: "emergency_or_fast_rising_risk"
    };
  }

  const cooldownMin = getCooldownByLastResultAndCategory(state, candidate, config);

  if (minutesSinceLastProposal(state) < cooldownMin) {
    return {
      fired: false,
      suppressed: true,
      reason: "cooldown_active"
    };
  }

  if (state.proposalHistory.proposalCountLast30Min >= config.maxProposalsPer30Min) {
    return {
      fired: false,
      suppressed: true,
      reason: "proposal_count_limit"
    };
  }

  return {
    fired: true,
    suppressed: false,
    reason: "fire_control_passed"
  };
}
```

---

## 15. Priority Resolver

If multiple candidates are valid and pass fire-control, AICA should choose one final proposal.

Default priority:

```yaml
priority:
  - rest_required
  - monotony_prevention
```

Reason:

```text
Safety-oriented rest proposal should have higher priority than light content proposal.
```

Resolver logic:

```ts
function resolveProposal(candidates, config) {
  const valid = candidates.filter(c => c.fireControl.fired);

  if (valid.length === 0) return null;

  return valid.sort((a, b) =>
    priorityRank(a.category, config) - priorityRank(b.category, config)
    || b.score - a.score
  )[0];
}
```

---

## 16. Proposal Generation

The algorithm should return a proposal object when firing occurs.

### 16.1 Proposal Object

```ts
type Proposal = {
  category: "rest_required" | "monotony_prevention";
  strength: "gentle" | "clear" | "strong";
  message: {
    en: string;
    ja: string;
  };
  options: ProposalOption[];
  explanation: {
    en: string[];
    ja: string[];
  };
};
```

The simulator UI should select English or Japanese at runtime.

---

### 16.2 Rest Proposal Options

```yaml
rest_required_options:
  - accept_rest_guidance
  - choose_different_rest_spot
  - play_pre_rest_wakefulness_content
  - decline
```

Example English messages:

```text
Gentle:
There is a rest spot about 7 minutes ahead. You seem a little tired. Would you like to take a short break?

Clear:
Your fatigue seems to be increasing. I recommend taking a short break at the next rest spot, about 7 minutes ahead.

Strong:
Your driving condition appears unstable. Please take a break at the next safe location.
```

Example Japanese messages:

```text
Gentle:
約7分先に休憩できる場所があります。少しお疲れのようです。短く休憩していきますか？

Clear:
疲労が高まっているようです。約7分先の休憩場所で、短い休憩を取ることをおすすめします。

Strong:
運転状態に不安定な兆候があります。次の安全な場所で休憩してください。
```

---

### 16.3 Monotony Prevention Options

```yaml
monotony_prevention_options:
  - playlist
  - humming_karaoke
  - quiz
  - ai_chat
  - decline
```

Example English messages:

```text
Gentle:
This route is familiar and traffic may continue for a while. Would you like a short playlist to help keep your attention?

Clear:
The current route and traffic may make driving feel monotonous. I can start a short recovery content option, such as a playlist or quiz.
```

Example Japanese messages:

```text
Gentle:
慣れた道で、しばらく渋滞が続く可能性があります。集中を保つために短いプレイリストを流しますか？

Clear:
現在のルートや交通状況により、運転が単調になりやすい状態です。プレイリストやクイズなど、短い回復コンテンツを開始できます。
```

---

## 17. User Action Handling

The simulator should update proposal history and state based on test-user choices during playback.

### 17.1 User Accepts Rest

State update:

```yaml
lastProposalResult: accepted
activeFlow: rest_guidance
cooldownProfile: accepted
```

Expected flow:

```text
Rest proposal accepted
→ Guide to rest spot
→ Optionally offer pre-rest wakefulness content
→ User parks
→ Offer rest method / rest duration
→ After rest, offer recovery content
```

---

### 17.2 User Rejects Rest

State update:

```yaml
lastProposalResult: rejected
cooldownProfile: rejected
```

Behavior:

```text
Suppress similar proposals for configured rejection cooldown.
If risk reaches urgent level, override suppression and propose again.
```

---

### 17.3 User Ignores Proposal

State update:

```yaml
lastProposalResult: ignored
cooldownProfile: ignored
```

Behavior:

```text
Apply medium cooldown.
If high safety risk appears, override can still occur.
```

---

### 17.4 User Accepts Monotony Content

State update:

```yaml
lastProposalResult: accepted
activeContent: playlist | humming_karaoke | quiz | ai_chat
```

Behavior:

```text
Suppress other non-safety proposals during active content.
Allow safety-oriented rest proposal to override active content.
```

---

## 18. Main Algorithm Pseudocode

```ts
function evaluateAicaTrigger(state, config, previousRuntimeState) {
  // 1. Extract features
  const features = extractFeatures(state, config.featureDefinitions);

  // 2. Smooth feature scores or trigger scores
  const smoothedFeatures = smoothFeatures(
    features,
    previousRuntimeState.features,
    config.smoothing
  );

  // 3. Calculate base safety risk
  const baseSafetyRisk = calculateBaseSafetyRisk(smoothedFeatures, config);

  // 4. Calculate trigger scores
  const restRequiredScore = calculateRestRequiredScore(
    baseSafetyRisk,
    smoothedFeatures,
    config
  );

  const monotonyPreventionScore = calculateMonotonyPreventionScore(
    smoothedFeatures,
    config
  );

  // 5. Calculate velocity
  const restVelocity =
    restRequiredScore - previousRuntimeState.scores.restRequiredScore;

  const monotonyVelocity =
    monotonyPreventionScore - previousRuntimeState.scores.monotonyPreventionScore;

  // 6. Determine states
  const restState = determineRestState(restRequiredScore, config);
  const monotonyState = determineMonotonyState(monotonyPreventionScore, config);

  // 7. Generate trigger candidates
  const candidates = [];

  const restCandidate = buildRestCandidate({
    score: restRequiredScore,
    velocity: restVelocity,
    state: restState,
    features,
    config
  });

  if (restCandidate.exists) candidates.push(restCandidate);

  const monotonyCandidate = buildMonotonyCandidate({
    score: monotonyPreventionScore,
    velocity: monotonyVelocity,
    state: monotonyState,
    features,
    config
  });

  if (monotonyCandidate.exists) candidates.push(monotonyCandidate);

  // 8. Apply persistence
  const persistentCandidates = applyPersistence(
    candidates,
    previousRuntimeState,
    config.persistence
  );

  // 9. Apply fire-control
  const fireControlledCandidates = persistentCandidates.map(candidate => ({
    ...candidate,
    fireControl: applyFireControl(candidate, state, config.fireControl)
  }));

  // 10. Resolve final proposal
  const selectedCandidate = resolveProposal(
    fireControlledCandidates.filter(c => c.fireControl.fired),
    config.priority
  );

  // 11. Generate proposal
  const proposal = selectedCandidate
    ? generateProposal(selectedCandidate, state, features, config)
    : null;

  // 12. Return decision trace
  return {
    timestampSec: state.timeSec,
    features,
    smoothedFeatures,
    scores: {
      baseSafetyRisk,
      restRequiredScore,
      monotonyPreventionScore
    },
    velocities: {
      restVelocity,
      monotonyVelocity
    },
    states: {
      restState,
      monotonyState
    },
    candidates: fireControlledCandidates,
    selectedCandidate,
    proposal,
    explanation: generateExplanation({
      features,
      scores: {
        baseSafetyRisk,
        restRequiredScore,
        monotonyPreventionScore
      },
      selectedCandidate,
      proposal
    })
  };
}
```

---

## 19. Default Hypothesis Package Configuration

```yaml
id: aica_transparent_hybrid_trigger_v1
name:
  en: AICA Transparent Hybrid Trigger Algorithm v1
  ja: AICA透明ハイブリッド発火アルゴリズム v1

version: 0.1.0

tick_seconds: 30

smoothing:
  alpha: 0.35

base_safety_risk:
  weights:
    drowsiness_score: 0.40
    fatigue_score: 0.25
    driving_anomaly_score: 0.25
    future_fatigue_score: 0.10

rest_required:
  minimum_risk_for_rest_bonus: 0.45
  bonus_weights:
    rest_window_score: 0.10
    rest_scarcity_score: 0.08
  thresholds:
    watch: 0.45
    suggest: 0.62
    recommend: 0.76
    urgent: 0.88

monotony_prevention:
  weights:
    monotony_score: 0.30
    familiar_route_score: 0.20
    attention_drop_score: 0.25
    traffic_jam_score: 0.15
    long_highway_score: 0.10
  thresholds:
    watch: 0.40
    suggest: 0.58
    strong_suggest: 0.75

persistence:
  rest_required_ticks: 2
  monotony_prevention_ticks: 3
  skip_persistence_if:
    rest_required_score_above: 0.88
    score_velocity_above: 0.08

fire_control:
  default_min_interval_min: 10
  max_proposals_per_30min: 3
  result_based_cooldown_min:
    accepted: 5
    completed: 5
    rejected: 15
    ignored: 12
    cancelled: 10
  category_specific_cooldown_min:
    rest_required: 8
    monotony_prevention: 12
  emergency_override:
    rest_required_score: 0.88
    base_safety_risk: 0.82
    driving_anomaly_score: 0.75
    score_velocity: 0.08

priority:
  - rest_required
  - monotony_prevention

editable_hyperparameters:
  feature_mapping:
    - trip_duration_pressure_curve
    - traffic_jam_score_curve
    - long_highway_score_curve
    - rest_window_score_curve
    - rest_scarcity_score_curve
  weights:
    - base_safety_risk.weights.*
    - rest_required.bonus_weights.*
    - monotony_prevention.weights.*
  thresholds:
    - rest_required.thresholds.*
    - monotony_prevention.thresholds.*
  persistence:
    - rest_required_ticks
    - monotony_prevention_ticks
    - skip_persistence_if.*
  fire_control:
    - default_min_interval_min
    - max_proposals_per_30min
    - result_based_cooldown_min.*
    - category_specific_cooldown_min.*
    - emergency_override.*
  priority:
    - priority
```

---

## 20. Decision Trace Output

Every simulation tick should emit a decision trace.

Example:

```json
{
  "timestampSec": 900,
  "features": {
    "drowsiness_score": 0.74,
    "fatigue_score": 0.62,
    "driving_anomaly_score": 0.30,
    "future_fatigue_score": 0.55,
    "rest_window_score": 0.90,
    "rest_scarcity_score": 0.40,
    "monotony_score": 0.35,
    "familiar_route_score": 0.70,
    "attention_drop_score": 0.45
  },
  "scores": {
    "baseSafetyRisk": 0.58,
    "restRequiredScore": 0.71,
    "monotonyPreventionScore": 0.44
  },
  "states": {
    "rest": "REST_SUGGEST",
    "monotony": "MONOTONY_WATCH"
  },
  "candidates": [
    {
      "category": "rest_required",
      "exists": true,
      "score": 0.71,
      "strength": "gentle",
      "fireControl": {
        "fired": true,
        "suppressed": false,
        "reason": "fire_control_passed"
      }
    }
  ],
  "proposal": {
    "category": "rest_required",
    "strength": "gentle",
    "message": {
      "en": "There is a rest spot about 7 minutes ahead. You seem a little tired. Would you like to take a short break?",
      "ja": "約7分先に休憩できる場所があります。少しお疲れのようです。短く休憩していきますか？"
    }
  },
  "explanation": {
    "en": [
      "Drowsiness score is high.",
      "Fatigue score is moderate.",
      "A rest spot is available soon.",
      "The rest-required score exceeded the suggestion threshold.",
      "No recent proposal cooldown blocked the proposal."
    ],
    "ja": [
      "眠気スコアが高い状態です。",
      "疲労スコアは中程度です。",
      "近くに休憩可能な場所があります。",
      "休憩提案スコアが提案しきい値を超えました。",
      "直近提案によるクールダウンには該当しません。"
    ]
  }
}
```

---

## 21. Example Scenario

### 21.1 Scenario Input

```yaml
scenario:
  driver:
    drowsinessLevel: 68
    fatigueLevel: 60
    attentionLevel: 55

  vehicle:
    speedKph: 80
    steeringInstabilityLevel: 20
    laneDepartureCount: 0

  route:
    distanceToDestinationMin: 45
    nextRestSpotMin: 7
    restSpotDensityNext30Min: 1
    highwayRemainingMin: 25
    familiarRouteRatio: 0.7

  environment:
    isNight: true
    trafficJamAheadMin: 15
    lowSpeedDurationMin: 0

  proposalHistory:
    proposalCountLast30Min: 0
```

### 21.2 Feature Result

```yaml
features:
  drowsiness_score: 0.68
  fatigue_score: 0.62
  driving_anomaly_score: 0.20
  traffic_jam_score: 0.60
  long_highway_score: 0.30
  future_fatigue_score: 0.375
  rest_window_score: 1.00
  rest_scarcity_score: 0.70
```

### 21.3 Score Calculation

```text
base_safety_risk =
  0.40 * 0.68
+ 0.25 * 0.62
+ 0.25 * 0.20
+ 0.10 * 0.375
= 0.5145
```

```text
rest_required_score =
  0.5145
+ 0.10 * 1.00
+ 0.08 * 0.70
= 0.6705
```

Since `0.6705 > suggest threshold 0.62`, AICA creates a rest suggestion candidate.

If fire-control passes, AICA proposes:

```text
There is a rest spot about 7 minutes ahead. You seem a little tired. Would you like to take a short break?
```

The test user may review:

```text
Timing: Good
Tone: Too weak
Reason: Driver is already sleepy and the next rest spot is the best opportunity.
```

Then the test user may change one or more hyperparameters and replay:

```yaml
rest_required.thresholds.recommend: 0.72
base_safety_risk.weights.drowsiness_score: 0.45
```

---

## 22. Simulator Requirements for This Algorithm

The simulator should support the following capabilities for this hypothesis package.

### 22.1 Hypothesis Package Selection

The test user can select:

```text
aica_transparent_hybrid_trigger_v1
```

from the available hypothesis packages.

### 22.2 Hyperparameter Editing

The simulator should allow the test user to modify:

```text
feature mapping curves
weights
thresholds
persistence settings
fire-control cooldowns
emergency override values
proposal priority order
```

### 22.3 Replay and Comparison

The simulator should allow:

```text
Run scenario with current settings
Save run as baseline
Modify hyperparameters
Replay same scenario
Compare proposal timing, proposal strength, fire-control result, and trace differences
```

### 22.4 Bilingual UI

The simulator should support switchable English and Japanese UI.

The algorithm package should provide:

```text
English proposal messages
Japanese proposal messages
English explanation lines
Japanese explanation lines
```

### 22.5 Review Feedback

After playback, the test user should be able to provide feedback such as:

```yaml
timing_review:
  - too_early
  - good
  - too_late
  - unnecessary

tone_review:
  - too_weak
  - appropriate
  - too_strong

proposal_content_review:
  - appropriate
  - wrong_content
  - wrong_rest_spot
  - too_many_options
  - unclear

safety_review:
  - safe
  - intrusive
  - unsafe

free_comment: string
```

The simulator records the feedback but does not autonomously judge the algorithm as correct or incorrect.

---

## 23. Acceptance Criteria

The algorithm package is acceptable for v1 if:

1. AICA can load the algorithm package at runtime.
2. The simulator can run at least one rest-required scenario.
3. The simulator can run at least one monotony-prevention scenario.
4. Each simulation tick emits a decision trace.
5. The test user can see raw parameters, feature scores, trigger scores, and fire-control results.
6. The test user can modify key hyperparameters and replay the scenario.
7. The simulator can compare baseline and modified runs.
8. Proposal messages and explanations are available in English and Japanese.
9. Test-user review feedback is recorded with the simulation trace.
10. The simulator does not claim that the algorithm is correct or incorrect; it only records experience and review evidence.

---

## 24. Recommended Implementation Order

Although this document is an algorithm proposal, the following order is recommended for implementation planning:

1. Define hypothesis package schema.
2. Implement feature extraction for v1 features.
3. Implement scoring functions.
4. Implement state threshold classification.
5. Implement persistence and smoothing.
6. Implement fire-control.
7. Implement priority resolver.
8. Implement proposal generation with English/Japanese messages.
9. Implement decision trace output.
10. Implement simulator UI controls for hyperparameter editing.
11. Implement replay and before/after comparison.
12. Implement review feedback capture.

---

## 25. Future Extensions

### 25.1 Rule-Based Variant

A pure rule-based hypothesis package can be added for comparison.

Example:

```text
if drowsiness_score > 0.75 and nextRestSpotMin < 10:
    fire rest proposal
```

### 25.2 AI/ML-Based Variant

After enough simulator feedback is collected, a model can be trained to estimate:

```text
probability that proposal timing will be reviewed as good
probability that proposal will be accepted
probability that proposal will be reviewed as too early or too late
```

Recommended early model types:

```text
logistic regression
small decision tree
gradient boosted trees
contextual bandit for proposal selection
```

### 25.3 LLM-Assisted Variant

LLM should not be the real-time trigger judge in v1. However, LLM can assist with:

```text
scenario variation generation
natural language explanation
feedback summarization
candidate hyperparameter change suggestions
requirement-change candidate drafting
hypothesis package drafting
```

Boundary:

```text
The LLM assists the test user.
The LLM does not replace the test user's review.
```

---

## 26. Summary

The recommended first AICA trigger algorithm is:

> **Transparent Hybrid Trigger Algorithm v1**

It combines:

```text
feature scoring
weighted trigger scoring
state machine thresholds
trend and persistence checks
rule-based fire-control
priority resolution
editable hyperparameters
bilingual proposal/explanation output
full decision trace
```

This algorithm is suitable for AICA because it helps the test user experience and review the algorithm behavior, rather than hiding decisions inside an opaque model.

It should become the first official hypothesis package:

```text
aica_transparent_hybrid_trigger_v1
```

Future algorithms can then be compared against this baseline.
