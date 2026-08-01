import { describe, it, expect } from 'vitest'
import { ensureRegistry } from '../src/data/registry'
import { builtinScenarios } from '../src/data/scenarios'
import { builtinPackages, builtinPackageErrors } from '../src/data/packages'
import { builtinManifestValidationError } from '../src/data/packages/validate'
import { routePresets } from '../src/data/routes'
import { BUILTIN_EVALUATORS, UNPORTED_BUILTINS } from '../src/data/builtinEvaluators'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

describe('registry-backed defaults', () => {
  it('loads scenarios from the registry', () => {
    const ids = builtinScenarios().map((s) => s.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('uc01_fatigue_recovery_v0_1')
  })

  it('loads packages from the registry, all tagged builtin', () => {
    const pkgs = builtinPackages()
    expect(pkgs.length).toBeGreaterThan(0)
    expect(pkgs.every((p) => p.origin === 'builtin')).toBe(true)
  })

  it('remaps python_module manifests onto the builtin_js_module strategy', () => {
    const nri = builtinPackages().find((p) => p.id === 'nri_fatigue_score_v1')
    expect(nri).toBeDefined()
    expect(nri!.strategy).toBe('builtin_js_module')
  })

  it('loads route presets from the registry', () => {
    const ids = routePresets().map((r) => r.id).sort()
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('long_tokyo_osaka')
  })

  it('keeps evaluators in SOURCE, keyed by package id', () => {
    expect(typeof BUILTIN_EVALUATORS.nri_fatigue_score_v1).toBe('function')
    expect(typeof BUILTIN_EVALUATORS.aica_transparent_hybrid_trigger_v1).toBe('function')
  })

  it('exposes an evaluator for every ported builtin_js_module package', () => {
    for (const pkg of builtinPackages()) {
      if (pkg.strategy !== 'builtin_js_module') continue
      if (UNPORTED_BUILTINS.has(pkg.id)) continue
      expect(BUILTIN_EVALUATORS[pkg.id], `no TS evaluator for ${pkg.id}`).toBeDefined()
    }
  })
})

describe('builtin manifest validation (fix round 2: Critical — unguarded compatible_scenario_types)', () => {
  // packages/*/package.json ships 6 manifests. 3 omit compatible_scenario_types
  // entirely: aica_transparent_service_selector_v1, mock_service_selector_v1,
  // mock_content_selector_v1. Python's PackageManifest model requires it
  // (non-empty), so these fail Pydantic validation and never reach the docker
  // app's PackageRegistry either — builtinPackages() must reproduce that.
  const KNOWN_INVALID_IDS = [
    'aica_transparent_service_selector_v1',
    'mock_service_selector_v1',
    'mock_content_selector_v1',
  ]
  const KNOWN_VALID_IDS = [
    'nri_fatigue_score_v1',
    'aica_transparent_hybrid_trigger_v1',
    // Has compatible_scenario_types (['proposal_content']) but no TS
    // evaluator yet (see UNPORTED_BUILTINS) — still a structurally VALID
    // manifest, must not be excluded by this validation pass.
    'aica_transparent_content_selector_v1',
  ]

  it('builtinPackages() excludes bundled manifests missing compatible_scenario_types', () => {
    const ids = builtinPackages().map((p) => p.id)
    for (const id of KNOWN_VALID_IDS) expect(ids, `expected ${id} to be included`).toContain(id)
    for (const id of KNOWN_INVALID_IDS) expect(ids, `expected ${id} to be excluded`).not.toContain(id)
  })

  it('builtinPackageErrors() names each excluded manifest and why', () => {
    const bySource = new Map(builtinPackageErrors().map((e) => [e.source, e.message]))
    for (const id of KNOWN_INVALID_IDS) {
      expect(bySource.has(id), `expected an error entry for ${id}`).toBe(true)
      expect(bySource.get(id)).toMatch(/compatible_scenario_types/)
    }
    for (const id of KNOWN_VALID_IDS) {
      expect(bySource.has(id), `valid manifest ${id} must not be reported as an error`).toBe(false)
    }
  })

  it('rejects a synthetic manifest with an EMPTY compatible_scenario_types (Python rejects empty, not just missing)', () => {
    // No committed manifest exercises this — build the payload directly
    // against the validator rather than mutating the installed registry.
    const wellFormedOtherwise = {
      id: 'synthetic_empty_compat',
      version: '1.0.0',
      label: { ja: 'テスト', en: 'test' },
      algorithm: { type: 'python_module' },
      compatible_scenario_types: [] as string[],
    }
    expect(builtinManifestValidationError(wellFormedOtherwise)).toMatch(/compatible_scenario_types/)

    // Sanity: the same payload with a non-empty array passes.
    const fixed = { ...wellFormedOtherwise, compatible_scenario_types: ['uc01_fatigue'] }
    expect(builtinManifestValidationError(fixed)).toBeNull()
  })
})
