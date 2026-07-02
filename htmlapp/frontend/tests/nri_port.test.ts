import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { evaluate as nriEvaluate, type NriEvaluateInput } from '../src/data/packages/builtin/nri_fatigue_score_v1'

type FixtureCase = {
  input: Omit<NriEvaluateInput, 'package_runtime_state'> & { package_runtime_state: Record<string, unknown> }
  output: Record<string, unknown>
}

describe('nri_fatigue_score_v1 TS port parity', () => {
  // Captured from a FULL run of the real Python package (app/api venv) —
  // packages/nri_fatigue_score_v1/algorithm.py driven through
  // python_module.dispatch() against scenario uc01_fatigue_recovery_v0_1 —
  // see src/engine/__fixtures__/parity/nri_fatigue_score_v1.json's capture
  // notes (task-S9.3-report.md) for the exact venv script. 113 ticks,
  // threading the evolving package_runtime_state end to end (score
  // accumulation, dead-zone thresholds, night/familiar multipliers,
  // fire-control, persistence-ticks, cooldown, recovery reset).
  const cases = loadFixture('nri_fatigue_score_v1') as unknown as FixtureCase[]

  it('reproduces the full stateful run tick-by-tick', () => {
    let runtimeState: Record<string, unknown> = {}
    for (const c of cases) {
      const out = nriEvaluate({ ...c.input, package_runtime_state: runtimeState })
      expectParity(out, c.output)
      runtimeState = (out.next_package_runtime_state as Record<string, unknown>) ?? runtimeState
    }
  })
})
