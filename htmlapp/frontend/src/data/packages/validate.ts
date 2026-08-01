/**
 * Manifest-shape checks for bundled ("builtin") packages, split into two
 * concerns that must NOT be conflated (feature 026 fix round 3 — round 2
 * conflated them, on an incorrect claim that proposal-family manifests fail
 * Pydantic validation in the docker app; they don't — see below):
 *
 *   1. FAMILY ROUTING (`isProposalFamilyManifest`) — not validation at all.
 *      `app/api/aica_api/services/package_registry.py` skips any manifest
 *      carrying `kind` or `family` SILENTLY, with this comment there:
 *        "Proposal-family packages (they declare `kind`/`family`, e.g. the
 *        transparent content selector) are owned by the separate proposal
 *        package registry, not the trigger registry. Skip them silently —
 *        they are not trigger packages and must not surface as errors here."
 *      Those manifests are perfectly valid against their OWN model
 *      (`ProposalPackageManifest`, a different registry entirely) — they
 *      were simply never trigger packages. `./index.ts#builtinPackages`
 *      skips them the same way, before validation ever runs, or they would
 *      wrongly surface as "could not be loaded" errors on every boot.
 *
 *   2. REQUIRED-FIELD VALIDATION (`hasWellFormedManifestCore`,
 *      `hasNonEmptyStringArray`, `builtinManifestValidationError`) — the
 *      field-level checks a TRIGGER-family manifest must satisfy, mirroring
 *      `app/api/aica_api/models/package.py`'s required Pydantic fields:
 *      non-empty string `id`, string `version`, `label.ja`/`label.en`
 *      strings, `algorithm.type` a string, and a NON-EMPTY
 *      `compatible_scenario_types` array of strings (Python's
 *      `@field_validator` rejects an empty list there, not just a missing
 *      key). This must only ever run against manifests
 *      `isProposalFamilyManifest` has already ruled OUT — a proposal-family
 *      manifest missing `compatible_scenario_types` (which all four of
 *      today's bundled ones do) is not a validation failure, it is simply
 *      the wrong model to check it against.
 *
 * `hasWellFormedManifestCore` is also reused, unmodified, by
 * `../../engine/worker/handlers/packages.ts#isWellFormedUserManifest`
 * (untrusted user js_module uploads) for its id/version/label/algorithm.type
 * checks — that path only requires `compatible_scenario_types` to be an
 * array (not necessarily non-empty), is unrelated to family routing (user
 * uploads have no `family`/`kind` concept), and is untouched by this fix
 * round.
 */

/**
 * True if `manifest` carries a `kind` or `family` field (present, i.e. not
 * `undefined`/`null` — an explicit `null` is treated the same as absent).
 * Mirrors the Python skip quoted in the module doc above: these are
 * proposal-family packages, owned by a different registry entirely, and
 * must never be treated as trigger packages — valid or invalid.
 */
export function isProposalFamilyManifest(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return false
  const v = manifest as Record<string, unknown>
  return v['kind'] != null || v['family'] != null
}

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
 * Required-field validation for a TRIGGER-family manifest, mirroring
 * Python's `PackageManifest` model exactly (see the module doc above —
 * callers must run `isProposalFamilyManifest` first and skip silently,
 * never call this on a proposal-family manifest). Returns `null` when
 * `manifest` is usable, or a human-readable reason otherwise. Shared by
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
