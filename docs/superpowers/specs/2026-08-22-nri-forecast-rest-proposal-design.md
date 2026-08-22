# NRI Forecast-Based Early Rest Proposal — Design

**Date:** 2026-08-22

**Branch:** `fixbug-0806`

**Scope:** NRI algorithm behavior in `app/` and its `htmlapp/` mirror

**Status:** Approved solution direction; written specification awaiting owner review

**Implementation:** Out of scope for this document-writing session

---

## 1. Decision summary

The existing last-10-minutes trip-edge guard remains a hard no-trigger zone for
routine `REST_PROPOSAL` and `MONOTONY_PROPOSAL` results. This design does not
weaken or bypass that guard.

Instead, NRI gains a forecast-based early rest path. At an eligible current tick,
the simulator projects the remaining drive without accepting any new proposal,
starting any new content, or starting a new rest. If that projection shows that:

1. `s_total` will reach `threshold_fire` before the destination; and
2. the closest rest spot ahead of that predicted crossing is inside the last
   10 minutes before the destination, or no rest spot remains ahead there,

then the tick has a `forecast_reject_trigger` context. This context means a normal
future rest proposal is likely to arrive too late to be useful.

The forecast context alone does not produce a proposal. It arms an early-rest
opportunity. NRI produces an early `REST_PROPOSAL` only when all of the following
are also true:

- the current `s_total` is strictly greater than `threshold_forecast_rest`
  (default `80`);
- the current `s_total` is still below `threshold_fire` (default `100`), so this
  remains an early proposal rather than the ordinary safety/rest proposal;
- the closest rest spot ahead of the current vehicle position exists;
- that current rest spot is within `rest_spot_eta_filter_min` (default 60
  minutes);
- that current rest spot is outside the last-10-minutes destination zone; and
- the existing fire-control, response-suppression, recovery, and trip-edge rules
  allow the proposal.

If the score is above 80 but no suitable rest spot is currently actionable, no
proposal is shown. The forecast conditions are evaluated again at later ticks.
The score threshold therefore makes the policy eligible; a real rest opportunity
decides when it may actually fire.

---

## 2. Problem

The trip-edge guard introduced in commit `f9a9aaf` correctly prevents routine
proposals that drivers are unlikely to accept:

- the first 20 minutes after the trip starts; and
- the last 10 minutes of driving ETA before the destination.

The guard neutralizes a routine fire before it enters the evidence log. This is
important because an automatic decline would start the same-category response
suppression and consume proposal-count capacity.

The end-edge behavior creates a remaining NRI safety gap:

1. NRI can be below `threshold_fire` before the last-10-minutes zone.
2. Continued driving can raise `s_total` to or above `threshold_fire` near the
   destination.
3. A normal rest proposal at that time is neutralized by the hard guard because
   the driver is likely to continue to the destination.
4. Merely hiding that future proposal loses the earlier opportunity to suggest
   a usable rest.

The solution must recognize this situation early, while preserving both facts:

- a score below the early threshold is not strong enough to justify a rest
  proposal; and
- a rest proposal without a nearby, usable rest spot is not actionable.

---

## 3. Existing NRI behavior that must remain true

NRI has one raw score:

```text
S_total(t) = S_base(t) + S_env(t) + S_realtime(t)
```

The existing score bands are:

```text
S_total >= threshold_fire
    -> rest_required / REST_PROPOSAL

threshold_monotony <= S_total < threshold_fire
    -> monotony_prevention / MONOTONY_PROPOSAL

S_total < threshold_monotony
    -> NO_PROPOSAL
```

With the current defaults:

| Name | Value | Existing meaning |
|---|---:|---|
| `threshold_monotony` | 60 | The lower boundary for a monotony/content proposal |
| `threshold_forecast_rest` | 80 | New lower boundary for a forecast-based early rest proposal |
| `threshold_fire` | 100 | The ordinary safety/rest proposal threshold |
| `rest_spot_eta_filter_min` | 60 minutes | The existing maximum ETA for an actionable rest spot |
| Trip end edge | less than 10 minutes to destination | Hard no-trigger zone for routine proposals |

The new score boundary does not create a second NRI score and does not change the
meaning of either existing threshold. It adds a narrowly gated rest decision
inside the existing 60-to-100 score band.

The following existing behavior remains unchanged:

- `threshold_fire` remains the ordinary rest threshold.
- `threshold_monotony` remains the monotony/content threshold.
- Rest remains higher priority than monotony.
- Recovery suppresses both routine categories.
- The ordinary rest path continues to use `rest_spot_eta_filter_min`.
- The trip-edge guard still neutralizes routine proposals in both trip edges.
- `SEVERE_INTERVENTION` and any other existing non-routine escalation behavior
  remain outside this NRI change.
- Existing proposal-history suppression and proposal-count rules remain in
  force.

---

## 4. Goals

### 4.1 Functional goals

1. Predict whether NRI will reach `threshold_fire` before the destination if no
   new proposal is accepted.
2. Detect when the closest rest spot after that future crossing would be in the
   last-10-minutes destination zone, or when no rest spot would remain.
3. Allow a real early `REST_PROPOSAL` once the current score is greater than 80.
4. Show that proposal only when a concrete rest spot ahead is close enough and
   outside the destination no-trigger zone.
5. Keep the proposal and its evidence distinct from the ordinary
   `threshold_fire` result and from a `MONOTONY_PROPOSAL`.
6. Produce equivalent results in the Python application and the offline
   TypeScript application.

### 4.2 Safety and behavior goals

1. Never weaken the hard last-10-minutes no-trigger rule for routine proposals.
2. Never issue a forecast-based rest proposal at or below score 80.
3. Never issue a forecast-based rest proposal with no actual rest spot ahead.
4. Never treat the `9999.0` no-rest-spot sentinel as an actionable early target.
5. Never let forecast calculation mutate the live run, preview run, proposal
   history, content state, recovery state, or package runtime state.
6. If forecasting fails, retain the ordinary NRI decision for the current tick.

### 4.3 Review goals

The evidence must let a reviewer answer:

- What was the current `s_total`?
- Why was the ordinary threshold-100 proposal expected later?
- Where was that crossing expected?
- What rest spot followed that crossing?
- Why was that future rest spot considered too close to the destination?
- Which rest spot is actionable now?
- How far away is the current target?
- How far from the destination will the driver still be at that target?
- Which gate allowed or blocked the early proposal?

---

## 5. Non-goals

This design does not include:

- a machine-learning model for drowsiness or fatigue;
- probabilistic confidence, upper/lower forecast bands, or uncertainty scoring;
- changes to the formulas for `S_base`, `S_env`, or `S_realtime`;
- changes to the drowsiness or fatigue progression model;
- changes to `threshold_monotony = 60` or `threshold_fire = 100` defaults;
- a proposal at score 80 exactly or below;
- a general forecast facility for non-NRI trigger packages;
- new rest-spot discovery or external map searches;
- a new destination guard duration;
- a UI redesign;
- new `SEVERE_INTERVENTION` rules;
- changes to existing response-suppression or proposal-count behavior; or
- implementation work in this brainstorming session.

---

## 6. Exact terminology

This document uses only the following terms for the new behavior.

### `no_new_intervention_forecast`

A copied, non-persisting projection from the current tick to the destination.
It applies the known route, traffic events, speed profile, tick duration, driver
signal progression, and NRI accumulation. It does not accept or acknowledge any
new proposal and does not start a new content or rest action.

An intervention that is already active at the current tick is part of the actual
current state. Existing content may continue until its already-defined end. The
forecast introduces no additional intervention.

### `forecast_fire_point`

The first projected future tick whose raw `s_total` is greater than or equal to
the resolved `threshold_fire`.

### `forecast_rest_spot`

The closest rest spot strictly ahead of the vehicle at the
`forecast_fire_point`, using the same ordered rest-spot positions that produce
`nextRestSpotMin`.

### `forecast_reject_trigger`

True when a `forecast_fire_point` exists and either:

- its `forecast_rest_spot` exists but is inside the last-10-minutes destination
  zone; or
- no rest spot remains ahead at the `forecast_fire_point`.

The name describes the future context: a normal proposal at the forecast fire
point would have no acceptable rest opportunity. It is not recorded as a driver
decline and does not itself affect proposal history.

### `threshold_forecast_rest`

The new NRI raw-score hyperparameter. Its default is `80.0`. The current score
must be strictly greater than this value for the early rest path.

### `current_rest_spot`

The closest rest spot strictly ahead of the actual vehicle position at the
current tick. This is the spot offered by the forecast-based early proposal.
It is deliberately different from `forecast_rest_spot`.

The `forecast_rest_spot` detects a future rejection risk. The
`current_rest_spot` is the actual early opportunity.

### `actionable current rest spot`

A `current_rest_spot` is actionable only when:

- it exists;
- its ETA from the current position is finite and no greater than
  `rest_spot_eta_filter_min`;
- its ETA is not the `9999.0` no-rest sentinel; and
- the driving ETA from the rest spot to the destination is at least 10 minutes.

---

## 7. Threshold configuration

Add the NRI hyperparameter:

```json
{
  "key": "threshold_forecast_rest",
  "label": {
    "ja": "予測休憩提案閾値 (点)",
    "en": "Forecast Rest Suggest Threshold (pts)"
  },
  "kind": "numeric",
  "default": 80.0,
  "min": 20.0,
  "max": 200.0,
  "step": 5.0
}
```

The default ordering is:

```text
threshold_monotony < threshold_forecast_rest < threshold_fire
60                 < 80                      < 100
```

Because existing test cases and review controls may override the two current
thresholds independently, an invalid resolved ordering must not break ordinary
NRI evaluation. The forecast-rest path is disabled for a tick unless:

```text
threshold_monotony < threshold_forecast_rest < threshold_fire
```

When disabled by ordering, ordinary monotony and rest behavior continues and
the forecast evidence records `forecast_threshold_order_valid = false`. No
threshold is silently changed or clamped.

The early comparison is strict:

```text
s_total > threshold_forecast_rest
```

At exactly `80.0` with the defaults, the early rest path does not fire. At
`threshold_fire` or above, the ordinary rest path owns the tick.

---

## 8. No-new-intervention forecast

### 8.1 Start state

The forecast begins after the current tick has been evaluated once normally. It
copies:

- current elapsed simulation time;
- current route distance and route fraction;
- current drowsiness and fatigue values;
- current continuous-driving and monotony state;
- current NRI `package_runtime_state` after the current tick;
- the frozen event plan;
- route facts and ordered rest-spot positions;
- the effective speed profile;
- the effective scenario and driver parameters;
- current content state, when content was already active before forecasting;
- current tick duration; and
- resolved NRI parameters and hyperparameters.

The live objects are never reused as mutable forecast state.

### 8.2 Forecast actions

For every projected future tick:

1. Advance route position and driver signals using the same tick-engine rules as
   the real run.
2. Build the same tiered signal context used by NRI.
3. Evaluate NRI with the copied forecast package state.
4. Record raw `s_total` and the copied next package state.
5. Ignore every returned proposal and fire-control result.
6. Do not append a real `TickEvent` or `ActionEvent`.
7. Do not acknowledge monotony content.
8. Do not accept, postpone, or decline a rest proposal.
9. Do not create a new recovery sequence.
10. Stop at the first future tick at or above `threshold_fire`, or when the
    route completes.

Ignoring forecast proposals is load-bearing. The current preview loop
automatically acknowledges monotony proposals and accepts eligible rest
proposals. Reusing those action semantics would change content, recovery,
drowsiness, fatigue, monotony accumulation, and later `s_total`, so it would not
represent continued driving with no new intervention.

### 8.3 Existing active recovery

The forecast-rest path is disabled while a real recovery sequence is active.
The ordinary NRI recovery suppression remains authoritative. Forecasting is
evaluated again after recovery ends.

### 8.4 Existing active content

Content that was already active before the current tick is not a new forecast
action. The projection carries its already-defined remaining duration and
effects. It must not extend, replace, or restart that content.

### 8.5 Termination

The forecast terminates when any of these occurs:

- the first projected `s_total >= threshold_fire` tick is found;
- the destination is reached;
- the underlying NRI evaluation returns an algorithm error; or
- the existing route/tick safety ceiling is reached.

No threshold crossing before route completion means
`forecast_reject_trigger = false`.

---

## 9. Forecast fire point and future rest spot

When the forecast finds its first threshold crossing, record:

```text
forecast_fire_point.tick_index
forecast_fire_point.elapsed_min
forecast_fire_point.distance_km
forecast_fire_point.route_fraction
forecast_fire_point.s_total
```

Then find the first sorted rest-spot position strictly greater than
`forecast_fire_point.distance_km`.

If one exists, calculate:

- driving ETA from the forecast fire point to the rest spot; and
- driving ETA from the rest spot to the destination, starting at the projected
  arrival time at the rest spot.

ETA must use the existing planned-profile forward integration used by
`nextRestSpotMin` and the trip-edge guard. It must not use current speed times
remaining distance.

The future rest spot is inside the destination no-trigger zone when:

```text
forecast_rest_spot.eta_to_destination_min < 10.0
```

Exactly 10.0 minutes is outside the zone, matching the existing strict end-edge
comparison.

Set `forecast_reject_trigger = true` when:

```text
forecast_fire_point exists
AND (
    forecast_rest_spot does not exist
    OR forecast_rest_spot.eta_to_destination_min < 10.0
)
```

Do not treat the future spot as the early target. Its only role is to establish
that the ordinary future rest opportunity is too late or absent.

---

## 10. Current rest-spot actionability

Once `forecast_reject_trigger` is true and the current score is above the early
threshold, evaluate the actual rest opportunity at the current tick.

Select the first sorted rest-spot position strictly greater than the current
vehicle position. This is `current_rest_spot`.

The current spot is actionable when all conditions pass:

```text
current_rest_spot exists
AND nextRestSpotMin != 9999.0
AND nextRestSpotMin <= rest_spot_eta_filter_min
AND current_rest_spot.eta_to_destination_min >= 10.0
```

The ETA from the target spot to the destination must be computed using the
projected arrival time at that target, so time-based traffic events are evaluated
on the correct future time axis.

### 10.1 Spot too far away

If the closest spot exists but its ETA is greater than
`rest_spot_eta_filter_min`, the policy is eligible but not actionable. No
proposal fires. The next actual tick reevaluates the same conditions. Once the
spot enters the existing ETA window, the proposal may fire if every other gate
still passes.

### 10.2 No spot ahead

If the current tick has no rest spot ahead, no forecast-based rest proposal may
fire. This differs intentionally from the ordinary NRI rest path, where the
`9999.0` sentinel currently allows a threshold-100 fire. An early rest proposal
must have a real early rest opportunity.

### 10.3 Current spot inside the destination zone

If the current spot leaves less than 10 minutes of driving to the destination,
no forecast-based rest proposal fires. Selecting a late spot would reproduce the
same likely rejection that this feature is intended to avoid.

### 10.4 Score threshold reached after an earlier spot was passed

The policy never goes backward to a rest spot that has already been passed and
never fires below or at the early threshold to preserve an earlier stop. If the
score becomes eligible too late, bypassing the early correction is accepted.
This follows the agreed assumption that a later score-80 crossing means less
remaining time for the score to reach the ordinary safety threshold.

---

## 11. Complete decision rule

Define:

```text
S_now = current raw s_total
T_mono = threshold_monotony
T_forecast = threshold_forecast_rest
T_fire = threshold_fire
ETA_limit = rest_spot_eta_filter_min
```

NRI classifies the current tick as a forecast-based early rest decision only
when:

```text
package_id == "nri_fatigue_score_v1"
AND T_mono < T_forecast < T_fire
AND T_forecast < S_now < T_fire
AND recovery is not active
AND current tick is outside the existing trip-edge zones
AND no_new_intervention_forecast finds a future S_total >= T_fire
AND forecast_reject_trigger == true
AND current_rest_spot exists
AND current_rest_spot ETA from now is finite
AND current_rest_spot ETA from now <= ETA_limit
AND current_rest_spot ETA to destination >= 10.0
```

If any condition fails, retain the ordinary current NRI result. Do not return a
partial rest proposal.

After NRI returns that decision, the proposal reaches the driver only when:

```text
the existing trip-edge guard leaves fire_control.fired == true
AND the proposal has at least one scenario-allowed action
AND existing recovery-active actionability suppression allows it
AND existing response suppression allows rest_required
```

This distinction matches the current runtime. The NRI result is calculated
first. The trip-edge guard can neutralize it before recording. Recovery and
post-response gates can then leave a fired decision visible in evidence while
preventing the run from pausing on it.

### 11.1 Priority inside the 80-to-100 band

Without this feature, a score above 80 and below 100 is inside the existing
monotony band. When the full forecast-rest rule passes:

- `rest_required` owns the tick because it has priority 1;
- `monotony_prevention` is retained in candidates but suppressed with reason
  `superseded_by_forecast_rest`; and
- only the early `REST_PROPOSAL` is actionable.

When any forecast-rest gate fails, the ordinary monotony behavior remains
unchanged.

### 11.2 Ordinary threshold-fire priority

When `S_now >= threshold_fire`, do not classify the result as forecast-based.
The existing ordinary rest path owns the tick, including its existing ETA
filter, recovery gate, response suppression, and trip-edge guard.

---

## 12. NRI decision output

The early path uses existing project categories and result types:

```text
result_type       = REST_PROPOSAL
selected_category = rest_required
trigger_candidate = true
```

It does not introduce a new result type or trigger category.

### 12.1 Proposal

Add an NRI proposal definition:

```json
{
  "id": "forecast_rest_required_proposal",
  "message": {
    "ja": "このまま走ると、目的地の近くで休憩が必要になる見込みです。前方の休憩場所で早めに休むことをおすすめします。",
    "en": "At the current trend, a rest is expected to become necessary near the destination. We suggest resting at the available facility ahead before continuing."
  },
  "options": ["accept_rest", "postpone", "decline"]
}
```

The message must not claim that `threshold_fire` has already been crossed. It
must explain that the proposal is early and based on the current trend.

### 12.2 State and fire reason

Use an NRI state label that does not misreport an actual threshold-100 fire:

```text
states.rest = REST_FORECAST_FIRE
fire_control.reason = forecast_rest_opportunity_passed
```

The rest candidate records the current raw score, the early threshold, and every
forecast/actionability gate. The monotony candidate remains present for review.

### 12.3 Strength

The forecast proposal is anticipatory. It uses a fixed `clear` strength. It does
not use `strong`, because `strong` currently communicates manifested
drowsiness/fatigue contribution on an ordinary threshold-fire result.

---

## 13. Forecast data contract

The route/tick layer provides a compact NRI-only forecast block to the current
NRI evaluation. It must not expose a mutable future run.

Recommended context shape:

```json
{
  "nri_forecast": {
    "evaluated": true,
    "error": null,
    "threshold_order_valid": true,
    "future_fire": {
      "found": true,
      "tick_index": 42,
      "elapsed_min": 126.0,
      "distance_km": 101.5,
      "route_fraction": 0.84,
      "s_total": 100.8
    },
    "forecast_rest_spot": {
      "exists": true,
      "position_km": 116.0,
      "eta_from_fire_min": 14.0,
      "eta_to_destination_min": 7.0,
      "inside_destination_edge": true
    },
    "forecast_reject_trigger": true,
    "current_rest_spot": {
      "exists": true,
      "position_km": 83.0,
      "eta_from_current_min": 18.0,
      "eta_to_destination_min": 31.0,
      "actionable": true
    }
  }
}
```

All nullable/absent cases must be explicit. Do not substitute zero for an
unknown ETA and do not substitute `9999.0` for a missing destination ETA.

The `9999.0` sentinel remains limited to the existing meaning of
`nextRestSpotMin`: no rest spot remains ahead.

---

## 14. Evidence requirements

### 14.1 Criteria

The NRI `criteria` block gains:

```text
threshold_forecast_rest
forecast_threshold_order_valid
forecast_fire_found
forecast_fire_s_total
forecast_fire_eta_from_now_min
forecast_fire_distance_km
forecast_rest_spot_exists
forecast_rest_spot_eta_to_destination_min
forecast_reject_trigger
current_rest_spot_exists
current_rest_spot_eta_min
current_rest_spot_eta_to_destination_min
current_rest_spot_actionable
```

Existing criteria remain:

```text
threshold_fire
threshold_monotony
rest_required_threshold
monotony_suggest_threshold
rest_spot_eta_filter_min
```

### 14.2 Rest candidate gates

The `rest_required` feature-contribution block records these forecast gates in
evaluation order:

1. `forecast_threshold_order`
2. `forecast_current_score`
3. `forecast_future_fire`
4. `forecast_future_rest_spot`
5. `forecast_destination_edge`
6. `forecast_current_rest_spot`
7. `forecast_current_rest_spot_eta`
8. `forecast_current_rest_spot_destination_edge`
9. existing recovery suppression

Each gate includes evaluated inputs, threshold where applicable, `passed`, and
`effect`. The trace must make a blocked early proposal understandable without
recomputing the forecast from logs.

### 14.3 Explanation

When the early proposal fires, the NRI explanation includes:

- current total score and its base/environment/realtime decomposition;
- early threshold 80 and ordinary threshold 100;
- expected time and distance of the threshold-100 crossing;
- why the future rest spot is too late or absent;
- current target rest-spot ETA; and
- destination ETA remaining after reaching the current target.

Example English explanation:

> Total fatigue score is 84.2 points, above the forecast-rest threshold of 80
> but below the ordinary rest threshold of 100. Without a new intervention, the
> score is expected to reach 100 near the destination, where the following rest
> spot would leave only 7 minutes to arrival. A rest spot is currently available
> 18 minutes ahead and still 31 minutes from the destination, so an early rest
> proposal was issued.

---

## 15. Integration architecture

### 15.1 Shared responsibility

The behavior separates into three clear responsibilities:

| Responsibility | Owner |
|---|---|
| Project future route, signals, and NRI package state without new actions | NRI forecast service in each runtime |
| Decide whether forecast and current rest opportunities satisfy NRI rules | NRI package evaluation |
| Apply response suppression, actionability, recovery suppression, and trip-edge neutralization | Existing run/preview orchestration |

This keeps route integration out of `algorithm.py` while keeping the NRI policy
inside the NRI decision.

### 15.2 Python application

Recommended ownership:

- `app/api/aica_api/services/nri_forecast.py` — new pure forecast service.
- `app/api/aica_api/services/run_manager.py` — invoke the service for live NRI
  ticks and continue to apply existing post-decision gates.
- `app/api/aica_api/services/preview.py` — invoke the same service against copied
  preview state; do not reuse the preview auto-action loop as the forecast.
- `app/api/aica_api/services/tick_engine.py` — reuse its existing route/signal and
  ETA rules; do not add a second ETA formula.
- `packages/nri_fatigue_score_v1/algorithm.py` — read `nri_forecast`, apply the
  early-rest gates, and produce evidence/proposal output.
- `packages/nri_fatigue_score_v1/package.json` — declare
  `threshold_forecast_rest` and the early-rest proposal.

### 15.3 Offline TypeScript application

Mirror the same contract and decisions in:

- `htmlapp/frontend/src/engine/nri_forecast.ts` — TypeScript forecast service.
- `htmlapp/frontend/src/engine/run_manager.ts` — live offline tick integration.
- `htmlapp/frontend/src/engine/services/preview_ticks.ts` — preview integration.
- `htmlapp/frontend/src/engine/tick_engine.ts` — existing route/signal/ETA rules.
- `htmlapp/frontend/src/data/packages/builtin/nri_fatigue_score_v1.ts` — NRI
  decision and evidence.

The Python and TypeScript forecast contracts must be field-for-field equivalent.

### 15.4 Two-pass current-tick evaluation

The forecast needs the current raw NRI score and the NRI state produced by the
current tick. A safe integration sequence is:

1. Evaluate the current NRI tick normally with no `nri_forecast` block.
2. If the score and current state make forecast evaluation eligible, run the
   copied no-new-intervention forecast from the first evaluation's next package
   state.
3. Reevaluate the same current tick from the same original input state, now with
   the compact `nri_forecast` block.
4. Persist only the second evaluation's `next_package_runtime_state`.

NRI evaluation is pure, so both evaluations produce the same accumulation state.
The second pass changes only the current decision classification and evidence.
The package state must never be advanced twice.

As an equivalent implementation, orchestration may use a package-owned pure
decision-finalization helper after the forecast, provided it produces exactly the
same candidate, criteria, explanation, proposal, and next-state contract. It must
not duplicate NRI score formulas in the orchestration layer.

---

## 16. Ordering with existing gates

For an NRI tick, apply decisions in this order:

1. Compute the current tick state and signals.
2. Evaluate the current NRI score/state once.
3. Compute the copied forecast when eligible.
4. Finalize the NRI decision with forecast evidence.
5. Store the final `next_package_runtime_state` once.
6. Apply the existing trip-edge guard before recording the tick event.
7. Record the tick event.
8. Apply existing recovery-active actionability suppression.
9. Apply existing response suppression and proposal-count rules.
10. Pause/show/auto-handle the proposal according to the existing live or
    preview behavior.

The current trip-edge guard remains after NRI evaluation. Therefore, an early
forecast proposal accidentally produced inside the first-20-minutes or
last-10-minutes edge is neutralized with the existing `trip_edge_guard` reason
and does not consume response suppression or count capacity.

---

## 17. Proposal history and driver response

A forecast-based early rest proposal that reaches the driver is a real
`REST_PROPOSAL`:

- it is recorded as fired;
- accepting it starts the existing rest flow;
- postponing or declining it uses existing action handling;
- it counts under the existing proposal-count policy; and
- existing same-category response suppression applies.

It is not neutralized merely because it was forecast-based. Only the existing
trip-edge guard can neutralize it before recording.

This design does not create a special threshold-100 override of a prior driver
decline. The existing severe-intervention behavior remains the separate path for
manifested danger, and the hard destination zone remains authoritative for
routine rest proposals.

---

## 18. Error and unavailable-data behavior

Forecasting is advisory to the current NRI decision. It must fail closed for the
new behavior and fail open for ordinary NRI behavior:

| Condition | Required result |
|---|---|
| Forecast service throws or returns an algorithm error | Keep the ordinary current NRI decision; record forecast unavailable for diagnostics |
| M1/time-only run has no destination distance | Disable forecast rest; keep ordinary NRI behavior |
| Total route distance is absent or non-positive | Disable forecast rest |
| Current distance is absent | Disable forecast rest |
| Route has no future threshold-fire crossing | `forecast_reject_trigger = false` |
| Crossing exists but no rest spot remains there | `forecast_reject_trigger = true`, but early fire still requires a current actionable spot |
| Current rest spot does not exist | No early proposal |
| Current `nextRestSpotMin == 9999.0` | No early proposal |
| Current rest spot ETA exceeds the existing limit | Wait and reevaluate on later ticks |
| Current rest spot is inside destination edge | No early proposal |
| Threshold ordering is invalid | Disable forecast rest without changing ordinary bands |
| Recovery is active | Disable forecast rest until recovery ends |

Forecast errors must not mark the whole tick as `algorithm_error` unless the
ordinary current NRI evaluation itself failed.

---

## 19. Performance constraints

The full remaining route must not be projected unnecessarily. Before starting a
forecast, the first current NRI evaluation may apply these cheap gates:

```text
package is NRI
AND threshold ordering is valid
AND threshold_forecast_rest < S_now < threshold_fire
AND recovery is inactive
AND destination distance is available
AND current tick is outside the existing trip-edge zones
```

The forecast stops at the first threshold-fire crossing; it does not need to
simulate the rest of the trip after that point.

The first implementation may recompute the copied forecast on every eligible
tick for correctness and parity. Any later cache must be keyed by every input
that affects the projection, including current position/time, driver signals,
package runtime state, content state, route facts, event plan, speed profile,
tick duration, parameters, and hyperparameters. A partial cache key is not
acceptable because it can return a stale safety decision.

The offline implementation runs in the existing worker path where available.
Forecasting must not move heavy calculation into React rendering.

---

## 20. Test design

### 20.1 NRI unit tests

1. `threshold_forecast_rest` default is `80.0`.
2. Score exactly 80 does not fire the early rest path.
3. Score slightly above 80 can fire when every forecast and spot gate passes.
4. Score at or above 100 uses the ordinary rest path, not the forecast path.
5. Invalid threshold ordering disables only the forecast path.
6. A passing forecast-rest decision returns `REST_PROPOSAL` and
   `rest_required`.
7. A passing forecast-rest decision suppresses the monotony candidate with
   `superseded_by_forecast_rest`.
8. A blocked forecast-rest decision retains ordinary monotony behavior.
9. The early proposal has `accept_rest`, `postpone`, and `decline` options.
10. The explanation does not say threshold 100 was already crossed.

### 20.2 Forecast-service unit tests

1. Forecast starts from a copy and does not mutate input state.
2. Forecasted NRI package state advances exactly once per future tick.
3. Forecast proposals do not create action events.
4. Forecast monotony proposals do not activate new content.
5. Forecast rest proposals do not start recovery.
6. Already-active content continues only for its remaining episode.
7. Forecast stops at the first `s_total >= threshold_fire` tick.
8. Forecast stops cleanly at destination when there is no crossing.
9. Future rest spot is the first ordered position strictly ahead of the crossing.
10. Future destination ETA uses planned-profile integration.
11. A future rest spot with 9.9 minutes to destination sets
    `forecast_reject_trigger = true`.
12. A future rest spot with exactly 10.0 minutes to destination does not.
13. No rest spot after the crossing sets `forecast_reject_trigger = true`.
14. Forecast failure returns unavailable data without changing the normal
    current decision.

### 20.3 Current rest-spot tests

1. Current nearest spot within 60 minutes and outside the end edge is actionable.
2. Current nearest spot over 60 minutes is not actionable.
3. The same spot becomes actionable at a later tick when its ETA reaches 60.
4. `nextRestSpotMin == 9999.0` is never actionable for forecast rest.
5. Current nearest spot inside the last-10-minutes zone is not actionable.
6. A spot already passed is never selected.
7. The algorithm never selects a prior rest spot to preserve an earlier
   opportunity.

### 20.4 Existing-gate integration tests

1. Early forecast proposal inside the first 20 minutes is neutralized by the
   existing trip-edge guard.
2. Early forecast proposal inside the last 10 minutes is neutralized.
3. A neutralized forecast proposal does not consume response suppression or
   proposal-count capacity.
4. A displayed forecast proposal is recorded and existing driver-response rules
   apply.
5. Recovery-active suppression prevents a forecast proposal.
6. A non-routine escalation remains unaffected.

### 20.5 Live/preview parity tests

For a fixed scenario, seed, route, and tick duration, Python live, Python
preview, TypeScript live, and TypeScript preview must agree on:

- current raw `s_total`;
- forecast fire tick/time/distance;
- forecast rest spot;
- destination ETA at the forecast rest spot;
- `forecast_reject_trigger`;
- current rest spot and its two ETAs;
- whether the early proposal fires;
- result type, category, fire reason, and proposal ID; and
- every new criteria field.

Golden fixtures must include passing, waiting-for-a-spot, no-current-spot,
future-spot-at-boundary, and forecast-error cases.

### 20.6 Regression tests

Existing tests must continue to prove:

- default NRI bands remain 60 and 100;
- ordinary rest proposals retain their current ETA behavior;
- monotony-only scenarios remain unchanged when forecast gates fail;
- start/end trip-edge suppression remains unchanged;
- zero-fire quickview projections return cleanly; and
- content/recovery behavior is unchanged by a forecast that is never accepted.

---

## 21. Acceptance criteria

The solution is complete when all of these are true:

1. With default NRI thresholds, a current score of 80 or below cannot produce a
   forecast-based rest proposal.
2. A no-new-intervention projection can identify the first future score-100
   crossing without changing live or preview state.
3. A following future rest spot inside the last-10-minutes zone creates
   `forecast_reject_trigger`.
4. No future rest spot after the crossing also creates
   `forecast_reject_trigger`.
5. `forecast_reject_trigger` alone cannot produce a proposal.
6. A score above 80 with no nearby current rest spot cannot produce a proposal.
7. A score above 80 with a current spot over the 60-minute ETA limit waits.
8. The proposal can fire later when that current spot becomes actionable.
9. A current target inside the destination zone cannot be offered.
10. A passing early decision is a real `REST_PROPOSAL`, not a
    `MONOTONY_PROPOSAL` and not a new result type.
11. At score 100 or above, the ordinary NRI rest decision remains authoritative.
12. The existing trip-edge guard remains the final authority for routine edge
    proposals.
13. Forecast failure never blocks an otherwise valid ordinary NRI decision.
14. Python and TypeScript live/preview outputs remain equivalent.
15. Evidence explains both the future rejection risk and the current actionable
    rest opportunity.

---

## 22. Alternatives considered

### 22.1 Fire a rest proposal immediately at `threshold_monotony = 60`

Rejected. Score 60 already has a defined meaning: monotony prevention and
refreshing content. Converting it into a rest proposal would blur two existing
NRI bands and would fire too early for the agreed safety evidence.

### 22.2 Fire a rest proposal immediately when score exceeds 80

Rejected as incomplete. A score crossing alone does not guarantee that a rest
spot is nearby. The proposal could ask the driver to rest without offering a
usable opportunity.

### 22.3 Select the latest rest spot before the destination no-trigger zone

Rejected. A late stop can still feel too close to the destination and reproduce
the same driver rejection. The forecasted late spot is used only to detect the
problem. The actual early target is the closest actionable spot from the current
score-above-80 position.

### 22.4 Recommended: score-gated and opportunity-gated forecast rest

Accepted. Forecasting detects that the normal rest opportunity will arrive too
late. Score above 80 supplies sufficient early evidence. The existing 60-minute
rest-spot ETA limit ensures there is a concrete current opportunity. The hard
destination guard remains unchanged.

---

## Appendix A — Complete discussion transcript

This appendix preserves every substantive user and assistant message in the
brainstorming discussion. System instructions, tool output, and short status
updates are not part of the design discussion and are not reproduced.

### User

> This session is for brainstorming to suggest the solution to solve the issue, no implemetation here.
>
> # Terminology:
> - threshold_monotony = 60, the threshold for preventing monotony
> - threshold_fire = 100, threshold_fire is the existing higher NRI threshold for the safety/rest proposal.
> - The last 10 minutes before the destination form a hard no-trigger zone.
>
> # Scope:
> - NRI algorithm
>
> # Idea detail
>
> In last commit, we fix the issue that prevent to trigger safety proposal near the destination 10 mins eta because driver will likely reject it to continue to arrive destination.
> However, the strategy of rest proposal is always safety first, so just bypassing the trigger would possibly cause implicit dangerous situation where driver reach over the safety of drowsiness or fatigue.
> Instead of bypassing, I suggest that we can look ahead the future to generate a forecast-based rest proposal.
> The idea at each current tick:
> 1. We predict the possible rest-proposal trigger eta which may happen in the future
> 2. From that forecast trigger location, we find the closest rest spot.
> 3. If that forecast rest spot is inside the guard zone 10 mins eta before destination, there is likely a high change that driver would reject it, so we call it forecast reject trigger.
> 4. So now we have the context about forecast reject trigger, we will look back to find the forecast rest proposal, which may be the last chance that driver can accept the trigger and recovery for safety
> 5. The problem now is how we should propose a rest early than the real signal. My suggest is we may try threshold_monotony. The idea is the time the predictable score gets over this monotony threshold, we may trigger the rest proposal here instead, then driver have a last chance to take a rest instead of just small recovery by activating service to prevent monotony
>
> ## Assumption
> - About the prediction, beside the predictable features, we may have unpredictable features such as drowsiness and fatigue. We assume that we could predict both those features, because we can always build a linear model to predict driver drowsiness or fatigue base on history tick values. So let make thing simply by just run ahead the future tick time to predict the safety score.
>
> # You job
>
> We will together step by step to clarify to complete solution.
> But first of all, please debating and may propose me a better idea which is real and implementable

### Assistant

> Your core idea is sound: replace blind end-zone suppression with an anticipatory “last viable rest opportunity.” But I would not implement it as “turn the threshold-60 monotony trigger into a rest trigger.”
>
> The main problems are:
>
> - `threshold_monotony = 60` already means `MONOTONY_PROPOSAL`, offering content rather than `accept_rest`. Reusing it directly would blur the safety meaning of the two thresholds in `algorithm.py`.
> - The closest stop after the predicted threshold-100 crossing is not necessarily useful. If it lies inside the last-ten-minute zone, the relevant stop is the latest reachable stop before that zone.
> - Forecasting the ordinary simulation unchanged would be misleading: preview currently accepts monotony content and rest proposals, which changes later scores. The forecast must be a counterfactual “continue driving with no new intervention.”
> - A fixed threshold-60 rule can still miss the last stop if the score reaches 60 only after that stop has been passed.
>
> I recommend a “forecasted last-opportunity” policy:
>
> 1. From the current tick, simulate the no-intervention score trajectory to the destination.
> 2. Find the first predicted crossing of `threshold_fire = 100`.
> 3. Determine the rest stop normally associated with that crossing.
> 4. If that stop is inside the hard destination zone—or no stop remains after the crossing—identify the latest reachable rest stop outside the zone.
> 5. Open an anticipatory-rest eligibility window for that specific stop.
> 6. Fire a distinct `REST_PROPOSAL` with reason such as `forecast_last_viable_rest`, a named target stop, and `accept_rest`; do not relabel it as a monotony proposal.
> 7. Use score 60 as an evidence/activation gate, not as the safety justification. The justification remains: “continuing without rest is forecast to cross 100 when no acceptable stop remains.”
> 8. Cancel or recompute the forecast if the route, signals, content activity, or recovery state changes.
>
> A practical initial trigger condition would be:
>
> ```text
> predicted score crosses 100 before arrival
> AND the normal post-crossing rest opportunity is inside the hard zone or absent
> AND a pre-zone rest stop is still reachable
> AND current score >= 60
> AND that stop is within the existing acceptable notice horizon
> AND no cooldown/dedup rule suppresses the proposal
> ```
>
> The repository already has most required mechanics: deterministic drowsiness/fatigue progression, route-aware ETA integration, rest-stop positions, and copied-state preview execution. The architectural gap is that NRI currently receives only `nextRestSpotMin`, not the destination ETA and full opportunity sequence. The eventual design should provide NRI with a compact forecast result rather than leaking the entire route model into the package.
>
> The most important unresolved safety decision is this: should 60 be an absolute minimum, or may a high-confidence forecast trigger below 60 at the last viable decision point when waiting for 60 would mean passing the final usable rest stop?

### User

> good,
>
> - so insead of threshold > 60, I suggest > 80 for forecast rest proposal, the middle between monotony and safety threshold
> - The closest stop after the predicted threshold-100 crossing is not necessarily useful. If it lies inside the last-ten-minute zone, the relevant stop is the latest reachable stop before that zone -> No, you are wrong here, driver will likely reject the rest spot near the destination.
> - Forecasting the ordinary simulation unchanged would be misleading: preview currently accepts monotony content and rest proposals, which changes later scores. The forecast must be a counterfactual “continue driving with no new intervention. -> good, predict score without any intervention is a good approach
> - A fixed threshold-60 rule can still miss the last stop if the score reaches 60 only after that stop has been passed it should be fine, because if the monotony trigger close to destination, meaning the chance driver gets over the drowsiness and fatigue safety is lower, and the safety correction may appcetable be bypassed

### Assistant

> Understood—I had the rest-stop selection wrong. The forecasted near-destination stop should only detect the rejection risk; it should not become the proposed stop.
>
> The revised policy is:
>
> 1. Forecast the no-intervention score trajectory.
> 2. Find the predicted `threshold_fire = 100` crossing.
> 3. From that forecast location, find the closest following rest spot.
> 4. If that forecast rest spot is within the last-ten-minute destination zone, set `forecast_reject = true`.
> 5. During actual driving, if `forecast_reject = true` and the current score exceeds 80, issue an early `REST_PROPOSAL`.
> 6. Select the closest rest spot ahead from the current score-80 location—not the last stop near the destination.
> 7. If the score never exceeds 80 early enough, do not force an anticipatory proposal. The destination guard may suppress the eventual routine trigger because the projected safety risk was not sufficiently strong early enough.
>
> So score 80 is a hard evidence gate, not merely a preferred trigger time. I would represent it explicitly as `threshold_forecast_rest = 80`, keeping its meaning separate from both monotony prevention at 60 and actual safety/rest necessity at 100.
>
> One detail to clarify: when the score exceeds 80, should the early proposal fire only when the closest rest spot from that current position is itself outside the last-ten-minute destination zone?

### User

> the problem of step 5 is that what if there is not rest spot near the early REST_PROPOSAL?

### Assistant

> Exactly. That means score 80 cannot directly fire the proposal; it should only arm the policy.
>
> Revised behavior:
>
> ```text
> forecast_reject detected
>         +
> current score > 80
>         ↓
> FORECAST_REST_ARMED
>         ↓
> wait until a suitable rest spot is actionable
>         ↓
> fire early REST_PROPOSAL for that specific spot
> ```
>
> A suitable target should be the first rest spot ahead after the score-80 point that:
>
> - Is outside the destination no-trigger zone.
> - Has not already been passed.
> - Is within an acceptable ETA from the current position.
>
> If the spot is still too far away, the system remains armed and reevaluates each tick. If there is no suitable stop before the destination zone, it should not produce an unfulfillable forecast rest proposal; ordinary safety or severe-intervention policy handles any later manifested danger.
>
> The proposal therefore becomes both score-gated and opportunity-gated:
>
> ```text
> forecast_reject
> AND current_score > 80
> AND suitable_rest_spot_exists
> AND rest_spot_eta <= actionable_eta_limit
> AND current tick is outside the hard no-trigger zone
> ```
>
> What maximum ETA should make a rest spot “actionable”—should we reuse the existing `rest_spot_eta_filter_min` of 60 minutes?

### User

> look good now, let write the markdown document to specify in detail of this solution.
> At the end of the document, append the whole script of this discussion into it.
> Remember that make this document as detail as possible for ready to implement the solution. And dont use the out of scope vocabulary of this project which may cause ambiguously.
> After that, make me another Japanese version for the document, the target reader is low-tech Japanese, so make the document even simpler and dont use weird Japanese.
