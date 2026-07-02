import type { DecisionResult, PackageManifest } from '../../api/types'
import nri from './nri_fatigue_score_v1.json'
import hybrid from './aica_transparent_hybrid_trigger_v1.json'
import { evaluate as nriEvaluate } from './builtin/nri_fatigue_score_v1'

export type PackageRecord = {
  id: string
  manifest: PackageManifest
  origin: 'builtin' | 'user'
  // declarative_rule | weighted_score | builtin_js_module | js_module
  strategy: string
  source?: string
}

function record(manifest: any): PackageRecord {
  const declared = manifest.algorithm?.type as string
  // python_module built-ins are served by TS ports registered in S9/S11.
  const strategy = declared === 'python_module' ? 'builtin_js_module' : declared
  return { id: manifest.id, manifest: manifest as PackageManifest, origin: 'builtin', strategy }
}

export const DEFAULT_PACKAGES: PackageRecord[] = [record(nri), record(hybrid)]

// ---------------------------------------------------------------------------
// builtin_js_module evaluate registry (S9.3) — the dispatch seam consulted
// by `../../engine/algorithms/adapter.ts` for any package whose
// `manifest.algorithm.type` is `'python_module'` (the bundled manifests'
// declared type, unchanged from the docker app's JSON) or `'builtin_js_module'`
// (this record's remapped `strategy`, see `record()` above). Keyed by
// package id — mirrors how Python's `python_module.load_evaluate` resolves
// a package's `evaluate` by id (via its manifest path) rather than by a
// caller-supplied strategy tag.
//
// `aica_transparent_hybrid_trigger_v1` is deliberately NOT registered here
// yet — it remains an unported `python_module` package (still surfaces
// `unsupported_algorithm_type` if run), out of scope for S9.3.
// ---------------------------------------------------------------------------

/** Mirrors python_module.dispatch()'s `py_context` dict — the input every builtin_js_module evaluate fn receives. */
export type BuiltinPyContext = {
  simulation_time_sec: number
  raw_state: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
}

export type BuiltinEvaluateFn = (input: BuiltinPyContext) => DecisionResult

export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluateFn> = {
  nri_fatigue_score_v1: nriEvaluate,
}
