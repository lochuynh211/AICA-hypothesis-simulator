// app/frontend/tests/review_vocabulary.test.ts
import { domainGroup, groupLabel, phrase, bandWord } from '../src/lib/review/reviewVocabulary'

describe('domainGroup', () => {
  it('buckets driver-state features', () => {
    expect(domainGroup('drowsiness')).toBe('driver_state')
    expect(domainGroup('fatigue')).toBe('driver_state')
    expect(domainGroup('driving_anomaly')).toBe('driver_state')
  })

  it('buckets road and environment features', () => {
    expect(domainGroup('monotony')).toBe('road_environment')
    expect(domainGroup('env_load')).toBe('road_environment')
    expect(domainGroup('rest_window')).toBe('road_environment')
  })

  it('buckets preference and history features', () => {
    expect(domainGroup('oshi_affinity')).toBe('preferences_history')
    expect(domainGroup('recent_play_penalty')).toBe('preferences_history')
    expect(domainGroup('familiar_route')).toBe('preferences_history')
  })

  it('buckets content-property features', () => {
    expect(domainGroup('song_arousal')).toBe('content_properties')
    expect(domainGroup('song_valence')).toBe('content_properties')
  })

  it('falls back to other for an unrecognised feature', () => {
    expect(domainGroup('some_future_feature')).toBe('other')
  })
})

describe('groupLabel', () => {
  it('is bilingual for every group', () => {
    const groups = ['driver_state', 'road_environment', 'preferences_history', 'content_properties', 'other'] as const
    for (const g of groups) {
      const label = groupLabel(g)
      expect(label.ja.length).toBeGreaterThan(0)
      expect(label.en.length).toBeGreaterThan(0)
      expect(label.ja).not.toBe(label.en)
    }
  })
})

describe('phrase', () => {
  it('reads as plain language, not as an identifier', () => {
    expect(phrase('monotony').en).toBe('how monotonous the road is')
    expect(phrase('fatigue').en).toBe('how tired the driver is')
  })

  it('is bilingual', () => {
    expect(phrase('monotony').ja).not.toBe(phrase('monotony').en)
  })

  it('returns the raw id for an unknown feature rather than inventing prose', () => {
    expect(phrase('unknown_feature')).toEqual({ ja: 'unknown_feature', en: 'unknown_feature' })
  })
})

describe('bandWord', () => {
  it('prefers the recorded band over the derived one', () => {
    expect(bandWord('very_high', 0.1).en).toBe('very high')
  })

  it('derives a band from the value when none was recorded', () => {
    expect(bandWord(null, 0.9).en).toBe('very high')
    expect(bandWord(null, 0.5).en).toBe('moderate')
    expect(bandWord(null, 0.05).en).toBe('very low')
  })

  it('is bilingual', () => {
    expect(bandWord(null, 0.9).ja).not.toBe(bandWord(null, 0.9).en)
  })
})
