import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { buildConfig } from '../config'
import { builtinPackages } from '../data/packages'
import type { PackageRecord } from '../data/types'
import { builtinScenarios } from '../data/scenarios'
import type { ScenarioDef } from '../api/types'

export type ScenarioRecord = { id: string; def: ScenarioDef; origin: 'builtin' | 'user' }
export type RunHeader = { id: string; status: string; [k: string]: unknown }
export type EvidenceEvent = { seq: number; type: string; [k: string]: unknown }
export type FeedbackRecord = { seq: number; [k: string]: unknown }
// Mirrors aica_api.models.proposal.world.DriverProfileRecord — only ever a
// USER-saved profile (builtin=false); built-in profiles come from the C0
// data registry (getProfiles()/getProfile()) and are never written here. See
// src/engine/proposal/stores.ts#driverProfileStore.
export type DriverProfileRecord = {
  profile_id: string
  label: { ja: string; en: string }
  builtin: boolean
  profile: Record<string, unknown>
}

interface AicaSchema extends DBSchema {
  packages: { key: string; value: PackageRecord }
  scenarios: { key: string; value: ScenarioRecord }
  runs: { key: string; value: RunHeader }
  run_events: { key: [string, number]; value: EvidenceEvent; indexes: { runId: string } }
  feedback: { key: [string, number]; value: FeedbackRecord; indexes: { runId: string } }
  settings: { key: string; value: unknown }
  driver_profiles: { key: string; value: DriverProfileRecord }
}

const DB_NAME = 'aica-hypothesis-simulator'
// v1 -> v2 (feature 026 C2 Task 1): added `driver_profiles` (user-saved
// proposal driver profiles — src/engine/proposal/stores.ts). oldVersion-gated
// so an existing v1 database only gains the new store; it never re-runs (or
// loses data from) the v1 stores it already has.
const DB_VERSION = 2

let _dbPromise: Promise<IDBPDatabase<AicaSchema>> | null = null
// Track which IDBFactory instance was used so tests that replace globalThis.indexedDB
// get a fresh connection rather than the cached one from a prior factory.
let _idbRef: IDBFactory | null = null

export function getDb(): Promise<IDBPDatabase<AicaSchema>> {
  const currentIdb = globalThis.indexedDB as IDBFactory
  if (!_dbPromise || _idbRef !== currentIdb) {
    _idbRef = currentIdb
    _dbPromise = openDB<AicaSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('packages', { keyPath: 'id' })
          db.createObjectStore('scenarios', { keyPath: 'id' })
          db.createObjectStore('runs', { keyPath: 'id' })
          const ev = db.createObjectStore('run_events', { keyPath: ['runId', 'seq'] })
          ev.createIndex('runId', 'runId')
          const fb = db.createObjectStore('feedback', { keyPath: ['runId', 'seq'] })
          fb.createIndex('runId', 'runId')
          db.createObjectStore('settings')
        }
        if (oldVersion < 2) {
          db.createObjectStore('driver_profiles', { keyPath: 'profile_id' })
        }
      },
    })
  }
  return _dbPromise
}

/** Idempotent: seeds builtins if absent, preserves user records. */
export async function seedDefaults(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['packages', 'scenarios', 'settings'], 'readwrite')
  for (const rec of builtinPackages()) {
    const existing = await tx.objectStore('packages').get(rec.id)
    if (!existing || existing.origin === 'builtin') await tx.objectStore('packages').put(rec)
  }
  for (const def of builtinScenarios()) {
    const rec: ScenarioRecord = { id: def.id, def, origin: 'builtin' }
    const existing = await tx.objectStore('scenarios').get(rec.id)
    if (!existing || existing.origin === 'builtin') await tx.objectStore('scenarios').put(rec)
  }
  const keyStore = tx.objectStore('settings')
  const haveKey = await keyStore.get('googleMapsApiKey')
  if (haveKey === undefined && buildConfig.googleMapsApiKey) {
    await keyStore.put(buildConfig.googleMapsApiKey, 'googleMapsApiKey')
  }
  await tx.done
}

/** Re-seed builtins, dropping builtin overrides; keeps user records + settings. */
export async function resetToDefaults(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['packages', 'scenarios'], 'readwrite')
  for (const store of ['packages', 'scenarios'] as const) {
    const all = await tx.objectStore(store).getAll()
    for (const r of all) if ((r as any).origin === 'builtin') await tx.objectStore(store).delete((r as any).id)
  }
  await tx.done
  await seedDefaults()
}
