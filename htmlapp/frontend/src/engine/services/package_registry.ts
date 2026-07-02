/**
 * Package registry — in-memory index built from IndexedDB package records.
 *
 * Ported from `app/api/aica_api/services/package_registry.py` (behavior-of-record).
 * The Python registry scans a `packages_dir` for `package.json` files at
 * construction time. The htmlapp offline build has no filesystem: package
 * manifests are bundled JSON (`src/data/packages/`) and seeded into
 * IndexedDB by `storage/db.ts#seedDefaults()` on first launch. This registry
 * reads the already-seeded `PackageRecord` rows via `packages_store` instead
 * of scanning a directory.
 *
 * Because bundled manifests are validated at build time (no runtime JSON
 * parsing / Pydantic-equivalent validation happens here yet), `listSummaries()`
 * always returns an empty `errors` array for now. A later slice that adds
 * user-supplied package import will populate it the same way
 * `list_errors()` does in Python.
 *
 * Public API mirrors the Python registry:
 *   packageRegistry.listSummaries() -> Promise<{ packages, errors }>
 *   packageRegistry.get(id)         -> Promise<PackageManifest>
 *   packageRegistry.isCompatible(package, scenario) -> boolean
 */
import { packagesStore } from '../../storage/packages_store'
import type { PackageManifest, PackageSummary, RegistryError, ScenarioDef } from '../../api/types'

export const packageRegistry = {
  /** Return lightweight summaries for all seeded packages, plus any load errors. */
  async listSummaries(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
    const records = await packagesStore.list()
    const packages: PackageSummary[] = records.map((rec) => ({
      id: rec.manifest.id,
      version: rec.manifest.version,
      label: rec.manifest.label,
      algorithm_type: rec.manifest.algorithm.type,
      compatible_scenario_types: rec.manifest.compatible_scenario_types,
    }))
    return { packages, errors: [] }
  },

  /** Return the full PackageManifest for a package_id. Throws if not found. */
  async get(id: string): Promise<PackageManifest> {
    const rec = await packagesStore.get(id)
    if (!rec) {
      throw new Error(`Package '${id}' not found or invalid`)
    }
    return rec.manifest
  },

  /** Return true if the scenario type is in the package's compat list. */
  isCompatible(pkg: PackageManifest, scenario: ScenarioDef): boolean {
    return pkg.compatible_scenario_types.includes(scenario.type)
  },
}
