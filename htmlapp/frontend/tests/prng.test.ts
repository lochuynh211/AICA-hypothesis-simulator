import { describe, it, expect } from 'vitest'
import { makePrng } from '../src/engine/prng'

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
})
