/**
 * Builtin package records, derived from the generated data payload.
 *
 * A function rather than a const: the registry is installed during boot (or by
 * the `data.install` op in the worker), which happens after module evaluation.
 */
import { getPackageManifests } from '../registry'
import type { PackageRecord } from '../types'

export type { PackageRecord } from '../types'
export {
  BUILTIN_EVALUATORS,
  UNPORTED_BUILTINS,
  type BuiltinEvaluateFn,
  type BuiltinPyContext,
} from '../builtinEvaluators'

function record(manifest: any): PackageRecord {
  const declared = manifest.algorithm?.type as string
  // python_module built-ins are served by the TS ports in ../builtinEvaluators.
  const strategy = declared === 'python_module' ? 'builtin_js_module' : declared
  return { id: manifest.id, manifest, origin: 'builtin', strategy }
}

export function builtinPackages(): PackageRecord[] {
  return getPackageManifests().map(record)
}
