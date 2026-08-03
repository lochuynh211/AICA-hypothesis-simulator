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

describe('packageRegistry.listSummaries (fix round 2: errors wired up; fix round 3: family-routed manifests are not errors)', () => {
  it('returns an empty errors array for the current committed data', async () => {
    // Round 2 wired listSummaries()'s errors to builtinPackageErrors() on an
    // incorrect premise: that the 4 family-bearing manifests
    // (aica_transparent_content_selector_v1, aica_transparent_service_selector_v1,
    // mock_content_selector_v1, mock_service_selector_v1) fail Pydantic
    // validation in the docker app. They don't — package_registry.py routes
    // them SILENTLY to a separate proposal package registry before
    // validation ever runs (see src/data/packages/validate.ts's module doc).
    // None of the currently committed manifests are genuinely malformed
    // trigger packages, so `errors` must be empty here — a non-empty result
    // would show the user a permanent "N package(s) could not be loaded"
    // notice for packages that are not actually broken.
    const { packages, errors } = await packageRegistry.listSummaries()
    expect(packages.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  it('never surfaces a seeded package as its own error (seedDefaults only seeds valid trigger manifests)', async () => {
    const { packages, errors } = await packageRegistry.listSummaries()
    const seededIds = new Set(packages.map((p) => p.id))
    const errorSources = new Set(errors.map((e) => e.source))
    for (const id of seededIds) expect(errorSources.has(id)).toBe(false)
  })
})
