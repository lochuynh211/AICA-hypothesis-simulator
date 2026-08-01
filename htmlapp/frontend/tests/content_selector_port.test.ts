import { describe, it } from 'vitest'
import { evaluate } from '../src/data/packages/builtin/aica_transparent_content_selector_v1'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

describe('aica_transparent_content_selector_v1 parity', () => {
  it('reproduces Python evaluate() byte-for-byte over the representative case set', () => {
    const { input, output } = loadFixture('content_selector')
    input.cases.forEach((c: any, i: number) => {
      const dec = evaluate(c.context)
      expectParity(dec, output.results[i].decision, `case[${i}] (${c.name})`)
    })
  })
})
