import { describe, it, expect } from 'vitest'
import { formatDuration } from '../src/lib/formatDuration'

describe('formatDuration', () => {
  it('formats hours and minutes (en)', () => {
    expect(formatDuration(320, 'en')).toBe('5h 20m')
    expect(formatDuration(320, 'ja')).toBe('5時間20分')
  })

  it('drops a zero minute part', () => {
    expect(formatDuration(300, 'en')).toBe('5h')
    expect(formatDuration(300, 'ja')).toBe('5時間')
  })

  it('drops a zero hour part', () => {
    expect(formatDuration(20, 'en')).toBe('20m')
    expect(formatDuration(20, 'ja')).toBe('20分')
  })

  it('rounds to whole minutes', () => {
    expect(formatDuration(89.6, 'en')).toBe('1h 30m')
    expect(formatDuration(0.4, 'en')).toBe('0m')
  })

  it('shows zero as 0m / 0分', () => {
    expect(formatDuration(0, 'en')).toBe('0m')
    expect(formatDuration(0, 'ja')).toBe('0分')
  })

  it('guards null / NaN / negative to an em dash', () => {
    expect(formatDuration(null, 'en')).toBe('—')
    expect(formatDuration(undefined, 'en')).toBe('—')
    expect(formatDuration(NaN, 'en')).toBe('—')
    expect(formatDuration(-5, 'en')).toBe('—')
  })
})
