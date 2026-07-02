import { describe, it, expect } from 'vitest'
import { buildConfig } from '../src/config'

describe('buildConfig', () => {
  it('exposes a googleMapsApiKey string', () => {
    expect(typeof buildConfig.googleMapsApiKey).toBe('string')
  })
})
