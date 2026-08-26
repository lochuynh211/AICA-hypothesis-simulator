# NRI Forecast-Based Early Rest Proposal — Design

**Date:** 2026-08-22

**Refined:** 2026-08-24

**Branch:** `fixbug-0806`

**Scope:** NRI algorithm behavior in `app/` and its `htmlapp/` mirror

**Status:** Refined solution approved; written specification awaiting owner review

**Implementation:** Out of scope for this document-writing session

---

## 1. Decision summary

The existing last-10-minutes trip-edge guard remains a hard no-trigger zone for
routine `REST_PROPOSAL` and `MONOTONY_PROPOSAL` results. This design does not
weaken or bypass that guard.

Instead, NRI gains a forecast-based early rest path. At an eligible real tick,
the simulator copies the actual state after that tick and projects the remaining
drive. The copy continues any intervention the driver has already accepted,
including active content and its remaining effects. The projection never accepts
an additional proposal produced by a projected future tick.

If that `committed_state_continuation_forecast` shows that:

1. `s_total` will reach `threshold_fire` before the destination; and
2. at that predicted crossing, the closest rest spot ahead is more than 30
   minutes away, is inside the last 10 minutes before the destination, or does
   not exist,

then the tick has a `forecast_future_rest_unactionable` context. This context
means that a normal future rest proposal would not have an actionable rest spot.

The forecast context alone does not produce a proposal or persist an armed
state. It makes the current tick eligible to test an early-rest opportunity.
NRI produces an early `REST_PROPOSAL` only when all of the following are also
true:

- the current `s_total` is strictly greater than `threshold_forecast_rest`
  (default `65`);
- the current `s_total` is still below `threshold_fire` (default `100`), so this
  remains an early proposal rather than the ordinary safety/rest proposal;
- the closest rest spot ahead of the current vehicle position exists;
- that current rest spot is within `rest_spot_eta_filter_min` (default 30
  minutes);
- that current rest spot is outside the last-10-minutes destination zone; and
- the existing fire-control, response-suppression, recovery, and trip-edge rules
  allow the proposal.

If the score is above 65 but no suitable rest spot is currently actionable, no
early rest proposal fires. The NRI output must not claim that a rest fire
occurred: the blocked rest path cannot set the overall `trigger_candidate`, the
rest candidate has `fire_control.fired = false`, `proposal = null` for the rest
path, and `states.rest` is not changed to `REST_FORECAST_FIRE`. If no other
category fires, the overall `trigger_candidate` is false. No rest fire marker,
proposal-history entry, response-suppression entry, proposal-count use, or run
pause is created by the blocked rest path. Ordinary monotony behavior may still
fire and follow its normal lifecycle while the score remains below 100.

The forecast and current spot are recalculated from the actual committed state
at the next real tick. This is not a sticky or permanently armed fire. The
early path may fire on the first later tick where the current score still
satisfies `65 < s_total < 100`, a current rest spot becomes actionable, the
future-rest problem still exists, and every other gate passes. If the score
falls to 65 or below, the early path is no longer eligible. If the score reaches
100, the early path closes and the ordinary rest path owns the tick.

The ordinary score-100 path follows the same no-fire rule. If no current rest
spot is actionable, it returns a suppressed rest decision with no proposal and
reevaluates on the next real tick. It may fire later if a spot becomes
actionable and the ordinary gates still pass. If no spot ever becomes
actionable, no routine NRI `REST_PROPOSAL` ever fires.

The same 30-minute ETA rule defines actionability everywhere: the forecast fire
point, the current early opportunity, the ordinary score-100 rest path, and the
rest-spot picker. The former projected-drowsiness reachability rule and its
`rest_drowsiness_ceiling` control are removed. Spots over 30 minutes remain
visible in the picker for transparency, but are disabled.

---

## 2. Problem

The trip-edge guard introduced in commit `f9a9aaf` correctly prevents routine
proposals that drivers are unlikely to accept:

- the first 20 minutes after the trip starts; and
- the last 10 minutes of driving ETA before the destination.

The guard neutralizes a routine fire before it enters the evidence log. This is
important because an automatic decline would start the same-category response
suppression and consume proposal-count capacity.

The end-edge behavior creates one NRI safety gap:

1. NRI can be below `threshold_fire` before the last-10-minutes zone.
2. Continued driving can raise `s_total` to or above `threshold_fire` near the
   destination.
3. A normal rest proposal at that time is neutralized by the hard guard because
   the driver is likely to continue to the destination.
4. Merely hiding that future proposal loses the earlier opportunity to suggest
   a usable rest.

There is a second form of the same gap outside the destination edge:

1. NRI reaches `threshold_fire` in real time.
2. The closest following rest spot is more than the current actionability limit
   away, or no spot remains ahead.
3. A rest proposal at that point cannot offer an appropriate place to stop.
4. A prior rest spot may already have been passed even though it would have been
   actionable earlier.

The current NRI implementation also contains behavior that conflicts with this
refinement. In both `packages/nri_fatigue_score_v1/algorithm.py` and
`htmlapp/frontend/src/data/packages/builtin/nri_fatigue_score_v1.ts`, the
ordinary rest gate currently treats `nextRestSpotMin >= 9999.0` as permission to
fire. The sentinel actually means that no rest spot remains ahead. The same
condition is also recorded as a passing ETA contribution gate. This design
requires removing both uses of that exception. A no-spot sentinel must fail
rest actionability and must never create a rest fire.

The existing end-to-end test
`app/api/tests/test_t012_rest_handling.py::test_empty_rest_run_still_fires_rest_proposal`
locks in that conflicting behavior. Implementation must replace it with a test
that completes an empty-rest-spot run without any routine `REST_PROPOSAL`, while
still proving that the run completes without an algorithm error.

The solution must recognize both situations early, while preserving these
facts:

- a score below the early threshold is not strong enough to justify a rest
  proposal; and
- a rest proposal without a real rest spot at most 30 minutes away is not
  actionable; and
- a forecast must follow choices the driver has already made, otherwise active
  content such as a 15-minute humming-karaoke session would be omitted and the
  projected score would be wrong.

---

## 3. Existing NRI behavior that must remain true

NRI has one raw score:

```text
S_total(t) = S_base(t) + S_env(t) + S_realtime(t)
```

The existing score bands classify the current score. They do not by themselves
mean that a proposal fired:

```text
S_total >= threshold_fire
    -> rest_required band

threshold_monotony <= S_total < threshold_fire
    -> monotony_prevention / MONOTONY_PROPOSAL

S_total < threshold_monotony
    -> NO_PROPOSAL
```

A `REST_PROPOSAL` may fire from the `rest_required` band only when a current
rest spot is actionable. The score threshold makes the rest candidate exist;
the spot gate decides whether that candidate fires.

With the current defaults:

| Name | Value | Existing meaning |
|---|---:|---|
| `threshold_monotony` | 60 | The lower boundary for a monotony/content proposal |
| `threshold_forecast_rest` | 65 | New lower boundary for a forecast-based early rest proposal |
| `threshold_fire` | 100 | The ordinary safety/rest proposal threshold |
| `rest_spot_eta_filter_min` | 30 minutes | The single maximum ETA for an actionable rest spot |
| Trip end edge | less than 10 minutes to destination | Hard no-trigger zone for routine proposals |

The new score boundary does not create a second NRI score and does not change the
meaning of either existing threshold. It adds a narrowly gated rest decision
inside the existing 60-to-100 score band.

The following score/category ordering and orchestration gates remain unchanged;
the spot-actionability rule is intentionally refined as stated:

- `threshold_fire` remains the ordinary rest threshold.
- `threshold_monotony` remains the monotony/content threshold.
- Rest remains higher priority than monotony.
- Recovery suppresses both routine categories.
- The ordinary and forecast rest paths both use
  `rest_spot_eta_filter_min = 30` by default.
- The rest-spot picker uses the same resolved 30-minute ETA rule.
- The trip-edge guard still neutralizes routine proposals in both trip edges.
- `SEVERE_INTERVENTION` and any other existing non-routine escalation behavior
  remain outside this NRI change.
- Existing proposal-history suppression and proposal-count rules remain in
  force.

---

## 4. Goals

### 4.1 Functional goals

1. Predict whether NRI will reach `threshold_fire` before the destination while
   continuing every intervention already accepted at the start of each real
   tick and accepting no additional projected-future intervention.
2. Detect when the closest rest spot after that future crossing would be more
   than 30 minutes away, inside the last-10-minutes destination zone, or absent.
3. Allow a real early `REST_PROPOSAL` once the current score is greater than 65.
4. Show that proposal only when a concrete rest spot ahead is at most 30 minutes
   away and outside the destination no-trigger zone.
5. Keep the proposal and its evidence distinct from the ordinary
   `threshold_fire` result and from a `MONOTONY_PROPOSAL`.
6. Produce equivalent results in the Python application and the offline
   TypeScript application.
7. Use the same ETA calculation and actionability boundary for ordinary NRI,
   forecast NRI, and the rest-spot picker.
8. Remove projected drowsiness as a rest-spot selection rule.
9. Replace the current `9999.0`-means-fire exception with a hard no-fire rule in
   both NRI runtimes and their contribution evidence.

### 4.2 Safety and behavior goals

1. Never weaken the hard last-10-minutes no-trigger rule for routine proposals.
2. Never issue a forecast-based rest proposal at or below score 65.
3. Never issue any routine NRI rest proposal with no actionable rest spot ahead.
4. Never treat the `9999.0` no-rest-spot sentinel as an actionable spot for
   either early or ordinary rest.
5. Never let forecast calculation mutate the live run, preview run, proposal
   history, content state, recovery state, or package runtime state.
6. Never omit an intervention already accepted and active at the forecast start.
7. Never accept a proposal created by a projected future tick.
8. If forecasting fails, retain the ordinary NRI decision for the current tick.

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
- Which committed intervention was active when the forecast started, and how
  much of it remained?
- Which gate allowed or blocked the early proposal?
- Did the rest candidate actually fire, or was it only score-eligible while no
  actionable current spot existed?

---

## 5. Non-goals

This design does not include:

- a machine-learning model for drowsiness or fatigue;
- probabilistic confidence, upper/lower forecast bands, or uncertainty scoring;
- changes to the formulas for `S_base`, `S_env`, or `S_realtime`;
- changes to the drowsiness or fatigue progression model;
- changes to `threshold_monotony = 60` or `threshold_fire = 100` defaults;
- a proposal at score 65 exactly or below;
- a general forecast facility for non-NRI trigger packages;
- new rest-spot discovery or external map searches;
- a new destination guard duration;
- live opening-hours, closure, congestion, or capacity data for rest spots;
- a UI redesign;
- new `SEVERE_INTERVENTION` rules;
- changes to existing response-suppression or proposal-count behavior; or
- implementation work in this brainstorming session.

---

## 6. Exact terminology

This document uses only the following terms for the new behavior.

### `committed_state_continuation_forecast`

A copied, non-persisting projection from the post-current-tick state to the
destination. It applies the known route, traffic events, speed profile, tick
duration, driver-signal progression, NRI accumulation, and every intervention
the driver has already accepted.

For example, if the driver accepted 15 minutes of humming karaoke before the
current real tick, the copied projection includes the remaining playback time,
its content-relief accumulation, and its signal effects. When the committed
episode ends in the projected timeline, its effects end normally. It is not
extended or restarted.

The forecast accepts no proposal generated by a projected future tick. An
offered but unaccepted proposal is not a committed intervention and is not
included.

### `forecast_fire_point`

The first projected future tick whose raw `s_total` is greater than or equal to
the resolved `threshold_fire`.

### `forecast_rest_spot`

The closest rest spot strictly ahead of the vehicle at the
`forecast_fire_point`, using the same ordered rest-spot positions that produce
`nextRestSpotMin`.

### `forecast_future_rest_unactionable`

True when a `forecast_fire_point` exists and the first rest spot strictly ahead
of that point fails at least one shared actionability rule:

- no rest spot remains ahead;
- the spot ETA from the forecast fire point is greater than 30 minutes; or
- the spot is inside the last-10-minutes destination zone.

The field describes a route opportunity, not a driver response. It is not
recorded as a decline and does not itself affect proposal history.

### `forecast_rest_unactionable_reason`

The single reason why the future spot is not actionable:

```text
no_spot_ahead
eta_over_30_min
inside_destination_edge
```

If more than one condition could be reported, use the evaluation order above.
When the future spot is actionable, the reason is `null`.

### `threshold_forecast_rest`

The new NRI raw-score hyperparameter. Its default is `65.0`. The current score
must be strictly greater than this value for the early rest path.

### `current_rest_spot`

The closest rest spot strictly ahead of the actual vehicle position at the
current tick. This is the spot offered by the forecast-based early proposal.
It is deliberately different from `forecast_rest_spot`.

The `forecast_rest_spot` detects a future actionability failure. The
`current_rest_spot` is the actual early opportunity.

### Actionable rest spot

A `current_rest_spot` or `forecast_rest_spot` is actionable only when:

- it exists;
- its ETA from the evaluation position is finite and no greater than
  `rest_spot_eta_filter_min` (default 30 minutes);
- its ETA is not the `9999.0` no-rest sentinel; and
- the driving ETA from the rest spot to the destination is at least 10 minutes.

Exactly 30 minutes is actionable. Exactly 10 minutes from the spot to the
destination is outside the destination edge.

When the current spot is not actionable, record exactly one current-spot reason
in this order:

```text
no spot exists or ETA is 9999.0       -> no_spot_ahead
finite spot ETA exceeds the limit     -> rest_spot_eta_over_limit
spot-to-destination ETA is < 10 min   -> inside_destination_edge
```

These are eligibility or suppression reasons. They are never fire reasons and
do not mean that the driver declined a proposal.

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
  "default": 65.0,
  "min": 20.0,
  "max": 200.0,
  "step": 5.0
}
```

The default ordering is:

```text
threshold_monotony < threshold_forecast_rest < threshold_fire
60                 < 65                      < 100
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

At exactly `65.0` with the defaults, the early rest path does not fire. At
`threshold_fire` or above, the ordinary rest path owns the tick.

The resolved `rest_spot_eta_filter_min` default changes from `60.0` to `30.0`.
It is one shared rule, not a forecast-only parameter:

```text
rest_spot_actionable = finite_eta AND eta_min <= rest_spot_eta_filter_min
```

The NRI package definition, Python runtime, TypeScript runtime, preview paths,
and rest-spot picker all use the same resolved value. A caller must not retain a
separate 60-minute picker or ordinary-rest default.

Remove `rest_drowsiness_ceiling` as an active setting. New runs do not expose or
record it, and no rest-spot decision projects drowsiness at arrival. Historical
stored evidence is not rewritten.

---

## 8. Committed-state continuation forecast

### 8.1 Start state

The forecast begins after the current real tick has advanced its route, signals,
content, recovery, and NRI accumulation once normally. It copies:

- current elapsed simulation time;
- current route distance and route fraction;
- current drowsiness and fatigue values;
- current continuous-driving and monotony state;
- current NRI `package_runtime_state` after the current tick;
- the frozen event plan;
- route facts and ordered rest-spot positions;
- the effective speed profile;
- the effective scenario and driver parameters;
- the committed active content/service, its remaining duration, its purpose,
  and the content-relief accumulation already granted;
- current tick duration; and
- resolved NRI parameters and hyperparameters.

The live objects are never reused as mutable forecast state. A driver action
between ticks does not run an extra forecast. Its effect enters the forecast on
the next real tick, through the same normal tick-by-tick recalculation as every
other state change.

### 8.2 Forecast actions

For every projected future tick:

1. Advance route position and driver signals using the same tick-engine rules as
   the real run.
2. Build the same tiered signal context used by NRI.
3. Evaluate NRI with the copied forecast package state.
4. Record raw `s_total` and the copied next package state.
5. Continue the committed intervention present in the copied start state. End
   it at its real remaining-duration boundary.
6. Ignore every proposal and fire-control result returned by a projected future
   tick.
7. Do not append a real `TickEvent` or `ActionEvent`.
8. Do not acknowledge a new monotony proposal.
9. Do not accept, postpone, or decline a new rest proposal.
10. Do not create a new recovery sequence.
11. Stop at the first future tick at or above `threshold_fire`, or when the
    route completes.

Continuing the committed start state and ignoring later forecast proposals are
both load-bearing. The current preview loop
automatically acknowledges monotony proposals and accepts eligible rest
proposals. Reusing those action semantics would change content, recovery,
drowsiness, fatigue, monotony accumulation, and later `s_total`, so it would not
represent continued driving under the driver's actual current choice.

### 8.3 Existing active recovery

The forecast-rest path is disabled while a real recovery sequence is active.
The ordinary NRI recovery suppression remains authoritative. Forecasting is
evaluated again after recovery ends.

### 8.4 Existing active content

Content accepted before the forecast start is committed state, including content
accepted between the previous and current real ticks. The projection carries
its already-defined remaining duration and effects. It must not extend, replace,
or restart that content. Offered, selected, or prepared content that the driver
has not accepted and started is not active and is not projected.

### 8.5 Termination

The forecast terminates when any of these occurs:

- the first projected `s_total >= threshold_fire` tick is found;
- the destination is reached;
- the underlying NRI evaluation returns an algorithm error; or
- the existing route/tick safety ceiling is reached.

No threshold crossing before route completion means
`forecast_future_rest_unactionable = false`.

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

The future spot is actionable when:

```text
forecast_rest_spot exists
AND forecast_rest_spot.eta_from_fire_min is finite
AND forecast_rest_spot.eta_from_fire_min <= rest_spot_eta_filter_min
AND forecast_rest_spot.eta_to_destination_min >= 10.0
```

Set `forecast_future_rest_unactionable = true` when a fire point exists and the
future spot is not actionable. Record exactly one reason in this order:

```text
no spot exists                         -> no_spot_ahead
spot ETA from fire point > 30 minutes -> eta_over_30_min
spot-to-destination ETA < 10 minutes  -> inside_destination_edge
```

The configured `rest_spot_eta_filter_min` supplies the comparison value; 30 is
the required default and the reason name describes that approved default.
Exactly 30.0 minutes passes. Do not treat the future spot as the early target.
Its only role is to establish that the ordinary future rest opportunity would
be unactionable.

---

## 10. Current rest-spot actionability

Once `forecast_future_rest_unactionable` is true and the current score is above
the early threshold, evaluate the actual rest opportunity at the current tick.

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
early rest proposal fires. The next actual tick reevaluates the same conditions.
Once the spot enters the shared ETA window, the proposal may fire if every other
gate still passes.

With the approved default, the window is 30 minutes. A spot at 30.0 minutes is
actionable; a spot above 30.0 minutes is not.

### 10.2 No spot ahead

If the current tick has no rest spot ahead, no forecast-based rest proposal may
fire. The ordinary threshold-100 path changes to the same rule: `9999.0` is not
actionable and no routine NRI rest proposal fires without a real spot. In
particular, remove the current Python and TypeScript condition that treats
`nextRestSpotMin >= 9999.0` as a passing ETA gate.

### 10.3 Current spot inside the destination zone

If the current spot leaves less than 10 minutes of driving to the destination,
no forecast-based rest proposal fires. Selecting a late spot would reproduce the
same likely rejection that this feature is intended to avoid.

### 10.4 Score threshold reached after an earlier spot was passed

The policy never goes backward to a rest spot that has already been passed and
never fires below or at the early threshold to preserve an earlier stop. If the
score becomes eligible too late, bypassing the early correction is accepted.
This follows the agreed assumption that a later score-65 crossing means less
remaining time for the score to reach the ordinary safety threshold.

### 10.5 Tick-by-tick retry without a latch

Failure of current-spot actionability does not create a pending or armed fire.
Every next real tick repeats the full calculation from the actual post-tick
committed state:

```text
tick t:   65 < score < 100, no actionable current spot   -> no early rest fire
tick t+1: recalculate; still no actionable current spot  -> no early rest fire
tick t+2: recalculate; actionable spot and all gates pass -> early rest fire
```

The score, committed intervention, future crossing, future spot actionability,
current spot, both current-spot ETAs, and all orchestration gates can change
between those ticks. Nothing from tick `t` forces tick `t+1` to fire.

If the score becomes 100 or greater before a current spot is actionable, switch
to the ordinary rest path. That path also reevaluates the current spot every
real tick and may fire only on a tick where the spot is actionable. It does not
fall back to monotony in the score-100 band.

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
AND committed_state_continuation_forecast finds a future S_total >= T_fire
AND forecast_future_rest_unactionable == true
AND current_rest_spot exists
AND current_rest_spot ETA from now is finite
AND current_rest_spot ETA from now <= ETA_limit  # default 30 minutes
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

### 11.1 Priority inside the 65-to-100 band

Without this feature, a score above 65 and below 100 is inside the existing
monotony band. When the full forecast-rest rule passes:

- `rest_required` owns the tick because it has priority 1;
- `monotony_prevention` is retained in candidates but suppressed with reason
  `superseded_by_forecast_rest`; and
- only the early `REST_PROPOSAL` is actionable.

When any forecast-rest gate fails, the ordinary monotony behavior remains
unchanged.

### 11.2 Ordinary threshold-fire priority

When `S_now >= threshold_fire`, do not classify the result as forecast-based.
The ordinary rest path owns the tick, including the shared 30-minute ETA filter,
real-spot requirement, recovery gate, response suppression, and trip-edge
guard. If no real spot is at most 30 minutes away, the ordinary rest candidate
is suppressed with `no_spot_ahead`, `rest_spot_eta_over_limit`, or
`inside_destination_edge`; the monotony candidate does not take over the
score-100 band.

“Suppressed” here explicitly means “did not fire,” not “fired but was hidden”:

```text
rest candidate exists                  = true
rest candidate fire_control.fired      = false
rest candidate fire_control.suppressed = true
rest candidate fire_control.reason     = current-spot failure reason
result_type                             = SUPPRESSED
trigger_candidate                       = false
selected_category                       = null
overall fire_control.fired              = false
overall fire_control.suppressed         = true
proposal                                = null
```

No fired rest event or rest marker is recorded and the blocked rest path does
not pause the run. A later real tick recomputes the ordinary decision; it does
not consume or resume a pending fire.

---

## 12. NRI decision output

Only an early path whose current rest spot is actionable and whose other gates
all pass uses these existing project categories and result types:

```text
result_type       = REST_PROPOSAL
selected_category = rest_required
trigger_candidate = true
```

It does not introduce a new result type or trigger category.

If the future-rest problem exists but the current spot is not actionable, the
rest path must instead have all of these properties:

```text
rest candidate fire_control.fired = false
proposal                           = null for the rest path
states.rest                        != REST_FORECAST_FIRE
```

While `65 < s_total < 100`, the ordinary monotony path is evaluated normally.
It may therefore be the tick's actual `MONOTONY_PROPOSAL`. The no-spot rule
forbids a rest fire; it does not forbid an unrelated actionable monotony
proposal. A blocked early-rest path cannot set the overall
`trigger_candidate`; that field is true only if another category, such as the
ordinary monotony path, actually fires.

### 12.1 Proposal

Add an NRI proposal definition:

```json
{
  "id": "forecast_rest_required_proposal",
  "message": {
    "ja": "このまま走ると、休憩が必要になる時に近くの休憩場所を使えない見込みです。前方の休憩場所で早めに休むことをおすすめします。",
    "en": "At the current trend, no nearby rest facility is expected to be actionable when a rest becomes necessary. We suggest resting at the available facility ahead before continuing."
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

Set these values only after the current rest spot and every other early-rest
gate passes. Never use `REST_FORECAST_FIRE` or
`forecast_rest_opportunity_passed` on a retry tick with no actionable current
spot.

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
    "forecast_mode": "committed_state_continuation",
    "forecast_start": {
      "content_active": true,
      "service_id": "humming_karaoke",
      "content_remaining_min": 11.0
    },
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
      "eta_from_fire_min": 34.0,
      "eta_to_destination_min": 22.0,
      "actionable": false
    },
    "forecast_future_rest_unactionable": true,
    "forecast_rest_unactionable_reason": "eta_over_30_min",
    "current_rest_spot": {
      "exists": true,
      "position_km": 83.0,
      "eta_from_current_min": 18.0,
      "eta_to_destination_min": 31.0,
      "actionable": true,
      "unactionable_reason": null
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
forecast_mode
forecast_start_content_active
forecast_start_service_id
forecast_start_content_remaining_min
forecast_fire_found
forecast_fire_s_total
forecast_fire_eta_from_now_min
forecast_fire_distance_km
forecast_rest_spot_exists
forecast_rest_spot_eta_from_fire_min
forecast_rest_spot_eta_to_destination_min
forecast_rest_spot_actionable
forecast_future_rest_unactionable
forecast_rest_unactionable_reason
current_rest_spot_exists
current_rest_spot_eta_min
current_rest_spot_eta_to_destination_min
current_rest_spot_actionable
current_rest_spot_unactionable_reason
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
4. `forecast_committed_intervention`
5. `forecast_future_rest_spot`
6. `forecast_future_rest_spot_eta`
7. `forecast_destination_edge`
8. `forecast_current_rest_spot`
9. `forecast_current_rest_spot_eta`
10. `forecast_current_rest_spot_destination_edge`
11. existing recovery suppression

Each gate includes evaluated inputs, threshold where applicable, `passed`, and
`effect`. The trace must make a blocked early proposal understandable without
recomputing the forecast from logs.

For the current-spot gates, the recorded `passed` values must match the fire
decision. In particular, `nextRestSpotMin == 9999.0` records a failed
`forecast_current_rest_spot` gate and cannot appear as a passed
`rest_spot_eta_filter_min` gate. Evidence must never show both “no current spot”
and a fired rest candidate on the same tick.

### 14.3 Explanation

When the early proposal fires, the NRI explanation includes:

- current total score and its base/environment/realtime decomposition;
- early threshold 65 and ordinary threshold 100;
- the committed active intervention at forecast start and its remaining time;
- expected time and distance of the threshold-100 crossing;
- whether the future problem is `no_spot_ahead`, `eta_over_30_min`, or
  `inside_destination_edge`;
- current target rest-spot ETA; and
- destination ETA remaining after reaching the current target.

Example English explanation:

> Total fatigue score is 84.2 points, above the forecast-rest threshold of 80
> but below the ordinary rest threshold of 100. The forecast continues the
> accepted humming-karaoke session for its remaining 11 minutes and accepts no
> later projected proposal. The score is still expected to reach 100 where the
> following rest spot would be 34 minutes away, above the 30-minute limit. A
> rest spot is currently available 18 minutes ahead and still 31 minutes from
> the destination, so an early rest proposal was issued.

---

## 15. Integration architecture

### 15.1 Shared responsibility

The behavior separates into three clear responsibilities:

| Responsibility | Owner |
|---|---|
| Project future route, signals, committed intervention, and NRI package state without accepting projected-future actions | NRI forecast service in each runtime |
| Decide whether forecast and current rest opportunities satisfy NRI rules | NRI package evaluation |
| Calculate ETA and the shared `<= 30` actionability result | Shared route/tick helper in each runtime |
| Apply response suppression, recovery suppression, and trip-edge neutralization | Existing run/preview orchestration |
| Display all candidate spots and disable spots over 30 minutes | Existing rest-spot endpoint and picker |

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
  ETA rules and expose one shared spot-actionability helper; do not add a second
  ETA formula.
- `app/api/aica_api/routers/runs.py` and the rest picker — remove the drowsiness
  ceiling projection and mark spots selectable only through shared ETA
  actionability. Keep over-limit spots visible and remove `reachable_fallback`.
- `packages/nri_fatigue_score_v1/algorithm.py` — read `nri_forecast`, apply the
  early-rest gates, and produce evidence/proposal output. Replace both the fire
  branch and contribution-gate expression
  `next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0` with the shared
  real, finite, non-sentinel spot-actionability result.
- `packages/nri_fatigue_score_v1/package.json` — declare
  `threshold_forecast_rest` and the early-rest proposal.

### 15.3 Offline TypeScript application

Mirror the same contract and decisions in:

- `htmlapp/frontend/src/engine/nri_forecast.ts` — TypeScript forecast service.
- `htmlapp/frontend/src/engine/run_manager.ts` — live offline tick integration.
- `htmlapp/frontend/src/engine/services/preview_ticks.ts` — preview integration.
- `htmlapp/frontend/src/engine/tick_engine.ts` — existing route/signal/ETA rules.
- `htmlapp/frontend/src/engine/worker/handlers/runs.ts` and the rest picker —
  mirror the Python ETA-only picker behavior and removals.
- `htmlapp/frontend/src/data/packages/builtin/nri_fatigue_score_v1.ts` — NRI
  decision and evidence. Remove the equivalent `nextRestMin >= 9999.0` fire and
  contribution-gate exception.

The Python and TypeScript forecast contracts must be field-for-field equivalent.

The empty-rest end-to-end expectation in
`app/api/tests/test_t012_rest_handling.py` is part of this change, not a
historical behavior to preserve. Rename and invert that test as described in
Section 20.7.

### 15.4 Two-pass current-tick evaluation

The forecast needs the current raw NRI score and the NRI state produced by the
current tick. A safe integration sequence is:

1. Evaluate the current NRI tick normally with no `nri_forecast` block.
2. If the score and current state make forecast evaluation eligible, copy the
   post-current-tick route, signals, next package state, committed active
   content, remaining duration, and content-relief state.
3. Run the committed-state continuation forecast from that copy. Accept no
   proposal created inside its projected future.
4. Reevaluate the same current tick from the same original input state, now with
   the compact `nri_forecast` block.
5. Persist only the second evaluation's `next_package_runtime_state`.

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
4. Evaluate current rest-spot actionability and finalize the NRI decision with
   forecast evidence. A rest candidate may set `fired = true` only in this step
   and only if current spot actionability passed.
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

Accepting, stopping, or completing content between real ticks does not invoke an
extra forecast. The next real tick first applies that committed change and then
recalculates the forecast from the resulting actual state.

Likewise, a blocked rest opportunity does not invoke a separate retry between
ticks and does not persist an armed fire. The next normal real tick is the only
retry point.

---

## 17. Proposal history and driver response

A forecast-based early rest proposal that reaches the driver is a real
`REST_PROPOSAL`:

- it is recorded as fired;
- accepting it starts the existing rest flow;
- postponing or declining it uses existing action handling;
- it counts under the existing proposal-count policy; and
- existing same-category response suppression applies.

A tick with no actionable current rest spot never enters this lifecycle. It
does not create a fired event, does not add a map or timeline fire marker, does
not change response history, does not use proposal-count capacity, and does not
pause the run. Diagnostic candidate/gate evidence may still record why the rest
decision did not fire.

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
| Route has no future threshold-fire crossing | `forecast_future_rest_unactionable = false` |
| Crossing exists but no rest spot remains there | Set `forecast_future_rest_unactionable = true` and reason `no_spot_ahead`; early fire still requires a current actionable spot |
| Crossing exists and its next spot is over 30 minutes away | Set reason `eta_over_30_min`; early fire still requires a current actionable spot |
| Crossing exists and its next spot is inside the destination edge | Set reason `inside_destination_edge`; early fire still requires a current actionable spot |
| Current rest spot does not exist | No early rest fire; record `no_spot_ahead`; retry on the next normal real tick |
| Current `nextRestSpotMin == 9999.0` | Fail the spot and ETA gates; no early or ordinary rest fire; record `no_spot_ahead` |
| Current rest spot ETA exceeds 30 minutes | No rest fire; record `rest_spot_eta_over_limit`; reevaluate on later real ticks |
| Current rest spot is inside destination edge | No rest fire; record `inside_destination_edge` |
| Active-content state or remaining duration is invalid | Mark forecast unavailable rather than guessing its effects |
| Rest picker has no current tick from which to calculate ETA | Keep the spot visible with unknown ETA and disabled |
| Score is at least 100 but no current actionable spot exists | Return `SUPPRESSED` with `trigger_candidate = false`, `fire_control.fired = false`, `proposal = null`, and the current-spot failure reason |
| Threshold ordering is invalid | Disable forecast rest without changing ordinary bands |
| Recovery is active | Disable forecast rest until recovery ends |

Forecast errors must not mark the whole tick as `algorithm_error` unless the
ordinary current NRI evaluation itself failed.

“Keep ordinary NRI behavior” never restores the old sentinel exception. Even
when the forecast is unavailable, an ordinary rest candidate must still pass
the shared current-spot actionability gate before it can fire.

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
package runtime state, active service/content identity, remaining content
duration, content-relief accumulation, route facts, event plan, speed profile,
tick duration, parameters, and hyperparameters. A partial cache key is not
acceptable because it can return a stale safety decision.

The offline implementation runs in the existing worker path where available.
Forecasting must not move heavy calculation into React rendering.

---

## 20. Test design

### 20.1 NRI unit tests

1. `threshold_forecast_rest` default is `65.0`.
2. `rest_spot_eta_filter_min` default is `30.0`.
3. Score exactly 65 (== `threshold_forecast_rest`) does not fire the early rest path.
4. Score slightly above 65 can fire when every forecast and spot gate passes.
5. Score at or above 100 uses the ordinary rest path, not the forecast path.
6. Score at or above 100 with no actionable spot returns `SUPPRESSED`,
   `trigger_candidate = false`, `selected_category = null`,
   `fire_control.fired = false`, and `proposal = null`.
7. `nextRestSpotMin == 9999.0` fails, rather than passes, the rest ETA
   contribution gate.
8. Invalid threshold ordering disables only the forecast path.
9. A passing forecast-rest decision returns `REST_PROPOSAL` and
   `rest_required`.
10. A passing forecast-rest decision suppresses the monotony candidate with
   `superseded_by_forecast_rest`.
11. A blocked forecast-rest decision retains ordinary monotony behavior below
    100.
12. A blocked early-rest path never sets `REST_FORECAST_FIRE` or
    `forecast_rest_opportunity_passed`.
13. The early proposal has `accept_rest`, `postpone`, and `decline` options.
14. The explanation does not say threshold 100 was already crossed.

### 20.2 Forecast-service unit tests

1. Forecast starts from a copy and does not mutate input state.
2. Forecasted NRI package state advances exactly once per future tick.
3. Forecast proposals do not create action events.
4. Forecast monotony proposals do not activate new content.
5. Forecast rest proposals do not start recovery.
6. An offered but unaccepted content choice is not included.
7. An accepted 15-minute humming-karaoke episode is present in the next real
   tick's forecast with the correct remaining duration and accumulated relief.
8. The committed content effects apply only until its remaining episode ends.
9. Accepting content does not run a separate forecast between ticks.
10. Stopping or completing committed content appears in the next tick's
    forecast, not earlier.
11. Forecast stops at the first `s_total >= threshold_fire` tick.
12. Forecast stops cleanly at destination when there is no crossing.
13. Future rest spot is the first ordered position strictly ahead of the crossing.
14. Both future ETAs use planned-profile integration.
15. A future spot at 30.0 minutes is actionable.
16. A future spot above 30.0 minutes sets reason `eta_over_30_min`.
17. A future rest spot with 9.9 minutes to destination sets reason
    `inside_destination_edge`.
18. A future rest spot with exactly 10.0 minutes to destination is outside the
    edge.
19. No rest spot after the crossing sets reason `no_spot_ahead`.
20. Forecast failure returns unavailable data without changing the normal
    current decision.

### 20.3 Current rest-spot tests

1. Current nearest spot at 30.0 minutes and outside the end edge is actionable.
2. Current nearest spot above 30.0 minutes is not actionable.
3. The same spot becomes actionable at a later real tick when its ETA reaches
   30.0.
4. `nextRestSpotMin == 9999.0` is never actionable for either early or ordinary
   rest.
5. Current nearest spot inside the last-10-minutes zone is not actionable.
6. A spot already passed is never selected.
7. The algorithm never selects a prior rest spot to preserve an earlier
   opportunity.
8. The ordinary score-100 path uses the identical actionability helper and
   boundaries.
9. At tick `t`, score above 65 with no current spot produces no early rest fire,
   no early proposal, no `REST_FORECAST_FIRE`, and no rest fire marker.
10. Tick `t+1` performs a fresh calculation and remains unfired when the spot is
    still not actionable.
11. A later tick may fire when the score is still below 100, the spot reaches
    the 30-minute boundary, the future problem still exists, and all other gates
    pass.
12. If the score reaches 100 first, the next calculation uses the ordinary path
    and still does not fire until a current spot is actionable.
13. A score or forecast change that invalidates eligibility prevents the later
    fire; the earlier tick does not leave a latch.

### 20.4 Rest-picker and drowsiness-ceiling removal tests

1. Spots at or below 30 minutes are visible and selectable.
2. Spots over 30 minutes remain visible, show their ETA, and are disabled.
3. If all spots are over 30 minutes, none is force-enabled.
4. With no prior tick, spots remain visible with unknown ETA and are disabled.
5. The picker does not calculate projected arrival drowsiness.
6. `rest_drowsiness_ceiling` is absent from new-run configuration and evidence.
7. Supplying an obsolete drowsiness-ceiling input cannot change which spots are
   actionable.

### 20.5 Existing-gate integration tests

1. Early forecast proposal inside the first 20 minutes is neutralized by the
   existing trip-edge guard.
2. Early forecast proposal inside the last 10 minutes is neutralized.
3. A neutralized forecast proposal does not consume response suppression or
   proposal-count capacity.
4. A displayed forecast proposal is recorded and existing driver-response rules
   apply.
5. Recovery-active suppression prevents a forecast proposal.
6. A non-routine escalation remains unaffected.
7. A blocked rest opportunity creates no fired rest event, rest-caused pause,
   rest map/timeline fire marker, rest response-history entry, or rest
   proposal-count use.

### 20.6 Live/preview parity tests

For a fixed scenario, seed, route, and tick duration, Python live, Python
preview, TypeScript live, and TypeScript preview must agree on:

- current raw `s_total`;
- forecast mode, active content identity, and remaining duration;
- forecast fire tick/time/distance;
- forecast rest spot;
- ETA from forecast fire to that spot;
- destination ETA at the forecast rest spot;
- `forecast_future_rest_unactionable` and its reason;
- current rest spot and its two ETAs;
- current rest-spot actionability and its failure reason;
- whether the early proposal fires;
- candidate and overall `fired`/`suppressed` flags;
- result type, category, fire reason, and proposal ID; and
- every new criteria field.

Golden fixtures must include passing, spot-not-yet-actionable, no-current-spot,
future-spot-at-30-minute-boundary, future-spot-at-destination boundary,
accepted-active-content, offered-but-unaccepted-content, and forecast-error
cases.

### 20.7 Regression tests

Existing tests must continue to prove:

- default NRI bands remain 60 and 100;
- ordinary rest proposals use the new shared 30-minute behavior;
- monotony-only scenarios remain unchanged when forecast gates fail;
- start/end trip-edge suppression remains unchanged;
- zero-fire quickview projections return cleanly; and
- content/recovery behavior is unchanged by the read-only forecast; and
- historical stored evidence remains readable without being rewritten.

Replace
`app/api/tests/test_t012_rest_handling.py::test_empty_rest_run_still_fires_rest_proposal`.
The replacement must run the same empty-rest-spot route to completion and prove:

- no algorithm error occurs;
- no routine `REST_PROPOSAL` appears;
- no rest candidate or overall fire-control block has `fired = true`;
- no rest fire marker or rest-caused pause is created; and
- Python and the TypeScript mirror agree that sentinel `9999.0` is not
  actionable.

---

## 21. Acceptance criteria

The solution is complete when all of these are true:

1. With default NRI thresholds, a current score of 65 or below cannot produce a
   forecast-based rest proposal.
2. A committed-state continuation projection can identify the first future
   score-100 crossing without changing live or preview state.
3. An intervention already accepted at forecast start continues for exactly its
   remaining duration and affects the projected score.
4. A proposal generated inside the projected future is never accepted.
5. A following future rest spot above 30 minutes creates
   `forecast_future_rest_unactionable` with reason `eta_over_30_min`.
6. A following future rest spot inside the last-10-minutes zone creates it with
   reason `inside_destination_edge`.
7. No future rest spot after the crossing creates it with reason
   `no_spot_ahead`.
8. `forecast_future_rest_unactionable` alone cannot produce a proposal.
9. A score above 65 with no nearby current rest spot cannot produce an early
   rest proposal or a rest fire. Ordinary monotony behavior may still apply.
10. A score above 65 with a current spot over the 30-minute ETA limit does not
    fire and is recalculated on the next real tick.
11. The proposal can fire later when that current spot reaches 30 minutes.
12. A current target inside the destination zone cannot be offered.
13. A passing early decision is a real `REST_PROPOSAL`, not a
    `MONOTONY_PROPOSAL` and not a new result type.
14. At score 100 or above, the ordinary NRI rest decision remains authoritative
    and uses the same 30-minute real-spot requirement.
15. At score 100 or above with no actionable current spot, the exact outcome is
    unfired `SUPPRESSED` with no selected category and no proposal.
16. Sentinel `9999.0` never passes a rest actionability or evidence gate.
17. A skipped tick creates no pending fire; each later real tick recomputes all
    early or ordinary gates from the latest committed state.
18. The picker shows over-limit spots disabled and never force-enables one.
19. No rest-spot decision uses projected drowsiness or
    `rest_drowsiness_ceiling`.
20. The existing trip-edge guard remains the final authority for routine edge
    proposals.
21. Forecast failure never blocks an otherwise valid ordinary NRI decision.
22. Python and TypeScript live/preview outputs remain equivalent.
23. Evidence explains the committed forecast start, the future actionability
    failure, and the current actionable rest opportunity.
24. The current empty-rest-run behavior and its test are replaced so an empty
    route completes without an algorithm error and without any routine rest
    fire.

---

## 22. Alternatives considered

### 22.1 Fire a rest proposal immediately at `threshold_monotony = 60`

Rejected. Score 60 already has a defined meaning: monotony prevention and
refreshing content. Converting it into a rest proposal would blur two existing
NRI bands and would fire too early for the agreed safety evidence.

### 22.2 Fire a rest proposal immediately when score exceeds 65

Rejected as incomplete. A score crossing alone does not guarantee that a rest
spot is nearby. The proposal could ask the driver to rest without offering a
usable opportunity.

### 22.3 Select the latest rest spot before the destination no-trigger zone

Rejected. A late stop can still feel too close to the destination and reproduce
the same driver rejection. The forecasted late spot is used only to detect the
problem. The actual early target is the closest actionable spot from the current
score-above-65 position.

### 22.4 Recommended: score-gated and opportunity-gated forecast rest

Accepted. Forecasting detects that the normal rest opportunity will be absent,
more than 30 minutes away, or too close to the destination. Score above 65
supplies sufficient early evidence. The shared 30-minute ETA limit ensures there
is a concrete current opportunity. The forecast continues the driver's actual
committed intervention but accepts no later projected proposal. The hard
destination guard remains unchanged.

### 22.5 Filter picker spots by projected drowsiness at arrival

Rejected and removed. The prior picker estimated arrival drowsiness from the
current value plus only `base_growth_per_min`, compared it with a configurable
300% ceiling, and force-enabled the nearest spot when every result failed. That
display-only approximation could disagree with NRI and did not represent the
full driver-signal progression. Planned-profile ETA already describes whether a
stop is practically near enough. One shared `ETA <= 30 minutes` rule is simpler,
reviewable, and consistent across the algorithm and picker.

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

---

## Appendix B — Refinement discussion transcript

This appendix preserves every substantive user and assistant message from the
second brainstorming session. System instructions, tool output, and short status
updates are not part of the design discussion and are not reproduced.

### User

> previous session we generated a proposal refinement for NRI trigger algorithm by introducing the forecast technique in 2026-08-22-nri-forecast-rest-proposal-design.md.
> Now I want you to read it back and brainstorming more about this.
> The purpose is clear, if we can early forecast and trigger sooner than waiting the score cross over 100 and lately trigger at the point where driver may likely reject it such as near the destination, we can extend it to also cover the case that when the score cross 100 and trigger rest proposal in realtime, there is a case that rest spot is not usable, or too far likely 60 minutes far from the proposal trigger time itself. In that case we also need sooner trigger to make sure driver have a chance to take a rest before get too drowsy or fatigue. That the purpose why I want to refine forecast technique to support that case.

### Assistant

> I’ve read the proposal back. Your new case fits naturally by generalizing its future-risk condition:
>
> ```text
> forecast score reaches 100
> AND the ordinary rest opportunity at that future point is not actionable
> ```
>
> “Not actionable” could include:
>
> - no rest spot remains ahead;
> - the nearest rest spot is more than 60 minutes away;
> - the spot is inside the destination’s last-10-minute zone; or
> - the spot is otherwise unusable.
>
> Then the existing early gates still apply: current score above 80, plus a currently actionable rest spot within 60 minutes and outside the destination zone.
>
> One important ambiguity: the current route model only knows each spot’s name, position, coordinates, and ETA. It does not know whether a spot is closed, full, restricted, or operational.
>
> For this refinement, what should “rest spot is not usable” mean?
>
> 1. Recommended first scope: no spot ahead, ETA over 60 minutes, or inside the destination guard.
> 2. Add static usability data to each spot, such as enabled/disabled or permitted/not permitted.
> 3. Include real-world availability such as opening hours, closure, or capacity, which requires a new data source.

### User

> No, we will focus on No.1 only. Currently we are filtering base on over 300% drowsiness to filtering out the spot, in this refinement I want to removed it. Instead we will use ETA to decide which spot is appropirate or not. 60 minutes is too way long, I think 30 minutes is better.

### Assistant

> One important detail: the 300% drowsiness ceiling is currently a display-only filter in the rest-spot picker. NRI itself separately uses `rest_spot_eta_filter_min = 60`.
>
> I agree that the drowsiness projection is a weak way to judge a facility: it uses only a simplified base-growth estimate, while ETA is concrete and already calculated using the planned route profile.
>
> Should the new 30-minute limit become the single shared rule for all of these?
>
> - ordinary score-100 rest proposals;
> - forecast evaluation at the future score-100 point;
> - early forecast proposals at the current point; and
> - rest-spot picker selectability.
>
> My recommendation is yes: remove the 300% ceiling and define an actionable spot consistently as `0 ≤ ETA ≤ 30 minutes`.

### User

> yes, look right

### Assistant

> At score ≥100, the ordinary rest proposal will therefore require a real spot with ETA ≤30 minutes. If none exists, the ordinary proposal is suppressed; the forecast path should have attempted an earlier proposal while a suitable spot was still available.
>
> For the rest-spot picker, should spots over 30 minutes:
>
> 1. Remain visible but disabled, with their ETA shown (recommended for transparency), or
> 2. Be removed from the list entirely?

### User

> 1

### Assistant

> I see three viable refinements.
>
> 1. Recommended: one generalized future-actionability rule
>
> At the predicted score-100 point, set `forecast_future_rest_unactionable = true` when:
>
> ```text
> no rest spot remains ahead
> OR nearest rest-spot ETA > 30 minutes
> OR nearest rest spot is inside the destination guard
> ```
>
> The early proposal then requires:
>
> ```text
> 80 < current score < 100
> AND forecast_future_rest_unactionable
> AND current nearest rest-spot ETA <= 30 minutes
> AND current spot is outside the destination guard
> ```
>
> This cleanly extends the existing design without creating a second forecast mechanism.
>
> 2. Separate forecast cases
>
> Keep the existing destination-rejection forecast and add another forecast specifically for “no spot or ETA over 30.” This gives separate evidence labels, but duplicates most gates and could allow the two paths to drift.
>
> 3. Last-opportunity tracking
>
> Forecast all rest spots and explicitly identify the final spot that can be reached before score 100. This may optimize timing more precisely, but adds substantially more state and complexity than the current requirement needs.
>
> I recommend approach 1. It also means:
>
> - change `rest_spot_eta_filter_min` default from 60 to 30;
> - use the same `≤30` boundary everywhere;
> - rename the narrowly worded `forecast_reject_trigger` to describe all future unactionable-rest cases;
> - remove `rest_drowsiness_ceiling`, its setup editor, API parameter, projected-drowsiness calculation, and nearest-spot fallback;
> - keep spots over 30 minutes visible but disabled.
>
> Should I proceed with approach 1 as the design direction?

### User

> looks right
> one more thing I want to fix is the way to forecast the future score at step 1. As current document, it wrote that no intervention to forecast. But because the forecast is calculated realtime tick by tick, we should adapt the current selection of driver. For example, if current time monotony prevention trigger on and driver choose the service and play humming karaoke for 15 minutes. So if we forecast the score without that acceptance, the score will go wrong. So we should accept the current intervention, and dont accept any future intervention, thats the correct way. Refine it too

### Assistant

> Agreed. The correct forecast is not “no intervention.” It is:
>
> ```text
> continue every intervention already accepted and active at the forecast start
> +
> accept no new intervention produced inside the projected future
> ```
>
> I recommend renaming it to `committed_state_continuation_forecast`.
>
> For example, after the driver accepts 15 minutes of humming karaoke, each subsequent real tick starts its forecast from the actual state, including:
>
> - humming karaoke as active content;
> - its remaining playback duration;
> - its drowsiness/fatigue or monotony-relief effects;
> - content-relief accumulation already applied; and
> - the current NRI runtime state.
>
> Any monotony or rest proposal generated inside that future simulation is ignored. When the committed karaoke finishes during the forecast, its effect ends normally; it is not restarted or extended.
>
> One timing point to confirm: should accepting karaoke update the forecast on the next simulation tick, as part of normal tick-by-tick recalculation, rather than running an additional forecast immediately at the moment the driver presses Accept? I recommend the next-tick behavior.

### User

> exactly the same behavior with realtime recalculation, tick by tick realtime recalculation

### Assistant

> ### Design section 1 — Core policy
>
> Replace `no_new_intervention_forecast` with `committed_state_continuation_forecast`.
>
> At every real simulation tick, the forecast copies the actual committed state at that tick. Active content continues for its remaining duration with its real effects. When it ends, those effects end normally. The forecast does not accept, acknowledge, postpone, or decline any proposal produced during projected future ticks.
>
> A rest spot is actionable when:
>
> ```text
> spot exists
> AND ETA is finite
> AND ETA <= 30 minutes
> AND ETA from the spot to destination >= 10 minutes
> ```
>
> Exactly 30 minutes is actionable. Exactly 10 minutes from the destination is outside the destination guard.
>
> At the predicted first score-100 crossing:
>
> ```text
> forecast_future_rest_unactionable =
>     no spot remains ahead
>     OR nearest spot ETA > 30 minutes
>     OR nearest spot is inside the destination guard
> ```
>
> The early-rest rule becomes:
>
> ```text
> 80 < current score < 100
> AND forecast_future_rest_unactionable
> AND current nearest spot is actionable
> AND existing recovery, trip-edge, history, and suppression gates pass
> ```
>
> At score 100 or above, the ordinary rest path also requires an actionable spot under the same 30-minute rule.
>
> The rest picker uses the same ETA calculation. Spots over 30 minutes remain visible with their ETA but are disabled. Remove the 300% drowsiness ceiling, projected-arrival drowsiness calculation, setup control, API override, and fallback that force-enables the nearest spot.
>
> Does this core policy section look right?

### User

> yes

### Assistant

> ### Design section 2 — Runtime architecture and tick ordering
>
> Each real tick follows this sequence:
>
> 1. Advance route position, driver signals, recovery, and currently active content using normal tick-engine behavior.
> 2. Evaluate NRI once to obtain the current score and next NRI package state.
> 3. If forecast gates are eligible, copy the complete post-current-tick state.
> 4. Run `committed_state_continuation_forecast` from that copy.
> 5. Finalize the current NRI decision using the forecast result.
> 6. Persist the NRI package state exactly once.
> 7. Apply the existing trip-edge, recovery, response-suppression, and proposal-history rules.
>
> The copied forecast state includes:
>
> - route position and elapsed time;
> - drowsiness and fatigue;
> - NRI accumulators and runtime state;
> - active content/service and remaining duration;
> - accumulated content-relief state;
> - frozen route events and speed profile; and
> - resolved parameters and hyperparameters.
>
> A driver action does not run a special forecast. If the driver accepts humming karaoke between ticks, the following real tick advances with that content active and creates a new forecast from the resulting actual state. This keeps forecasting synchronized with the normal tick-by-tick runtime.
>
> The forecast service owns projection only. It returns a compact result containing the future score-100 point, future nearest spot, its two ETAs, actionability, and an explicit failure reason:
>
> ```text
> no_spot_ahead
> eta_over_30_min
> inside_destination_edge
> ```
>
> NRI owns the early-rest decision. A shared route-layer helper owns ETA calculation and the `ETA <= 30` actionability test. The rest picker calls the same helper so its enabled/disabled state cannot disagree with NRI.
>
> Python and TypeScript must use the same field names, ordering, boundaries, and failure reasons.
>
> Does this runtime architecture and tick ordering look right?

### User

> yes

### Assistant

> ### Design section 3 — Evidence, outputs, and failure handling
>
> The compact forecast evidence records:
>
> ```text
> forecast_mode = committed_state_continuation
> forecast_start_content_active
> forecast_start_service_id
> forecast_start_content_remaining_min
> forecast_fire_found
> forecast_fire_eta_from_now_min
> forecast_fire_distance_km
> forecast_fire_s_total
> forecast_rest_spot_exists
> forecast_rest_spot_eta_from_fire_min
> forecast_rest_spot_eta_to_destination_min
> forecast_rest_spot_actionable
> forecast_rest_unactionable_reason
> current_rest_spot_exists
> current_rest_spot_eta_min
> current_rest_spot_eta_to_destination_min
> current_rest_spot_actionable
> rest_spot_eta_filter_min = 30
> ```
>
> The old `forecast_reject_trigger` terminology is replaced by `forecast_future_rest_unactionable`, because the condition now covers three cases rather than only likely rejection near the destination.
>
> A successful early decision remains:
>
> ```text
> result_type = REST_PROPOSAL
> selected_category = rest_required
> proposal_id = forecast_rest_required_proposal
> ```
>
> Its explanation states that score 100 is forecast—not already reached—and identifies whether the future problem is no spot, ETA over 30 minutes, or the destination edge.
>
> Failure behavior remains conservative:
>
> - Forecast error: no early proposal; keep the ordinary current NRI result.
> - Missing route/destination data: disable forecasting.
> - No future score-100 crossing: ordinary behavior continues.
> - Invalid active-content state: mark forecast unavailable rather than guessing its effects.
> - Active recovery: forecasting remains disabled until recovery ends.
> - Rest-picker ETA unavailable: show the spot disabled with unknown ETA.
> - Score ≥100 with no actionable spot: return a suppressed ordinary rest decision with an explicit `no_spot_ahead` or `rest_spot_eta_over_limit` reason.
>
> The drowsiness reachability evidence and controls disappear from new runs:
>
> - no projected-arrival drowsiness;
> - no `rest_drowsiness_ceiling`;
> - no setup editor;
> - no effective ceiling in the rest-spots endpoint;
> - no `reachable_fallback`.
>
> Historical stored evidence remains unchanged; it is not rewritten.
>
> Does this evidence and failure-handling section look right?

### User

> ok

### Assistant

> ### Design section 4 — Verification and acceptance
>
> The tests must cover four groups.
>
> Forecast semantics:
>
> - No active intervention produces the normal continuation forecast.
> - Accepted 15-minute humming karaoke is present in the next real tick’s forecast.
> - Its effects apply only for the remaining playback duration.
> - An offered but unaccepted service is not included.
> - Proposals produced inside forecast ticks are never accepted.
> - Accepting content does not trigger an immediate extra forecast.
> - Forecasting does not mutate live state or advance NRI state twice.
>
> Rest-spot boundaries:
>
> - ETA 30.0 minutes is actionable.
> - ETA above 30.0 is not actionable.
> - Exactly 10 minutes from the destination remains actionable.
> - Less than 10 minutes is blocked.
> - No future spot, future ETA over 30, and destination-edge placement each set the correct unactionable reason.
> - A currently actionable earlier spot can produce the forecast rest proposal.
>
> Ordinary behavior and picker:
>
> - Score ≥100 uses the same 30-minute actionability rule.
> - Score ≥100 with no suitable spot is explicitly suppressed.
> - Spots over 30 minutes remain visible but disabled.
> - No nearest-spot fallback force-enables them.
> - Changing or supplying an old drowsiness ceiling cannot affect selection.
> - The drowsiness-ceiling editor and projected-arrival calculation are absent.
>
> Parity and regressions:
>
> - Python live, Python preview, TypeScript live, and TypeScript preview agree on forecast start state, future crossing, spot ETAs, reason, and decision.
> - Active-content forecasts agree tick by tick across runtimes.
> - Trip-edge, recovery, response suppression, and proposal counts remain unchanged.
> - Forecast failure never blocks an otherwise valid ordinary NRI decision.
>
> Acceptance requires one consistent outcome: the simulator proposes rest early only when future score 100 would have no actionable stop, while an actionable stop exists now; every actionability decision uses ETA ≤30 minutes.
>
> If this final section is approved, I’ll revise and commit both the English and Japanese design documents.

### User

> yes, append discussion script in this session too. We have appendix A, then this will be appendix B. Appendix script Japanese version is a real 1 to 1 translation from english, dont summarize.
> And remember how to write documents following rules:
> - Remember that make this document as detail as possible for ready to implement the solution. And dont use the out of scope vocabulary of this project which may cause ambiguously.
> - Japanese version target reader is low-tech Japanese, so make the document even simpler and dont use weird Japanese.

### User

> before reviewing, I want one more refinement to discuss:
> - when we decide to trigger early at tick time t when score cross 80, what happen if there is no usable rest spot? We will skip it and continue to check again on next tick t+1 until trigger on right?

### Assistant

> Yes, that is the current intended behavior—but “until it triggers” needs one boundary clarified.
>
> At every real tick, the system recalculates everything from the latest committed state:
>
> ```text
> tick t:
> score = 81
> no actionable current rest spot
> → do not trigger
>
> tick t+1:
> recalculate score, forecast, and current rest spot
> still no actionable spot
> → do not trigger
>
> tick t+2:
> score is still between 80 and 100
> current spot becomes actionable, with ETA ≤ 30 minutes
> all other gates pass
> → trigger the early REST_PROPOSAL
> ```
>
> This should be a fresh evaluation each tick, not a permanently latched trigger. Therefore:
>
> - The score must still satisfy `80 < s_total < 100`.
> - The future score must still be expected to reach 100 with an unusable future rest spot.
> - A usable current rest spot must now exist.
> - All proposal and trip-edge gates must still pass.
> - A previously passed rest spot is never reconsidered.
>
> If no usable spot appears before the score reaches 100, the early path closes. The ordinary score-100 path then runs on every tick using the same 30-minute actionability rule. It triggers when an actionable spot becomes available; if no actionable spot ever becomes available, no unusable rest proposal is shown.
>
> The important design choice is whether crossing 80 should create a permanent “armed” state even if the score later drops below 80. I recommend **no permanent latch**: require the current score to remain above 80 and recalculate from the real state every tick. Is that the behavior you want?

### User

> yes it is. so we wont fire when there is no rest spot right? Currently looks like the fire still triggered without any usable spot, we need to fix it too. Mention it into document and reconcile
