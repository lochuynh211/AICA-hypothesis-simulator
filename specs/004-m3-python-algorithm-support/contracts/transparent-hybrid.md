# Contract: aica_transparent_hybrid_trigger_v1 (Python package)

`algorithm.type: "python_module"`, `entrypoint: "algorithm.py"`, `tick_seconds: 30`,
config = the proposal §19 defaults as hyperparameters. Pure & deterministic.

## Pipeline (per tick, from `context`)
1. **Feature extraction** (proposal §§7–9) from `raw_state`; clamp 0–1; optional
   inputs absent → 0.
2. **Smoothing** `smoothed_f[t] = 0.35·f[t] + 0.65·smoothed_f[t-1]`
   (prev from `package_runtime_state.smoothed_features`).
3. **Category scores** from smoothed features:
   - `base_safety_risk = clamp(0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly + 0.10·future_fatigue)`
   - `rest_required_score = base_safety_risk` + gated bonus (`0.10·rest_window + 0.08·rest_scarcity` iff base ≥ 0.45)
   - `monotony_prevention_score = clamp(0.30·monotony + 0.20·familiar_route + 0.25·attention_drop + 0.15·traffic_jam + 0.10·long_highway)`
4. **Velocity** = score − prev smoothed score; **persistence counters** (rest 2,
   monotony 3 ticks; skip-if rest>0.88 OR velocity>0.08).
5. **State machines**: REST_NORMAL→WATCH(0.45)→SUGGEST(`threshold_suggest`)→
   RECOMMEND(0.76)→URGENT(0.88)(→RECOVERY on accept);
   MONOTONY_NORMAL→WATCH(0.40)→CONTENT_SUGGEST(0.58).
   - The SUGGEST band and the rest fire-gate share the single `threshold_suggest`
     hyperparameter (proposal §19). Its proposal default is 0.62; the shipped
     `aica_transparent_hybrid_trigger_v1` default is **0.58** — tuned down because the
     α=0.35 feature smoothing lags the raw signal, so the smoothed rest score peaks
     near 0.62 and only grazes the 0.62 gate. 0.58 clears with a deterministic margin
     while still firing exactly once. Editable at setup; the trace records the
     effective value.
6. **Fire-control**: no-candidate → emergency override → cooldown
   (result-based max category-specific) → 30-min count limit → pass.
7. **Strength** gentle/clear/strong; **priority** [rest_required, monotony_prevention]
   then score → selected.
8. **Proposal** (localized message per category×strength + options) + **explanation**
   (`{ja,en}` reason lines).

## Returned dict (normalized §11 + runtime state)
`result_type` (REST_PROPOSAL / MONOTONY_PROPOSAL→recorded verbatim / SUPPRESSED /
NO_PROPOSAL), `trigger_candidate`, `selected_category`, `score`,
`features`, `scores{base_safety_risk, rest_required_score, monotony_prevention_score}`,
`states{rest, monotony}`, `candidates[]` (all incl. suppressed), `fire_control`,
`proposal{message{ja,en}, options, …}`, `reason_inputs`, `explanation`,
`next_package_runtime_state{smoothed_features, smoothed_scores, persistence_counters,
states{rest_state, monotony_state}}`.

## Contract tests
- Smoothing: a 1-tick spike does not jump the smoothed feature (vs the prev value).
- Persistence: a single over-threshold tick does NOT fire until the counter clears
  (unless skip-if); skip-if (score>0.88 / velocity>0.08) bypasses persistence.
- State machine advances through the bands with rising score.
- Fire-control cooldown suppresses a too-soon second proposal (using proposal_history).
- Priority selects rest over monotony when both fire; suppressed retained.
- Determinism: same scenario+config → identical trace + identical runtime-state series.
- **Acceptance:** runs a UC-01 rest scenario to a REST_PROPOSAL with a full trace and a
  non-empty, evolving `next_package_runtime_state`.
