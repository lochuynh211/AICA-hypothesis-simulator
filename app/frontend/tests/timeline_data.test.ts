// app/frontend/tests/timeline_data.test.ts
import { describe, it, expect } from 'vitest'
import { instantResultToTimeline, timelineYDomain } from '../src/components/playback/timelineData'
import type { InstantResult } from '../src/api/types'

const base: InstantResult = {
  fired: true,
  fire: { category: 'rest_required', strength: 'clear', tick: 2, time_min: 20 },
  fires: [{ category: 'rest_required', strength: 'clear', tick: 2, time_min: 20 }],
  peak_score: 0.8,
  threshold: 0.6,
  score_series: [
    { t: 0, score: 0.1 },
    { t: 1, score: 0.4 },
    { t: 2, score: 0.8 },
  ],
  monotony_series: [
    { t: 0, score: 0.2 },
    { t: 2, score: 0.5 },
  ],
  monotony_threshold: 0.7,
  spikes: [{ t: 1, time_min: 10 }],
  segments: [
    { type: 'highway', from_min: 0, to_min: 20 },
    { type: 'mountain_road', from_min: 20, to_min: 40 },
  ],
  rest_spot: null,
  rest_option: { id: 'rest_a', auto_chosen: true, recovery_from_min: 30, to_min: 35 },
  rest_options: [{ id: 'rest_a', auto_chosen: true, recovery_from_min: 30, to_min: 35 }],
  completed_min: 40,
  seed: 1,
  overrides: [],
  error: null,
}

describe('instantResultToTimeline', () => {
  it('normalizes score series x to 0–1 by tick max', () => {
    const d = instantResultToTimeline(base)
    expect(d.restScore.map((p) => p.x)).toEqual([0, 0.5, 1])
    expect(d.restScore.map((p) => p.y)).toEqual([0.1, 0.4, 0.8])
  })

  it('emits a second monotony curve when present', () => {
    const d = instantResultToTimeline(base)
    expect(d.monotonyScore).toHaveLength(2)
    expect(d.monotonyThreshold).toBe(0.7)
  })

  it('normalizes segment/fire/rest/spike/completion x to 0–1 by minute or tick max', () => {
    const d = instantResultToTimeline(base)
    expect(d.segments).toEqual([
      { fromX: 0, toX: 0.5, type: 'highway' },
      { fromX: 0.5, toX: 1, type: 'mountain_road' },
    ])
    expect(d.fires).toEqual([{ x: 0.5, kind: 'rest' }]) // 20/40 min
    expect(d.spikes).toEqual([0.5]) // tick 1 / 2
    expect(d.restDots).toEqual([0.75]) // 30/40 min
    expect(d.completionX).toBe(1)
    expect(d.recoveryWindows).toEqual([{ fromX: 0.75, toX: 0.875 }])
  })

  it('leaves monotony empty and threshold null for a single-curve (NRI) result', () => {
    const nri: InstantResult = { ...base, monotony_series: [], monotony_threshold: null }
    const d = instantResultToTimeline(nri)
    expect(d.monotonyScore).toEqual([])
    expect(d.monotonyThreshold).toBeNull()
  })

  it('y-domain fits both curves and both thresholds with padding', () => {
    const d = instantResultToTimeline(base)
    const { yMin, yMax } = timelineYDomain(d)
    expect(yMin).toBeLessThanOrEqual(0.1)
    expect(yMax).toBeGreaterThanOrEqual(0.8)
  })
})
