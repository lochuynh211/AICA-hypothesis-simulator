# Phase 0 Research: M3 Python Algorithm Support

The ADR (two review rounds) + the spec resolved the design. This file records the
concrete loading/context/hybrid choices and the error-model migration so Phase 1 has
no open unknowns.

## R1 — Module loading (isolated, cached)

- **Decision**: `importlib.util.spec_from_file_location("aica_pkg_<id>",
  <package_dir>/<entrypoint>)` + `module_from_spec` + `loader.exec_module`. Cache the
  loaded module per package id (load once; reload only if the file path changes). The
  module must expose `evaluate`; absence → `missing_evaluate` error.
- **Rationale**: no `sys.path` pollution, no cross-package name clash, pure in-process.
- **Alternatives**: sys.path import (rejected — global state / clashes).

## R2 — `evaluate(context: dict) -> dict` contract

- **Decision**: the adapter builds a plain dict (not Pydantic) per the master contract:
  `{simulation_time_sec, raw_state, feature_groups, parameters, hyperparameters,
  proposal_history, user_action_history, package_runtime_state}`. The Python returns a
  plain dict; the adapter validates/coerces it into the §11 `DecisionResult` (shape +
  field-names), passing `result_type` through verbatim.
- **Rationale**: matches arch §11 + workflow §6; keeps Python authors free of our
  Pydantic types.

## R3 — `result_type` relaxation (no alias map)

- **Decision**: relax `DecisionResult.result_type` from M1's 5-value Literal to a
  permissive `str` accepting the master/package set (`REST_PROPOSAL`,
  `MONOTONY_PROPOSAL`, `SUPPRESSED`, `NO_PROPOSAL`, the M1/M2 values, package-defined).
  Record verbatim; normalize shape only. Backward compatible (all M1/M2 values valid).
- **Rationale**: master/arch explicitly allow these (arch §11 uses `SUPPRESSED`);
  downstream pausing keys off proposal actionability + fire_control, not a fixed
  result_type set (M2 final-review fix).

## R4 — Required vs optional context fields

- **Decision**: required fields validated at context-build time (a missing required
  field → a context-build error surfaced to the run): `simulation_time_sec`, driver
  `drowsinessLevel`/`fatigueLevel`/`attentionLevel`, `speedKph`, distance/time to
  destination, `proposal_history` count. Optional sensor/route enhancements
  (`highwayRemainingMin`, `monotonousRoadRemainingMin`, `familiarRouteRatio`,
  `restSpotDensityNext30Min`, …) default to 0 inside the algorithm.
- **Rationale**: spec FR-005; prevents silently zeroing required signals.

## R5 — `proposal_history` derivation

- **Decision**: `run_manager` derives `proposal_history` from the run's persisted
  proposal/action events: `lastProposalTimeSec` (sim-time of last fired proposal),
  `lastProposalCategory`, `lastProposalResult` (accept/postpone/decline), 
  `proposalCountLast30Min` (count within a 30-sim-min window), `acceptanceRateRecent`.
  **Scope:** only these cooldown/count/acceptance fields; no new interaction/recovery
  state machinery beyond M2's action effects.
- **Rationale**: spec FR-002; the hybrid's fire-control needs it; deterministic (from
  frozen sim-time events).

## R6 — `package_runtime_state` threading (now non-empty)

- **Decision**: M2 already threads `package_runtime_state` tick-to-tick (pass current
  in → store returned next → persist). M3's Python packages return a non-empty
  `next_package_runtime_state`; the trace surfaces the **recorded output** (the value
  the tick produced), not the input. No new plumbing — M2's mechanism is reused.
- **Rationale**: FR-003; the M3 acceptance heart.

## R7 — Transparent hybrid port (faithful core; constants from proposal §19)

- **Decision**: port per the ADR §4.2 — feature extraction (§§7–9), smoothing
  `0.35·current + 0.65·prev` at the feature level (prev from
  `package_runtime_state.smoothed_features`), category scores (base_safety_risk
  0.40/0.25/0.25/0.10, gated rest_required, monotony_prevention), velocity (vs prev
  smoothed scores), persistence counters (rest 2 / monotony 3 ticks; skip-if
  rest>0.88 or velocity>0.08), state machines (REST_NORMAL→WATCH0.45→SUGGEST0.62→
  RECOMMEND0.76→URGENT0.88(→RECOVERY); MONOTONY_NORMAL→WATCH0.40→CONTENT_SUGGEST0.58),
  fire-control (no-candidate→emergency→cooldown→count-limit→pass), strength bands,
  priority [rest, monotony], proposal (localized) + explanation (`{ja,en}` lines),
  `next_package_runtime_state{smoothed_features, smoothed_scores, persistence_counters,
  states}`. Declares `tick_seconds: 30`.
- **Rationale**: matches the master proposal; exercises runtime-state across ticks.
- **Firing on the reused scenario**: smoothing slows the score rise (like M2's
  ws×friend-drive coupling); the implementation tunes the hybrid's default config
  and/or picks the existing scenario (and may apply a minor scenario tweak) so the
  hybrid deterministically reaches a rest proposal — the FR-008 acceptance. Pure;
  deterministic.

## R8 — Algorithm-error pause-by-default migration

- **Decision**: change `run_manager` so an `algorithm_error` (built-in OR Python) by
  default sets the run to **paused** with the error recorded — `paused=True`, no
  decision; resuming requires the appropriate recovery (reset / setup-value change /
  package-or-scenario change). A package/error may declare **non-blocking**, in which
  case the run continues (current M1/M2 behavior). Update the M1/M2 algorithm-error
  tests (which assert `paused=False`) to the new default.
- **Rationale**: spec FR-006 + master runtime workflow §775 / architecture §824;
  unifies built-in + Python error handling; strengthens constitution II.
- **Alternatives**: keep continue-on-error (rejected — contradicts master).

## Outcome

All Technical Context items are concrete. **No `NEEDS CLARIFICATION` remain.**
