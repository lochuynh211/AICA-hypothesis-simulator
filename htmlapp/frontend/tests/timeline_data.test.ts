// htmlapp/frontend/tests/timeline_data.test.ts
//
// Port of app/frontend/tests/timeline_data.test.ts's distance-axis coverage —
// `mergedInstantResultToTimeline` maps a merged quickview projection onto the
// route-fraction axis so its fires/curve/rest markers line up with the
// distance-axis live animation.
import { describe, it, expect } from 'vitest'
import { mergedInstantResultToTimeline } from '../src/components/playback/timelineData'
import type { MergedInstantResult } from '../src/api/mergedClient'

describe('mergedInstantResultToTimeline — distance (route_fraction) axis via progress', () => {
  // A run where TIME and DISTANCE diverge: 80% of the route is covered in the
  // first 10 min, then the car PARKS for a rest (min 20-30, distance flat at
  // 0.8), then finishes.
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
  } as unknown as MergedInstantResult

  it('plots the fire at its DISTANCE route_fraction (0.8), not its time fraction (0.25)', () => {
    const d = mergedInstantResultToTimeline(merged)
    expect(d.fires).toHaveLength(1)
    expect(d.fires[0].x).toBeCloseTo(0.8)
  })

  it('collapses a stopped-rest span (flat distance) to a single route position', () => {
    const d = mergedInstantResultToTimeline(merged)
    expect(d.restDots).toEqual([0.8])
  })

  it('fixbug-0806: labels the rest dot with the ARRIVAL minute (first tick at the spot), not recovery-start', () => {
    // The car reaches frac 0.8 at min 10 (arrival), but `recovery_from_min` is
    // 20 (resting begins a tick later, once STOPPED). The `@ N min` label must
    // read the arrival — the same rule the live chart uses — so the projection
    // and the live animation agree on when the car reached the rest spot.
    const d = mergedInstantResultToTimeline(merged)
    expect(d.restDotTimes).toEqual([10])
  })
})
