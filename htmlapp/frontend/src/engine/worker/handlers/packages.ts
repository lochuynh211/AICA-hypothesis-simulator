import type { PackageSummary, PackageManifest } from '../../../api/types'
import { packageRegistry } from '../../services/package_registry'
import { packagesStore } from '../../../storage/packages_store'
import { createJsModuleRunner, type EvaluateInput, type EvaluateOutput } from '../../algorithms/js_module'
import { hasWellFormedManifestCore } from '../../../data/packages/validate'

/** Minimal, representative probe input for the upload-time smoke test. */
const UPLOAD_SMOKE_INPUT: EvaluateInput = {
  context: {},
  parameters: {},
  hyperparameters: {},
  history: [],
  package_runtime_state: {},
}

/**
 * Loose shape guard for the required manifest fields addUserPackage/
 * packageRegistry.listSummaries actually need. Shares its id/version/label/
 * algorithm.type checks with `../../../data/packages/validate.ts`'s
 * `hasWellFormedManifestCore` (used for bundled manifests) — see that
 * module's doc comment for why the two paths disagree on
 * `compatible_scenario_types` strictness (this one only requires an array;
 * bundled manifests require it to be non-empty, matching Python).
 */
function isWellFormedUserManifest(value: unknown): value is PackageManifest {
  if (!hasWellFormedManifestCore(value)) return false
  return Array.isArray((value as Record<string, unknown>)['compatible_scenario_types'])
}

/** EvaluateOutput is a loose `Record<string, unknown>` — any plain, non-array object qualifies. */
function isEvaluateOutputShape(value: unknown): value is EvaluateOutput {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function packagesList(): Promise<{ packages: PackageSummary[]; errors: { source: string; message: string }[] }> {
  return packageRegistry.listSummaries()
}

export async function packagesGet(params: { id: string }): Promise<PackageManifest> {
  return packageRegistry.get(params.id)
}

/**
 * Add an untrusted `js_module` package: parse its manifest, smoke-test its
 * `evaluate()` in a sandboxed Web Worker, and commit to IndexedDB only if
 * both succeed.
 */
export async function packagesAddUser(params: { source: string }): Promise<PackageSummary> {
  const { source } = params

  const runner = createJsModuleRunner(source)
  try {
    // 1. Manifest — obtained FROM the worker's load handshake
    let manifest: unknown
    try {
      manifest = await runner.getManifest()
    } catch (exc) {
      throw new Error(
        `invalid_package_source: failed to load package source (${exc instanceof Error ? exc.message : String(exc)})`,
      )
    }
    if (!isWellFormedUserManifest(manifest)) {
      throw new Error(
        "invalid_package_manifest: package source does not export a well-formed 'manifest' " +
          '(requires string id/version, algorithm.type, label.en/ja, and an array compatible_scenario_types)',
      )
    }

    // 2. Smoke test evaluate() in the same sandboxed worker
    let output: EvaluateOutput
    try {
      output = await runner.evaluate(UPLOAD_SMOKE_INPUT)
    } catch (exc) {
      throw new Error(
        `js_module_smoke_failed: package evaluate() failed during smoke test (${exc instanceof Error ? exc.message : String(exc)})`,
      )
    }
    if (!isEvaluateOutputShape(output)) {
      throw new Error(
        'js_module_smoke_failed: package evaluate() did not return a valid object result during smoke test',
      )
    }

    // 3. Commit (only reached if both checks above passed)
    const committedManifest: PackageManifest = {
      ...manifest,
      algorithm: { ...manifest.algorithm, type: 'js_module' },
    }
    await packagesStore.put({
      id: committedManifest.id,
      manifest: committedManifest,
      origin: 'user',
      strategy: 'js_module',
      source,
    })

    return {
      id: committedManifest.id,
      version: committedManifest.version,
      label: committedManifest.label,
      algorithm_type: committedManifest.algorithm.type,
      compatible_scenario_types: committedManifest.compatible_scenario_types,
    }
  } finally {
    runner.terminate()
  }
}
