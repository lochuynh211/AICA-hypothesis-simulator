/**
 * Algorithm adapter - the single, authoritative dispatch path.
 *
 * Ported from `app/api/aica_api/algorithms/adapter.py` (behavior-of-record).
 * Every algorithm call goes through this module. It dispatches by
 * `manifest.algorithm.type`, calls the implementation, normalizes the output
 * to the §11 DecisionResult shape, and raises `AlgorithmAdapterError` for
 * any algorithm exception or invalid return shape (FR-011).
 *
 * Design constraints:
 *   - Deterministic: same inputs -> same output.
 *   - An algorithm exception or invalid return -> AlgorithmAdapterError,
 *     NEVER a faked DecisionResult (FR-011). The tick engine (a later task)
 *     converts this into an `algorithm_error` EVENT — never a normal decision.
 *   - Suppressed candidates are passed through unchanged (FR-008).
 *
 * Only the exported function identifier (`evaluate`) is camelCased. This is
 * the ONLY entry point for algorithm evaluation in the htmlapp engine.
 */

import type { DecisionResult, PackageManifest } from '../../api/types'
import { AlgorithmAdapterError } from './errors'
import { evaluateDeclarative } from './declarative_rule'
import { evaluateWeighted } from './weighted_score'
import type { JsModuleRunner } from './js_module'
import { BUILTIN_EVALUATORS, type BuiltinEvaluateFn, type BuiltinPyContext } from '../../data/packages'

export type EvaluateArgs = {
  manifest: PackageManifest
  context: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  history: unknown[]
  packageRuntimeState: Record<string, unknown>
}

/**
 * Args for the `js_module` async dispatch entry (`evaluateJsModule`).
 *
 * `js_module` (UNTRUSTED user-uploaded packages, run in a sandboxed Web
 * Worker — see `./js_module.ts`) is the one adapter strategy that cannot be
 * evaluated synchronously: a worker call is inherently a message round-trip.
 * Every other strategy — `declarative_rule`, `weighted_score`, and the
 * trusted-TS-port `builtin_js_module` (S9.3) — stays on the synchronous
 * `evaluate()` path above and is untouched by this addition.
 *
 * `runner` is a per-package `JsModuleRunner` (one Worker per uploaded
 * package). Constructing/caching that runner across ticks is the run
 * manager's job, not this adapter's — see the seam note on
 * `evaluateJsModule` below.
 */
export type EvaluateJsModuleArgs = {
  runner: JsModuleRunner
  context: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  history: unknown[]
  packageRuntimeState: Record<string, unknown>
}

function isDecisionResultShape(value: unknown): value is DecisionResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v['result_type'] === 'string'
    && typeof v['trigger_candidate'] === 'boolean'
    && Array.isArray(v['candidates'])
    && typeof v['fire_control'] === 'object' && v['fire_control'] !== null
    && Array.isArray(v['reason_inputs'])
    && typeof v['explanation'] !== 'undefined'
  )
}

/**
 * Dispatch to the algorithm implementation and return a DecisionResult.
 *
 * This is the **only** entry point for algorithm evaluation. It is the
 * boundary between the tick engine and the algorithm implementations.
 *
 * Raises AlgorithmAdapterError if the algorithm throws any exception, or if
 * it returns a value that is not a valid DecisionResult shape. The caller is
 * responsible for converting this to an `algorithm_error` log event.
 */
export function evaluate(args: EvaluateArgs): DecisionResult {
  const algoType = args.manifest.algorithm.type

  if (algoType === 'declarative_rule') {
    return dispatchDeclarativeRule(args.context, args.parameters, args.hyperparameters)
  }

  if (algoType === 'weighted_score') {
    return dispatchWeightedScore(args.context, args.parameters, args.hyperparameters)
  }

  // ── DISPATCH SEAM (S9.3): trusted local packages whose behavior-of-record
  // is a Python `python_module` (app/api's trusted-local-Python strategy)
  // now ship as a TS port registered under `BUILTIN_EVALUATORS` (keyed by
  // package id — see `../../data/packages/index.ts`). The bundled manifest's
  // `algorithm.type` stays `'python_module'` (it's the SAME JSON the docker
  // app ships, byte-identical, never hand-edited for the offline build), and
  // `PackageRecord.strategy` is separately remapped to `'builtin_js_module'`
  // at load time (see `data/packages/index.ts`'s `record()`) — but nothing
  // upstream of THIS function ever threads that `strategy` string through to
  // here (`EvaluateArgs` only carries `manifest`, matching Python
  // adapter.py's signature exactly, and `run_manager.tick` calls this
  // synchronous `evaluate()` unchanged, see the docstring above). Rather
  // than widen `EvaluateArgs` with a `strategy` field (which `run_manager`
  // would then need to source from a `PackageRecord` it doesn't otherwise
  // carry), the adapter consults the SAME registry `data/packages/index.ts`
  // populates by package id whenever the manifest's declared type is
  // `python_module` OR (for forward-compat, if a manifest is ever authored
  // saying so directly) `builtin_js_module`. This is a closer structural
  // match to Python's own `_dispatch_python_module` (which also looks the
  // trusted implementation up — via `importlib`, keyed by package id — from
  // inside the adapter, not from a caller-supplied strategy tag).
  //
  // `dispatchBuiltinJsModule` applies the SAME required-context-field
  // validation and §11 DecisionResult normalization that
  // `app/api/aica_api/algorithms/python_module.py`'s `dispatch()` applies
  // around the package's `evaluate()` (context_error / algorithm_exception /
  // invalid_result_shape), and — unlike declarative_rule/weighted_score —
  // threads `next_package_runtime_state` through rather than forcing `{}`,
  // matching `python_module`'s stateful contract exactly.
  //
  // Both bundled UC-01 packages are registered (nri_fatigue_score_v1 and
  // aica_transparent_hybrid_trigger_v1). Any package id NOT present in the
  // registry — e.g. an uploaded/unported python_module package — correctly
  // falls through to `unsupported_algorithm_type` below.
  if (algoType === 'python_module' || algoType === 'builtin_js_module') {
    const builtinEvaluate = BUILTIN_EVALUATORS[args.manifest.id]
    if (builtinEvaluate) {
      return dispatchBuiltinJsModule(builtinEvaluate, args.context, args.parameters, args.hyperparameters, args.packageRuntimeState)
    }
  }

  // NOTE: 'js_module' intentionally falls through to unsupported_algorithm_type
  // here. A js_module package needs a per-package Web Worker runner, which
  // this synchronous entry point has no way to await — see `evaluateJsModule`
  // below for the async dispatch path. Until the run manager is wired to call
  // it (a separate, still-deferred follow-up — see that function's seam
  // note), a js_module package tick correctly surfaces as an algorithm_error
  // via this same generic path (tick engine continues, package flagged
  // unhealthy — same contract as every other adapter error). An unregistered
  // python_module/builtin_js_module package id (no TS port yet) also lands
  // here.
  throw new AlgorithmAdapterError(
    `unsupported_algorithm_type: Algorithm type '${algoType}' is not supported in this version.`,
    { error_type: 'unsupported_algorithm_type' },
  )
}

/**
 * Async dispatch entry for `js_module` (UNTRUSTED user-uploaded packages).
 *
 * Calls `args.runner.evaluate(...)` (a Web Worker round-trip — see
 * `./js_module.ts`), then validates + normalizes the result to the §11
 * `DecisionResult` shape exactly like the synchronous strategies above.
 *
 * Like `python_module` (the docker app's equivalent trusted-local strategy)
 * and unlike the two built-ins, `next_package_runtime_state` is THREADED
 * THROUGH from the package's return value, not forced to `{}` — a js_module
 * package may be stateful across ticks. `result_type` is likewise passed
 * through verbatim (no alias map), matching `python_module`'s contract.
 *
 * Any failure — the worker throwing, crashing, timing out, or returning a
 * value that isn't a valid `DecisionResult` shape — becomes an
 * `AlgorithmAdapterError`, never a faked decision (FR-011). The caller
 * converts this to an `algorithm_error` event exactly as it does for the
 * synchronous strategies' errors.
 *
 * INTEGRATION SEAM for S9.2: this function does not construct, cache, or
 * tear down `JsModuleRunner`s — it only calls the one it's given. Owning a
 * runner's lifecycle (spawn on package load/upload, reuse across ticks of a
 * run, `terminate()` on run end / package deletion / registry eviction) is
 * `run_manager`'s responsibility once the upload feature (S9.2) exists to
 * feed an uploaded js_module package through a run. `run_manager.tick`
 * itself is already `async`, so wiring is a matter of branching on the
 * package's dispatch strategy and `await`ing this function instead of
 * calling the synchronous `evaluate()` — no change to the synchronous path
 * is required to do that.
 */
export async function evaluateJsModule(args: EvaluateJsModuleArgs): Promise<DecisionResult> {
  let raw: Record<string, unknown>
  try {
    raw = await args.runner.evaluate({
      context: args.context,
      parameters: args.parameters,
      hyperparameters: args.hyperparameters,
      history: args.history,
      package_runtime_state: args.packageRuntimeState,
    })
  } catch (exc) {
    throw new AlgorithmAdapterError(
      `algorithm_exception: ${exc instanceof Error ? exc.message : String(exc)}`,
      { error_type: 'algorithm_exception' },
    )
  }

  if (!isDecisionResultShape(raw)) {
    throw new AlgorithmAdapterError(
      "invalid_result_shape: Algorithm returned a value that is not a DecisionResult.",
      { error_type: 'invalid_result_shape' },
    )
  }

  // next_package_runtime_state and result_type are passed through verbatim
  // (js_module packages may be stateful and may emit their own result
  // category strings) — everything else is copied as-is since the shape
  // guard above already confirmed the required §11 fields are present.
  return {
    ...raw,
    next_package_runtime_state: raw.next_package_runtime_state ?? {},
  }
}

// ---------------------------------------------------------------------------
// Private dispatch helpers
// ---------------------------------------------------------------------------

/** Call declarative_rule's evaluate and normalize the result. */
function dispatchDeclarativeRule(
  context: Record<string, unknown>,
  parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): DecisionResult {
  let result: DecisionResult
  try {
    result = evaluateDeclarative(context, parameters, hyperparameters)
  } catch (exc) {
    throw new AlgorithmAdapterError(
      `algorithm_exception: ${exc instanceof Error ? exc.message : String(exc)}`,
      { error_type: 'algorithm_exception' },
    )
  }

  if (!isDecisionResultShape(result)) {
    throw new AlgorithmAdapterError(
      "invalid_result_shape: Algorithm returned a value that is not a DecisionResult.",
      { error_type: 'invalid_result_shape' },
    )
  }

  // Normalize hybrid-only fields (always empty for declarative_rule).
  return {
    result_type: result.result_type,
    trigger_candidate: result.trigger_candidate,
    selected_category: result.selected_category,
    score: result.score,
    features: result.features,
    scores: {},
    states: {},
    criteria: result.criteria,
    candidates: result.candidates,
    fire_control: result.fire_control,
    proposal: result.proposal,
    reason_inputs: result.reason_inputs,
    explanation: result.explanation,
    next_package_runtime_state: {},
  }
}

/**
 * Call a registered `builtin_js_module` evaluate fn (a trusted TS port of a
 * `python_module` package's `evaluate()` — currently `nri_fatigue_score_v1`,
 * see `../../data/packages/builtin/nri_fatigue_score_v1.ts`), validate +
 * build its input, call it, and normalize the result.
 *
 * Ported from `app/api/aica_api/algorithms/python_module.py`'s `dispatch()`
 * (behavior-of-record):
 *   1. Validate required context fields BEFORE calling the package
 *      (`validateBuiltinContext`, mirrors `_validate_context` exactly).
 *   2. Build the py_context-equivalent input handed to the package.
 *   3. Call it; any thrown exception -> `algorithm_exception`.
 *   4. Normalize the returned value to a §11 DecisionResult; an invalid
 *      shape -> `invalid_result_shape`.
 *
 * Unlike declarative_rule/weighted_score, `next_package_runtime_state` is
 * threaded through (NOT forced to `{}`) and `result_type` is passed through
 * verbatim (no alias map) — same contract as `python_module`.
 */
function dispatchBuiltinJsModule(
  builtinEvaluate: BuiltinEvaluateFn,
  context: Record<string, unknown>,
  parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
  packageRuntimeState: Record<string, unknown>,
): DecisionResult {
  // ── Step 1: validate required context fields ─────────────────────────
  validateBuiltinContext(context)

  // ── Step 2: build the py_context-equivalent input ─────────────────────
  // Mirrors python_module.dispatch()'s py_context construction exactly —
  // note `context['recovery_active']` (injected by run_manager) is
  // deliberately NOT forwarded, matching Python (it's dropped at this same
  // boundary there too).
  const input: BuiltinPyContext = {
    simulation_time_sec: context['simulation_time_sec'] as number,
    raw_state: context['raw_state'] as Record<string, unknown>,
    feature_groups: context['feature_groups'] as Record<string, unknown>,
    parameters,
    hyperparameters,
    proposal_history: context['proposal_history'] as Record<string, unknown>,
    user_action_history: context['user_action_history'] as unknown[],
    package_runtime_state: packageRuntimeState,
  }

  // ── Step 3: call the builtin ────────────────────────────────────────
  let result: DecisionResult
  try {
    result = builtinEvaluate(input)
  } catch (exc) {
    throw new AlgorithmAdapterError(
      `algorithm_exception: ${exc instanceof Error ? exc.message : String(exc)}`,
      { error_type: 'algorithm_exception' },
    )
  }

  // ── Step 4: normalize ──────────────────────────────────────────────
  if (!isDecisionResultShape(result)) {
    throw new AlgorithmAdapterError(
      "invalid_result_shape: Algorithm returned a value that is not a DecisionResult.",
      { error_type: 'invalid_result_shape' },
    )
  }

  // result_type passed verbatim; next_package_runtime_state threaded
  // through (NOT forced to {}) — matching python_module's contract exactly.
  return {
    ...result,
    next_package_runtime_state: result.next_package_runtime_state ?? {},
  }
}

/**
 * Validate the required context fields BEFORE calling a `builtin_js_module`
 * evaluate fn.
 *
 * Ported from `app/api/aica_api/algorithms/python_module.py`'s
 * `_validate_context` (behavior-of-record) — same required fields, same
 * `error_type` ("context_error"):
 *   - `simulation_time_sec`
 *   - `raw_state` with the four core sensor keys (drowsinessLevel,
 *     fatigueLevel, attentionLevel, speedKph)
 *   - `feature_groups.normalized` (a dict)
 *   - `proposal_history`, `user_action_history` (present, any shape)
 *
 * Optional sensor/route enhancement fields may be absent; the package
 * itself defaults them.
 */
const REQUIRED_RAW_STATE_FIELDS = ['drowsinessLevel', 'fatigueLevel', 'attentionLevel', 'speedKph'] as const

function validateBuiltinContext(context: Record<string, unknown>): void {
  if (!('simulation_time_sec' in context)) {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'simulation_time_sec'",
      { error_type: 'context_error' },
    )
  }

  const rawState = context['raw_state']
  if (rawState == null || typeof rawState !== 'object') {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'raw_state'",
      { error_type: 'context_error' },
    )
  }

  const missingSensor = REQUIRED_RAW_STATE_FIELDS.filter((k) => !(k in rawState))
  if (missingSensor.length > 0) {
    throw new AlgorithmAdapterError(
      `context_error: missing required field(s) in raw_state: [${missingSensor.slice().sort().map((s) => `'${s}'`).join(', ')}]`,
      { error_type: 'context_error' },
    )
  }

  const featureGroups = context['feature_groups']
  if (featureGroups == null || typeof featureGroups !== 'object') {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'feature_groups'",
      { error_type: 'context_error' },
    )
  }
  if (!('normalized' in featureGroups)) {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'feature_groups.normalized'",
      { error_type: 'context_error' },
    )
  }
  const normalized = (featureGroups as Record<string, unknown>)['normalized']
  if (typeof normalized !== 'object' || normalized === null) {
    throw new AlgorithmAdapterError(
      "context_error: 'feature_groups.normalized' must be a dict",
      { error_type: 'context_error' },
    )
  }

  for (const key of ['proposal_history', 'user_action_history']) {
    if (!(key in context)) {
      throw new AlgorithmAdapterError(
        `context_error: missing required field: '${key}'`,
        { error_type: 'context_error' },
      )
    }
  }
}

/**
 * Call weighted_score's evaluate, validate, and normalize the result.
 *
 * The weighted_score algorithm already populates the full §11 shape
 * (scores/states/candidates/selected_category), so normalization here just
 * enforces next_package_runtime_state={} passthrough.
 */
function dispatchWeightedScore(
  context: Record<string, unknown>,
  parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): DecisionResult {
  let result: DecisionResult
  try {
    result = evaluateWeighted(context, parameters, hyperparameters)
  } catch (exc) {
    throw new AlgorithmAdapterError(
      `algorithm_exception: ${exc instanceof Error ? exc.message : String(exc)}`,
      { error_type: 'algorithm_exception' },
    )
  }

  if (!isDecisionResultShape(result)) {
    throw new AlgorithmAdapterError(
      "invalid_result_shape: Algorithm returned a value that is not a DecisionResult.",
      { error_type: 'invalid_result_shape' },
    )
  }

  // Enforce M2 contract: next_package_runtime_state is always empty.
  return {
    result_type: result.result_type,
    trigger_candidate: result.trigger_candidate,
    selected_category: result.selected_category,
    score: result.score,
    features: result.features,
    scores: result.scores,
    states: result.states,
    criteria: result.criteria,
    candidates: result.candidates,
    fire_control: result.fire_control,
    proposal: result.proposal,
    reason_inputs: result.reason_inputs,
    explanation: result.explanation,
    next_package_runtime_state: {},
  }
}
