/**
 * signalLabels — feature 009 UX-FE3.
 *
 * The registry is the single source of {ja,en} labels for every signal /
 * scenario-param / tier-3 generator-param key shown on the setup screen
 * (hyperparameters are excluded — they carry their own manifest label).
 */

import { describe, it, expect } from 'vitest'
import { t } from '../src/i18n/t'
import { SIGNAL_LABELS, signalLabel } from '../src/components/setup/signalLabels'

describe('signalLabels — feature 009 UX-FE3', () => {
  it('resolves both ja and en for a representative Fixed signal (isNight)', () => {
    expect(t(SIGNAL_LABELS.isNight, 'en')).toBe('Night')
    expect(t(SIGNAL_LABELS.isNight, 'ja')).toBe('夜間')
  })

  it('resolves both ja and en for a representative Dynamic signal (continuousDrivingMin)', () => {
    expect(signalLabel('continuousDrivingMin', 'en')).toBe('Continuous Driving (min)')
    expect(signalLabel('continuousDrivingMin', 'ja')).toBe('連続運転時間（分）')
  })

  it('resolves both ja and en for a representative Simulated signal (anomaly_rate)', () => {
    expect(signalLabel('anomaly_rate', 'en')).toBe('Anomaly Rate')
    expect(signalLabel('anomaly_rate', 'ja')).toBe('異常発生率')
  })

  it('resolves both ja and en for tier-3 generator params (lambda_base) — not the raw key', () => {
    expect(signalLabel('lambda_base', 'en')).not.toBe('lambda_base')
    expect(signalLabel('lambda_base', 'en')).toBe('Base Event Rate')
    expect(signalLabel('lambda_base', 'ja')).toBe('基本発生率')
  })

  it('resolves context params referenced by the tier-3 editor scope (child_passenger, familiar_route, weather_risk)', () => {
    expect(signalLabel('child_passenger', 'en')).toBe('Child Passenger')
    expect(signalLabel('familiar_route', 'en')).toBe('Familiar Route')
    expect(signalLabel('weather_risk', 'en')).toBe('Weather Risk')
  })

  it('falls back to the raw key for an unregistered key (never throws, never renders undefined)', () => {
    expect(signalLabel('totally_unregistered_key', 'en')).toBe('totally_unregistered_key')
  })
})
