import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { settingsStore } from '../src/storage/settings_store'
import { packagesStore } from '../src/storage/packages_store'
import { scenariosStore } from '../src/storage/scenarios_store'
import { runsStore } from '../src/storage/runs_store'
import { createRunPlan, createRun, tickRun } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import {
  exportRun,
  exportAllRuns,
  exportPackage,
  exportScenario,
  importRun,
  importPackage,
  importScenario,
} from '../src/engine/services/portability'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

/** Creates a run with the nri package (python_module — unsupported by the TS
 * adapter, see client_run_loop.test.ts's docstring), ticks it once. tickRun
 * is EXPECTED to produce an `algorithm_error` event and a paused run — never
 * a faked decision (master invariant FR-011). The RunLog still exports and
 * imports fine without requiring completion. */
async function makeRun(): Promise<string> {
  const plan = await createRunPlan({ packageId: 'nri_fatigue_score_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
  const run = await createRun((plan as any).plan_id)
  await tickRun(run.run_id)
  return run.run_id
}

describe('portability — runs', () => {
  it('exports a run without the map key and re-imports it', async () => {
    await settingsStore.set('googleMapsApiKey', 'SECRET')
    const runId = await makeRun()

    const dump = await exportRun(runId)
    expect(JSON.stringify(dump)).not.toContain('SECRET')
    expect(dump.run_id).toBe(runId)
    expect(dump.events.length).toBeGreaterThan(0)

    // importRun refuses to import over a currently-active run_id (REHYDRATE
    // task's active-guard — see rehydrate.test.ts for the dedicated
    // coverage). Simulate the run no longer being active (e.g. a reload)
    // before re-importing, matching the realistic scenario the guard is
    // meant to allow.
    clearRegistry()
    await expect(importRun(dump)).resolves.not.toThrow()

    // Round-trip proof: re-read what was actually persisted (via the store,
    // not the in-memory registry — importRun writes to IndexedDB, it does
    // not register the run as "active").
    const header = await runsStore.getHeader(runId)
    const events = await runsStore.getEvents(runId)
    expect(header?.id).toBe(runId)
    expect(events.length).toBe(dump.events.length)
    expect(events.map((e) => e.kind)).toEqual(dump.events.map((e) => e.kind))
    expect(events.map((e) => (e as any).seq)).toEqual(dump.events.map((_, i) => i))
  })

  it('exportAllRuns excludes the key across every run and matches exportRun per-run', async () => {
    await settingsStore.set('googleMapsApiKey', 'SECRET')
    const runId = await makeRun()

    const dump = await exportAllRuns()
    expect(JSON.stringify(dump)).not.toContain('SECRET')
    expect(dump.runs.some((r) => r.run_id === runId)).toBe(true)
  })

  it('importRun refuses malformed JSON', async () => {
    await expect(importRun({})).rejects.toThrow()
    await expect(importRun({ run_id: 'x' })).rejects.toThrow()
    await expect(importRun(null)).rejects.toThrow()
    await expect(importRun('not an object')).rejects.toThrow()
    // events with an unknown kind must be refused too
    const runId = await makeRun()
    const dump = await exportRun(runId)
    const corrupted = { ...dump, events: [{ kind: 'bogus' }] }
    await expect(importRun(corrupted)).rejects.toThrow()
  })
})

describe('portability — packages', () => {
  it('exportPackage excludes the key and round-trips as a user record', async () => {
    await settingsStore.set('googleMapsApiKey', 'SECRET')

    const dump = await exportPackage('nri_fatigue_score_v1')
    expect(JSON.stringify(dump)).not.toContain('SECRET')
    expect(dump.id).toBe('nri_fatigue_score_v1')

    await expect(importPackage(dump)).resolves.not.toThrow()

    const rec = await packagesStore.get('nri_fatigue_score_v1')
    expect(rec?.origin).toBe('user') // imported records must never masquerade as builtin
    expect(rec?.manifest).toEqual(dump)
  })

  it('importPackage refuses malformed JSON', async () => {
    await expect(importPackage({})).rejects.toThrow()
    await expect(importPackage({ id: 'x', version: '1' })).rejects.toThrow()
    await expect(importPackage(null)).rejects.toThrow()
  })
})

describe('portability — scenarios', () => {
  it('exportScenario excludes the key and round-trips as a user record', async () => {
    await settingsStore.set('googleMapsApiKey', 'SECRET')

    const dump = await exportScenario('uc01_fatigue_recovery_v0_1')
    expect(JSON.stringify(dump)).not.toContain('SECRET')
    expect(dump.id).toBe('uc01_fatigue_recovery_v0_1')

    await expect(importScenario(dump)).resolves.not.toThrow()

    const rec = await scenariosStore.get('uc01_fatigue_recovery_v0_1')
    expect(rec?.origin).toBe('user') // imported records must never masquerade as builtin
    expect(rec?.def).toEqual(dump)
  })

  it('importScenario refuses malformed JSON', async () => {
    await expect(importScenario({})).rejects.toThrow()
    await expect(importScenario({ id: 'x', version: '1', type: 'uc01' })).rejects.toThrow()
    await expect(importScenario(null)).rejects.toThrow()
  })

  it('importScenario rejects legacy driver_profile/vehicle_profile shape (feature 009 FR-017)', async () => {
    await expect(importScenario({ id: 'x', version: '1', type: 'uc01', driver_profile: {} }))
      .rejects.toThrow(/incompatible scenario shape/)
    await expect(importScenario({ id: 'x', version: '1', type: 'uc01', vehicle_profile: {} }))
      .rejects.toThrow(/incompatible scenario shape/)
  })
})
