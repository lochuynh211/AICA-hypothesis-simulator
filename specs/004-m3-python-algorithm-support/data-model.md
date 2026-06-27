# Phase 1 Data Model: M3 Python Algorithm Support

M3 mostly reuses M1/M2 models; the changes are a relaxed `result_type`, a
`python_module` algorithm type, the Python evaluation context (a plain dict, not a
persisted model), and the hybrid's runtime-state shape. Frontend `api/types.ts`
mirrors the runtime-state trace fields.

## Package (`models/package.py`) — EXTENDED
- `AlgorithmDef.type` Literal adds `"python_module"`.
- `AlgorithmDef.entrypoint` = the package-local file (e.g. `"algorithm.py"`).
- `AlgorithmDef.tick_seconds: int | None` (optional; the hybrid declares 30) — when
  set, the tick engine uses it; else the scenario's.
- `AlgorithmDef.error_mode: "blocking" | "non_blocking"` (default `"blocking"`) — the
  pause-by-default vs continue choice for this package's algorithm errors.

## Decision (`models/decision.py`) — EXTENDED
- `result_type`: relaxed from M1's 5-value `Literal` to `str` (or an extended set)
  accepting `REST_PROPOSAL`, `MONOTONY_PROPOSAL`, `SUPPRESSED`, `NO_PROPOSAL`, the M1/M2
  values, and package-defined values. Recorded verbatim. (All M1/M2 values remain
  valid — backward compatible.)
- `Candidate.state`, `Candidate.strength` already present (M2); the hybrid populates
  rich state labels.

## Python evaluation context (plain dict — `algorithms/python_module.py`)
Not a persisted model; built per tick:
```
{
  "simulation_time_sec": int,            # required (from frozen tick state)
  "raw_state": { drowsinessLevel, fatigueLevel, attentionLevel, speedKph,    # required core
                 distanceToDestinationKm, timeToDestinationMin, ...           # + optional fields }
  "feature_groups": { "normalized": {...}, "ordinal": {...} },
  "parameters": {...}, "hyperparameters": {...},                              # frozen/edited
  "proposal_history": { lastProposalTimeSec, lastProposalCategory,
                        lastProposalResult, proposalCountLast30Min,
                        acceptanceRateRecent },                               # derived from events
  "user_action_history": [ {tick_index, action}, ... ],
  "package_runtime_state": {...}                                             # prev tick's output (or {})
}
```
**Required-field validation** (R4): the context builder asserts the required core
fields are present; a missing required field → a context-build error (surfaced as an
algorithm/context error, not a silent 0). Optional enhancement fields may be absent.

## Package runtime state (returned by the hybrid; threaded + persisted)
```
next_package_runtime_state = {
  "smoothed_features": { <feature_name>: float, ... },
  "smoothed_scores":   { "rest_required_score": float, "monotony_prevention_score": float },
  "persistence_counters": { "rest_required": int, "monotony_prevention": int },
  "states": { "rest_state": str, "monotony_state": str }
}
```
M2 already stores this on `RunState.package_runtime_state` + the per-tick `TickEvent`.
M3 makes it non-empty. The trace surfaces the **tick's recorded output** value.

## Run state / outcome (`models/run.py`, `services/run_manager.py`) — error path change
- `TickOutcome.paused` is `True` on an `algorithm_error` when the package's
  `error_mode` is `blocking` (default); `False` when `non_blocking`. The run's
  `status` → `paused` (blocking) carries no `pending_proposal` but an error marker so
  the UI/log shows why; resuming requires recovery (reset / value change / package or
  scenario change).
- `AlgorithmError` event (M1/M2) unchanged in shape; gains the three M3 `error_type`s:
  `missing_evaluate`, `algorithm_exception`, `invalid_result_shape` (the last two
  already exist from M1/M2).

## Decision result / trace entry — unchanged shape
Full §11 (M1/M2). The hybrid populates `features`, `scores` (base_safety_risk /
rest_required_score / monotony_prevention_score), `states` (rest/monotony),
`candidates` (incl. suppressed), `fire_control`, `proposal` (localized), `explanation`
(localized lines), `reason_inputs`, `next_package_runtime_state`.
