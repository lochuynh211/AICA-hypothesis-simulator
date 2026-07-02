import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { evaluate as hybridEvaluate, type HybridEvaluateInput } from '../src/data/packages/builtin/aica_transparent_hybrid_trigger_v1'

type FixtureCase = {
  input: Omit<HybridEvaluateInput, 'package_runtime_state'> & { package_runtime_state: Record<string, unknown> }
  output: Record<string, unknown>
}

describe('aica_transparent_hybrid_trigger_v1 TS port parity', () => {
  // Captured from a FULL run of the real Python package (app/api venv) —
  // packages/aica_transparent_hybrid_trigger_v1/algorithm.py driven through
  // python_module.dispatch() against scenario uc01_fatigue_recovery_v0_1 —
  // see src/engine/__fixtures__/parity/aica_transparent_hybrid_trigger_v1.json's
  // capture notes (task-hybrid-port-report.md) for the exact venv script.
  // 222 dispatch() calls captured over 223 driven ticks (run completes on the
  // 223rd tick, a no-op with no dispatch call), threading the evolving
  // package_runtime_state end to end (smoothed features/scores, persistence
  // counters, skip-if bypass, category state machines, fire-control,
  // cooldown, recovery reset). result_type counts: NO_PROPOSAL x203,
  // SUPPRESSED x18, REST_PROPOSAL x1 (fired once, accepted via nap_karaoke).
  const cases = loadFixture('aica_transparent_hybrid_trigger_v1') as unknown as FixtureCase[]

  it('reproduces the full stateful run tick-by-tick', () => {
    let runtimeState: Record<string, unknown> = {}
    for (const c of cases) {
      const out = hybridEvaluate({ ...c.input, package_runtime_state: runtimeState })
      expectParity(out, c.output)
      runtimeState = (out.next_package_runtime_state as Record<string, unknown>) ?? runtimeState
    }
  })
})
