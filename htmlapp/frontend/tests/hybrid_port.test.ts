import { describe, it } from 'vitest'
import { evaluate } from '../src/data/packages/builtin/aica_transparent_hybrid_trigger_v1'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

describe('aica_transparent_hybrid_trigger_v1 parity', () => {
  it('reproduces Python evaluate() byte-for-byte over a full run', () => {
    const { input, output } = loadFixture('aica_transparent_hybrid_trigger_v1')
    let state: Record<string, unknown> = {}
    input.ticks.forEach((tick: any, i: number) => {
      const ctx = { ...tick, package_runtime_state: state }
      const dec = evaluate(ctx)
      expectParity(dec, output.decisions[i], `tick[${i}]`)
      state = dec.next_package_runtime_state
    })
  })
})
