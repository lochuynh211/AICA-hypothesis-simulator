/**
 * Package registry — in-memory index built from IndexedDB package records.
 *
 * Ported from `app/api/aica_api/services/package_registry.py` (behavior-of-record).
 * The Python registry scans a `packages_dir` for `package.json` files at
 * construction time. The htmlapp offline build has no filesystem: package
 * manifests are bundled JSON, generated into the data registry
 * (`../../data/registry.ts`) and seeded into IndexedDB by
 * `storage/db.ts#seedDefaults()` on first launch. This registry reads the
 * already-seeded `PackageRecord` rows via `packages_store` instead of
 * scanning a directory.
 *
 * `listSummaries()`'s `errors` surfaces
 * `../../data/packages#builtinPackageErrors()` — one entry per bundled
 * TRIGGER-family manifest that fails required-field validation in
 * `../../data/packages/validate.ts`. Proposal-family manifests (any
 * manifest carrying `kind`/`family`, e.g. the content/service selectors) are
 * routed away before validation even runs — they are not malformed trigger
 * packages, they were simply never trigger packages to begin with, mirroring
 * `app/api/aica_api/services/package_registry.py`'s own silent `continue`
 * for the same fields (see `../../data/packages/validate.ts`'s module doc
 * for the full story, including an earlier, incorrect version of this
 * reasoning that treated them as malformed rather than mis-routed).
 * With the current committed data `errors` is empty: no manifest that
 * actually belongs in the trigger registry is malformed. `seedDefaults()`
 * never seeds an invalid manifest into IndexedDB in the first place — it
 * only ever calls `builtinPackages()`, which already excludes both the
 * proposal-family skips and any genuine trigger-manifest failures — so
 * `errors` here answers "why isn't a bundled trigger package I expected
 * available," not "something already seeded is broken."
 *
 * Public API mirrors the Python registry:
 *   packageRegistry.listSummaries() -> Promise<{ packages, errors }>
 *   packageRegistry.get(id)         -> Promise<PackageManifest>
 *   packageRegistry.isCompatible(package, scenario) -> boolean
 */
import { packagesStore } from '../../storage/packages_store'
import { builtinPackageErrors } from '../../data/packages'
import type { PackageManifest, PackageSummary, RegistryError, ScenarioDef } from '../../api/types'

export const packageRegistry = {
  /** Return lightweight summaries for all seeded packages, plus any bundled-manifest load errors. */
  async listSummaries(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
    const records = await packagesStore.list()
    const packages: PackageSummary[] = records.map((rec) => ({
      id: rec.manifest.id,
      version: rec.manifest.version,
      label: rec.manifest.label,
      algorithm_type: rec.manifest.algorithm.type,
      compatible_scenario_types: rec.manifest.compatible_scenario_types,
    }))
    return { packages, errors: builtinPackageErrors() }
  },

  /** Return the full PackageManifest for a package_id. Throws if not found. */
  async get(id: string): Promise<PackageManifest> {
    const rec = await packagesStore.get(id)
    if (!rec) {
      throw new Error(`Package '${id}' not found or invalid`)
    }
    return rec.manifest
  },

  /**
   * Return true if the scenario type is in the package's compat list.
   * Defensive: a manifest with a missing or non-array
   * `compatible_scenario_types` is treated as compatible with nothing,
   * rather than throwing. `builtinPackages()` already excludes bundled
   * manifests missing the field, so this is belt-and-braces there, but this
   * is also reachable outside React (e.g. a worker `dispatch()` call) where
   * nothing upstream guards the field the way `ScenarioSelector.tsx`
   * assumes — without this guard, reaching it produces a raw TypeError
   * instead of a domain-shaped `false`.
   */
  isCompatible(pkg: PackageManifest, scenario: ScenarioDef): boolean {
    const types = pkg.compatible_scenario_types
    return Array.isArray(types) && types.includes(scenario.type)
  },
}
