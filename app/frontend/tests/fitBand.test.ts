import { describe, it, expect } from 'vitest'
import { fitBand } from '../src/lib/fitBand'

describe('fitBand', () => {
  it('maps raw=-1 to 0 (floor endpoint)', () => {
    expect(fitBand(-1)).toBe(0)
  })

  it('maps raw=0 to 50 (midpoint)', () => {
    expect(fitBand(0)).toBe(50)
  })

  it('maps raw=+0.386 to 69.3 (worked example)', () => {
    expect(fitBand(0.386)).toBeCloseTo(69.3, 5)
  })

  it('maps raw=+1 to 100 (ceiling endpoint)', () => {
    expect(fitBand(1)).toBe(100)
  })

  it('clamps a raw value below -1 to 0', () => {
    expect(fitBand(-1.5)).toBe(0)
    expect(fitBand(-2)).toBe(0)
  })

  it('clamps a raw value above +1 to 100', () => {
    expect(fitBand(1.5)).toBe(100)
    expect(fitBand(2)).toBe(100)
  })

  it('is stable: equal raw inputs always yield equal bands', () => {
    expect(fitBand(0.25)).toBe(fitBand(0.25))
  })
})
