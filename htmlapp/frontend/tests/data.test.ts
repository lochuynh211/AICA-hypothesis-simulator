import { describe, it, expect } from 'vitest'
import { ensureRegistry } from '../src/data/registry'
import { builtinScenarios } from '../src/data/scenarios'
import { builtinPackages } from '../src/data/packages'
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
