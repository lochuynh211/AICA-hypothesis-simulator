# aica_transparent_hybrid_trigger_v1

The **faithful, stateful transparent hybrid trigger** — the headline M3 deliverable. A
UC-01 fatigue/drowsiness trigger whose full decision basis is reviewable and whose runtime
state **evolves tick-to-tick**.

It is a `python_module` package: `algorithm.py` exposes `def evaluate(context: dict) -> dict`,
loaded by the M3 adapter and normalized to the §11 `DecisionResult`. It declares
`tick_seconds: 30`, so the engine evaluates it every 30 simulated seconds regardless of the
scenario's own cadence.

## Why "transparent hybrid"

It blends the same multi-category weighted scoring as the built-in `weighted_score`
(`base_safety_risk`, gated `rest_required_score`, `monotony_prevention_score`) with a
**stateful temporal layer**: exponential smoothing, velocity, persistence gating, per-category
state machines, and fire-control. Every intermediate is recorded so a reviewer can trace
exactly *why* (and *why not*) a proposal fired.

## Pipeline at a glance (per tick)

1. **Feature extraction** — 11 features (0–1) from `raw_state` + `feature_groups.normalized`
   (same formulas as `weighted_score`). Absent optional inputs default to 0.
2. **Smoothing** — `smoothed_f[t] = 0.35·f[t] + 0.65·smoothed_f[t-1]` (prev from the threaded
   runtime state; 0 on tick 0). A one-tick sensor spike is damped, not propagated.
3. **Category scores** — computed from the **smoothed** features: `base_safety_risk`,
   `rest_required_score = base + (gated bonus iff base ≥ 0.45)`, `monotony_prevention_score`.
4. **Velocity + persistence** — `velocity = score − prev smoothed score`. A candidate must
   stay over its suggest threshold for **2 (rest) / 3 (monotony)** consecutive ticks before it
   may fire; a **skip-if** (`score > 0.88` OR `velocity > 0.08`) bypasses the gate for genuine
   spikes.
5. **State machines** — `REST_NORMAL→WATCH(0.45)→SUGGEST(0.58)→RECOMMEND(0.76)→URGENT(0.88)`
   (`→RECOVERY` once an accept is observed); `MONOTONY_NORMAL→WATCH(0.40)→CONTENT_SUGGEST(0.58)`.
6. **Fire-control** — in order: no-candidate → emergency override → category cooldown
   (`proposal_history.lastProposalTimeSec` vs `simulation_time_sec`) → 30-min count limit
   (`proposalCountLast30Min`) → pass.
7. **Strength + priority** — gentle/clear/strong by band; priority `rest_required` >
   `monotony_prevention`, then score. Non-fired and suppressed candidates are **retained**.
8. **Proposal + explanation** — localized `{ja, en}` message and reason lines.

`result_type` is one of `REST_PROPOSAL` / `MONOTONY_PROPOSAL` / `SUPPRESSED` / `NO_PROPOSAL`
(recorded verbatim).

> **Note:** steps 1–8 above still quote the PRE-009 feature count and hyperparameter values
> (11 features, α 0.35, thresholds 0.45/0.58/0.76/0.88, persistence 2/3). The live values are
> the ones in `package.json`; `algorithm.py`'s module docstring is the accurate pipeline
> description. This staleness predates the monotony work documented below.

## The monotony channel

`monotony_prevention_score = w_monotony·monotony + w_env_mono·env_load + w_familiar·familiar_route
+ w_night·isNight`, where the **monotony feature is pure exposure time**:

```
monotony = clamp(mono_min / monotony_saturation_min)      # default 90 min
```

Two properties this deliberately has, both of which the earlier
`clamp(0.6·clamp(mono_min/30) + 0.4·isNight)` form lacked:

- **It does not saturate early.** The old `/30` ramp made five hours of featureless highway
  read exactly the same as thirty minutes.
- **`isNight` is a separate weighted row, not part of the feature.** Night owning 40% of a
  feature called "monotony" capped that feature at 0.6 in daylight, which put the whole
  score's daytime ceiling (0.575, with `env_load` at its no-jam ceiling) *below* the 0.70
  suggest threshold — a daytime monotonous drive could never fire, on a route of any length.

**Monotony decays when it is served.** `accum_baseline.mono_min` is rebaselined when the
driver answers a monotony proposal, so the score falls and rebuilds instead of staying pinned
above threshold and re-firing at every cooldown expiry. This mirrors the rest channel, where
an accepted rest rebaselines `jam_min`/`hw_min`/`mono_min` together. The rebaseline happens
**once per proposal** — `mono_intervention_handled_sec` remembers which one has been applied,
since `proposal_history.lastProposal*` keeps pointing at it for many ticks afterwards.

## Stateful: runtime state threaded each tick

`evaluate` returns `next_package_runtime_state`:

```json
{
  "smoothed_features":   { "...": 0.0 },
  "smoothed_scores":     { "rest_required_score": 0.0, "monotony_prevention_score": 0.0 },
  "persistence_counters":{ "rest_required": 0, "monotony_prevention": 0 },
  "states":              { "rest_state": "REST_NORMAL", "monotony_state": "MONOTONY_NORMAL" },

  "accumulators":        { "jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0 },
  "drive_min_baseline":  0.0,
  "accum_baseline":      { "jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0 },
  "mono_intervention_handled_sec": null,
  "prev_sim_time_sec":   0.0
}
```

The adapter threads this back as the next tick's `package_runtime_state`. Because the smoothed
values, counters and state labels carry forward, the same raw inputs produce **different**
decisions depending on history — that is what makes it stateful. The trace records the tick's
**output** state (post-evaluation), not the pre-evaluation input.

## How to review a trace

For each tick the evidence log carries the full `decision_result`:

- `scores` — smoothed `base_safety_risk` / `rest_required_score` / `monotony_prevention_score`
  plus per-category `*_velocity`.
- `states` — the current `rest` / `monotony` state-machine labels.
- `candidates[]` — every category (rest + monotony), each with its `fire_control`
  (`fired` / `suppressed` / `override` / `reason`) — including persistence-gated and
  cooldown-suppressed ones.
- `fire_control` — the overall outcome mirroring the selected (or first suppressed) candidate.
- `proposal` + `explanation` — the localized driver message and the `{ja, en}` reasoning.
- `next_package_runtime_state` — the smoothed/counter/state values carried to the next tick.

Watch `smoothed_scores` climb, `persistence_counters` accumulate, and the `states` advance
through the bands until the rest candidate fires exactly once (the run pauses there).

## Purity

Pure and deterministic: no backend imports, no clocks, no randomness. All time comes from
`context["simulation_time_sec"]`. Same context sequence ⇒ identical trace and runtime-state series.
