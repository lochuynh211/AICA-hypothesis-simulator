import { describe, expect, it } from 'vitest'
import { dispatchSelector, SCHEMA_VERSION, type AlgorithmEvidence, type SelectorEvaluator } from '../src/engine/proposal/selector'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { ensureRegistry } from '../src/data/registry'
import { proposalPackageRegistry } from '../src/engine/proposal/stores'

/**
 * Parity + TS-logic tests — reproduces `dispatch_selector()` (`services/
 * proposal_selector.py`, C2 Task 3) byte-for-byte over the cases captured
 * from the real Python function (see `scripts/gen/capture_all.py#
 * _capture_proposal_selector_dispatch`) for its SUCCESS branches, plus
 * direct assertions (labelled TS-logic, not parity — see the task report's
 * hazard/branch notes) for every failure branch: an unregistered package id,
 * an unported (`mock_*`) package id, a real thrown exception, and the two
 * branches no real ported evaluator can reach on its own
 * (invalid_result_shape, candidate_outside_allowed_set), exercised via
 * `dispatchSelector`'s injectable `options.evaluators` testability seam.
 * Per-branch coverage table and hazard verdicts are in the task report.
 */

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

function realPackage(id: string): Record<string, unknown> {
  const pkg = proposalPackageRegistry.get(id)
  if (!pkg) throw new Error(`test setup: package '${id}' not found in the real registry`)
  return pkg
}

describe('dispatchSelector parity (real committed packages, both families)', () => {
  it('reproduces dispatch_selector() success shaping over the captured service + content cases', () => {
    const { input, output } = loadFixture('proposal_selector_dispatch')

    input.cases.forEach((c: any, i: number) => {
      const pkg = c.package as Record<string, unknown>
      const evidence = dispatchSelector(pkg, c.context, {
        matrixVersion: c.matrix_version,
        usedFeatureIds: c.used_feature_ids,
        allowedServiceIds: c.allowed_service_ids,
        evidenceInputSnapshot: c.evidence_input_snapshot,
      })
      // Direct parity, no normalizer: dispatchSelector's production code
      // now replicates the one pydantic bool->float artefact itself (see
      // coerceServiceFeatureValueBooleanArtefact in selector.ts), so the
      // real dispatch output should already match the golden byte-for-byte.
      expectParity(evidence, output.results[i].evidence, `case[${i}] (${c.name})`)
    })
  })

  it('stamps the fixed SCHEMA_VERSION constant on both captured cases', () => {
    const { output } = loadFixture('proposal_selector_dispatch')
    output.results.forEach((r: any) => {
      expect(r.evidence.schema_version).toBe(SCHEMA_VERSION)
      expect(SCHEMA_VERSION).toBe('1.0.0')
    })
  })
})

describe('dispatchSelector — failure branches (TS-logic, direct assertions)', () => {
  it('unknown package id -> missing_evaluate, output null, error set, step still derived from family', () => {
    const pkg = { id: 'totally_unknown_package_xyz', family: 'service_selector', contract_version: '1.0.0' }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1' })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('missing_evaluate')
    expect(evidence.output).toBeNull()
    expect(evidence.step).toBe('service')
    expect(evidence.package_id).toBe('totally_unknown_package_xyz')
    expect(evidence.contract_version).toBe('1.0.0')
    expect(evidence.schema_version).toBe(SCHEMA_VERSION)
    expect(evidence.matrix_version).toBe('v1')
    expect(evidence.input_snapshot).toEqual({})
    expect(evidence.used_feature_ids).toEqual([])
    expect(evidence.unused_available_features).toEqual([])
    expect(evidence.missing_features).toEqual([])
  })

  it('unported mock_* package id (mock_service_selector_v1) -> missing_evaluate, never a crash or silent empty result', () => {
    const pkg = realPackage('mock_service_selector_v1')
    const evidence = dispatchSelector(pkg, { allowed_service_ids: ['music_playlist'] }, { matrixVersion: 'v1' })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('missing_evaluate')
    expect(evidence.error?.message).toMatch(/no ported evaluate/i)
    expect(evidence.output).toBeNull()
    expect(evidence.step).toBe('service')
  })

  it('unported mock_* package id (mock_content_selector_v1) -> same missing_evaluate treatment, content family', () => {
    const pkg = realPackage('mock_content_selector_v1')
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1' })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('missing_evaluate')
    expect(evidence.output).toBeNull()
    expect(evidence.step).toBe('content')
  })

  it('real ported evaluator throwing (invalid trigger_purpose) -> algorithm_exception, output null', () => {
    // Mirrors the real Python repro (captured manually while building this
    // port): dispatch_selector(aica_transparent_service_selector_v1 package,
    // {...worked_example, trigger_purpose: 'not_a_real_purpose'}, ...) ->
    // error.category == 'algorithm_exception', message ==
    // "invalid trigger_purpose: 'not_a_real_purpose'". Message TEXT is not
    // asserted byte-for-byte (JSON.stringify vs. Python repr quoting — see
    // the task report's hazard notes); category and the never-fabricated
    // shape are.
    const pkg = realPackage('aica_transparent_service_selector_v1')
    const { input } = loadFixture('service_selector')
    const context = { ...input.cases[0].context, trigger_purpose: 'not_a_real_purpose' }

    const evidence = dispatchSelector(pkg, context, { matrixVersion: 'v1' })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('algorithm_exception')
    expect(evidence.error?.message).toMatch(/trigger_purpose/)
    expect(evidence.output).toBeNull()
    expect(evidence.step).toBe('service')
  })

  it('non-object return -> invalid_result_shape (via the evaluators injection seam; no real evaluator can hit this)', () => {
    const pkg = { id: 'fake_non_object_return', family: 'service_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_non_object_return: (() => ['not', 'an', 'object']) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1', evaluators: fakeEvaluators })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('invalid_result_shape')
    expect(evidence.error?.message).toMatch(/ServiceSelectorOutput/)
    expect(evidence.output).toBeNull()
  })

  it('null return -> invalid_result_shape too (null is typeof "object" in JS — must not be mistaken for a valid output)', () => {
    const pkg = { id: 'fake_null_return', family: 'content_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_null_return: (() => null) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1', evaluators: fakeEvaluators })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('invalid_result_shape')
    expect(evidence.error?.message).toMatch(/CompletePlan/)
    expect(evidence.output).toBeNull()
  })

  it('candidate outside allowed_service_ids (ranked_candidates) -> candidate_outside_allowed_set', () => {
    const pkg = { id: 'fake_bad_candidate', family: 'service_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_bad_candidate: (() => ({
        decision_type: 'ranked_candidates',
        ranked_candidates: [{ candidate_id: 'not_allowed_service', rank: 1 }],
        excluded_candidates: [],
        unused_available_features: [],
        missing_features: [],
      })) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(
      pkg,
      { excluded_candidates: [] },
      { matrixVersion: 'v1', allowedServiceIds: ['music_playlist'], evaluators: fakeEvaluators },
    )

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('candidate_outside_allowed_set')
    expect(evidence.error?.message).toContain('not_allowed_service')
    expect(evidence.output).toBeNull()
  })

  it('excluded_candidates: a platform-excluded id (echoed from context) is exempt from the allowed-set check', () => {
    const pkg = { id: 'fake_platform_excluded', family: 'service_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_platform_excluded: (() => ({
        decision_type: 'ranked_candidates',
        ranked_candidates: [{ candidate_id: 'music_playlist', rank: 1 }],
        excluded_candidates: [{ candidate_id: 'quiz', platform_reason: 'not_available_this_trip' }],
        unused_available_features: [],
        missing_features: [],
      })) as unknown as SelectorEvaluator,
    }
    // 'quiz' is echoed back from context.excluded_candidates (platform
    // exclusion) and is NOT in allowed_service_ids — must NOT trip the guard.
    const evidence = dispatchSelector(
      pkg,
      { excluded_candidates: [{ candidate_id: 'quiz', platform_reason: 'not_available_this_trip' }] },
      { matrixVersion: 'v1', allowedServiceIds: ['music_playlist'], evaluators: fakeEvaluators },
    )

    expect(evidence.error).toBeNull()
    expect(evidence.output).not.toBeNull()
  })

  it('allowedServiceIds omitted (null/undefined) skips the check entirely, even with an out-of-set candidate', () => {
    const pkg = { id: 'fake_no_allowed_check', family: 'service_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_no_allowed_check: (() => ({
        decision_type: 'ranked_candidates',
        ranked_candidates: [{ candidate_id: 'anything_at_all', rank: 1 }],
        excluded_candidates: [],
        unused_available_features: [],
        missing_features: [],
      })) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1', evaluators: fakeEvaluators })

    expect(evidence.error).toBeNull()
    expect(evidence.output).not.toBeNull()
  })

  it('content family ignores allowedServiceIds entirely, even when set and the output has no candidate_id shape', () => {
    const pkg = { id: 'fake_content_ignores_allowed', family: 'content_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_content_ignores_allowed: (() => ({
        decision_type: 'complete_plan',
        selected_service_id: 'music_playlist',
        ordered_items: [],
        unused_available_features: [],
        missing_features: [],
      })) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(
      pkg,
      {},
      { matrixVersion: 'v1', allowedServiceIds: ['this_would_exclude_everything'], evaluators: fakeEvaluators },
    )

    expect(evidence.error).toBeNull()
    expect(evidence.output).not.toBeNull()
    expect(evidence.step).toBe('content')
  })

  it('a thrown non-Error value is stringified rather than crashing dispatch', () => {
    const pkg = { id: 'fake_throws_string', family: 'service_selector', contract_version: '9.9.9' }
    const fakeEvaluators: Record<string, SelectorEvaluator> = {
      fake_throws_string: (() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom (not an Error instance)'
      }) as unknown as SelectorEvaluator,
    }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1', evaluators: fakeEvaluators })

    expect(evidence.error).not.toBeNull()
    expect(evidence.error?.category).toBe('algorithm_exception')
    expect(evidence.error?.message).toContain('boom (not an Error instance)')
    expect(evidence.output).toBeNull()
  })

  it('an unknown family value defaults to the content step, mirroring _step_for_family exactly', () => {
    const pkg = { id: 'fake_garbage_family', family: 'not_a_real_family', contract_version: '9.9.9' }
    const evidence = dispatchSelector(pkg, {}, { matrixVersion: 'v1' })
    expect(evidence.step).toBe('content')
    expect(evidence.error?.category).toBe('missing_evaluate')
  })

  it('a failure evidence never carries a truthy output alongside error — the never-fabricated-result invariant', () => {
    const cases: AlgorithmEvidence[] = [
      dispatchSelector({ id: 'unknown_a', family: 'service_selector', contract_version: '1' }, {}, { matrixVersion: 'v1' }),
      dispatchSelector(realPackage('mock_content_selector_v1'), {}, { matrixVersion: 'v1' }),
    ]
    for (const evidence of cases) {
      expect(evidence.error).not.toBeNull()
      expect(evidence.output).toBeNull()
    }
  })
})
