/**
 * registry — the ONLY reader of the generated data payload.
 *
 * The payload is installed either by `public/aica-data.js` (a <script> tag in
 * index.html, main thread) or by the `data.install` op (backend worker, whose
 * global scope a <script> tag cannot reach). Nothing else in the app touches
 * `globalThis.__AICA_DATA__`.
 *
 * Validation is fail-fast and exhaustive: every problem found is reported at
 * once, because a half-loaded registry surfaces later as a pile of unrelated
 * op failures that are far harder to diagnose than one honest boot error.
 */
import type { PackageManifest, ScenarioDef } from '../api/types'
import type { RoutePreset } from './types'

export const SUPPORTED_SCHEMA_VERSION = 1

export type CombinedCaseDoc = { case_id: string; [k: string]: unknown }
export type PresetDoc = { preset_id: string; [k: string]: unknown }
export type ProfileDoc = { profile_id: string; [k: string]: unknown }
export type SeedDoc = { seed_id: string; [k: string]: unknown }
export type DatasetEntry = {
  manifest: { dataset_id: string; [k: string]: unknown }
  catalog: unknown
  genreAffinity: unknown | null
}

export type AicaDataPayload = {
  schema_version: number
  combinedCases: Record<string, CombinedCaseDoc>
  presets: Record<string, PresetDoc>
  profiles: Record<string, ProfileDoc>
  seeds: Record<string, SeedDoc>
  scenarios: Record<string, ScenarioDef>
  routePresets: Record<string, RoutePreset>
  packageManifests: Record<string, PackageManifest>
  matrix: unknown
  dispositions: unknown
  serviceCapabilities: unknown
  datasets: Record<string, DatasetEntry>
}

export class DataRegistryError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`simulator data could not be loaded:\n  - ${problems.join('\n  - ')}`)
    this.name = 'DataRegistryError'
    this.problems = problems
  }
}

/** id-keyed collections: payload key -> the id field each record must carry. */
const ID_KEYED: ReadonlyArray<readonly [keyof AicaDataPayload, string]> = [
  ['combinedCases', 'case_id'],
  ['presets', 'preset_id'],
  ['profiles', 'profile_id'],
  ['seeds', 'seed_id'],
  ['scenarios', 'id'],
  ['routePresets', 'id'],
  ['packageManifests', 'id'],
]

const SINGLETONS: ReadonlyArray<keyof AicaDataPayload> = [
  'matrix',
  'dispositions',
  'serviceCapabilities',
]

let installed: AicaDataPayload | null = null

function validate(raw: unknown): string[] {
  const problems: string[] = []
  if (raw === null || typeof raw !== 'object') {
    return ['payload is not an object']
  }
  const p = raw as Record<string, unknown>

  if (p.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    problems.push(
      `schema_version is ${String(p.schema_version)}, this build supports ${SUPPORTED_SCHEMA_VERSION} — regenerate with 'npm run build:data'`,
    )
  }

  for (const [key, idField] of ID_KEYED) {
    const coll = p[key as string]
    if (coll === null || typeof coll !== 'object') {
      problems.push(`${String(key)}: missing or not an object`)
      continue
    }
    const entries = Object.entries(coll as Record<string, unknown>)
    if (entries.length === 0) {
      problems.push(`${String(key)}: is empty`)
      continue
    }
    for (const [id, doc] of entries) {
      if (doc === null || typeof doc !== 'object') {
        problems.push(`${String(key)}.${id}: not an object`)
        continue
      }
      const actual = (doc as Record<string, unknown>)[idField]
      if (actual !== id) {
        problems.push(`${String(key)}.${id}: '${idField}' is ${JSON.stringify(actual)}, expected ${JSON.stringify(id)}`)
      }
    }
  }

  for (const key of SINGLETONS) {
    const v = p[key as string]
    if (v === null || typeof v !== 'object') problems.push(`${String(key)}: missing or not an object`)
  }

  const datasets = p.datasets
  if (datasets === null || typeof datasets !== 'object') {
    problems.push('datasets: missing or not an object')
  } else {
    const entries = Object.entries(datasets as Record<string, unknown>)
    if (entries.length === 0) problems.push('datasets: is empty')
    for (const [id, entry] of entries) {
      const e = entry as Partial<DatasetEntry>
      if (!e || typeof e !== 'object') { problems.push(`datasets.${id}: not an object`); continue }
      if (!e.manifest || e.manifest.dataset_id !== id) {
        problems.push(`datasets.${id}: manifest.dataset_id does not match its key`)
      }
      if (e.catalog === undefined || e.catalog === null) problems.push(`datasets.${id}: missing catalog`)
    }
  }

  return problems
}

/** Validate and memoize `payload`. Throws DataRegistryError listing every problem. */
export function installRegistry(payload: unknown): void {
  const problems = validate(payload)
  if (problems.length) throw new DataRegistryError(problems)
  installed = payload as AicaDataPayload
}

/** Install from `globalThis.__AICA_DATA__` on first call, then memoize. */
export function ensureRegistry(): AicaDataPayload {
  if (installed) return installed
  const raw = (globalThis as Record<string, unknown>).__AICA_DATA__
  if (raw === undefined) {
    throw new DataRegistryError([
      "aica-data.js did not load — the <script src='./aica-data.js'> tag is missing, or the file was not generated (run 'npm run build:data')",
    ])
  }
  installRegistry(raw)
  return req()
}

export function resetRegistryForTests(): void {
  installed = null
}

function req(): AicaDataPayload {
  if (!installed) {
    throw new DataRegistryError(['registry not installed — call ensureRegistry() during boot'])
  }
  return installed
}

const values = <T,>(rec: Record<string, T>): T[] => Object.keys(rec).sort().map((k) => rec[k])
const one = <T,>(rec: Record<string, T>, id: string): T | null =>
  Object.prototype.hasOwnProperty.call(rec, id) ? rec[id] : null

export const getCombinedCases = (): CombinedCaseDoc[] => values(req().combinedCases)
export const getCombinedCase = (id: string): CombinedCaseDoc | null => one(req().combinedCases, id)
export const getPresets = (): PresetDoc[] => values(req().presets)
export const getPreset = (id: string): PresetDoc | null => one(req().presets, id)
export const getProfiles = (): ProfileDoc[] => values(req().profiles)
export const getProfile = (id: string): ProfileDoc | null => one(req().profiles, id)
export const getSeeds = (): SeedDoc[] => values(req().seeds)
export const getSeed = (id: string): SeedDoc | null => one(req().seeds, id)
export const getScenarioDefs = (): ScenarioDef[] => values(req().scenarios)
export const getScenarioDef = (id: string): ScenarioDef | null => one(req().scenarios, id)
export const getRoutePresetDocs = (): RoutePreset[] => values(req().routePresets)
export const getRoutePresetDoc = (id: string): RoutePreset | null => one(req().routePresets, id)
export const getPackageManifests = (): PackageManifest[] => values(req().packageManifests)
export const getPackageManifest = (id: string): PackageManifest | null => one(req().packageManifests, id)
export const getMatrix = (): unknown => req().matrix
export const getDispositions = (): unknown => req().dispositions
export const getServiceCapabilities = (): unknown => req().serviceCapabilities
export const getDatasetIds = (): string[] => Object.keys(req().datasets).sort()
export const getDataset = (id: string): DatasetEntry | null => one(req().datasets, id)
