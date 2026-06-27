# ADR / Design — M3 Python Algorithm Support

**Date:** 2026-06-27
**Milestone:** M3 — Python Algorithm Support
**Status:** Accepted (pending implementation)
**Source docs:** `docs/master/aica_hypothesis_simulator_milestones.md` §5,
`aica_hypothesis_simulator_architecture.md` §11,
`aica_hypothesis_simulator_runtime_workflow.md` §§5,6,7,
`others/aica_transparent_hybrid_trigger_algorithm_proposal.md` (full); constitution v1.0.0
**Builds on:** M1, M2 (`docs/superpowers/specs/2026-06-27-m2-package-schema-hardening-design.md`)

---

## 1. Context

M2 delivered the behavioral engine, the `weighted_score` multi-category algorithm,
the setup/run-plan flow, and — crucially for M3 — the `package_runtime_state`
tick-to-tick plumbing (threaded but left empty by M2 built-ins), the full §11
result shape, localized messages, validation + `algorithm_error` events, and a
trace UI rendering scores/candidates/suppressed/errors.

M3 adds **Python-authored trigger algorithms** as first-class local packages and
runs the **transparent hybrid** package — the first algorithm that actually
*populates* the runtime state (smoothing, persistence counters, velocity, state
machines). Local trusted code only; no sandboxing (constitution + milestone).

## 2. Scope decisions (settled in brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Module loading | **Isolated `importlib.util.spec_from_file_location` by path**, cached per package id. No `sys.path` pollution / name clashes. |
| D2 | Python fixtures | **Both**: a simple `rest_python_v0_1` (mirrors weighted_score; de-risks the adapter) + the full `aica_transparent_hybrid_trigger_v1`. |
| D3 | Hybrid fidelity | **Faithful core machinery** — smoothing, persistence counters, velocity, state machines, multi-category + priority, populated `next_package_runtime_state`. |
| D4 | Frontend | **Modest trace extension** — surface state labels + a compact runtime-state indicator per tick; full detail in the log viewer. |
| D5 | result_type | **Relax `result_type` to the master/package set — no alias map.** The master spec/architecture explicitly allow `REST_PROPOSAL`, `MONOTONY_PROPOSAL`, `SUPPRESSED`, `NO_PROPOSAL`, and package-defined values; architecture §11 shows suppressed candidates carrying `result_type: "SUPPRESSED"`. The Python algorithm's semantic result type is **passed through unchanged**; the adapter normalizes shape/field-names only. (This relaxes M1's narrow 5-value enum, which was an M1-era simplification — backward compatible, since M1/M2's values remain valid.) |
| D6 | Context inputs | **Required fields validated; optional fields default to 0.** Required simulation-state fields the simulator always provides (`simulation_time_sec`, driver `drowsinessLevel`/`fatigueLevel`/`attentionLevel`, `speedKph`, distance/time to destination, `proposal_history` count) MUST be present — a missing required field is a context-build error, not a silent 0. Only optional sensor/route enhancements the hybrid lists (e.g. `highwayRemainingMin`, `monotonousRoadRemainingMin`, `familiarRouteRatio`, `restSpotDensityNext30Min`) default to 0 (per the proposal). The hybrid fires a real **rest** proposal from the drowsiness/fatigue/rest-window path; monotony/route features stay inert until those optional inputs are authored (full monotony UX is M8). |
| D7 | Scenario | **Reuse an existing UC-01 rest scenario** (no new scenario). |

## 3. `python_module` adapter

`algorithms/python_module.py` + a dispatch branch in `algorithms/adapter.py`. Local
trusted code, no sandboxing.

### 3.1 Loading (isolated, cached)
A package with `algorithm.type: "python_module"` declares `entrypoint` (e.g.
`algorithm.py`). The adapter loads it via
`importlib.util.spec_from_file_location("aica_pkg_<id>", <package_dir>/<entrypoint>)`
— by path, no `sys.path` mutation. The module is **cached per package id** (loaded
once; reloaded only if its path changes). It must expose
`def evaluate(context: dict) -> dict`.

### 3.2 Context (plain dict, per the master `evaluate(context: dict)` contract)
```python
{
  "simulation_time_sec": <tick state>,
  "raw_state": {...},            # numeric internal state (M2); hybrid-expected fields,
                                 # required fields always present; only optional
                                 # enhancement fields may be absent → default to 0
  "feature_groups": {...},       # M2 normalized + ordinal
  "parameters": {...},           # frozen/edited setup parameters
  "hyperparameters": {...},      # the package's config (the hybrid's §19 defaults, edited)
  "proposal_history": {...},     # NEW: derived from the run's proposal/action events —
                                 # lastProposalTimeSec, lastProposalCategory,
                                 # lastProposalResult, proposalCountLast30Min,
                                 # acceptanceRateRecent
  "user_action_history": [...],  # past actions this run
  "package_runtime_state": {...} # previous tick's next_package_runtime_state
}
```
`proposal_history` is the new context plumbing: `run_manager` derives it from the
run log's proposal/action events (M1/M2 built-ins ignored history; the hybrid needs
it for fire-control cooldowns/limits). **Scope (M3):** only the proposal-history-
derived **cooldown / count / acceptance** fields are added (lastProposalTimeSec,
lastProposalCategory, lastProposalResult, proposalCountLast30Min,
acceptanceRateRecent). Active-content / rest-guidance *interaction effects* (e.g.
content playing, rest-in-progress recovery) remain **whatever M2 already supports** —
M3 does NOT add new interaction/recovery state machinery beyond the action effects
M2 implemented. Determinism: `simulation_time_sec` is from the frozen tick state,
never wall clock.

**Required vs optional fields (D6):** the adapter validates that the **required**
fields are present in the context it builds (the simulator always provides them) —
a missing required field is a context-build error surfaced to the run, not a silent
0. Only the hybrid's optional sensor/route enhancement fields default to 0.

### 3.3 Normalization → `DecisionResult` (shape/field-names only, not semantics)
The returned dict is validated/coerced into the §11 `DecisionResult` Pydantic
model (same as built-ins): localized `explanation` accepted (M2 schema),
**suppressed candidates retained**, and the returned `next_package_runtime_state`
stored so `run_manager` threads it to the next tick (M2 plumbing — now non-empty).
Normalization adjusts **shape and field names** (filling optional fields, coercing
types) — it does **not** remap the algorithm's semantic `result_type`.

### 3.4 result_type is passed through (D5)
`DecisionResult.result_type` is relaxed from M1's narrow 5-value Literal to a
permissive value accepting the master/package set — `REST_PROPOSAL`,
`MONOTONY_PROPOSAL`, `SUPPRESSED`, `NO_PROPOSAL`, the M1/M2 values
(`NO_TRIGGER`/`SOFT_WARNING`/`SEVERE_INTERVENTION`/`NO_PRACTICAL_ACTION_FALLBACK`),
and package-defined values. The Python algorithm's `result_type` is recorded
**verbatim** in the trace; no alias map. This is a small, backward-compatible
schema relaxation (every M1/M2 value remains valid). Downstream pausing/UX already
keys off **proposal actionability** (options ∩ `allowed_actions`, per the M2
final-review fix) and `fire_control`, **not** off a fixed `result_type` set, so the
relaxation requires no run-manager/UI logic change. Suppressed candidates carry
`fire_control.suppressed: true` and the result may legitimately be
`result_type: "SUPPRESSED"`.

### 3.5 Error handling (the M3 test matrix)
- module **missing `evaluate`** → `algorithm_error` (`error_type:"missing_evaluate"`);
- `evaluate` **raises** → `algorithm_error` (`error_type:"algorithm_exception"`, message);
- **invalid return** (non-dict, or fails `DecisionResult` validation) →
  `algorithm_error` (`error_type:"invalid_result_shape"`).
All three are persisted as evidence and shown in the frontend trace
(M1/M2 `algorithmErrors`), **never disguised as a normal decision** (constitution II).

### 3.6 `tick_seconds` precedence
If a `python_module` package declares `tick_seconds` (the hybrid declares 30), the
tick engine uses the package cadence when set, else the scenario's.

## 4. Python packages

### 4.1 `packages/rest_python_v0_1/` (simple — proves the adapter)
`package.json` (`algorithm.type: "python_module"`, `entrypoint: "algorithm.py"`,
compatible UC-01) + `algorithm.py` mirroring the M2 weighted-score rest logic
(base_safety_risk → gated rest_required_score → strength → fire-control → §11 dict;
`next_package_runtime_state: {}`). A test asserts parity with the built-in
`weighted_score` on the same context.

### 4.2 `packages/aica_transparent_hybrid_trigger_v1/` (the real hybrid)
`package.json` (`algorithm.type: "python_module"`, `tick_seconds: 30`, the §19
default config as hyperparameters, two trigger categories, localized proposals +
options) + `algorithm.py` porting the faithful core (all constants from the proposal
§19):
- **Feature extraction** (§§7–9) from `raw_state`; clamp 0–1; unavailable → 0.
  - `drowsiness_score = clamp(drowsinessLevel/100)`;
    `fatigue_score = clamp(0.45·norm_fatigue + 0.25·trip_duration_pressure +
    0.15·voice_abnormality + 0.15·response_delay)`;
    `driving_anomaly_score = max(steering, lane, pedal, adas)`;
    `future_fatigue_score = clamp(0.45·traffic_jam + 0.35·long_highway +
    0.20·weather_risk)`; `rest_window_score`/`rest_scarcity_score` (conditional);
    `monotony_score`, `familiar_route_score`, `attention_drop_score`, etc.
- **Smoothing** `smoothed[t] = 0.35·current + 0.65·prev` at the **feature** level
  (prev from `package_runtime_state.smoothed_features`).
- **Category scores** from smoothed features: `base_safety_risk`
  (0.40/0.25/0.25/0.10), gated `rest_required_score` (bonus 0.10/0.08 iff
  base ≥ 0.45), `monotony_prevention_score` (0.30/0.20/0.25/0.15/0.10).
- **Velocity** = score − previous smoothed score; **persistence counters**
  (rest 2 ticks, monotony 3 ticks; **skip-if** rest_score>0.88 or velocity>0.08).
- **State machines**: REST_NORMAL→WATCH(0.45)→SUGGEST(0.62)→RECOMMEND(0.76)→
  URGENT(0.88)(→RECOVERY on accept); MONOTONY_NORMAL→WATCH(0.40)→
  CONTENT_SUGGEST(0.58)(→ACTIVE_CONTENT on accept).
- **Fire-control** (order: no-candidate → emergency override → cooldown
  [result-based max category-specific] → 30-min count limit → pass), using
  `proposal_history`; **strength** bands (gentle/clear/strong at suggest/recommend/
  urgent); **priority** [rest_required, monotony_prevention] then score → selected.
- **Proposal** (localized message per category×strength, options) + **explanation**
  (`{ja,en}` reason lines per material signal).
- **`next_package_runtime_state` = `{smoothed_features, smoothed_scores,
  persistence_counters, states{rest_state, monotony_state}}`.**

Runs against an existing UC-01 rest scenario; emits a full trace incl. states +
next runtime state. Monotony candidate is structurally supported (route/monotony
inputs ~0 on current scenarios; full monotony UX is M8).

## 5. Frontend (modest trace extension)

`components/trace/DecisionTracePanel.tsx`: add per-tick **state labels**
(`states.rest`/`states.monotony`) and a compact **runtime-state indicator**
(smoothed_scores + persistence_counters from the tick's **recorded output**
runtime state — the decision's returned `next_package_runtime_state` persisted for
that tick, NOT the pre-evaluation `package_runtime_state` input),
in addition to the M2 scores/candidates. Full detail stays in the `RunLogViewer`.
`python_module` packages appear in the existing multi-option selectors
automatically; algorithm-error rendering already exists. Types in `api/types.ts`
gain the runtime-state shape; no new dependency.

## 6. Testing strategy (TDD; contract surfaces first)

- **Adapter:** successful Python eval → normalized §11; **missing `evaluate`** /
  **exception** / **invalid return** → the three `algorithm_error` types (the
  explicit M3 matrix); result_type passed through verbatim (a `SUPPRESSED` /
  `MONOTONY_PROPOSAL` / `NO_PROPOSAL` / package value is recorded as-is, not remapped);
  required-field validation; suppressed retained;
  `next_package_runtime_state` threaded back into the next tick.
- **Simple package:** parity with built-in `weighted_score` on the same context
  (the Python path matches a known-good built-in).
- **Hybrid:** smoothing damps tick-to-tick score swings (a 1-tick spike does not
  jump the smoothed score); persistence gates firing (a single spike does not fire
  until the counter clears, unless skip-if); the state machine advances through the
  bands; velocity skip-if works; fire-control cooldown suppresses a too-soon second
  proposal; determinism (same scenario+config → identical trace); **runs a UC-01
  scenario to a rest proposal with a full trace + non-empty
  `next_package_runtime_state`** (the acceptance).
- **Evidence:** the run log carries the hybrid's per-tick `package_runtime_state`
  (smoothed/counters/states) — M2 plumbing, now non-empty; suppressed candidates
  persisted + visible.
- **Frontend:** the trace renders state labels + the runtime-state indicator; an
  algorithm-error entry renders as an error, not a decision.
- **e2e (controller, docker):** select the hybrid package, run a UC-01 scenario via
  the plan flow to the proposal; confirm the persisted evidence shows smoothing /
  states / runtime-state evolving across ticks.

## 7. Acceptance mapping (milestone §5)

| Criterion | M3 satisfies it |
|---|---|
| A package with `algorithm.py` can be selected and evaluated | `python_module` adapter + 2 fixtures, selectable |
| Setup-time parameter/hyperparameter changes passed into Python eval | context carries frozen/edited parameters + hyperparameters |
| Transparent hybrid runs against a UC-01 rest scenario | hybrid fixture + existing scenario |
| Full trace: features, scores, states, candidates, fire-control, selected proposal, next runtime state | hybrid returns all; normalized + persisted + traced |
| Suppressed candidates persisted + visible | retained through adapter + trace (M1/M2 + M3) |
| Python output normalized into the same shape | adapter → §11 `DecisionResult` (shape/field-names normalized; semantic `result_type` passed through) |
| Python errors persisted as evidence + shown in UI | three `algorithm_error` types + trace |
| Local/trusted only; no sandboxing | isolated importlib load, in-process |

## 8. Constitution check (preview)

- **I** Backend source of truth — Python runs server-side; frontend renders.
- **II** Append-only/honest failure — Python errors → `algorithm_error` events, never
  faked decisions; suppressed retained.
- **III** Deterministic — `simulation_time_sec` from frozen state; pure Python
  fixtures; `package_runtime_state` makes the stateful hybrid reproducible.
- **IV** Qualitative discipline — Python consumes simulator-internal `raw_state` +
  `feature_groups` (no external-service raw numeric; Maps is M4).
- **V** One adapter contract — `python_module` dispatched through the same
  `evaluate(...) → DecisionResult`; normalized; runtime-state threaded.
- **VI** Local-first YAGNI — file-based packages, local trusted code, no sandboxing,
  no new deps; reuse an existing scenario.

## 9. Consequences

- The simulator can execute and trace a real stateful Python algorithm — the
  transparent hybrid — proving the package-author contract end-to-end.
- `package_runtime_state` becomes non-empty and meaningful (smoothing/persistence/
  states), exercising the plumbing M2 built only structurally.
- Relaxing `result_type` to the master/package set records each algorithm's semantic
  result type verbatim (no corruption of the hybrid's own categories/suppression
  semantics); the required-vs-optional input policy validates required fields while
  letting only optional sensor/route enhancements default to 0 — keeping M3 bounded
  without a large `raw_state`/scenario expansion (monotony/route enrichment can come
  with M8).
- M4 (Maps) and M5 (feedback/replay) build on an unchanged, now Python-capable
  adapter + complete evidence.
