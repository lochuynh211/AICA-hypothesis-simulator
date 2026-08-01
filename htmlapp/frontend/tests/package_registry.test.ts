import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { packageRegistry } from '../src/engine/services/package_registry'
import { ensureRegistry } from '../src/data/registry'
import type { PackageManifest, ScenarioDef } from '../src/api/types'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await seedDefaults()
})

function minimalManifest(overrides: Partial<PackageManifest>): PackageManifest {
  return {
    id: 'test_pkg',
    version: '1.0.0',
    label: { ja: 'テスト', en: 'test' },
    compatible_scenario_types: ['uc01_fatigue'],
    algorithm: { type: 'python_module', entrypoint: 'evaluate' },
    parameters: [],
    features: [],
    hyperparameters: [],
    trigger_categories: [],
    rules: [],
    fire_control: { threshold_source: '', actionability_guard: {} },
    proposals: [],
    feedback_schema: [],
    evidence_metrics: [],
    ...overrides,
  } as PackageManifest
}

describe('packageRegistry.isCompatible (fix round 2: Critical — reachable outside React)', () => {
  it('returns true when the scenario type is in the package compat list', () => {
    const pkg = minimalManifest({ compatible_scenario_types: ['uc01_fatigue', 'uc02_monotony'] })
    const scenario = { type: 'uc02_monotony' } as unknown as ScenarioDef
    expect(packageRegistry.isCompatible(pkg, scenario)).toBe(true)
  })

  it('returns false when the scenario type is absent from the compat list', () => {
    const pkg = minimalManifest({ compatible_scenario_types: ['uc01_fatigue'] })
    const scenario = { type: 'proposal_content' } as unknown as ScenarioDef
    expect(packageRegistry.isCompatible(pkg, scenario)).toBe(false)
  })

  it('returns false (not throw) for a manifest with a MISSING compatible_scenario_types', () => {
    // ScenarioSelector.tsx calls `.includes(...)` unguarded during render —
    // this is the defensive fallback for the same field reached outside
    // React (e.g. a worker dispatch()), where nothing upstream guards it.
    const pkg = minimalManifest({}) as PackageManifest
    delete (pkg as unknown as Record<string, unknown>)['compatible_scenario_types']
    const scenario = { type: 'uc01_fatigue' } as unknown as ScenarioDef
    expect(() => packageRegistry.isCompatible(pkg, scenario)).not.toThrow()
    expect(packageRegistry.isCompatible(pkg, scenario)).toBe(false)
  })

  it('returns false (not throw) for a manifest with a non-array compatible_scenario_types', () => {
    const pkg = minimalManifest({ compatible_scenario_types: null as unknown as string[] })
    const scenario = { type: 'uc01_fatigue' } as unknown as ScenarioDef
    expect(() => packageRegistry.isCompatible(pkg, scenario)).not.toThrow()
    expect(packageRegistry.isCompatible(pkg, scenario)).toBe(false)
  })
})

describe('packageRegistry.listSummaries (fix round 2: errors surfaced, not hardcoded [])', () => {
  it('surfaces bundled-manifest load errors instead of an empty array', async () => {
    const { packages, errors } = await packageRegistry.listSummaries()
    expect(packages.length).toBeGreaterThan(0)
    expect(errors.length).toBeGreaterThan(0)
    const sources = errors.map((e) => e.source)
    expect(sources).toContain('aica_transparent_service_selector_v1')
    expect(sources).toContain('mock_service_selector_v1')
    expect(sources).toContain('mock_content_selector_v1')
    for (const e of errors) expect(e.message).toMatch(/compatible_scenario_types/)
  })

  it('never surfaces a seeded package as its own error (seedDefaults only seeds valid manifests)', async () => {
    const { packages, errors } = await packageRegistry.listSummaries()
    const seededIds = new Set(packages.map((p) => p.id))
    const errorSources = new Set(errors.map((e) => e.source))
    for (const id of seededIds) expect(errorSources.has(id)).toBe(false)
  })
})
