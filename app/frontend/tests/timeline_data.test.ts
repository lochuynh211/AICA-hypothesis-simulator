// app/frontend/tests/timeline_data.test.ts
import { describe, it, expect } from 'vitest'
import { instantResultToTimeline, mergedInstantResultToTimeline, timelineYDomain } from '../src/components/playback/timelineData'
import type { InstantResult } from '../src/api/types'
import type { MergedInstantResult } from '../src/api/mergedClient'

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

  it('fixbug-0806: maps a jam with from_frac/to_frac straight through, bypassing the minute remap', () => {
    const withJam: InstantResult = {
      ...base,
      traffic_jams: [{ from_min: 18, to_min: 36, from_frac: 0.1667, to_frac: 0.3333 }],
    }
    const d = instantResultToTimeline(withJam)
    expect(d.trafficJams).toEqual([{ fromX: 0.1667, toX: 0.3333 }])
  })

  it('fixbug-0806: falls back to the minute remap when a jam has no from_frac/to_frac', () => {
    const withJam: InstantResult = {
      ...base,
      traffic_jams: [{ from_min: 20, to_min: 30 }],
    }
    const d = instantResultToTimeline(withJam)
    // minMax = completed_min (40) -> from_min 20/40 = 0.5, to_min 30/40 = 0.75
    expect(d.trafficJams).toEqual([{ fromX: 0.5, toX: 0.75 }])
  })
})

describe('mergedInstantResultToTimeline — distance (route_fraction) axis via progress', () => {
  // A run where TIME and DISTANCE diverge: 80% of the route is covered in the
  // first 10 min, then the car PARKS for a rest (min 20-30, distance flat at
  // 0.8), then finishes. On the time axis a fire at min 10 sits at 0.25; on the
  // distance axis it sits at 0.8 — the whole point of owner-review issue 2.
  const merged: MergedInstantResult = {
    fired: true,
    fire: { category: 'rest_required', strength: 'clear', tick: 1, time_min: 10 },
    fires: [{ category: 'rest_required', strength: 'clear', tick: 1, time_min: 10, proposal: null, proposal_error: null }],
    peak_score: 0.9,
    threshold: 0.6,
    score_series: [
      { t: 0, score: 0.1 },
      { t: 1, score: 0.4 },
      { t: 2, score: 0.8 },
      { t: 3, score: 0.8 },
      { t: 4, score: 0.9 },
    ],
    progress: [
      { t: 0, min: 0, frac: 0.0 },
      { t: 1, min: 10, frac: 0.8 },
      { t: 2, min: 20, frac: 0.8 },
      { t: 3, min: 30, frac: 0.8 },
      { t: 4, min: 40, frac: 1.0 },
    ],
    monotony_series: [],
    monotony_threshold: null,
    spikes: [],
    segments: [
      { type: 'highway', from_min: 0, to_min: 20 },
      { type: 'parking', from_min: 20, to_min: 30 },
    ],
    traffic_jams: [],
    rest_spot: null,
    rest_option: { id: 'r', auto_chosen: true, recovery_from_min: 20, to_min: 30, after_rest_proposal: null, after_rest_proposal_error: null },
    rest_options: [{ id: 'r', auto_chosen: true, recovery_from_min: 20, to_min: 30, after_rest_proposal: null, after_rest_proposal_error: null }],
    completed_min: 40,
    seed: 1,
    overrides: [],
    error: null,
  }

  it('plots the fire at its DISTANCE route_fraction (0.8), not its time fraction (0.25)', () => {
    const d = mergedInstantResultToTimeline(merged)
    expect(d.fires).toHaveLength(1)
    expect(d.fires[0].x).toBeCloseTo(0.8)
  })

  it('maps the score curve x onto route_fraction per tick', () => {
    const d = mergedInstantResultToTimeline(merged)
    expect(d.restScore.map((p) => p.x)).toEqual([0, 0.8, 0.8, 0.8, 1])
  })

  it('collapses a stopped-rest span (flat distance) to a single route position', () => {
    const d = mergedInstantResultToTimeline(merged)
    expect(d.restDots).toEqual([0.8])
    expect(d.recoveryWindows).toEqual([{ fromX: 0.8, toX: 0.8 }])
    // The parking segment (min 20-30) collapses too — the car isn't moving.
    expect(d.segments[1]).toEqual({ fromX: 0.8, toX: 0.8, type: 'parking' })
  })

  it('falls back to the TIME axis when progress is absent (older payloads)', () => {
    const d = mergedInstantResultToTimeline({ ...merged, progress: [] })
    // time axis: fire time_min 10 / completed_min 40 = 0.25
    expect(d.fires[0].x).toBeCloseTo(0.25)
  })

  it('fixbug-0806: a jam with from_frac/to_frac maps straight through, ignoring the minute→frac progress remap', () => {
    // Even though min 5-15 would remap to frac ~0.6-0.8 via `progress`, the
    // km-derived from_frac/to_frac (0.1667/0.3333) must win — this is the fix
    // for the wrong jam sub-bar position when time isn't linear in distance.
    const d = mergedInstantResultToTimeline({
      ...merged,
      traffic_jams: [{ from_min: 5, to_min: 15, from_frac: 0.1667, to_frac: 0.3333 }],
    })
    expect(d.trafficJams).toEqual([{ fromX: 0.1667, toX: 0.3333 }])
  })

  it('fixbug-0806: a jam without from_frac/to_frac falls back to the minute→frac progress remap', () => {
    const d = mergedInstantResultToTimeline({
      ...merged,
      traffic_jams: [{ from_min: 0, to_min: 10 }],
    })
    // minToFrac: min 0 -> frac 0, min 10 -> frac 0.8 (per the `progress` table above)
    expect(d.trafficJams).toEqual([{ fromX: 0, toX: 0.8 }])
  })
})
