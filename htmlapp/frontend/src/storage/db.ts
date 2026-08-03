import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { buildConfig } from '../config'
import { builtinPackages } from '../data/packages'
import type { PackageRecord } from '../data/types'
import { builtinScenarios } from '../data/scenarios'
import type { ScenarioDef } from '../api/types'
import type { MergedRunHandle } from '../engine/merged/types'

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

// Proposal run persistence (feature 026 C2 Task 4) — mirrors
// aica_api.services.proposal_run_manager's on-disk `<run_id>.json`.
// `ProposalRunHeader` holds every ProposalRunLog field EXCEPT the three
// append-only lists (events/evidence/explanations), which live in their own
// stores below — same split as `RunHeader`/`run_events` above. Kept loose
// here (storage layer); the typed domain shape lives in
// `../engine/proposal/run_manager.ts`.
export type ProposalRunHeader = { run_id: string; status: string; [k: string]: unknown }
export type ProposalRunEventRow = { runId: string; seq: number; [k: string]: unknown }
export type ProposalRunEvidenceRow = { runId: string; seq: number; [k: string]: unknown }
export type ProposalRunExplanationRow = { runId: string; seq: number; [k: string]: unknown }

interface AicaSchema extends DBSchema {
  packages: { key: string; value: PackageRecord }
  scenarios: { key: string; value: ScenarioRecord }
  runs: { key: string; value: RunHeader }
  run_events: { key: [string, number]; value: EvidenceEvent; indexes: { runId: string } }
  feedback: { key: [string, number]; value: FeedbackRecord; indexes: { runId: string } }
  settings: { key: string; value: unknown }
  driver_profiles: { key: string; value: DriverProfileRecord }
  proposal_runs: { key: string; value: ProposalRunHeader }
  proposal_run_events: { key: [string, number]; value: ProposalRunEventRow; indexes: { runId: string } }
  proposal_run_evidence: { key: [string, number]; value: ProposalRunEvidenceRow; indexes: { runId: string } }
  proposal_run_explanations: { key: [string, number]; value: ProposalRunExplanationRow; indexes: { runId: string } }
  merged_runs: { key: string; value: MergedRunHandle }
}

const DB_NAME = 'aica-hypothesis-simulator'
// v1 -> v2 (feature 026 C2 Task 1): added `driver_profiles` (user-saved
// proposal driver profiles — src/engine/proposal/stores.ts). oldVersion-gated
// so an existing v1 database only gains the new store; it never re-runs (or
// loses data from) the v1 stores it already has.
// v2 -> v3 (feature 026 C2 Task 4): added `proposal_runs` +
// `proposal_run_{events,evidence,explanations}` (proposal run persistence —
// ../engine/proposal/run_manager.ts). Same oldVersion-gating discipline: an
// existing v1 OR v2 database only gains the new stores, never loses data
// from stores it already has.
// v3 -> v4 (feature 026 C4 Task 3): added `merged_runs` (the merged-run
// join record — trigger run <-> the proposal runs its fires created; see
// ../engine/merged/types.ts's `MergedRunHandle` and
// ./merged_runs_store.ts). Same oldVersion-gating discipline: an existing
// v1, v2, OR v3 database only gains the new store, never loses data from
// stores it already has.
const DB_VERSION = 4

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
        if (oldVersion < 3) {
          db.createObjectStore('proposal_runs', { keyPath: 'run_id' })
          const pe = db.createObjectStore('proposal_run_events', { keyPath: ['runId', 'seq'] })
          pe.createIndex('runId', 'runId')
          const pv = db.createObjectStore('proposal_run_evidence', { keyPath: ['runId', 'seq'] })
          pv.createIndex('runId', 'runId')
          const px = db.createObjectStore('proposal_run_explanations', { keyPath: ['runId', 'seq'] })
          px.createIndex('runId', 'runId')
        }
        if (oldVersion < 4) {
          db.createObjectStore('merged_runs', { keyPath: 'merged_run_id' })
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
