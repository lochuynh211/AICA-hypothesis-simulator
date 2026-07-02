import type { PackageManifest } from '../../api/types'
import nri from './nri_fatigue_score_v1.json'
import hybrid from './aica_transparent_hybrid_trigger_v1.json'

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
