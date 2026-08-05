import { describe, it, expect } from 'vitest'
import { buildEventTimeline, selectActiveEvent } from '../src/lib/merged/eventTimeline'
import type { MergedTimingModel } from '../src/lib/merged/eventTimeline'
import type { MergedInstantResult } from '../src/api/mergedClient'

// Minimal MergedInstantResult factory — only the fields buildEventTimeline reads
// need real values; the rest satisfy the type with inert defaults.
function result(partial: Partial<MergedInstantResult>): MergedInstantResult {
  return {
    fired: true,
    fire: null,
    fires: [],
    peak_score: 0,
    threshold: null,
    score_series: [],
    progress: [],
    monotony_series: [],
    monotony_threshold: null,
    spikes: [],
    segments: [],
    traffic_jams: [],
    rest_spot: null,
    rest_option: null,
    rest_spots: [],
    rest_options: [],
    completed_min: null,
    seed: 42,
    overrides: [],
    error: null,
    ...partial,
  } as MergedInstantResult
}

describe('buildEventTimeline — route duration', () => {
  it('excludes parked dwell but keeps driving time (jam slow-driving counts)', () => {
    // completed_min 330 includes a 30m parked nap → driving route = 300.
    const m = buildEventTimeline(result({
      completed_min: 330,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))
    expect(m.routeDrivingMin).toBe(300)
  })

  it('falls back to last progress minute minus parked when completed_min is null', () => {
    const m = buildEventTimeline(result({
      completed_min: null,
      progress: [{ t: 0, min: 0, frac: 0 }, { t: 100, min: 330, frac: 1 }] as never,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))
    expect(m.routeDrivingMin).toBe(300)
  })

  it('falls back to route-facts duration when completed_min and progress are absent', () => {
    const m = buildEventTimeline(result({ completed_min: null, progress: [] }), 300)
    expect(m.routeDrivingMin).toBe(300)
  })

  it('returns null route duration when nothing is available', () => {
    expect(buildEventTimeline(result({ completed_min: null }), null).routeDrivingMin).toBeNull()
  })

  it('returns an empty model for a null result', () => {
    expect(buildEventTimeline(null)).toEqual({ routeDrivingMin: null, events: [] })
  })

  it('includes jam slow-driving in D but excludes parked rest dwell', () => {
    // completed_min 300 already includes the jam's slow-driving minutes (the
    // car is moving, not parked) — traffic_jams must not reduce D. Only the
    // 30m parked nap (150→180) is subtracted: D = 300 - 30 = 270.
    const m = buildEventTimeline(result({
      completed_min: 300,
      traffic_jams: [{ from_min: 60, to_min: 90 }],
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))
    expect(m.routeDrivingMin).toBe(270)
  })
})

describe('buildEventTimeline — events', () => {
  it('labels categories, orders by minute, and computes driving-only arrive-in', () => {
    // Route D = completed 330 − 30 parked = 300.
    // Monotony @120 (no parked before) → drive elapsed 120 → arrive 180.
    // Rest begins @150, restart @180.
    // Restart @180: the whole 30m nap (150→180) is parked-before → drive elapsed
    // 180 − 30 = 150 → arrive 300 − 150 = 150.
    // Safety @240 (30 parked before) → drive elapsed 210 → arrive 90.
    const m = buildEventTimeline(result({
      completed_min: 330,
      progress: [
        { t: 0, min: 0, frac: 0 }, { t: 40, min: 120, frac: 0.4 },
        { t: 50, min: 150, frac: 0.5 }, { t: 60, min: 180, frac: 0.5 },
        { t: 80, min: 240, frac: 0.8 },
      ] as never,
      fires: [
        { category: 'monotony_prevention', strength: 'high', tick: 40, time_min: 120 } as never,
        { category: 'rest_required', strength: 'high', tick: 80, time_min: 240 } as never,
      ],
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))

    expect(m.routeDrivingMin).toBe(300)
    expect(m.events.map((e) => [e.kind, e.whenMin, e.arriveInMin])).toEqual([
      ['monotony_trigger', 120, 180],
      ['rest_begin', 150, null],
      ['rest_restart', 180, 150],
      ['safety_trigger', 240, 90],
    ])
  })

  it('reports fire ticks as reachTick', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      fires: [{ category: 'rest_required', strength: 'high', tick: 40, time_min: 120 } as never],
    }))
    expect(m.events[0].reachTick).toBe(40)
  })

  it('drops the arrive-in / restart for a rest that never completed (to_min null)', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: null } as never],
    }))
    const kinds = m.events.map((e) => e.kind)
    expect(kinds).toContain('rest_begin')
    expect(kinds).not.toContain('rest_restart')
  })

  it('ignores rest options that never recovered (recovery_from_min null)', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: null, to_min: null } as never],
    }))
    expect(m.events).toHaveLength(0)
  })
})

describe('selectActiveEvent', () => {
  const model: MergedTimingModel = {
    routeDrivingMin: 300,
    events: [
      { kind: 'monotony_trigger', whenMin: 40, arriveInMin: 260, reachTick: 20 },
      { kind: 'rest_begin', whenMin: 120, arriveInMin: null, reachTick: 45 },
      { kind: 'rest_restart', whenMin: 150, arriveInMin: 180, reachTick: 55 },
      { kind: 'safety_trigger', whenMin: 240, arriveInMin: 60, reachTick: 80 },
    ],
  }

  it('returns the trigger matching an inspected/defaulted fireTick', () => {
    expect(selectActiveEvent(model, { fireTick: 80 })?.whenMin).toBe(240)
    expect(selectActiveEvent(model, { fireTick: 20 })?.kind).toBe('monotony_trigger')
  })

  it('returns null when fireTick matches no trigger', () => {
    expect(selectActiveEvent(model, { fireTick: 999 })).toBeNull()
  })

  it('never selects a rest boundary via fireTick (rest ticks are ineligible)', () => {
    // reachTick 45 is a rest_begin — not a trigger, so no active event.
    expect(selectActiveEvent(model, { fireTick: 45 })).toBeNull()
  })

  it('during a live run returns the most-recently-reached trigger', () => {
    expect(selectActiveEvent(model, { livePos: 30 })?.whenMin).toBe(40)  // past fire#0, before fire#1
    expect(selectActiveEvent(model, { livePos: 90 })?.whenMin).toBe(240) // past both
  })

  it('returns null during a live run before the first trigger is reached', () => {
    expect(selectActiveEvent(model, { livePos: 5 })).toBeNull()
  })

  it('prefers an explicit fireTick over livePos', () => {
    // Clicking fire#0 while the run has advanced past fire#1 → show fire#0.
    expect(selectActiveEvent(model, { fireTick: 20, livePos: 90 })?.whenMin).toBe(40)
  })

  it('returns null when neither fireTick nor livePos is given', () => {
    expect(selectActiveEvent(model, {})).toBeNull()
  })
})
