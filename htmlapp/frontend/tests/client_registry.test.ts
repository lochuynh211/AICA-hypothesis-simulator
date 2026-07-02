import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { listPackages, getPackage, listScenarios, getScenario, getHealth } from '../src/api/client'

beforeEach(async () => { globalThis.indexedDB = new IDBFactory(); await seedDefaults() })

describe('client registry seam', () => {
  it('getHealth returns ok', async () => {
    expect((await getHealth()).status).toBe('ok')
  })
  it('listPackages returns seeded packages', async () => {
    const { packages, errors } = await listPackages()
    expect(packages.length).toBeGreaterThan(0)
    expect(Array.isArray(errors)).toBe(true)
  })
  it('getPackage returns a manifest', async () => {
    expect((await getPackage('nri_fatigue_score_v1')).id).toBe('nri_fatigue_score_v1')
  })
  it('listScenarios + getScenario round-trip', async () => {
    const { scenarios } = await listScenarios()
    expect(scenarios.length).toBeGreaterThan(0)
    expect((await getScenario('uc01_fatigue_recovery_v0_1')).id).toBe('uc01_fatigue_recovery_v0_1')
  })
})
