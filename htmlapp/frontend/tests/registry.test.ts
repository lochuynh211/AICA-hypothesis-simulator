import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installRegistry,
  ensureRegistry,
  resetRegistryForTests,
  DataRegistryError,
  getPresets,
  getPreset,
  getCombinedCases,
  getScenarioDefs,
  getRoutePresetDocs,
  getPackageManifests,
  getMatrix,
  getDatasetIds,
  getDataset,
} from '../src/data/registry'

const REAL = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

/** Structurally valid minimum, used for negative cases. */
function minimal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    combinedCases: { c: { case_id: 'c' } },
    presets: { p: { preset_id: 'p' } },
    profiles: { pr: { profile_id: 'pr' } },
    seeds: { s: { seed_id: 's' } },
    scenarios: { sc: { id: 'sc' } },
    routePresets: { r: { id: 'r' } },
    packageManifests: { pk: { id: 'pk' } },
    matrix: { matrix_version: '1' },
    dispositions: { registry_version: '1' },
    serviceCapabilities: { capabilities_version: '1' },
    datasets: { d: { manifest: { dataset_id: 'd' }, catalog: {}, genreAffinity: null } },
    ...overrides,
  }
}

beforeEach(() => {
  resetRegistryForTests()
  delete (globalThis as any).__AICA_DATA__
})

describe('installRegistry', () => {
  it('accepts the real generated payload', () => {
    expect(() => installRegistry(REAL)).not.toThrow()
    expect(getPresets().length).toBeGreaterThan(0)
  })

  it('rejects a null payload with a readable error', () => {
    expect(() => installRegistry(null)).toThrow(DataRegistryError)
  })

  it('lists EVERY missing key, not just the first', () => {
    const broken = minimal()
    delete (broken as any).presets
    delete (broken as any).scenarios
    delete (broken as any).matrix
    try {
      installRegistry(broken)
      throw new Error('expected throw')
    } catch (e) {
      const problems = (e as DataRegistryError).problems
      expect(problems.some((p) => p.includes('presets'))).toBe(true)
      expect(problems.some((p) => p.includes('scenarios'))).toBe(true)
      expect(problems.some((p) => p.includes('matrix'))).toBe(true)
    }
  })

  it('rejects a schema_version it does not understand', () => {
    expect(() => installRegistry(minimal({ schema_version: 99 }))).toThrow(DataRegistryError)
  })

  it('rejects an empty id-keyed collection', () => {
    expect(() => installRegistry(minimal({ presets: {} }))).toThrow(DataRegistryError)
  })

  it('rejects a record whose id does not match its key', () => {
    expect(() => installRegistry(minimal({ presets: { p: { preset_id: 'MISMATCH' } } }))).toThrow(
      DataRegistryError,
    )
  })
})

describe('ensureRegistry', () => {
  it('installs from globalThis.__AICA_DATA__', () => {
    ;(globalThis as any).__AICA_DATA__ = REAL
    expect(ensureRegistry().schema_version).toBe(1)
  })

  it('throws a readable error when the bundle never loaded', () => {
    try {
      ensureRegistry()
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(DataRegistryError)
      expect((e as DataRegistryError).problems.join(' ')).toMatch(/aica-data\.js/)
    }
  })

  it('is memoized — a later global change does not take effect', () => {
    ;(globalThis as any).__AICA_DATA__ = REAL
    const first = ensureRegistry()
    ;(globalThis as any).__AICA_DATA__ = minimal()
    expect(ensureRegistry()).toBe(first)
  })
})

describe('accessors', () => {
  beforeEach(() => installRegistry(REAL))

  it('throws when the registry is not installed', () => {
    resetRegistryForTests()
    expect(() => getPresets()).toThrow(DataRegistryError)
  })

  it('returns collections as arrays in sorted-key order', () => {
    const ids = getPresets().map((p: any) => p.preset_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('looks records up by id and returns null for unknown ids', () => {
    const first: any = getPresets()[0]
    expect(getPreset(first.preset_id)).toEqual(first)
    expect(getPreset('no-such-preset')).toBeNull()
  })

  it('exposes every collection', () => {
    expect(getCombinedCases().length).toBeGreaterThan(0)
    expect(getScenarioDefs().length).toBeGreaterThan(0)
    expect(getRoutePresetDocs().length).toBeGreaterThan(0)
    expect(getPackageManifests().length).toBeGreaterThan(0)
    expect(getMatrix()).toBeTruthy()
    expect(getDatasetIds().length).toBeGreaterThan(0)
    expect(getDataset(getDatasetIds()[0])).toBeTruthy()
    expect(getDataset('nope')).toBeNull()
  })
})
