import { describe, it } from 'vitest'
import { evaluate } from '../src/data/packages/builtin/nri_fatigue_score_v1'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

describe('nri_fatigue_score_v1 parity', () => {
  it('reproduces Python evaluate() byte-for-byte over a full run', () => {
    const { input, output } = loadFixture('nri_fatigue_score_v1')
    let state: Record<string, unknown> = {}
    input.ticks.forEach((tick: any, i: number) => {
      const ctx = { ...tick, package_runtime_state: state }
      const dec = evaluate(ctx)
      expectParity(dec, output.decisions[i], `tick[${i}]`)
      state = dec.next_package_runtime_state
    })
  })
})
