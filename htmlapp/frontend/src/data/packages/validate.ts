/**
 * Manifest-shape validation — the field-level checks a package manifest must
 * satisfy to be usable, mirroring `app/api/aica_api/models/package.py`'s
 * required Pydantic fields: non-empty string `id`, string `version`,
 * `label.ja`/`label.en` strings, `algorithm.type` a string, and a NON-EMPTY
 * `compatible_scenario_types` array of strings (Python's `@field_validator`
 * rejects an empty list there, not just a missing key — see that model).
 *
 * `hasWellFormedManifestCore` covers the fields every htmlapp validation path
 * agrees are always required. It deliberately does NOT check
 * `compatible_scenario_types` — the two call sites disagree on strictness:
 *   - `./index.ts#builtinManifestValidationError` (bundled manifests read
 *     from the generated data registry) requires the array to be non-empty,
 *     matching Python's validator exactly — see `hasNonEmptyStringArray`.
 *   - `../../engine/worker/handlers/packages.ts#isWellFormedUserManifest`
 *     (untrusted user js_module uploads) only requires the field to be an
 *     array — upload-time validation has always been looser here, and
 *     tightening it to match Python is out of scope for this fix.
 * Both reuse this same core check rather than each hand-rolling its own
 * id/version/label/algorithm.type validation (a second dialect of the same
 * rules would drift the two apart silently).
 */
export function hasWellFormedManifestCore(value: unknown): value is {
  id: string
  version: string
  label: { ja: string; en: string }
  algorithm: { type: string; [k: string]: unknown }
  [k: string]: unknown
} {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || v['id'].length === 0) return false
  if (typeof v['version'] !== 'string') return false
  const algorithm = v['algorithm'] as Record<string, unknown> | undefined
  if (!algorithm || typeof algorithm['type'] !== 'string') return false
  const label = v['label'] as Record<string, unknown> | undefined
  if (!label || typeof label['en'] !== 'string' || typeof label['ja'] !== 'string') return false
  return true
}

/** Non-empty array whose every element is a string. */
export function hasNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
}

/**
 * Full builtin-manifest validation, mirroring Python's `PackageManifest`
 * model exactly (see the module doc above). Returns `null` when `manifest`
 * is usable, or a human-readable reason otherwise. Shared by
 * `./index.ts#builtinPackages` (filters invalid manifests out) and
 * `./index.ts#builtinPackageErrors` (reports why) so the two can never
 * disagree about which manifests are valid.
 */
export function builtinManifestValidationError(manifest: unknown): string | null {
  if (!hasWellFormedManifestCore(manifest)) {
    return 'manifest is missing a required id/version/label.ja/label.en/algorithm.type field'
  }
  if (!hasNonEmptyStringArray((manifest as Record<string, unknown>)['compatible_scenario_types'])) {
    return "'compatible_scenario_types' must be a non-empty array of strings"
  }
  return null
}
