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

export type EvaluateArgs = {
  manifest: PackageManifest
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

  throw new AlgorithmAdapterError(
    `unsupported_algorithm_type: Algorithm type '${algoType}' is not supported in this version.`,
    { error_type: 'unsupported_algorithm_type' },
  )
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
