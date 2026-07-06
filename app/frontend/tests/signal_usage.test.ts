import { describe, it, expect } from 'vitest'
import type { FeatureDef } from '../src/api/types'
import { usedSignalKeys, SIGNAL_ROW_KEYS } from '../src/components/setup/signalUsage'

/** Manifest feature lists copied from the shipped package.json files. */
const HYBRID_FEATURES: FeatureDef[] = [
  'drowsiness',
  'fatigue',
  'driving_anomaly',
  'driving_time',
  'env_load',
  'monotony',
  'rest_window',
  'rest_scarcity',
  'familiar_route',
].map((key) => ({ key, band_values: [] }))

const NRI_FEATURES: FeatureDef[] = [
  'drowsiness',
  'fatigue',
  'driving_anomaly',
  'future_fatigue',
  'rest_window',
  'rest_scarcity',
  'monotony',
  'familiar_route',
  'attention_drop',
  'traffic_jam',
  'long_highway',
].map((key) => ({ key, band_values: [] }))

describe('usedSignalKeys', () => {
  it('returns ALL signals when no package is selected (dim nothing)', () => {
    const used = usedSignalKeys(null, undefined)
    expect(used.size).toBe(SIGNAL_ROW_KEYS.length)
    for (const key of SIGNAL_ROW_KEYS) expect(used.has(key)).toBe(true)
  })

  it('Compact Hybrid consumes every signal (dims nothing)', () => {
    const used = usedSignalKeys('aica_transparent_hybrid_trigger_v1', HYBRID_FEATURES)
    for (const key of SIGNAL_ROW_KEYS) expect(used.has(key)).toBe(true)
  })

  it('NRI consumes every signal except weatherRisk (no env_load feature, never linked)', () => {
    const used = usedSignalKeys('nri_fatigue_score_v1', NRI_FEATURES)
    expect(used.has('weatherRisk')).toBe(false)
    for (const key of SIGNAL_ROW_KEYS) {
      if (key === 'weatherRisk') continue
      expect(used.has(key)).toBe(true)
    }
  })

  it('unknown package with no features falls back to no feature-fed signals, only direct links', () => {
    // No template, no features → nothing is provably used → empty set (all dim).
    const used = usedSignalKeys('does_not_exist', [])
    expect(used.size).toBe(0)
  })
})
