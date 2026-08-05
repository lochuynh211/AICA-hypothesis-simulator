/**
 * buildEventTimeline — derive the Combined screen's timing model from a merged
 * quickview projection. Display-only (no decision logic): it reshapes data the
 * backend already produced.
 *
 *   • routeDrivingMin — overall DRIVING-only route duration: total elapsed minus
 *     all parked rest dwell. Slow-driving through a jam still counts (it is time
 *     the car was moving); a parked nap does not.
 *   • events — the projected schedule (triggers + rest boundaries), ascending by
 *     wall-clock minute, with per-event driving-only "arrive in" remaining.
 *
 * The same projection feeds quickview AND animation (the coordinator preserves
 * `quickviewResult` across run creation and playback), so this one builder serves
 * both modes; the reached-marker is applied by the panel against the live tick.
 */
import type { MergedInstantResult } from '../../api/mergedClient'

export type MergedTimingEventKind = 'monotony_trigger' | 'safety_trigger' | 'rest_begin' | 'rest_restart'

export type MergedTimingEvent = {
  kind: MergedTimingEventKind
  whenMin: number
  arriveInMin: number | null
  reachTick: number | null
}

export type MergedTimingModel = {
  routeDrivingMin: number | null
  events: MergedTimingEvent[]
}

type RestWindow = { from: number; to: number | null }

/** Recovered rests only (recovery_from_min set) — the same predicate the panel
 * uses for clickable after-nap dots. */
function recoveredRests(result: MergedInstantResult): RestWindow[] {
  return (result.rest_options ?? [])
    .filter((o) => o.recovery_from_min != null)
    .map((o) => ({ from: o.recovery_from_min as number, to: o.to_min }))
}

/** Total parked dwell across all completed rest windows. */
function parkedTotal(rests: RestWindow[]): number {
  return rests.reduce((sum, r) => (r.to != null ? sum + Math.max(0, r.to - r.from) : sum), 0)
}

/** Parked minutes accumulated at-or-before wall-clock minute `w`. Partial rests
 * (w falls inside the window) count only the elapsed portion. */
function parkedBefore(rests: RestWindow[], w: number): number {
  return rests.reduce((sum, r) => {
    if (r.to == null) return sum
    return sum + Math.max(0, Math.min(r.to, w) - r.from)
  }, 0)
}

/** The tick whose projected minute is nearest `min`, or null when no progress. */
function nearestTick(result: MergedInstantResult, min: number): number | null {
  const progress = result.progress ?? []
  if (progress.length === 0) return null
  let best = progress[0]
  let bestDelta = Math.abs(progress[0].min - min)
  for (const p of progress) {
    const d = Math.abs(p.min - min)
    if (d < bestDelta) {
      best = p
      bestDelta = d
    }
  }
  return best.t
}

const KIND_ORDER: Record<MergedTimingEventKind, number> = {
  monotony_trigger: 0,
  safety_trigger: 0,
  rest_begin: 1,
  rest_restart: 2,
}

export function buildEventTimeline(
  result: MergedInstantResult | null | undefined,
  routeFactsDurationMin?: number | null,
): MergedTimingModel {
  if (result == null) return { routeDrivingMin: null, events: [] }

  const rests = recoveredRests(result)
  const parked = parkedTotal(rests)

  // Overall driving-only route duration, with an explicit fallback chain.
  let routeDrivingMin: number | null
  const progress = result.progress ?? []
  if (result.completed_min != null) {
    routeDrivingMin = result.completed_min - parked
  } else if (progress.length > 0) {
    routeDrivingMin = progress[progress.length - 1].min - parked
  } else if (routeFactsDurationMin != null) {
    routeDrivingMin = routeFactsDurationMin
  } else {
    routeDrivingMin = null
  }

  const arriveIn = (w: number): number | null => {
    if (routeDrivingMin == null) return null
    const drivingElapsed = w - parkedBefore(rests, w)
    return Math.max(0, routeDrivingMin - drivingElapsed)
  }

  const events: MergedTimingEvent[] = []

  for (const f of result.fires ?? []) {
    events.push({
      kind: f.category === 'rest_required' ? 'safety_trigger' : 'monotony_trigger',
      whenMin: f.time_min,
      arriveInMin: arriveIn(f.time_min),
      reachTick: f.tick,
    })
  }

  for (const r of rests) {
    events.push({
      kind: 'rest_begin',
      whenMin: r.from,
      arriveInMin: null,
      reachTick: nearestTick(result, r.from),
    })
    if (r.to != null) {
      events.push({
        kind: 'rest_restart',
        whenMin: r.to,
        arriveInMin: arriveIn(r.to),
        reachTick: nearestTick(result, r.to),
      })
    }
  }

  events.sort((a, b) => a.whenMin - b.whenMin || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return { routeDrivingMin, events }
}
