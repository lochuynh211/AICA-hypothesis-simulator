// app/frontend/src/components/playback/timelineData.ts
import type { InstantResult } from '../../api/types'
import type { MergedInstantResult } from '../../api/mergedClient'

export type TimelinePoint = { x: number; y: number }
export type TimelineFire = { x: number; kind: 'rest' | 'monotony' }
export type TimelineSegment = { fromX: number; toX: number; type: string | null }
/** A traffic-jam range in normalized [0,1] route-x (thin jam sub-bar). */
export type TimelineJam = { fromX: number; toX: number }

export type TimelineData = {
  segments: TimelineSegment[]
  /** Traffic-jam ranges (same x-axis as `segments`) — drawn as a thin sub-bar. */
  trafficJams: TimelineJam[]
  restScore: TimelinePoint[]
  monotonyScore: TimelinePoint[]
  restThreshold: number | null
  monotonyThreshold: number | null
  spikes: number[]
  fires: TimelineFire[]
  restDots: number[]
  recoveryWindows: { fromX: number; toX: number }[]
  completionX: number | null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Map a whole-run headless InstantResult to a resolution-independent TimelineData. */
export function instantResultToTimeline(result: InstantResult): TimelineData {
  const { score_series, segments, threshold, completed_min } = result
  const monotony_series = result.monotony_series ?? []
  const spikePts = result.spikes ?? []
  const restOptions =
    result.rest_options && result.rest_options.length > 0
      ? result.rest_options
      : result.rest_option != null
        ? [result.rest_option]
        : []
  const fires = result.fired
    ? result.fires && result.fires.length > 0
      ? result.fires
      : result.fire != null
        ? [result.fire]
        : []
    : []

  const lastTick = Math.max(
    score_series.length > 0 ? score_series[score_series.length - 1].t : 1,
    monotony_series.length > 0 ? monotony_series[monotony_series.length - 1].t : 1,
  )
  const tickMax = Math.max(1, lastTick)
  const minMax = Math.max(
    1,
    completed_min ?? (segments.length > 0 ? segments[segments.length - 1].to_min : tickMax),
  )
  const xTick = (t: number) => clamp01(Math.min(t, tickMax) / tickMax)
  const xMin = (m: number) => clamp01(Math.min(m, minMax) / minMax)

  const restStops = restOptions
    .map((o) => o.recovery_from_min)
    .filter((m): m is number => m != null)

  return {
    segments: segments.map((s) => ({ fromX: xMin(s.from_min), toX: xMin(s.to_min), type: s.type })),
    trafficJams: (result.traffic_jams ?? []).map((j) =>
      j.from_frac != null && j.to_frac != null
        ? { fromX: clamp01(j.from_frac), toX: clamp01(j.to_frac) }
        : { fromX: xMin(j.from_min), toX: xMin(j.to_min) },
    ),
    restScore: score_series.map((p) => ({ x: xTick(p.t), y: p.score })),
    monotonyScore: monotony_series.map((p) => ({ x: xTick(p.t), y: p.score })),
    restThreshold: threshold,
    monotonyThreshold: result.monotony_threshold ?? null,
    spikes: spikePts.map((s) => xTick(s.t)),
    fires: fires.map((f) => ({
      x: xMin(f.time_min),
      kind: (f.category ?? '').startsWith('rest') ? 'rest' : 'monotony',
    })),
    restDots: restStops.map(xMin),
    recoveryWindows: restOptions
      .filter((o) => o.recovery_from_min != null && o.to_min != null)
      .map((o) => ({ fromX: xMin(o.recovery_from_min as number), toX: xMin(o.to_min as number) })),
    completionX: completed_min != null ? xMin(completed_min) : null,
  }
}

/** Piecewise-linear interpolator from a monotone `(key → frac)` map (the
 * per-tick `progress` series). `anchorOrigin` prepends `(0, 0)` so a minute
 * value before the first tick (a segment starting at `from_min: 0`) maps to
 * the route start; tick keys already start at 0 so they don't need it. Beyond
 * the last point the last frac is held (clamped to [0,1]). */
function makeFracInterp(
  points: { key: number; frac: number }[],
  anchorOrigin: boolean,
): (q: number) => number {
  const pts = anchorOrigin ? [{ key: 0, frac: 0 }, ...points] : points
  return (q: number): number => {
    if (pts.length === 0) return 0
    if (q <= pts[0].key) return clamp01(pts[0].frac)
    for (let i = 1; i < pts.length; i++) {
      if (q <= pts[i].key) {
        const a = pts[i - 1]
        const b = pts[i]
        const span = b.key - a.key
        const f = span > 0 ? (q - a.key) / span : 0
        return clamp01(a.frac + (b.frac - a.frac) * f)
      }
    }
    return clamp01(pts[pts.length - 1].frac)
  }
}

/** Map a merged quickview projection (feature 020) to a resolution-independent
 * `TimelineData` on the DISTANCE (route_fraction) axis — so its fires/curve/rest
 * markers line up with the distance-axis live animation (owner review issue 2:
 * the quickview trigger point must sit at the same x as the animation's). The
 * per-tick `progress` map (added by `services/preview.py`) remaps every
 * minute/tick x-coordinate onto route_fraction; distance is FLAT across a
 * stopped rest, so a multi-minute rest collapses to a single route position,
 * exactly as the live animation shows it. Falls back to the time-axis
 * `instantResultToTimeline` when `progress` is absent (older payloads/fixtures). */
export function mergedInstantResultToTimeline(result: MergedInstantResult): TimelineData {
  const progress = result.progress ?? []
  if (progress.length === 0) return instantResultToTimeline(result)

  const tickToFrac = makeFracInterp(progress.map((p) => ({ key: p.t, frac: p.frac })), false)
  const minToFrac = makeFracInterp(progress.map((p) => ({ key: p.min, frac: p.frac })), true)

  const restOptions =
    result.rest_options && result.rest_options.length > 0
      ? result.rest_options
      : result.rest_option != null
        ? [result.rest_option]
        : []
  const fires = result.fired
    ? result.fires && result.fires.length > 0
      ? result.fires
      : result.fire != null
        ? [result.fire]
        : []
    : []

  const restStops = restOptions
    .map((o) => o.recovery_from_min)
    .filter((m): m is number => m != null)

  return {
    segments: result.segments.map((s) => ({ fromX: minToFrac(s.from_min), toX: minToFrac(s.to_min), type: s.type })),
    trafficJams: (result.traffic_jams ?? []).map((j) =>
      j.from_frac != null && j.to_frac != null
        ? { fromX: clamp01(j.from_frac), toX: clamp01(j.to_frac) }
        : { fromX: minToFrac(j.from_min), toX: minToFrac(j.to_min) },
    ),
    restScore: result.score_series.map((p) => ({ x: tickToFrac(p.t), y: p.score })),
    monotonyScore: (result.monotony_series ?? []).map((p) => ({ x: tickToFrac(p.t), y: p.score })),
    restThreshold: result.threshold,
    monotonyThreshold: result.monotony_threshold ?? null,
    spikes: (result.spikes ?? []).map((s) => tickToFrac(s.t)),
    fires: fires.map((f) => ({
      x: tickToFrac(f.tick),
      kind: (f.category ?? '').startsWith('rest') ? 'rest' : 'monotony',
    })),
    restDots: restStops.map(minToFrac),
    recoveryWindows: restOptions
      .filter((o) => o.recovery_from_min != null && o.to_min != null)
      .map((o) => ({ fromX: minToFrac(o.recovery_from_min as number), toX: minToFrac(o.to_min as number) })),
    completionX: result.completed_min != null ? minToFrac(result.completed_min) : null,
  }
}

/** y-axis domain fitting BOTH curves and BOTH thresholds (never hardcode 0–1). */
export function timelineYDomain(d: TimelineData): { yMin: number; yMax: number } {
  const vals: number[] = []
  for (const p of d.restScore) vals.push(p.y)
  for (const p of d.monotonyScore) vals.push(p.y)
  if (d.restThreshold != null) vals.push(d.restThreshold)
  if (d.monotonyThreshold != null) vals.push(d.monotonyThreshold)
  const rawMin = vals.length > 0 ? Math.min(...vals) : 0
  const rawMax = vals.length > 0 ? Math.max(...vals) : 1
  const pad = (rawMax - rawMin) * 0.1 || 0.1
  return { yMin: rawMin - pad, yMax: rawMax + pad }
}
