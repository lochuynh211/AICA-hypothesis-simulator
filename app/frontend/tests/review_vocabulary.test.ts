// app/frontend/tests/review_vocabulary.test.ts
import { domainGroup, groupLabel, phrase, bandWord, GROUP_MEMBERS, PHRASES } from '../src/lib/review/reviewVocabulary'

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
  const groups = ['driver_state', 'road_environment', 'preferences_history', 'content_properties', 'other'] as const

  it('is bilingual for every group', () => {
    for (const g of groups) {
      const label = groupLabel(g)
      expect(label.ja.length).toBeGreaterThan(0)
      expect(label.en.length).toBeGreaterThan(0)
      expect(label.ja).not.toBe(label.en)
    }
  })

  it('gives every group a DISTINCT label', () => {
    // Without this, a stub returning one hardcoded pair for every group passes
    // the test above in full, and a copy-paste when a sixth group is added
    // would collapse two groups' labels together undetected.
    expect(new Set(groups.map((g) => groupLabel(g).en)).size).toBe(groups.length)
    expect(new Set(groups.map((g) => groupLabel(g).ja)).size).toBe(groups.length)
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

  it('has a phrase for EVERY feature that belongs to a real group', () => {
    // A grouped feature with no phrase falls back to its raw identifier, which
    // puts the identifier on screen as the label — the one thing the design
    // says it must never be. Tasks 12 and 13 call phrase() on every chain row,
    // and service/content chains carry exactly these ids.
    const grouped = Object.values(GROUP_MEMBERS).flat()
    const unphrased = grouped.filter((id) => phrase(id).en === id)
    expect(unphrased).toEqual([])
  })
})

describe('PHRASES — degree-framed English must not pair with yes/no-framed Japanese', () => {
  // `bandWord()` appends a strength word ("非常に高い" / "very high") after the
  // phrase. An English phrase framed by DEGREE ("how suited the song is to
  // full karaoke") paired with a Japanese phrase framed by YES/NO ("フルカラ
  // オケ向きかどうか" — "whether it's suited to full karaoke") produces
  // "whether X: very high", which is ungrammatical nonsense — this is the
  // class of bug MUST FIX 3 fixed for `recent_play_penalty`/`full_karaoke_ease`.
  // This test catches the CLASS, not just those two instances, so a future
  // phrase added the same way fails immediately instead of shipping.
  it('has no entry where the English is "how …"-framed but the Japanese ends in かどうか', () => {
    const offenders = Object.entries(PHRASES)
      .filter(([, label]) => /^how\b/.test(label.en) && label.ja.endsWith('かどうか'))
      .map(([id]) => id)
    expect(offenders).toEqual([])
  })

  it('still allows a genuinely yes/no-framed pair (English also "whether …")', () => {
    // Guards against an overzealous fix that bans かどうか outright — it is
    // correct when EN is ALSO whether-framed (child_passenger, night_state,
    // motion_state, oshi_mode), just not when EN is degree-framed.
    expect(PHRASES.night_state.ja.endsWith('かどうか')).toBe(true)
    expect(PHRASES.night_state.en.startsWith('whether')).toBe(true)
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
