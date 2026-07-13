# AICA Stage-Constrained LLM Proposal Service Selection Simulator Specification

**Document type:** Implementation specification  
**Target implementer:** Claude Code / software engineer / simulator builder  
**Target simulator phase:** Proposal service selection and concrete content selection after rest-recommended trigger  
**Primary source document:** `CDC-SU_specplan.md` converted from `CDC-SU_音楽企画_システム要求仕様書.pptx`  
**Focus scope:** `危険運転防止` → `①休憩が推奨される状態（疲れている or 今後疲労する）`

---

## 1. Executive Summary

This specification defines the next AICA simulator phase after the trigger algorithm.

The previous phase answers:

```text
When should AICA fire because rest is recommended?
```

This proposal phase answers:

```text
At each real-time stage of the rest-support journey,
which service type should AICA propose,
what concrete content should be selected inside that service,
how should the content be played,
and how should the test user review the result?
```

The algorithm is a **hybrid algorithm**:

```text
Deterministic rules = stage, safety boundary, document constraint, service eligibility, end condition
LLM agents = contextual service selection, explanation, proposal wording, concrete content proposal
Test user = final reviewer through simulator feedback
```

This is necessary because the PowerPoint does not define one flat recommendation problem. It defines a multi-step proposal flow:

```text
発火
→ コンテンツ案の表示順決め
→ コンテンツ選択
→ 具体コンテンツ内容検討
→ コンテンツ提供
→ コンテンツ終了判断
→ コンテンツ終了後アクション
```

Reference: `CDC-SU_specplan.md`, **Slide 64: コンテンツ提供～終了時における流れ（提案①）**.

The simulator must reproduce this flow interactively, so the test user can experience and review AICA behavior step by step.

---

## 2. Why This Phase Is Needed

### 2.1 Trigger alone is not enough

The trigger algorithm only determines that the user is in a state where rest is recommended:

```text
①休憩が推奨される状態
（疲れている or 今後疲労する）
```

However, the PowerPoint shows that after this state is detected, AICA must still decide:

1. What service to propose while driving to the rest spot.
2. What rest method/time to propose at the rest spot.
3. What recovery content to propose after rest.
4. What actual playlist, karaoke songs, quiz genre, video, or oshi-related content to use.
5. How the content should end or transition to another action.

References:

- `CDC-SU_specplan.md`, **Slide 26**: shows `提案サービス選択`, `具体提案内容検討`, `発話・コンテンツ再生`, `コンテンツ再生終了判断`.
- `CDC-SU_specplan.md`, **Slide 64**: defines the flow for `①危険運転防止向け提案`.
- `CDC-SU_specplan.md`, **Slides 66–70**: define how service order and concrete content should be decided.
- `CDC-SU_specplan.md`, **Slides 81–82**: define content provision and ending behavior.

### 2.2 The PowerPoint constrains service type by stage

AICA cannot freely propose any service at any time.

The document separates services into:

| Stage / category | Document meaning | Reference |
|---|---|---|
| 走行中コンテンツ | Supports fatigue recovery / wakefulness while driving until rest spot | Slide 38, Slide 39 |
| 停車中コンテンツ | Provides refresh/reward content at rest location, mostly screen/video-based | Slide 38, Slide 40 |
| 休憩中 support | Helps user actually rest: time/method/nap/seat/rest continuation | Slide 2 and rest-related use-case slides |

Therefore, the proposal algorithm must be **stage-constrained**.

### 2.3 The selection logic requires context, not only rules

Slides 66–67 say content display priority should be determined from:

```text
ユーザーの状況 × ユーザーの好み × 過去実績
```

The document also lists many judgment materials:

- Current driver state: `眠気`, `疲労度`
- Driving environment: `渋滞中`, `高速道路`, `夜間`, `単調な道`
- Route/destination features
- Passenger composition
- Oshi information
- Unused/rarely used functions
- Usage frequency
- Scene-specific preference
- Proposal acceptance rate
- Recovery rate

Reference: `CDC-SU_specplan.md`, **Slide 66: コンテンツ案の表示順決めプロセス・分析データ**, **Slide 67: 提案コンテンツ優先度判断材料**.

This is hard to maintain as pure rules. LLM is useful because it can interpret heterogeneous context and explain why a service is appropriate. But LLM must not bypass document constraints. Therefore the chosen approach is hybrid.

---

## 3. Scope

### 3.1 In scope

This specification covers only the proposal phase for:

```text
危険運転防止
①休憩が推奨される状態
（疲れている or 今後疲労する）
```

In scope:

1. Multi-step rest-support simulation.
2. Stage determination.
3. Stage-constrained service catalog.
4. Safety and feasibility filtering.
5. LLM-based service selection from allowed candidates.
6. LLM-based concrete content proposal after service selection.
7. Simulator playback for proposal speech, options, content start, content end, and transitions.
8. Test-user feedback collection.
9. Full trace output for review and later improvement.

### 3.2 Out of scope for this phase

1. Final production vehicle control.
2. Legal validation for in-car display rules.
3. Real copyrighted music/video integration.
4. Fully trained recommendation model such as LightGBM or transformer.
5. Trigger algorithm design; trigger result is an input.
6. Non-rest proposal categories such as child passenger proposal or route-only music proposal, except where referenced as future extension.

---

## 4. Source Mapping to PowerPoint

The implementation must point to `CDC-SU_specplan.md` when explaining behavior.

| Spec decision | PowerPoint / Markdown reference |
|---|---|
| Use stage-constrained service categories | `CDC-SU_specplan.md`, Slide 38 |
| Running service list | Slide 39 |
| Stopped service list | Slide 40 |
| Service use cases | Slides 41–61 |
| Proposal flow for rest/danger prevention | Slide 64 |
| Service priority/display ordering | Slides 66–67 |
| Concrete content selection flow | Slides 68–70 |
| Service-specific concrete content inputs | Slides 71–80 |
| Content provision/end conditions for AI proposal start | Slide 81 |
| Content provision/end conditions for user request start | Slide 82 |

---

## 5. Core Concept

The simulator should model AICA proposal behavior as a real-time event-driven state machine.

```text
Rest trigger fired
→ before-rest proposal while driving
→ user/tester chooses an option
→ content plays until rest spot or end condition
→ vehicle arrives at rest spot
→ rest method/time proposal
→ user rests/naps or skips
→ rest finishes / user returns / IG-ON
→ after-rest service proposal
→ user/tester chooses an option
→ content plays
→ content ends or driving starts
→ feedback collected
```

At each step:

1. Current state is updated.
2. Available services are constrained by stage.
3. Unsafe or unavailable services are blocked.
4. LLM selects from allowed candidates only.
5. LLM emits structured output with reason.
6. Simulator displays the decision trace.
7. Test user can accept, reject, choose alternative, or give review feedback.

---

## 6. Stage Model

### 6.1 Stage enum

```ts
type ProposalStage =
  | "before_rest_until_stop"
  | "during_rest_stopped"
  | "after_rest_before_restart";
```

### 6.2 Stage A: before_rest_until_stop

Japanese label:

```text
休憩前 / 休憩所まで / 走行中
```

Purpose:

```text
休憩所に到着するまで、眠気・疲労を抑え、安全に停止までつなぐ。
```

Reference:

- `CDC-SU_specplan.md`, Slide 38: 走行中コンテンツ definition.
- `CDC-SU_specplan.md`, Slide 39: 走行中コンテンツ service list.
- `CDC-SU_specplan.md`, Slide 64: 提案① flow includes 走行中コンテンツ before arriving at rest spot.

Allowed service types:

| Service ID | Japanese | Reference |
|---|---|---|
| `music_recommend` | 音楽レコメンド | Slide 39, Slides 41–42, Slide 71 |
| `humming_karaoke` | 鼻歌カラオケ | Slide 39, Slides 43–44, Slide 72 |
| `call_and_response` | 合いの手練習 | Slide 39, Slides 45–47, Slide 73 |
| `quiz` | クイズ | Slide 39, Slides 48–49, Slide 74 |
| `ranking` | ランキング作成 | Slide 39, Slides 50–51, Slide 75 |
| `radio` | ラジオ風再生 | Slide 39, Slides 52–53, Slide 76 |
| `lighting` | ライティング | Slide 39; supporting feature, not standalone in V1 |

### 6.3 Stage B: during_rest_stopped

Japanese label:

```text
休憩所到着 / 停車中 / 休憩中
```

Purpose:

```text
ユーザーが実際に休憩できる状態を作る。
```

Reference:

- `CDC-SU_specplan.md`, Slide 2: rest method/time proposal, seat adjustment, nap, rest continuation confirmation.
- Rest-related use-case slides show arrival, parking, nap/rest, and post-rest flow.

Allowed proposal types:

| Proposal Type ID | Japanese | Purpose | Reference |
|---|---|---|---|
| `rest_duration_suggestion` | 休憩時間提案 | Suggest rest duration | Slide 2 |
| `rest_method_suggestion` | 休憩方法提案 | Suggest nap/stretch/light rest | Slide 2 |
| `seat_adjustment` | シート調整提案 | Confirm seat adjustment before rest | Slide 2 |
| `nap_guidance` | 仮眠促進 | Help user sleep/rest | Slide 2 and rest-flow use cases |
| `rest_extension_check` | 休憩継続確認 | Ask whether to continue rest | Slide 2 |

This stage is not primarily entertainment recommendation. It is a rest execution step.

### 6.4 Stage C: after_rest_before_restart

Japanese label:

```text
休憩後 / 停車中 / 走行再開前
```

Purpose:

```text
休憩後の身体をゆっくり起こし、漫然運転を防止する。
```

Reference:

- `CDC-SU_specplan.md`, Slide 38: 停車中コンテンツ definition.
- `CDC-SU_specplan.md`, Slide 40: 停車中コンテンツ service list.
- `CDC-SU_specplan.md`, Slides 54–61: stopped/post-rest service use cases.

Allowed service types:

| Service ID | Japanese | Reference |
|---|---|---|
| `live_viewing` | ライブビューイング | Slide 40, Slides 54–55, Slide 77 |
| `stretch_video` | ストレッチ動画 | Slide 40, Slides 56–57, Slide 78 |
| `full_karaoke` | カラオケ | Slide 40, Slides 58–59, Slide 79 |
| `call_and_response_video` | 合いの手練習 | Slide 40, Slides 45–47, Slide 73 |
| `oshi_reexperience` | 推し追体験 | Slide 40, Slides 60–61, Slide 80 |
| `relaxation_multisensory` | リラックス（多感覚連携） | Slide 26/38 concept; future extension |

---

## 7. High-Level Algorithm

### 7.1 Algorithm name

```text
Stage-Constrained LLM Proposal Service Selection Algorithm
```

### 7.2 Algorithm summary

```text
1. Receive rest-recommended trigger result.
2. Determine current simulation stage.
3. Load service candidates allowed by that stage.
4. Apply safety and feasibility filters.
5. Compute optional heuristic priority hints.
6. Ask Service Selection LLM Agent to choose from allowed services only.
7. Display selected service, alternatives, blocked services, and reason in simulator.
8. Accept test-user action.
9. Ask Concrete Content LLM Agent to generate actual content for selected service.
10. Simulate content playback and ending behavior using rule engine.
11. Collect feedback at stage, service, content, speech, safety, and UX levels.
12. Save trace as evidence for algorithm improvement.
```

### 7.3 Why hybrid, not pure rules or pure LLM

Pure rules are good for:

- stage decision;
- service allowed by document;
- moving/stopped restrictions;
- visual-heavy restrictions;
- end conditions;
- driving-start behavior;
- trace consistency.

Pure LLM is good for:

- reasoning across user context, environment, external information, preference, and past result;
- selecting a natural proposal among allowed choices;
- generating Japanese/English proposal wording;
- summarizing reason for human review;
- generating concrete playlist/quiz/video policy.

Final design:

```text
Rules = boundary and lifecycle
LLM = contextual proposal intelligence
Human/test user = final reviewer
```

---

## 8. Simulator Events

### 8.1 Event enum

```ts
type SimulationEventType =
  | "rest_trigger_fired"
  | "service_proposal_presented"
  | "driver_accepts_service"
  | "driver_rejects_service"
  | "driver_selects_alternative_service"
  | "content_started"
  | "content_completed"
  | "arrived_at_rest_spot"
  | "vehicle_stopped"
  | "rest_method_proposed"
  | "rest_started"
  | "nap_started"
  | "nap_finished"
  | "rest_extension_requested"
  | "driver_returns_to_car"
  | "ig_on_after_rest"
  | "after_rest_service_proposed"
  | "driving_started"
  | "content_transitioned"
  | "review_feedback_submitted";
```

### 8.2 Main event flow

```text
E1 rest_trigger_fired
  → stage = before_rest_until_stop
  → select before-rest service
  → propose service
  → user action

E2 content_started
  → simulate selected content until completion, rest arrival, or user stop

E3 arrived_at_rest_spot + vehicle_stopped
  → stage = during_rest_stopped
  → propose rest duration/method
  → user action

E4 nap_finished / rest_finished / driver_returns_to_car / ig_on_after_rest
  → stage = after_rest_before_restart
  → select after-rest service
  → propose service
  → user action

E5 content_completed / driving_started
  → apply end behavior
  → ask continuation / switch / return / finish

E6 review_feedback_submitted
  → store evidence
```

---

## 9. Data Model

### 9.1 Simulation context

```ts
type ProposalSimulationContext = {
  sessionId: string;
  scenarioId: string;
  language: "ja" | "en";
  currentTimeSec: number;
  currentStage: ProposalStage;

  triggerContext: TriggerContext;
  driverState: DriverState;
  vehicleState: VehicleState;
  routeContext: RouteContext;
  environmentContext: EnvironmentContext;
  externalContext: ExternalContext;
  userContext: UserContext;
  historyContext: HistoryContext;

  activeContent?: ActiveContentState;
  previousContent?: PreviousContentState;
  proposalHistory: ProposalHistory;
};
```

### 9.2 Trigger context

Input from trigger algorithm.

```ts
type TriggerContext = {
  triggerCategory: "rest_recommended";
  reasonTags: Array<"tired_now" | "future_fatigue_expected" | "drowsiness" | "driving_anomaly" | "rest_opportunity" | "traffic_or_highway_fatigue">;
  riskLevel: "low" | "medium" | "high" | "urgent";
  restRequiredScore?: number;
  drowsinessScore?: number;
  fatigueScore?: number;
  futureFatigueScore?: number;
  drivingAnomalyScore?: number;
  explanation: string[];
};
```

### 9.3 Driver state

```ts
type DriverState = {
  drowsinessLevel: "low" | "medium" | "high" | "urgent";
  fatigueLevel: "low" | "medium" | "high";
  attentionLevel?: "low" | "medium" | "high";
  responseDelay?: "normal" | "slow" | "very_slow";
  voiceEnergy?: "normal" | "low";
  selfAwarenessOfFatigue?: "low" | "medium" | "high";
};
```

### 9.4 Vehicle state

```ts
type VehicleState = {
  moving: boolean;
  stopped: boolean;
  speedKph?: number;
  igOn: boolean;
  atRestSpot: boolean;
  seatAdjustable?: boolean;
  displayAvailable?: boolean;
  rearSeatDisplayAvailable?: boolean;
};
```

### 9.5 Route context

```ts
type RouteContext = {
  destinationName?: string;
  distanceToDestinationMin?: number;
  nextRestSpotMin?: number;
  nextRestSpotType?: "sa_pa" | "convenience_store" | "parking" | "other";
  restSpotDensityNext30Min?: number;
  highwayRemainingMin?: number;
  trafficJamAheadMin?: number;
  monotonousRoadRemainingMin?: number;
  routeFeatureTags?: Array<"sea" | "mountain" | "city" | "night_view" | "oshi_related" | "ordinary_commute">;
};
```

### 9.6 Environment context

```ts
type EnvironmentContext = {
  timeOfDay: "morning" | "day" | "evening" | "night" | "late_night";
  weather: "clear" | "rain" | "snow" | "fog" | "hot" | "cold" | "unknown";
  roadType: "highway" | "local" | "mountain" | "tunnel" | "parking" | "unknown";
  lightingCondition?: "bright" | "dark";
  passengerComposition?: "alone" | "friend" | "family" | "child" | "multiple" | "unknown";
};
```

### 9.7 External context

```ts
type ExternalContext = {
  restSpotOpen?: boolean;
  restSpotCongestion?: "low" | "medium" | "high" | "unknown";
  parkingAvailability?: "available" | "limited" | "full" | "unknown";
  musicServiceAvailable?: boolean;
  karaokeServiceAvailable?: boolean;
  videoServiceAvailable?: boolean;
  quizGenerationAvailable?: boolean;
  radioInfoAvailable?: boolean;
  oshiLatestInfoAvailable?: boolean;
  networkAvailable?: boolean;
};
```

### 9.8 User context

```ts
type UserContext = {
  oshiEnabled: boolean;
  oshiProfileAvailable: boolean;
  musicPreference?: "low" | "medium" | "high";
  singingPreference?: "low" | "medium" | "high";
  quizPreference?: "low" | "medium" | "high";
  videoPreference?: "low" | "medium" | "high";
  stretchPreference?: "low" | "medium" | "high";
  radioPreference?: "low" | "medium" | "high";
  restAcceptanceTendency?: "low" | "medium" | "high";
  userProfileSummary?: string;
  scheduleTags?: Array<"upcoming_live" | "event_soon" | "none" | "unknown">;
};
```

### 9.9 History context

```ts
type HistoryContext = {
  recentlyUsedServices: string[];
  recentlyRejectedServices: string[];
  serviceAcceptanceRate?: Record<string, number>;
  serviceRecoveryRate?: Record<string, number>;
  sceneSpecificPreference?: Record<string, string[]>;
  skippedSongsOrVideos?: string[];
  previousQuizGenres?: string[];
  previousRankingThemes?: string[];
  previousRadioTopics?: string[];
  previousOshiSpots?: string[];
};
```

---


## 9.5 Slide 67 Feature Alignment and Simulator Data-Readiness Matrix

This section updates the specification to align explicitly with `CDC-SU_specplan.md`, **Slide 67: コンテンツ具体内容検討プロセス・分析データ** and the surrounding feature-selection pages.

Slide 67 says that concrete content selection should use information already analyzed during display-order/service selection, plus additional information required for concrete content generation. The slide organizes the inputs into three major groups:

```text
状況 / Situation
好み / Preference
過去実績 / Past performance
```

It also shows that content selection should consider questions such as:

```text
今、ドライバーはどんな状況か？
ユーザーは普段何を好むか？
本当に通るか？
効果はあったのか？
```

Therefore, the simulator must not assume all features are real or available. For each feature, the simulator must track whether it is:

| Data status | Meaning | Simulator handling |
|---|---|---|
| `real_input` | Comes from real integration or uploaded data | Use directly and show source |
| `scenario_parameter` | Defined by scenario author/test user | Editable in scenario setup |
| `simulated_persona` | Mock user/profile/history data | Clearly marked as simulated |
| `runtime_collected` | Produced by simulator during playback | Stored in trace and evidence |
| `future_integration` | Not available now, but expected later | Mock now, document required data |

The LLM agents must receive both the feature value and the data status. If a feature is simulated, the UI and LLM explanation must make that visible.

### 9.5.1 Feature List From Slide 67 and Required Data

| Slide 67 group | Feature / input | Japanese reference | Purpose in algorithm | Data needed | Can use in simulator now? | Simulator approach |
|---|---|---|---|---|---|---|
| Situation | Current driver state | `現在のドライバー状態（眠気、疲労度）` | Determine safety pressure and suitable interaction load | Drowsiness score, fatigue score, trigger output, camera/voice/CAN data if available | Yes | Use trigger algorithm output or scenario sliders/time-series |
| Situation | Driving environment | `走行環境（渋滞中、高速道路、夜間、単調な道）` | Select services suitable for current road condition | VICS/traffic, road type, highway flag, night flag, monotony flag | Yes | Use route/environment presets; later replace with route/VICS integration |
| Situation | Characteristic route / destination | `特徴的なルート・目的地` | Generate context-matched content theme | Navi destination, route tags, scenic/oshi/location metadata | Partly | Use mocked route tags such as sea/mountain/city/oshi-related |
| Situation | Passenger composition | `同乗者構成（子供有無、複数人）` | Avoid unsuitable content and select passenger-aware content | mmWave/camera/passenger count/child state | Yes as scenario | Use scenario toggles: alone/friend/child/multiple passengers |
| Situation | Driving state | `走行状態（走行中/停車中）` | Hard safety gating for visual/video/heavy interaction services | Vehicle speed, parking state, IG state | Yes | Deterministic simulator event state: moving/stopped/resting/restart |
| Preference | Scene-specific preference | `場面別の好み傾向` | Prefer content that user likes under similar context | Usage logs grouped by scene, e.g. traffic/night/child/passenger | No real data initially | Use simulated persona profile; collect during simulator runs |
| Preference | Overall usage frequency | `全体的な利用頻度` | Prefer familiar services, or avoid overusing one service | Service usage history | No real data initially | Use mock usage history; later use actual app/service logs |
| Preference | Oshi information | `推し情報（登録有無・ON/OFF設定）` | Enable/disable oshi-related content and personalization | Oshi registration, ON/OFF setting, favorite artist/group/content | Yes as scenario | Use profile toggle and mock oshi profile; mark as simulated |
| Preference | Unused / rarely used functions | `未使用機能（未使用/久しぶりのコンテンツ）` | Add novelty and avoid repetitive proposals | Feature usage history by service | No real data initially | Simulate last-used timestamps; collect from simulator trace |
| Preference | UPro information | `UPro情報（年代/性別、趣味嗜好などユーザーの登録情報）` | Personalize service and content style | User profile, preference categories | Partly | Use coarse mock persona only; avoid over-personal assumptions |
| Preference | Schedule | `スケジュール（推しのイベントなどユーザーの直近予定）` | Make content relevant to upcoming events | Calendar, oshi event schedule, user plan | No real data initially | Use optional simulated upcoming event |
| Preference | User operation history / content selection | `ユーザー操作履歴`, `ユーザーによるコンテンツ選択` | Learn what user actually selects in the simulator | Playback choices, skip/change logs, selected service/content | Yes after first run | Runtime-collected by simulator |
| Past performance | Proposal acceptance rate | `提案受諾率` | Prioritize services likely to be accepted | Accept/reject/ignore logs by service and context | No real data initially | Simulate baseline; collect from simulator feedback |
| Past performance | Recovery rate | `回復率` | Prioritize services that reduce drowsiness/fatigue | Before/after fatigue/drowsiness scores, user recovery feedback | No real data initially | Use simulated recovery model; later replace with measured outcomes |

### 9.5.2 Minimum Feature Set for V1 Simulator

For the first simulator prototype, implement these features because they can be controlled in scenario setup and are enough to demonstrate the slide-67 logic.

| Priority | Feature | Reason |
|---|---|---|
| Must have | Current driver state: drowsiness/fatigue | Required for safety and rest context |
| Must have | Driving state: moving/stopped/resting/after-rest | Required for stage and service gating |
| Must have | Driving environment: traffic/highway/night/monotony | Required by slide 67 and service-specific input pages |
| Must have | Passenger composition | Required for passenger-aware service/content selection |
| Must have | Oshi setting ON/OFF | Required because page 26 and later service pages use oshi context |
| Must have | Overall preference profile | Needed for LLM service selection and content wording |
| Must have | Acceptance/rejection in simulator | Needed to start creating proposal acceptance data |
| Should have | Scene-specific preference | Can be simulated and reviewed by tester |
| Should have | Usage frequency / unused functions | Needed to test over-proposal and diversity behavior |
| Should have | Recovery effect feedback | Needed to prepare future learning dataset |
| Later | Real VICS / real user profile / real media history | Useful for production-like validation, not required for V1 |

### 9.5.3 Data Readiness Strategy

The simulator must support cold-start operation. At the beginning, most preference and past-performance features do not exist as real data. Therefore, the simulator must provide a **data source selector** for each scenario:

```yaml
feature_data_sources:
  current_driver_state: scenario_parameter
  driving_environment: scenario_parameter
  route_destination: scenario_parameter
  passenger_composition: scenario_parameter
  driving_state: runtime_event
  oshi_information: simulated_persona
  overall_usage_frequency: simulated_persona
  scene_specific_preference: simulated_persona
  unused_function_state: simulated_persona
  schedule: simulated_persona
  user_operation_history: runtime_collected
  proposal_acceptance_rate: simulated_persona_then_runtime_collected
  recovery_rate: simulated_outcome_then_runtime_collected
```

The UI must clearly show this to the test user. Example:

```text
Feature: 提案受諾率 / Proposal acceptance rate
Value: 鼻歌カラオケ = high, クイズ = low
Source: simulated_persona
Meaning: This is not real user history. It is a scenario assumption for review.
```

### 9.5.4 How Slide 67 Features Enter the Hybrid Algorithm

The algorithm uses slide-67 features at three points.

#### A. Service candidate ranking

```text
service_score =
  situation_fit
+ preference_fit
+ past_performance_fit
+ novelty_fit
- safety_burden
- interaction_burden
- unavailable_penalty
```

Feature usage:

| Score component | Slide 67 features used |
|---|---|
| `situation_fit` | Current driver state, driving environment, route/destination, passenger composition, driving state |
| `preference_fit` | UPro, oshi information, usage frequency, scene-specific preference, schedule |
| `past_performance_fit` | proposal acceptance rate, recovery rate, operation history |
| `novelty_fit` | unused / rarely used functions |
| `safety_burden` | drowsiness/fatigue, moving/stopped, road complexity |
| `interaction_burden` | service interaction load, passenger context, driving state |

#### B. LLM service selection

The LLM receives the ranked service list plus slide-67 context. The LLM must output a reason using the same feature groups.

Example required reason format:

```json
{
  "selected_service": "humming_karaoke",
  "reason_by_feature_group": {
    "situation": [
      "The driver is moderately tired and the vehicle is moving until the rest spot."
    ],
    "preference": [
      "The simulated persona has high music preference and oshi setting is ON."
    ],
    "past_performance": [
      "The simulated history shows high acceptance for music-like services and low acceptance for quiz."
    ],
    "constraints": [
      "Video services are blocked because the vehicle is moving."
    ]
  }
}
```

#### C. Concrete content generation

After selecting the service, the concrete content agent uses the same slide-67 feature groups plus service-specific inputs from slides 70–80.

Example:

```text
Selected service: 鼻歌カラオケ
Situation: 休憩所まで10分、夜間、走行中、疲労中
Preference: 推し情報ON、音楽利用頻度高
Past performance: クイズ拒否傾向、音楽受諾率高
Concrete content: サビのみ / 2〜3曲 / 画面なし / 推しジャンル寄り / 休憩所到着前に終了
```

### 9.5.5 UI Requirements for Feature/Data Readiness

The simulator UI must include a **Feature Evidence Panel**.

Minimum fields:

| UI field | Description |
|---|---|
| Feature name | English + Japanese label |
| Current value | Value used by this simulation run |
| Data status | `real_input`, `scenario_parameter`, `simulated_persona`, `runtime_collected`, or `future_integration` |
| Used by | service ranking / LLM service selection / concrete content generation / safety filter |
| Reason text | Human-readable reason shown in decision trace |
| Editable? | Whether the test user can change it before replay |

This panel is required because the customer specifically needs to know which features are usable in the simulator and which require simulation.

### 9.5.6 Implementation Rule

Every decision trace must include feature provenance.

```json
{
  "feature_provenance": {
    "oshi_information": {
      "value": "enabled",
      "status": "simulated_persona",
      "used_by": ["service_selection", "content_generation"],
      "note": "Mock oshi profile because real user profile data is not integrated."
    },
    "proposal_acceptance_rate": {
      "value": {"humming_karaoke": "high", "quiz": "low"},
      "status": "simulated_persona_then_runtime_collected",
      "used_by": ["service_ranking", "llm_reasoning"],
      "note": "Initial value comes from persona; future values are collected from simulator choices."
    }
  }
}
```


## 10. Stage-Constrained Service Catalog

### 10.1 Catalog schema

```ts
type ServiceCatalogItem = {
  id: string;
  labelJa: string;
  labelEn: string;
  stage: ProposalStage;
  documentRefs: string[];
  usableWhileMoving: boolean;
  stoppedOnly: boolean;
  visualLoad: "none" | "low" | "medium" | "high";
  interactionLoad: "low" | "medium" | "medium_high" | "high";
  requiredCapabilities: string[];
  suitableFor: string[];
  avoidWhen: string[];
  outputType: "playlist" | "karaoke_playlist" | "quiz_set" | "ranking_flow" | "radio_speech" | "video" | "song" | "oshi_story" | "rest_plan";
};
```

### 10.2 Before-rest services

```yaml
before_rest_until_stop:
  - id: music_recommend
    labelJa: 音楽レコメンド
    refs: [Slide 39, Slide 41, Slide 42, Slide 71]
    usableWhileMoving: true
    visualLoad: low
    interactionLoad: low
    outputType: playlist

  - id: humming_karaoke
    labelJa: 鼻歌カラオケ
    refs: [Slide 39, Slide 43, Slide 44, Slide 72]
    usableWhileMoving: true
    visualLoad: none
    interactionLoad: medium
    outputType: karaoke_playlist

  - id: call_and_response
    labelJa: 合いの手練習
    refs: [Slide 39, Slide 45, Slide 46, Slide 47, Slide 73]
    usableWhileMoving: true
    visualLoad: low
    interactionLoad: medium
    outputType: song

  - id: quiz
    labelJa: クイズ
    refs: [Slide 39, Slide 48, Slide 49, Slide 74]
    usableWhileMoving: true
    visualLoad: none
    interactionLoad: medium_high
    outputType: quiz_set

  - id: ranking
    labelJa: ランキング作成
    refs: [Slide 39, Slide 50, Slide 51, Slide 75]
    usableWhileMoving: true
    visualLoad: none
    interactionLoad: medium_high
    outputType: ranking_flow

  - id: radio
    labelJa: ラジオ風再生
    refs: [Slide 39, Slide 52, Slide 53, Slide 76]
    usableWhileMoving: true
    visualLoad: none
    interactionLoad: low
    outputType: radio_speech
```

### 10.3 During-rest proposal types

```yaml
during_rest_stopped:
  - id: rest_duration_suggestion
    labelJa: 休憩時間提案
    refs: [Slide 2]
    outputType: rest_plan

  - id: rest_method_suggestion
    labelJa: 休憩方法提案
    refs: [Slide 2]
    outputType: rest_plan

  - id: nap_guidance
    labelJa: 仮眠促進
    refs: [Slide 2]
    outputType: rest_plan

  - id: seat_adjustment
    labelJa: シート調整提案
    refs: [Slide 2]
    outputType: rest_plan

  - id: rest_extension_check
    labelJa: 休憩継続確認
    refs: [Slide 2]
    outputType: rest_plan
```

### 10.4 After-rest services

```yaml
after_rest_before_restart:
  - id: live_viewing
    labelJa: ライブビューイング
    refs: [Slide 40, Slide 54, Slide 55, Slide 77]
    stoppedOnly: true
    visualLoad: high
    interactionLoad: low
    outputType: video

  - id: stretch_video
    labelJa: ストレッチ動画
    refs: [Slide 40, Slide 56, Slide 57, Slide 78]
    stoppedOnly: true
    visualLoad: high
    interactionLoad: medium
    outputType: video

  - id: full_karaoke
    labelJa: カラオケ
    refs: [Slide 40, Slide 58, Slide 59, Slide 79]
    stoppedOnly: true
    visualLoad: medium
    interactionLoad: high
    outputType: song

  - id: call_and_response_video
    labelJa: 合いの手練習
    refs: [Slide 40, Slide 45, Slide 46, Slide 47, Slide 73]
    stoppedOnly: false
    visualLoad: medium
    interactionLoad: medium
    outputType: song

  - id: oshi_reexperience
    labelJa: 推し追体験
    refs: [Slide 40, Slide 60, Slide 61, Slide 80]
    stoppedOnly: true
    visualLoad: low
    interactionLoad: medium
    outputType: oshi_story
```

---

## 11. Service Eligibility and Filtering Rules

### 11.1 Filter output schema

```ts
type ServiceFilterResult = {
  allowedServices: CandidateService[];
  blockedServices: BlockedService[];
  loweredPriorityServices: CandidateService[];
};

type CandidateService = {
  serviceId: string;
  labelJa: string;
  baseStageAllowed: boolean;
  heuristicScore?: number;
  scoreReasons: string[];
  warnings: string[];
  documentRefs: string[];
};

type BlockedService = {
  serviceId: string;
  labelJa: string;
  reasonCode: string;
  reasonJa: string;
  documentRefs: string[];
};
```

### 11.2 Stage filter

```text
candidate_services = service_catalog where service.stage == currentStage
```

Reason:

- Slide 38 separates 走行中コンテンツ and 停車中コンテンツ.
- Slides 39–40 define the service list for each category.

### 11.3 Moving/stopped filter

```text
If vehicle is moving:
  block stopped-only services.
  block video-heavy services.
  block services requiring long visual attention.

If vehicle is stopped:
  allow stopped services if capability exists.
```

Reason:

- Slide 38 says running content is basically voice-first.
- Slide 40 stopped content includes video/screen-centered services.
- Slide 81 defines stopped-content behavior when driving starts.

### 11.4 Risk severity filter

```text
If riskLevel == urgent:
  prefer simple low-interaction service or rest guidance only.
  lower or block quiz, ranking, and high-interaction services.

If riskLevel == high:
  allow simple audio support.
  lower services that require continuous cognitive response.

If riskLevel == medium:
  allow active wakefulness services such as humming karaoke if stage permits.
```

Reason:

- Slide 38: running content supports fatigue recovery/wakefulness until rest spot.
- Slide 67: high drowsiness/fatigue increases inattentive-driving risk and physical activity/intellectual load may suppress drowsiness.
- This filter is an implementation guardrail inferred from the safety objective.

### 11.5 Capability filter

```text
If music service unavailable:
  block music_recommend.

If karaoke service unavailable:
  block humming_karaoke and full_karaoke.

If video service unavailable:
  block live_viewing and stretch_video.

If oshi profile unavailable:
  lower or block oshi-heavy services.

If latest info unavailable:
  lower or block radio.
```

Reason:

- Slide 39 describes required sources such as streaming app, karaoke app, and radio/latest information.
- Slide 76 says radio-style playback should provide latest information only since previous use.

### 11.6 Environment filter

```text
If weather is rain/snow/fog or night:
  lower outdoor oshi_reexperience.

If road condition is complex or driver state is high risk:
  lower quiz/ranking.

If passenger composition includes child:
  this phase remains rest-focused, but content should not conflict with child/passenger context.
```

Reason:

- Slide 67 includes driving environment and passenger composition as priority judgment materials.
- Slide 80 includes route/destination and oshi-related spot content.

---

## 12. Heuristic Priority Hints

The rule engine should compute non-binding priority hints before calling the LLM.

### 12.1 Priority formula

```text
service_priority_hint =
  situation_fit
+ preference_fit
+ past_acceptance_fit
+ recovery_fit
+ novelty_fit
+ stage_fit
- interaction_burden
- visual_burden
- repetition_penalty
- safety_penalty
```

The LLM may use these scores, but the simulator should show that final selection is made by LLM from allowed candidates.

### 12.2 Source mapping

| Factor | Meaning | Reference |
|---|---|---|
| `situation_fit` | Fit with fatigue, drowsiness, driving environment, route, passenger composition | Slide 66, Slide 67 |
| `preference_fit` | Fit with UPro, oshi, usage frequency, scene-specific preference | Slide 66, Slide 67 |
| `past_acceptance_fit` | Past AI proposal acceptance | Slide 66, Slide 67 |
| `recovery_fit` | Fatigue/drowsiness recovery result | Slide 66, Slide 67 |
| `novelty_fit` | Unused or long-unused functions | Slide 66, Slide 67 |
| `concrete_content_inputs` | Additional data for genre/playlist/video/quiz | Slides 68–70 |

---

## 13. LLM Agent Design

### 13.1 Agent 1: Service Selection Agent

#### Purpose

Select the most appropriate service type from allowed service candidates.

#### Input

```json
{
  "task": "select_service",
  "current_stage": "before_rest_until_stop",
  "stage_purpose_ja": "休憩所まで安全に誘導し、停止まで眠気・疲労を抑える",
  "trigger_context": {},
  "driver_state": {},
  "vehicle_state": {},
  "route_context": {},
  "environment_context": {},
  "external_context": {},
  "user_context": {},
  "history_context": {},
  "allowed_services": [],
  "blocked_services": [],
  "heuristic_priority_hints": [],
  "language": "ja"
}
```

#### Required output

```ts
type ServiceSelectionOutput = {
  selectedServiceId: string;
  selectedServiceLabelJa: string;
  confidence: "low" | "medium" | "high";
  selectionReasonJa: string[];
  proposalMessageJa: string;
  proposalOptionsJa: string[];
  alternatives: Array<{
    serviceId: string;
    labelJa: string;
    reasonJa: string;
  }>;
  notSelectedReasons: Array<{
    serviceId: string;
    labelJa: string;
    reasonJa: string;
  }>;
  contentGenerationRequest: {
    serviceId: string;
    constraintsJa: string[];
    desiredEffectJa: string;
  };
  reviewQuestionsJa: string[];
};
```

#### Hard constraints

The Service Selection Agent must obey:

1. It must select only one service from `allowed_services`.
2. It must not select any service in `blocked_services`.
3. It must reference the current stage in the explanation.
4. It must keep driving-time messages short.
5. It must not invent external availability data.
6. If confidence is low, it must choose the safest/simple alternative.
7. It must output JSON only.

#### Prompt template

```text
You are AICA Service Selection Agent.
Your job is to select the best proposal service for the current simulation stage.

You must follow CDC-SU_specplan.md constraints:
- Slide 38 separates running and stopped content.
- Slide 39 lists running content services.
- Slide 40 lists stopped content services.
- Slide 64 defines the flow: display order → content selection → concrete content → provision → end judgment.
- Slides 66–67 define priority factors: situation, preference, and past results.

Rules:
- Select only from allowed_services.
- Never select blocked_services.
- Explain the reason in Japanese.
- Keep proposal speech short if vehicle is moving.
- Return valid JSON only.

Input JSON:
{{input_json}}
```

### 13.2 Agent 2: Concrete Content Agent

#### Purpose

Generate the concrete content plan inside the selected service.

Examples:

- `music_recommend` → playlist policy and mock playlist.
- `humming_karaoke` → chorus-only song policy and mock tracks.
- `quiz` → quiz genre and question plan.
- `stretch_video` → video duration, body focus, intensity.
- `oshi_reexperience` → spot/story proposal.

#### Input

```json
{
  "task": "generate_concrete_content",
  "selected_service": "humming_karaoke",
  "current_stage": "before_rest_until_stop",
  "content_generation_request": {},
  "driver_state": {},
  "vehicle_state": {},
  "route_context": {},
  "environment_context": {},
  "external_context": {},
  "user_context": {},
  "history_context": {},
  "service_specific_input_requirements": [],
  "language": "ja"
}
```

#### Required output

```ts
type ConcreteContentOutput = {
  serviceId: string;
  contentTitleJa: string;
  contentSummaryJa: string;
  contentPolicyJa: string[];
  concreteItems: Array<{
    itemId: string;
    titleJa: string;
    type: "song" | "playlist" | "quiz" | "video" | "speech" | "rest_plan";
    durationSec?: number;
    reasonJa: string;
    mock: boolean;
  }>;
  speechBeforeStartJa: string;
  expectedEndCondition: string;
  safetyNotesJa: string[];
  reviewQuestionsJa: string[];
};
```

#### Source mapping

- General concrete content flow: `CDC-SU_specplan.md`, Slides 68–70.
- Service-specific input requirements: `CDC-SU_specplan.md`, Slides 71–80.

#### Prompt template

```text
You are AICA Concrete Content Agent.
Your job is to propose concrete content inside the selected service.

Follow CDC-SU_specplan.md:
- Slides 68–70 define the concrete content selection process.
- Slides 71–80 define service-specific input information.

Rules:
- Respect selected_service and current_stage.
- Do not change the service type.
- Use mock song/video names unless real content data is provided.
- Do not invent unavailable external information.
- If vehicle is moving, avoid visual/complex content.
- Return valid JSON only.

Input JSON:
{{input_json}}
```

---

## 14. Step-by-Step Algorithm Detail

### Step 0: Precondition

The trigger algorithm emits:

```json
{
  "triggerCategory": "rest_recommended",
  "riskLevel": "medium",
  "reasonTags": ["tired_now", "future_fatigue_expected"],
  "drowsinessScore": 0.68,
  "fatigueScore": 0.62,
  "explanation": ["疲労が上昇", "10分先に休憩所あり"]
}
```

The proposal phase must not recompute the trigger. It uses this trigger as input.

### Step 1: Determine stage

Input features:

| Feature | Example |
|---|---|
| vehicle moving/stopped | moving |
| at rest spot | false |
| rest started | false |
| nap finished | false |
| IG-ON after rest | false |

Rule:

```ts
if (triggerCategory == "rest_recommended" && vehicle.moving && !vehicle.atRestSpot) {
  stage = "before_rest_until_stop";
} else if (vehicle.stopped && vehicle.atRestSpot && !restFinished) {
  stage = "during_rest_stopped";
} else if (vehicle.stopped && restFinished) {
  stage = "after_rest_before_restart";
}
```

Output shown in simulator:

```json
{
  "stage": "before_rest_until_stop",
  "stageLabelJa": "休憩前 / 休憩所まで / 走行中",
  "reasonJa": "休憩推奨トリガー後、まだ休憩所に到着しておらず走行中のため。",
  "documentRefs": ["CDC-SU_specplan.md Slide 38", "Slide 64"]
}
```

### Step 2: Load stage-constrained services

Input:

```text
stage = before_rest_until_stop
```

Output:

```json
{
  "candidateServices": [
    "music_recommend",
    "humming_karaoke",
    "call_and_response",
    "quiz",
    "ranking",
    "radio"
  ],
  "documentRefs": ["CDC-SU_specplan.md Slide 39"]
}
```

Simulator display:

```text
このステージでは、走行中コンテンツのみ候補になります。
参照: CDC-SU_specplan.md Slide 38–39
```

### Step 3: Apply hard filters

Input features:

- Vehicle state: moving/stopped.
- Risk level.
- Visual load.
- Interaction load.
- Service availability.
- Oshi profile availability.
- Weather/time.
- Recent rejection/overuse.

Example output:

```json
{
  "allowedServices": [
    {
      "serviceId": "music_recommend",
      "labelJa": "音楽レコメンド",
      "scoreReasons": ["走行中利用可能", "操作負荷が低い", "音楽受諾率が高い"]
    },
    {
      "serviceId": "humming_karaoke",
      "labelJa": "鼻歌カラオケ",
      "scoreReasons": ["画面なし", "サビのみ", "覚醒維持に向く"]
    },
    {
      "serviceId": "radio",
      "labelJa": "ラジオ風再生",
      "scoreReasons": ["音声のみ", "操作負荷が低い"]
    }
  ],
  "loweredPriorityServices": [
    {
      "serviceId": "quiz",
      "labelJa": "クイズ",
      "warnings": ["認知負荷が高い", "過去拒否傾向あり"]
    }
  ],
  "blockedServices": [
    {
      "serviceId": "live_viewing",
      "labelJa": "ライブビューイング",
      "reasonJa": "停車中コンテンツであり、走行中ステージでは候補外。"
    }
  ]
}
```

### Step 4: Compute priority hints

Input features:

| Factor | Input examples |
|---|---|
| situation | fatigue, drowsiness, road, traffic, night, monotony |
| preference | oshi ON/OFF, music preference, quiz preference |
| past result | acceptance rate, recovery rate, skipped content |
| novelty | unused or rarely used service |
| burden | interaction load, visual load |

Output:

```json
{
  "heuristicPriorityHints": [
    {
      "serviceId": "humming_karaoke",
      "score": 0.82,
      "reasonsJa": ["音楽嗜好が高い", "走行中に画面なしで実施可能", "休憩所まで10分あり覚醒維持が必要"]
    },
    {
      "serviceId": "music_recommend",
      "score": 0.77,
      "reasonsJa": ["操作負荷が低い", "音楽受諾率が高い"]
    },
    {
      "serviceId": "radio",
      "score": 0.60,
      "reasonsJa": ["受動的に聞ける", "最新情報がある場合のみ有効"]
    }
  ]
}
```

Reference:

- `CDC-SU_specplan.md`, Slides 66–67.

### Step 5: Service Selection LLM Agent

Input:

All context + allowed services + priority hints + blocked services.

Output:

```json
{
  "selectedServiceId": "humming_karaoke",
  "selectedServiceLabelJa": "鼻歌カラオケ",
  "confidence": "medium",
  "selectionReasonJa": [
    "現在は休憩所まで走行中のため、走行中コンテンツのみが対象。",
    "休憩所まで10分あり、到着まで覚醒維持が必要。",
    "鼻歌カラオケは画面なし・サビのみで実施でき、走行中の制約に合う。",
    "ユーザーは音楽系の受諾率が高く、クイズは過去拒否傾向があるため優先しない。"
  ],
  "proposalMessageJa": "少し疲れが出ているようです。10分先の休憩所まで案内します。到着までは、画面を使わずにサビだけ軽く歌える鼻歌カラオケで眠気を抑えませんか？",
  "proposalOptionsJa": [
    "休憩所まで案内する",
    "鼻歌カラオケを流す",
    "音楽レコメンドに変更する",
    "今回は不要"
  ],
  "alternatives": [
    {
      "serviceId": "music_recommend",
      "labelJa": "音楽レコメンド",
      "reasonJa": "より操作負荷が低い代替案。"
    }
  ],
  "contentGenerationRequest": {
    "serviceId": "humming_karaoke",
    "constraintsJa": ["サビのみ", "画面なし", "2〜3曲", "休憩所到着前に終了"],
    "desiredEffectJa": "休憩所到着までの覚醒維持"
  },
  "reviewQuestionsJa": [
    "このステージで鼻歌カラオケを提案するのは自然か？",
    "運転中の情報量は多すぎないか？",
    "休憩を受け入れやすくなる提案か？"
  ]
}
```

Simulator must show:

1. Selected service.
2. Why selected.
3. Candidate ranking.
4. Blocked services and reasons.
5. LLM input/output trace.
6. Document references.

### Step 6: Test-user interaction

The simulator presents proposal options.

Possible actions:

```ts
type TestUserAction =
  | "accept_selected_service"
  | "reject_service"
  | "select_alternative_service"
  | "skip_content_but_accept_rest_guidance"
  | "continue_driving"
  | "request_other_service";
```

The simulator records:

```json
{
  "event": "driver_accepts_service",
  "selectedOption": "鼻歌カラオケを流す",
  "timestampSec": 420
}
```

### Step 7: Concrete Content Agent

Input:

Selected service + context + service-specific input requirements.

For `humming_karaoke`, reference:

- `CDC-SU_specplan.md`, Slide 72: 鼻歌カラオケ content selection inputs.
- `CDC-SU_specplan.md`, Slide 39: no lyric display during driving, guide vocal chorus-only.

Output:

```json
{
  "serviceId": "humming_karaoke",
  "contentTitleJa": "休憩所までの鼻歌カラオケ",
  "contentSummaryJa": "画面を使わず、サビだけ軽く歌える3曲の鼻歌カラオケ",
  "contentPolicyJa": [
    "サビのみ",
    "ガイドボーカルあり",
    "歌詞表示なし",
    "休憩所到着前に終了",
    "覚醒度は高いが運転を妨げないテンポ"
  ],
  "concreteItems": [
    {
      "itemId": "mock_song_1",
      "titleJa": "Mock Song A",
      "type": "song",
      "durationSec": 90,
      "reasonJa": "ユーザーの音楽嗜好に近く、サビが短く覚えやすい。",
      "mock": true
    },
    {
      "itemId": "mock_song_2",
      "titleJa": "Mock Song B",
      "type": "song",
      "durationSec": 90,
      "reasonJa": "明るいテンポで、休憩所までの覚醒維持に向く。",
      "mock": true
    }
  ],
  "speechBeforeStartJa": "画面は使わず、サビだけ軽く歌える曲を流します。疲れが強くなったらすぐ休憩案内に戻します。",
  "expectedEndCondition": "一定曲数再生完了、または休憩所到着",
  "safetyNotesJa": ["走行中のため歌詞表示は行わない。"],
  "reviewQuestionsJa": [
    "選曲方針は適切か？",
    "曲数・長さは休憩所までの時間に合うか？",
    "覚醒度が強すぎないか？"
  ]
}
```

### Step 8: Playback and end judgment

The rule engine simulates content playback.

Reference:

- `CDC-SU_specplan.md`, Slide 81: AI提案開始時のコンテンツ提供内容及び終了条件整理.
- `CDC-SU_specplan.md`, Slide 82: ユーザー要望開始時の違い.

Example rule for AI proposal start:

```ts
if (content.serviceId == "music_recommend" || content.serviceId == "humming_karaoke" || content.serviceId == "call_and_response") {
  endCondition = "fixed_song_count_completed";
  afterEndAction = "ask_continue_or_other_content; if rejected, recheck_threshold_later";
}

if (content.serviceId == "quiz" || content.serviceId == "ranking" || content.serviceId == "radio") {
  endCondition = "one_set_completed";
  afterEndAction = "ask_continue_or_other_content; if rejected, recheck_threshold_later";
}

if (content.serviceId == "live_viewing") {
  endCondition = "fixed_video_count_completed";
  afterEndAction = "return_to_before_trigger";
  onDrivingStart = "switch_to_background_and_confirm_after_current_song";
}

if (content.serviceId == "stretch_video") {
  endCondition = "one_video_completed";
  afterEndAction = "return_to_before_trigger";
  onDrivingStart = "auto_end";
}

if (content.serviceId == "full_karaoke") {
  endCondition = "one_song_completed";
  afterEndAction = "return_to_before_trigger";
  onDrivingStart = "lyrics_off_and_background_playback";
}
```

### Step 9: Transition to next stage

Examples:

```text
If arrived_at_rest_spot:
  stage = during_rest_stopped

If nap_finished or driver_returns_to_car:
  stage = after_rest_before_restart

If driving_started:
  apply Slide 81/82 driving-start behavior
```

### Step 10: Review feedback

Collect feedback at three levels.

#### Stage feedback

```json
{
  "stageCorrect": true,
  "comment": "休憩前なので走行中コンテンツ候補だけでよい。"
}
```

#### Service selection feedback

```json
{
  "serviceAppropriateness": "good",
  "labels": ["natural", "safe", "motivating"],
  "comment": "音楽嗜好が高いユーザーなので鼻歌カラオケは自然。"
}
```

#### Concrete content feedback

```json
{
  "contentAppropriateness": "needs_adjustment",
  "labels": ["too_many_songs", "message_too_long"],
  "comment": "休憩所まで8分なら2曲でよい。"
}
```

---

## 15. Service-Specific Concrete Content Requirements

This section maps service-specific content selection to PowerPoint references.

### 15.1 音楽レコメンド

Reference:

- `CDC-SU_specplan.md`, Slide 39: overview.
- Slide 71: input details.

Concrete output should include:

- Playlist theme.
- Number of songs.
- Energy level.
- Whether route/environment is reflected.
- Whether oshi/user preference is reflected.
- Whether child/passenger context is reflected.
- Mock songs if real source unavailable.

Inputs from Slide 71:

- User fatigue.
- Driving environment.
- Route/destination features.
- Passenger composition.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Schedule.
- Playback/skipping history.
- Proposal acceptance rate.
- Recovery rate.

### 15.2 鼻歌カラオケ

Reference:

- `CDC-SU_specplan.md`, Slide 39.
- Slide 72.

Concrete output should include:

- Chorus-only playlist.
- Guide vocal setting.
- Lyric display disabled while driving.
- 2–3 songs for before-rest usage.
- User approval required if appropriate.
- Mock songs if real source unavailable.

Inputs from Slide 72:

- User fatigue.
- Driving environment.
- Destination.
- Passenger composition.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Schedule.
- Song/playback/skipping history.
- Proposal acceptance rate.
- Recovery rate.

### 15.3 合いの手練習

Reference:

- `CDC-SU_specplan.md`, Slide 39 and Slide 40.
- Slide 73.

Concrete output should include:

- Song/video candidate.
- Call-and-response timing policy.
- Lighting pattern if supported.
- Background audio if moving.
- Video/MM output only if stopped.

Inputs from Slide 73:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Oshi info.
- Usage frequency.
- Schedule.
- Playback history.
- Recovery rate.

### 15.4 クイズ

Reference:

- `CDC-SU_specplan.md`, Slide 39.
- Slide 74.

Concrete output should include:

- Quiz genre.
- Number of questions.
- Voice-only delivery.
- Difficulty.
- Result feedback.
- Avoid repeated past quiz.

Inputs from Slide 74:

- User fatigue.
- Driving environment.
- Destination.
- Passenger composition.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Schedule.
- Quiz result history.
- Acceptance rate.
- Recovery rate.

### 15.5 ランキング作成

Reference:

- `CDC-SU_specplan.md`, Slide 39.
- Slide 75.

Concrete output should include:

- Ranking theme.
- Two-choice questions.
- Playlist created from ranking.
- Avoid duplicate past ranking playlist.

Inputs from Slide 75:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Schedule.
- Previous ranking result.
- Acceptance rate.
- Recovery rate.

### 15.6 ラジオ風再生

Reference:

- `CDC-SU_specplan.md`, Slide 39.
- Slide 76.

Concrete output should include:

- Short speech script.
- Information source summary.
- Latest info only since previous use.
- Shopping list or detailed follow-up is future function if needed.

Inputs from Slide 76:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Schedule.
- Past radio content history.
- Latest info availability.
- Acceptance rate.
- Recovery rate.

### 15.7 ライブビューイング

Reference:

- `CDC-SU_specplan.md`, Slide 40.
- Slide 77.

Concrete output should include:

- Video candidate.
- Number of videos/songs.
- Why it helps post-rest refresh.
- Background behavior if driving starts.

Inputs from Slide 77:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Oshi info.
- Usage frequency.
- Schedule.
- Playback history.
- Recovery rate.

### 15.8 ストレッチ動画

Reference:

- `CDC-SU_specplan.md`, Slide 40.
- Slide 78.

Concrete output should include:

- Video duration.
- Body focus.
- Intensity.
- Whether suitable for post-nap wake-up.
- Auto-end behavior if driving starts.

Inputs from Slide 78:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Usage frequency.
- Playback history.
- Acceptance rate.
- Recovery rate.

### 15.9 カラオケ

Reference:

- `CDC-SU_specplan.md`, Slide 40.
- Slide 79.

Concrete output should include:

- Full song candidate.
- Approval flow.
- If rejected, transition to recommendation/ranking/search screen.
- Lyrics display while stopped.
- Lyrics off/background playback when driving starts.

Inputs from Slide 79:

- User fatigue.
- Driving environment.
- Destination.
- Passenger composition.
- Driving state.
- UPro/user profile.
- Oshi info.
- Usage frequency.
- Schedule.
- Playback history.
- Acceptance rate.
- Recovery rate.

### 15.10 推し追体験

Reference:

- `CDC-SU_specplan.md`, Slide 40.
- Slide 80.

Concrete output should include:

- Oshi spot.
- Episode speech.
- Smartphone info transfer if relevant.
- Safety/location check.
- Avoid if unsafe/weather unsuitable.

Inputs from Slide 80:

- User fatigue.
- Driving environment.
- Destination.
- Driving state.
- UPro/user profile.
- Oshi info.
- Usage frequency.
- Schedule.
- Visit history.
- Acceptance rate.
- Recovery rate.

---

## 16. Simulator UI Requirements

### 16.1 Screen 1: Scenario and Stage Panel

Must show:

- Current event.
- Current stage.
- Trigger result.
- Driver state.
- Route/rest spot status.
- Environment.
- User context.
- Source slide references.

Example:

```text
Stage: 休憩前 / 休憩所まで / 走行中
Reason: 休憩推奨トリガー後、まだ休憩所に到着していないため
References: CDC-SU_specplan.md Slide 38, Slide 64
```

### 16.2 Screen 2: Service Candidate Board

Must show:

- Stage-allowed services.
- Blocked services and reasons.
- Lowered-priority services and reasons.
- Heuristic priority hints.
- Selected service.
- Alternatives.

### 16.3 Screen 3: LLM Decision Trace

Must show:

- LLM input summary.
- LLM selected service.
- LLM reason.
- Generated proposal message.
- JSON output.
- Guardrail status: passed/failed.

### 16.4 Screen 4: Concrete Content Panel

Must show:

- Selected service.
- Concrete content policy.
- Mock/real content items.
- Service-specific inputs used.
- Service-specific reference slides.

### 16.5 Screen 5: Playback Timeline

Must show:

- AICA speech.
- Test user action.
- Content start.
- Content progress.
- End condition.
- End action.
- Stage transition.

### 16.6 Screen 6: Review Feedback

Must collect:

- Stage correctness.
- Service appropriateness.
- Concrete content appropriateness.
- Proposal wording.
- Safety and distraction.
- Acceptance/motivation.
- Free comment.

---

## 17. Trace and Evidence Output

Every simulation run must output a trace.

```ts
type ProposalSimulationTrace = {
  sessionId: string;
  scenarioId: string;
  hypothesisPackageId: string;
  events: SimulationEvent[];
  stageDecisions: StageDecisionTrace[];
  serviceSelectionTraces: ServiceSelectionTrace[];
  contentSelectionTraces: ConcreteContentTrace[];
  playbackTraces: PlaybackTrace[];
  feedback: ReviewFeedback[];
};
```

### 17.1 Service selection trace

```ts
type ServiceSelectionTrace = {
  timestampSec: number;
  stage: ProposalStage;
  allowedServices: string[];
  blockedServices: BlockedService[];
  priorityHints: Array<{ serviceId: string; score: number; reasonsJa: string[] }>;
  llmInput: object;
  llmOutput: ServiceSelectionOutput;
  guardrailResult: "passed" | "failed";
  documentRefs: string[];
};
```

### 17.2 Concrete content trace

```ts
type ConcreteContentTrace = {
  timestampSec: number;
  serviceId: string;
  requiredInputs: string[];
  providedInputs: object;
  missingInputs: string[];
  llmInput: object;
  llmOutput: ConcreteContentOutput;
  documentRefs: string[];
};
```

---

## 18. Hypothesis Package Format

The whole algorithm should be loaded as a hypothesis package.

```yaml
id: aica_stage_constrained_llm_proposal_selector_v1
name:
  en: AICA Stage-Constrained LLM Proposal Service Selector v1
  ja: AICAステージ制約付きLLM提案サービス選択 v1
source_document: CDC-SU_specplan.md
scope:
  trigger_category: rest_recommended
  proposal_class: danger_driving_prevention
stages:
  - before_rest_until_stop
  - during_rest_stopped
  - after_rest_before_restart
llm_agents:
  - service_selection_agent
  - concrete_content_agent
guardrails:
  - stage_constraint
  - moving_stopped_constraint
  - service_capability_constraint
  - risk_severity_constraint
  - structured_json_output
```

---

## 19. Acceptance Criteria

### 19.1 Functional acceptance

1. The simulator can start from a rest-recommended trigger.
2. The simulator determines the correct stage.
3. The simulator loads only services allowed for that stage.
4. The simulator blocks services that violate stage/safety/capability constraints.
5. The LLM selects only from allowed services.
6. The simulator shows the LLM reason and selected service.
7. The simulator allows the test user to accept, reject, or select alternatives.
8. The simulator generates concrete content after service selection.
9. The simulator simulates content playback and end behavior based on Slides 81–82.
10. The simulator collects structured review feedback.
11. The simulator exports a complete trace.

### 19.2 Document coherence acceptance

The implementation must explicitly reference:

- Slide 38 for running/stopped content classification.
- Slide 39 for running services.
- Slide 40 for stopped services.
- Slide 64 for proposal ① flow.
- Slides 66–67 for service priority factors.
- Slides 68–70 for concrete content selection.
- Slides 71–80 for service-specific input requirements.
- Slides 81–82 for content provision/end conditions.

### 19.3 LLM guardrail acceptance

1. LLM output must be valid JSON.
2. Selected service must be in `allowedServices`.
3. Blocked service must never be selected.
4. Proposal message must respect language setting.
5. The reason must include stage and context.
6. If the LLM violates guardrails, simulator must reject the output and fall back to safest service.

---

## 20. Recommended V1 Prototype Scope

To avoid overbuilding, implement these first.

### 20.1 Stage A services

- 音楽レコメンド
- 鼻歌カラオケ
- クイズ
- ラジオ風再生

### 20.2 Stage B rest support

- 休憩時間提案
- 休憩方法提案
- 仮眠促進
- 休憩継続確認

### 20.3 Stage C services

- ストレッチ動画
- カラオケ
- ライブビューイング
- 推し追体験

### 20.4 Later services

- 合いの手練習
- ランキング作成
- ライティング
- リラックス（多感覚連携）
- 動画レコ（家電連携）

---

## 21. Example End-to-End Simulation

### Initial condition

```json
{
  "trigger": {
    "triggerCategory": "rest_recommended",
    "riskLevel": "medium",
    "reasonTags": ["tired_now", "future_fatigue_expected"],
    "drowsinessScore": 0.68,
    "fatigueScore": 0.62
  },
  "vehicle": {
    "moving": true,
    "atRestSpot": false
  },
  "route": {
    "nextRestSpotMin": 10,
    "nextRestSpotType": "convenience_store"
  },
  "environment": {
    "timeOfDay": "night",
    "weather": "rain"
  },
  "user": {
    "oshiEnabled": true,
    "musicPreference": "high",
    "quizPreference": "low"
  }
}
```

### Stage decision

```json
{
  "stage": "before_rest_until_stop",
  "reasonJa": "走行中で休憩所到着前のため。"
}
```

### Service selection

```json
{
  "selectedServiceId": "humming_karaoke",
  "reasonJa": [
    "走行中コンテンツとして許可されている。",
    "画面なし・サビのみで実施できる。",
    "音楽嗜好が高く、休憩所まで覚醒維持が必要。"
  ]
}
```

### Concrete content

```json
{
  "serviceId": "humming_karaoke",
  "contentPolicyJa": ["サビのみ", "歌詞表示なし", "2曲", "休憩所到着前に終了"],
  "mockTracks": ["Mock Song A", "Mock Song B"]
}
```

### Arrival

```json
{
  "event": "arrived_at_rest_spot",
  "nextStage": "during_rest_stopped"
}
```

### Rest method proposal

```json
{
  "proposalType": "nap_guidance",
  "messageJa": "到着しました。10分だけ仮眠しますか？それとも軽いストレッチにしますか？"
}
```

### After rest

```json
{
  "event": "nap_finished",
  "nextStage": "after_rest_before_restart",
  "selectedServiceId": "stretch_video",
  "reasonJa": ["仮眠後の身体をゆっくり起こす目的に合う。", "停車中なので動画利用が可能。"]
}
```

---

## 22. Implementation Notes for Claude Code

1. Implement a deterministic simulator core first.
2. Use JSON/YAML service catalog files.
3. Make stage determination and filters unit-testable without LLM.
4. Mock LLM output first for tests.
5. Then add LLM adapter behind an interface.
6. Validate LLM JSON output with schema.
7. Add fallback selection if LLM fails.
8. Show all decision traces in UI.
9. Keep `CDC-SU_specplan.md` references in the catalog and traces.
10. Do not hardcode one service path; support multiple steps and user actions.

---

## 23. Open Questions

1. Should Stage B include entertainment services or only rest method/time support?
2. Should `ライティング` be treated as standalone service or as decoration attached to music/karaoke/合いの手?
3. Should real song/video names be used, or mock content only in simulator?
4. How much should LLM know about user profile in privacy-sensitive contexts?
5. Should the simulator support Japanese/English bilingual output from V1?
6. Should test user feedback update service priority immediately during the same session?

---

## 24. Short Japanese Definition

```text
AICA提案サービス選択シミュレーターは、休憩推奨トリガー後の体験を、休憩前・休憩中・休憩後の複数ステップとして再現する。各ステップでは、CDC-SU_specplan.mdで定義されたステージ別サービス候補に制約し、安全性・実行可能性をルールで確認したうえで、LLMがユーザー状況・好み・過去実績を踏まえて最適な提案サービスと具体コンテンツを選択する。テストユーザーはその提案をシミュレーション画面で体験し、サービス選択・具体内容・発話・安全性に対するレビューを行う。
```
