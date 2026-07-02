import { describe, it, expect } from 'vitest'
import { DEFAULT_SCENARIOS } from '../src/data/scenarios'
import { DEFAULT_PACKAGES } from '../src/data/packages'

describe('bundled defaults', () => {
  it('loads at least one scenario with an id', () => {
    expect(DEFAULT_SCENARIOS.length).toBeGreaterThan(0)
    expect(DEFAULT_SCENARIOS[0].id).toBe('uc01_fatigue_recovery_v0_1')
  })
  it('loads packages tagged builtin', () => {
    expect(DEFAULT_PACKAGES.length).toBeGreaterThan(0)
    expect(DEFAULT_PACKAGES.every(p => p.origin === 'builtin')).toBe(true)
  })
})
