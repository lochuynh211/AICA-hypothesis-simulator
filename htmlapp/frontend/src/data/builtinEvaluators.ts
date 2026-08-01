/**
 * builtin_js_module evaluate registry — the dispatch seam consulted by
 * `../engine/algorithms/adapter.ts` for any package whose
 * `manifest.algorithm.type` is `'python_module'` (the bundled manifests'
 * declared type, unchanged from the docker app's JSON) or
 * `'builtin_js_module'`. Keyed by package id — mirrors how Python's
 * `python_module.load_evaluate` resolves a package's `evaluate` by id.
 *
 * This is SOURCE, not data: manifests and parameters come from the generated
 * data payload, but the executable port lives in `./packages/builtin/*.ts`.
 */
import type { DecisionResult } from '../api/types'
import { evaluate as nriEvaluate } from './packages/builtin/nri_fatigue_score_v1'
import { evaluate as hybridEvaluate } from './packages/builtin/aica_transparent_hybrid_trigger_v1'

/**
 * Mirrors python_module.dispatch()'s `py_context` dict (feature 009 tiered
 * shape) — the input every builtin_js_module evaluate fn receives. The flat
 * `raw_state` is retired in favor of `signals` ({fixed, dynamic, simulated}),
 * plus the top-level `recovery_active` flag.
 */
export type BuiltinPyContext = {
  simulation_time_sec: number
  signals: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
  recovery_active: boolean
}

export type BuiltinEvaluateFn = (input: BuiltinPyContext) => DecisionResult

export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluateFn> = {
  nri_fatigue_score_v1: nriEvaluate,
  aica_transparent_hybrid_trigger_v1: hybridEvaluate,
}

/**
 * Packages whose manifests ship in the data payload but whose TS ports do not
 * exist yet. C1 adds `aica_transparent_service_selector_v1` and
 * `aica_transparent_content_selector_v1` and deletes those two entries; the
 * mock packages are UI-hidden and never dispatched.
 */
export const UNPORTED_BUILTINS: ReadonlySet<string> = new Set([
  'aica_transparent_service_selector_v1',
  'aica_transparent_content_selector_v1',
  'mock_service_selector_v1',
  'mock_content_selector_v1',
])
