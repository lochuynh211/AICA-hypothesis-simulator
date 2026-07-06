import { describe, it, expect } from 'vitest'
import { makePrng, seededUniform, subseed } from '../src/engine/prng'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

describe('prng', () => {
  it('is deterministic for a fixed seed', () => {
    const a = makePrng(42), b = makePrng(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })
  it('differs across seeds', () => {
    expect(makePrng(1)()).not.toEqual(makePrng(2)())
  })

  // Feature 009: bit-parity with CPython random.Random(sha256-subseed).random().
  it('matches Python seeded_uniform / _subseed byte-for-byte', () => {
    const { input, output } = loadFixture('prng')
    const cases = input.cases as Array<{ run_seed: number; tick: number; channel: string }>
    const results = output.results as Array<{ subseed: string; uniform: number }>
    cases.forEach((c, i) => {
      expect(subseed(c.run_seed, c.tick, c.channel).toString(), `subseed[${i}] ${JSON.stringify(c)}`)
        .toBe(results[i].subseed)
      expectParity(seededUniform(c.run_seed, c.tick, c.channel), results[i].uniform, `uniform[${i}]`)
    })
  })
})
