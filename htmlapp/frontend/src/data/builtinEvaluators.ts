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
import { evaluate as serviceSelectorEvaluate } from './packages/builtin/aica_transparent_service_selector_v1'
import type { SelectorInput, ServiceSelectorOutput } from './packages/builtin/aica_transparent_service_selector_v1'

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

/**
 * The evaluate() contract for a PROPOSAL-family selector package (C1+) —
 * `aica_transparent_service_selector_v1`'s own `evaluate(context:
 * SelectorInput) -> ServiceSelectorOutput`, mirroring algorithm.py's
 * `evaluate(context: dict) -> dict` exactly rather than forcing it into
 * `BuiltinPyContext`/`DecisionResult` (see that package's own module doc for
 * why: different family, different input/output shape entirely — a
 * SelectorInput has no `signals`/`feature_groups` tiers, and a
 * ServiceSelectorOutput has no `result_type`/`fire_control`/`candidates`).
 * `aica_transparent_content_selector_v1` (also C1-scoped, not yet ported)
 * will add a second, differently-shaped variant here when it lands.
 */
export type SelectorEvaluateFn = (input: SelectorInput) => ServiceSelectorOutput

/**
 * Keyed by package id, same as the trigger-only `BuiltinEvaluateFn` map used
 * to be. The value type is now a UNION of the trigger contract and the
 * proposal-selector contract (see `SelectorEvaluateFn` above) — deliberately
 * widened rather than distorting the selector port into the trigger shape,
 * per the C1 Task 4 brief. The one call site that dereferences this map
 * expecting a plain `BuiltinEvaluateFn`
 * (`../engine/algorithms/adapter.ts#evaluate`) narrows with a cast rather
 * than a runtime check, because it is ONLY ever reached for TRIGGER-family
 * manifests in practice: `./packages/index.ts#triggerFamilyManifests()`
 * routes any manifest carrying `kind`/`family` (every proposal-family
 * package, including this one) away before it can ever reach the trigger
 * adapter — see that file's module doc. The cast changes no runtime
 * behavior; it only restores the narrower type the adapter already assumed
 * before this map was widened.
 */
export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluateFn | SelectorEvaluateFn> = {
  nri_fatigue_score_v1: nriEvaluate,
  aica_transparent_hybrid_trigger_v1: hybridEvaluate,
  aica_transparent_service_selector_v1: serviceSelectorEvaluate,
}

/**
 * Packages whose manifests ship in the data payload but whose TS ports do not
 * exist yet. C1 Task 4 ports `aica_transparent_service_selector_v1` (removed
 * below); `aica_transparent_content_selector_v1` is still C1-scoped but not
 * yet ported. The mock packages are UI-hidden and never dispatched.
 */
export const UNPORTED_BUILTINS: ReadonlySet<string> = new Set([
  'aica_transparent_content_selector_v1',
  'mock_service_selector_v1',
  'mock_content_selector_v1',
])
