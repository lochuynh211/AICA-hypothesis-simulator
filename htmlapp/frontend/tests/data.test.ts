import { describe, it, expect } from 'vitest'
import { ensureRegistry, installRegistry, resetRegistryForTests, type AicaDataPayload } from '../src/data/registry'
import { builtinScenarios } from '../src/data/scenarios'
import { builtinPackages, builtinPackageErrors } from '../src/data/packages'
import { builtinManifestValidationError, isProposalFamilyManifest } from '../src/data/packages/validate'
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

describe('builtin manifest family routing + validation (fix round 3: family-routing, not validation)', () => {
  // packages/*/package.json ships 6 manifests. 4 carry a `kind`/`family`
  // field (aica_transparent_content_selector_v1, aica_transparent_service_selector_v1,
  // mock_content_selector_v1, mock_service_selector_v1) — these are
  // proposal-family packages, owned by a SEPARATE proposal package registry.
  // app/api/aica_api/services/package_registry.py skips them SILENTLY:
  //   if data.get("kind") is not None or data.get("family") is not None: continue
  // They are perfectly valid against their own ProposalPackageManifest
  // model; they were simply never trigger packages, and must never be
  // treated as malformed ones (round 2's premise — "the cutover exposes
  // manifests that fail validation" — was itself mistaken; see
  // ../src/data/packages/validate.ts's module doc). The remaining 2
  // (nri_fatigue_score_v1, aica_transparent_hybrid_trigger_v1) carry
  // neither field and are the only genuine trigger packages — exactly what
  // the htmlapp's old hand-copied DEFAULT_PACKAGES always held.
  const FAMILY_ROUTED_IDS = [
    'aica_transparent_content_selector_v1',
    'aica_transparent_service_selector_v1',
    'mock_content_selector_v1',
    'mock_service_selector_v1',
  ]
  const TRIGGER_IDS = ['nri_fatigue_score_v1', 'aica_transparent_hybrid_trigger_v1']

  it('builtinPackages() includes the trigger packages and excludes every family-bearing manifest', () => {
    const ids = builtinPackages().map((p) => p.id)
    for (const id of TRIGGER_IDS) expect(ids, `expected ${id} to be included`).toContain(id)
    for (const id of FAMILY_ROUTED_IDS) {
      expect(ids, `expected ${id} to be family-routed, not included`).not.toContain(id)
    }
  })

  it('builtinPackageErrors() is empty for the current committed data', () => {
    // A family-bearing manifest is SKIPPED, not errored — it belongs to a
    // different registry entirely, so none of the 4 family-routed ids may
    // ever appear here, and since the 2 genuine trigger packages are both
    // well-formed, the error list is empty on a normal boot. A non-empty
    // result here would put a permanent "N package(s) could not be loaded"
    // notice in front of the user for packages that are not actually broken
    // — exactly the regression the re-review caught in round 2.
    expect(builtinPackageErrors()).toEqual([])
  })

  it('a malformed TRIGGER-family manifest (no kind/family) is flagged by the validator itself (unit-level; see the end-to-end wiring test below for the real crash-path guard)', () => {
    const malformedTrigger = {
      id: 'synthetic_malformed_trigger',
      version: '1.0.0',
      label: { ja: 'テスト', en: 'test' },
      algorithm: { type: 'python_module' },
      // missing compatible_scenario_types entirely, and NO kind/family — a
      // genuine trigger-package defect, not a family-routing case.
    }
    expect(isProposalFamilyManifest(malformedTrigger)).toBe(false)
    expect(builtinManifestValidationError(malformedTrigger)).toMatch(/compatible_scenario_types/)
  })

  it("a malformed trigger-family manifest routed through the REAL registry wiring is excluded by builtinPackages() and reported by builtinPackageErrors() — proves the ScenarioSelector.tsx crash-path guard (index.ts's `.filter(...)`) is load-bearing, not just the validator functions in isolation", () => {
    // ScenarioSelector.tsx:34 does an unguarded
    // `selectedPackage.compatible_scenario_types.includes(...)`. That file is
    // synced verbatim from app/frontend and cannot be patched here — the ONLY
    // thing standing between a malformed manifest and a white-screen crash is
    // `builtinPackages()`'s `.filter((manifest) => builtinManifestValidationError(manifest) === null)`
    // in ../src/data/packages/index.ts. The test above only proves the
    // validator FUNCTIONS produce the right verdict for a hand-built object;
    // it never calls builtinPackages()/builtinPackageErrors(), so it would
    // stay green even if that `.filter(...)` were deleted. This test drives
    // the real registry (installRegistry/resetRegistryForTests), the same
    // entry points production code uses, to close that gap.
    const realPayload = (globalThis as Record<string, unknown>).__AICA_DATA__ as AicaDataPayload

    // Deep clone: mutate a copy, never the shared fixture object other tests
    // in this file (and process) depend on.
    const synthetic = JSON.parse(JSON.stringify(realPayload)) as AicaDataPayload
    const malformedId = 'synthetic_e2e_malformed_trigger'
    synthetic.packageManifests[malformedId] = {
      id: malformedId,
      version: '1.0.0',
      label: { ja: 'テスト', en: 'test' },
      algorithm: { type: 'python_module' },
      // No kind/family (so NOT family-routed) and no
      // compatible_scenario_types (so it must fail validation) — exactly the
      // shape that would reach ScenarioSelector.tsx's
      // `selectedPackage.compatible_scenario_types.includes(...)` and
      // white-screen the app if this guard were ever removed.
    }

    resetRegistryForTests()
    try {
      installRegistry(synthetic)

      const ids = builtinPackages().map((p) => p.id)
      expect(ids, 'a malformed manifest must never reach builtinPackages()').not.toContain(malformedId)

      const errors = builtinPackageErrors()
      expect(
        errors.some((e) => e.source === malformedId),
        'the same malformed manifest must be reported by builtinPackageErrors()',
      ).toBe(true)
    } finally {
      // Restore exactly what was installed before this test ran, so no other
      // test in this file (or run order) observes the synthetic manifest.
      resetRegistryForTests()
      installRegistry(realPayload)
    }
  })

  it('a manifest carrying family is routed away silently even when ALSO malformed by trigger standards', () => {
    const malformedButFamilyRouted = {
      id: 'synthetic_malformed_proposal',
      family: 'content_selector',
      // no version, no label, no algorithm, no compatible_scenario_types —
      // malformed by trigger standards, but that must never matter: family
      // routing happens BEFORE validation ever runs (see
      // ../src/data/packages/index.ts#triggerFamilyManifests, which filters
      // by isProposalFamilyManifest before builtinManifestValidationError is
      // ever called).
    }
    expect(isProposalFamilyManifest(malformedButFamilyRouted)).toBe(true)
    // Confirms it really IS malformed by trigger standards (not vacuously
    // true because the payload happens to be valid) — proving that it's the
    // routing check, not accidental validity, that keeps it out of errors.
    expect(builtinManifestValidationError(malformedButFamilyRouted)).not.toBeNull()
  })

  it('rejects a synthetic TRIGGER-family manifest with an EMPTY compatible_scenario_types (Python rejects empty, not just missing)', () => {
    // No committed manifest exercises this — build the payload directly
    // against the validator rather than mutating the installed registry.
    const wellFormedOtherwise = {
      id: 'synthetic_empty_compat',
      version: '1.0.0',
      label: { ja: 'テスト', en: 'test' },
      algorithm: { type: 'python_module' },
      compatible_scenario_types: [] as string[],
    }
    expect(isProposalFamilyManifest(wellFormedOtherwise)).toBe(false)
    expect(builtinManifestValidationError(wellFormedOtherwise)).toMatch(/compatible_scenario_types/)

    // Sanity: the same payload with a non-empty array passes.
    const fixed = { ...wellFormedOtherwise, compatible_scenario_types: ['uc01_fatigue'] }
    expect(builtinManifestValidationError(fixed)).toBeNull()
  })
})
