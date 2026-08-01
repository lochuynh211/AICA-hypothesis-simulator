/**
 * Algorithm adapter — the single, authoritative dispatch path.
 *
 * Ported from `app/api/aica_api/algorithms/adapter.py` + `python_module.py`
 * (behavior-of-record). Feature 009 (signal-tier redesign): `python_module` is
 * the SOLE algorithm type — the built-in `declarative_rule`/`weighted_score`
 * strategies were retired. Every algorithm call goes through this module. It
 * dispatches by `manifest.algorithm.type`, calls the implementation, normalizes
 * the output to the §11 DecisionResult shape, and raises `AlgorithmAdapterError`
 * for any algorithm exception or invalid return shape (FR-011).
 *
 * Design constraints:
 *   - Deterministic: same inputs -> same output.
 *   - An algorithm exception or invalid return -> AlgorithmAdapterError,
 *     NEVER a faked DecisionResult (FR-011). The tick engine converts this into
 *     an `algorithm_error` EVENT — never a normal decision.
 */

import type { DecisionResult, PackageManifest } from '../../api/types'
import { AlgorithmAdapterError } from './errors'
import type { JsModuleRunner } from './js_module'
import { BUILTIN_EVALUATORS, type BuiltinEvaluateFn, type BuiltinPyContext } from '../../data/builtinEvaluators'

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
 * `js_module` (UNTRUSTED user-uploaded packages, run in a sandboxed Web Worker)
 * is the one adapter strategy that cannot be evaluated synchronously. The
 * trusted-TS-port `builtin_js_module` (the offline mirror of a Python
 * `python_module` package) stays on the synchronous `evaluate()` path.
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
 * This is the **only** entry point for algorithm evaluation. Feature 009: only
 * `python_module` (mirrored offline as a registered `builtin_js_module` TS
 * port) is supported. Any other type — or a python_module package with no
 * registered TS port — surfaces as `unsupported_algorithm_type`.
 */
export function evaluate(args: EvaluateArgs): DecisionResult {
  const algoType = args.manifest.algorithm.type

  // The bundled manifests declare algorithm.type = 'python_module' (byte-
  // identical to the docker app's JSON). Their trusted behavior-of-record is a
  // TS port registered under BUILTIN_EVALUATORS, keyed by package id. See
  // data/packages/index.ts. `builtin_js_module` is accepted for forward-compat.
  if (algoType === 'python_module' || algoType === 'builtin_js_module') {
    const builtinEvaluate = BUILTIN_EVALUATORS[args.manifest.id]
    if (builtinEvaluate) {
      return dispatchBuiltinJsModule(builtinEvaluate, args.context, args.parameters, args.hyperparameters, args.packageRuntimeState)
    }
  }

  // js_module (untrusted uploads) needs the async Web Worker path; an
  // unregistered python_module package id (no TS port) also lands here.
  throw new AlgorithmAdapterError(
    `unsupported_algorithm_type: Algorithm type '${algoType}' is not supported in this version.`,
    { error_type: 'unsupported_algorithm_type' },
  )
}

/**
 * Async dispatch entry for `js_module` (UNTRUSTED user-uploaded packages).
 * Calls `args.runner.evaluate(...)` (a Web Worker round-trip), then validates +
 * normalizes to the §11 DecisionResult shape. Any failure becomes an
 * AlgorithmAdapterError, never a faked decision (FR-011).
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

  return {
    ...raw,
    next_package_runtime_state: raw.next_package_runtime_state ?? {},
  }
}

// ---------------------------------------------------------------------------
// Private dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Call a registered `builtin_js_module` evaluate fn (a trusted TS port of a
 * `python_module` package's `evaluate()`), validate + build its input, call it,
 * and normalize the result. Ported from python_module.py's `dispatch()`:
 *   1. Validate the tiered context (validateBuiltinContext ↔ _validate_context).
 *   2. Build the py_context-equivalent input (signals, feature_groups, ...,
 *      recovery_active) — feature 009 tiered shape, NO raw_state.
 *   3. Call it; any thrown exception -> algorithm_exception.
 *   4. Normalize to §11 DecisionResult; invalid shape -> invalid_result_shape.
 * `next_package_runtime_state` is threaded through (NOT forced to {}) and
 * `result_type` is passed verbatim — same contract as python_module.
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

  // ── Step 2: build the py_context-equivalent input (feature 009) ───────
  const input: BuiltinPyContext = {
    simulation_time_sec: context['simulation_time_sec'] as number,
    signals: context['signals'] as Record<string, unknown>,
    feature_groups: (context['feature_groups'] as Record<string, unknown>) ?? {},
    parameters,
    hyperparameters,
    proposal_history: context['proposal_history'] as Record<string, unknown>,
    user_action_history: (context['user_action_history'] as unknown[]) ?? [],
    package_runtime_state: packageRuntimeState,
    recovery_active: Boolean(context['recovery_active'] ?? false),
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

  return {
    ...result,
    next_package_runtime_state: result.next_package_runtime_state ?? {},
  }
}

/**
 * Validate the required tiered context fields BEFORE calling a builtin evaluate.
 *
 * Ported from python_module.py's `_validate_context` (feature 009):
 *   - `simulation_time_sec`
 *   - `signals.fixed` (a dict), `signals.dynamic` (a dict)
 *   - `signals.simulated` (a dict) containing drowsiness, fatigue, anomaly_rate
 *   - `proposal_history`, `user_action_history`
 * `feature_groups` is optional (packages default it for display only).
 */
const REQUIRED_SIMULATED_FIELDS = ['drowsiness', 'fatigue', 'anomaly_rate'] as const

function validateBuiltinContext(context: Record<string, unknown>): void {
  if (!('simulation_time_sec' in context)) {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'simulation_time_sec'",
      { error_type: 'context_error' },
    )
  }

  const signals = context['signals']
  if (signals == null || typeof signals !== 'object') {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'signals'",
      { error_type: 'context_error' },
    )
  }
  const sig = signals as Record<string, unknown>

  for (const tier of ['fixed', 'dynamic'] as const) {
    const t = sig[tier]
    if (t == null || typeof t !== 'object') {
      throw new AlgorithmAdapterError(
        `context_error: missing required field: 'signals.${tier}'`,
        { error_type: 'context_error' },
      )
    }
  }

  const simulated = sig['simulated']
  if (simulated == null || typeof simulated !== 'object') {
    throw new AlgorithmAdapterError(
      "context_error: missing required field: 'signals.simulated'",
      { error_type: 'context_error' },
    )
  }
  const missing = REQUIRED_SIMULATED_FIELDS.filter((k) => !(k in (simulated as Record<string, unknown>)))
  if (missing.length > 0) {
    throw new AlgorithmAdapterError(
      `context_error: missing required field(s) in signals.simulated: [${missing.slice().sort().map((s) => `'${s}'`).join(', ')}]`,
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
