/**
 * Builtin package records, derived from the generated data payload.
 *
 * A function rather than a const: the registry is installed during boot (or by
 * the `data.install` op in the worker), which happens after module evaluation.
 *
 * `builtinPackages()` only returns manifests that pass
 * `./validate.ts#builtinManifestValidationError` — mirroring
 * `app/api/aica_api/models/package.py`, whose required, non-empty
 * `compatible_scenario_types` field a `@field_validator` enforces. The
 * generated data payload bundles 6 manifests today; 3
 * (`aica_transparent_service_selector_v1`, `mock_service_selector_v1`,
 * `mock_content_selector_v1`) omit `compatible_scenario_types` entirely —
 * they fail Pydantic validation in the docker app too and never reach its
 * `PackageRegistry`. Before feature 026 this was unreachable here: the
 * htmlapp's old hand-copied `DEFAULT_PACKAGES` only ever held the two
 * manifests with TS ports, both already valid, so nothing ever exercised an
 * invalid bundled manifest reaching a live component
 * (`ScenarioSelector.tsx` indexes `compatible_scenario_types` unguarded).
 * `builtinPackageErrors()` reports the rejects, mirroring Python's
 * `list_errors()`.
 */
import { getPackageManifests } from '../registry'
import type { PackageRecord } from '../types'
import type { RegistryError } from '../../api/types'
import { builtinManifestValidationError } from './validate'

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

/**
 * The package id for a manifest that failed validation, or a positional
 * fallback if `id` itself is unusable. `../registry.ts#installRegistry`'s
 * boot-time validation already guarantees every manifest in the installed
 * payload has an `id` matching its payload key (an unusable id would have
 * thrown a `DataRegistryError` at boot, before `getPackageManifests()` ever
 * returns it) — this fallback is defensive, not reachable through
 * `ensureRegistry()` today, only if that invariant is ever loosened.
 */
function errorSource(manifest: any, index: number): string {
  return typeof manifest?.id === 'string' && manifest.id.length > 0
    ? manifest.id
    : `<unknown manifest at payload index ${index}>`
}

export function builtinPackages(): PackageRecord[] {
  return getPackageManifests()
    .filter((manifest) => builtinManifestValidationError(manifest) === null)
    .map(record)
}

/** One entry per bundled manifest that fails validation — mirrors Python's
 * `PackageRegistry.list_errors()`. */
export function builtinPackageErrors(): RegistryError[] {
  const errors: RegistryError[] = []
  getPackageManifests().forEach((manifest, index) => {
    const problem = builtinManifestValidationError(manifest)
    if (problem) errors.push({ source: errorSource(manifest, index), message: problem })
  })
  return errors
}
