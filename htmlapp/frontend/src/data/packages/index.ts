/**
 * Builtin package records, derived from the generated data payload.
 *
 * A function rather than a const: the registry is installed during boot (or by
 * the `data.install` op in the worker), which happens after module evaluation.
 *
 * Two-stage filtering, mirroring `app/api/aica_api/services/package_registry.py`
 * (feature 026 fix round 3 — see `./validate.ts`'s module doc for the full
 * story, including round 2's incorrect "these fail Pydantic validation"
 * premise that this replaces):
 *   1. FAMILY ROUTING (`./validate.ts#isProposalFamilyManifest`) — any
 *      manifest carrying `kind` or `family` is a proposal-family package
 *      (owned by a separate proposal package registry, not this one) and is
 *      skipped SILENTLY, never validated, never reported as an error —
 *      exactly like Python's own silent `continue` for the same fields. Of
 *      the 6 manifests the generated data payload bundles today, 4 are
 *      proposal-family (`aica_transparent_content_selector_v1`,
 *      `aica_transparent_service_selector_v1`, `mock_content_selector_v1`,
 *      `mock_service_selector_v1`) and are skipped here — leaving exactly
 *      the 2 the htmlapp's old hand-copied `DEFAULT_PACKAGES` always held
 *      (`nri_fatigue_score_v1`, `aica_transparent_hybrid_trigger_v1`). They
 *      were never supposed to be in the trigger package list at all.
 *   2. REQUIRED-FIELD VALIDATION (`./validate.ts#builtinManifestValidationError`)
 *      applies only to the remaining trigger-family manifests, mirroring
 *      Python's `PackageManifest` Pydantic model. `builtinPackageErrors()`
 *      reports genuine trigger-package failures — with the current
 *      committed data that's empty, and no "could not be loaded" notice
 *      appears on a normal boot.
 */
import { getPackageManifests } from '../registry'
import type { PackageRecord } from '../types'
import type { RegistryError } from '../../api/types'
import { builtinManifestValidationError, isProposalFamilyManifest } from './validate'

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

/** Manifests actually owned by this (trigger) registry — proposal-family
 * manifests are routed away first, before any validation runs. */
function triggerFamilyManifests(): any[] {
  return getPackageManifests().filter((manifest) => !isProposalFamilyManifest(manifest))
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
  return triggerFamilyManifests()
    .filter((manifest) => builtinManifestValidationError(manifest) === null)
    .map(record)
}

/** One entry per TRIGGER-family manifest that fails validation — mirrors
 * Python's `PackageRegistry.list_errors()`. Proposal-family manifests are
 * routed away by `triggerFamilyManifests()` before this ever runs, so they
 * can never appear here, valid or not. */
export function builtinPackageErrors(): RegistryError[] {
  const errors: RegistryError[] = []
  triggerFamilyManifests().forEach((manifest, index) => {
    const problem = builtinManifestValidationError(manifest)
    if (problem) errors.push({ source: errorSource(manifest, index), message: problem })
  })
  return errors
}
