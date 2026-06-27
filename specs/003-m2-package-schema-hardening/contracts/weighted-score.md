# Contract: weighted_score algorithm (multi-category §11 population)

Same adapter contract as `declarative_rule`:
`evaluate(package, context, parameters, hyperparameters, history,
package_runtime_state) → DecisionResult`. Consumes `context.raw_state` /
`context.feature_groups.normalized`. Returns `package_runtime_state` empty (M2).

## Category scores (research R4)
- `base_safety_risk = clamp(0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly +
  0.10·future_fatigue, 0, 1)`
- `rest_required_score = base_safety_risk`, plus gated bonus
  (`+0.10·rest_window + 0.08·rest_scarcity`) iff `base_safety_risk ≥ 0.45`
- `monotony_prevention_score = clamp(0.30·monotony + 0.20·familiar_route +
  0.25·attention_drop + 0.15·traffic_jam + 0.10·long_highway, 0, 1)`

## Candidates, strength, priority
- Per category: `exists = score ≥ suggest(0.62)`; strength `gentle/clear/strong` at
  `0.62 / 0.76 / 0.88`; `state` label (`REST_RECOMMEND`/`MONOTONY_WATCH`);
  per-candidate `fire_control` (fired + actionability guard; unactionable → suppressed
  but retained).
- Priority `[rest_required, monotony_prevention]` then score desc over fired
  candidates → `selected_category` + selected candidate drives the proposal;
  non-selected fired candidates remain in `candidates[]`.

## Normalized DecisionResult (populated fields)
`result_type` (one of the 5), `trigger_candidate`, `selected_category`, `score`
(= selected candidate score), `scores{base_safety_risk, rest_required_score,
monotony_prevention_score}`, `states{rest, monotony}`, `candidates[]` (all, incl.
suppressed/non-selected), `fire_control`, `proposal` (localized message),
`reason_inputs`, `explanation` (string or localized), `next_package_runtime_state:{}`.

## Contract tests
- Each category-score formula matches the constants; gated rest bonus does not apply
  below 0.45 (rest opportunity alone cannot trigger).
- Strength thresholds map correctly; a high-monotony `raw_state` emits a
  `monotony_prevention` candidate (SC-007); priority selects `rest_required` over
  `monotony_prevention` when both fire.
- A suppressed (unactionable) candidate is retained with `fire_control.suppressed`.
- Totality (always one of 5 `result_type`); determinism (same context → same result).
- Invalid/raising → `AlgorithmError` event, never a faked decision.
- Adapter normalizes to the full §11 shape; runtime-state returned empty.
