// app/frontend/src/components/playback/timelineData.ts
import type { InstantResult } from '../../api/types'
import type { MergedInstantResult } from '../../api/mergedClient'

export type TimelinePoint = { x: number; y: number }
export type TimelineFire = {
  x: number
  kind: 'rest' | 'monotony'
  /** Elapsed minute the fire happened at (fixbug-0806 event-labels feature) —
   *  projected minute on the quickview projection, actual elapsed minute
   *  (following the reviewer's answers) on the live chart. `undefined` on the
   *  Trigger-screen builder (`instantResultToTimeline`), which never labels
   *  its fires. */
  timeMin?: number | null
}
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
  /** Elapsed minute each `restDots` entry was reached, index-aligned
   *  (fixbug-0806 event-labels feature). `undefined` on builders that don't
   *  label rest arrivals. */
  restDotTimes?: (number | null)[]
  recoveryWindows: { fromX: number; toX: number }[]
  /** Driver-state curves drawn UNDER the road bar (0-100 each). Empty when the
   * source has no `signal_series` — the chart then simply omits the lower band. */
  driverSignals: {
    drowsiness: TimelinePoint[]
    fatigue: TimelinePoint[]
    monotony: TimelinePoint[]
  }
  completionX: number | null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Map a whole-run headless InstantResult to a resolution-independent TimelineData. */
export function instantResultToTimeline(result: InstantResult): TimelineData {
  const { score_series, segments, threshold, completed_min } = result
  const monotony_series = result.monotony_series ?? []
  const signal_series = result.signal_series ?? []
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
    // fixbug-0806: prefer the km-derived route-fraction bounds when present
    // (position-native jams) — bypasses the minute→frac remap entirely, which
    // is the fix for the wrong sub-bar position/width. Falls back to the
    // minute axis for legacy time-only jams (from_frac/to_frac absent).
    trafficJams: (result.traffic_jams ?? []).map((j) =>
      j.from_frac != null && j.to_frac != null
        ? { fromX: clamp01(j.from_frac), toX: clamp01(j.to_frac) }
        : { fromX: xMin(j.from_min ?? 0), toX: xMin(j.to_min ?? 0) },
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
    driverSignals: {
      drowsiness: signal_series.map((p) => ({ x: xTick(p.t), y: p.drowsiness })),
      fatigue: signal_series.map((p) => ({ x: xTick(p.t), y: p.fatigue })),
      monotony: signal_series.map((p) => ({ x: xTick(p.t), y: p.monotony })),
    },
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

  const restDots = restStops.map(minToFrac)

  // Arrival minute for a rest dot: the elapsed minute of the FIRST projected
  // tick whose route position reaches the dot — the SAME rule the live chart
  // uses (`arrivalMinAt` in mergedLiveTimeline). `recovery_from_min` is the
  // resting-START minute (the first STOPPED tick), which lands ONE tick AFTER
  // the car physically reaches the spot: the arrival tick is still MOVING with
  // its position clamped to the spot, and the STOPPED stage only begins on the
  // next tick. Labelling the dot with `recovery_from_min` therefore drew the
  // preview one tick (~3 min) later than the live chart at the very same rest
  // spot; the arrival is what "rest spot arrive @ N min" means on both charts.
  const arrivalMinAtFrac = (frac: number): number | null => {
    for (const p of progress) {
      if (p.frac >= frac) return p.min
    }
    return null
  }

  return {
    segments: result.segments.map((s) => ({ fromX: minToFrac(s.from_min), toX: minToFrac(s.to_min), type: s.type })),
    // fixbug-0806: prefer the km-derived route-fraction bounds when present
    // (position-native jams) — bypasses the minute→frac remap entirely, which
    // is the fix for the wrong sub-bar position/width. Falls back to the
    // minute axis for legacy time-only jams (from_frac/to_frac absent).
    trafficJams: (result.traffic_jams ?? []).map((j) =>
      j.from_frac != null && j.to_frac != null
        ? { fromX: clamp01(j.from_frac), toX: clamp01(j.to_frac) }
        : { fromX: minToFrac(j.from_min ?? 0), toX: minToFrac(j.to_min ?? 0) },
    ),
    restScore: result.score_series.map((p) => ({ x: tickToFrac(p.t), y: p.score })),
    monotonyScore: (result.monotony_series ?? []).map((p) => ({ x: tickToFrac(p.t), y: p.score })),
    restThreshold: result.threshold,
    monotonyThreshold: result.monotony_threshold ?? null,
    spikes: (result.spikes ?? []).map((s) => tickToFrac(s.t)),
    fires: fires.map((f) => ({
      x: tickToFrac(f.tick),
      kind: (f.category ?? '').startsWith('rest') ? 'rest' : 'monotony',
      timeMin: f.time_min,
    })),
    restDots,
    // Arrival minute at each dot (index-aligned with `restDots`), derived from
    // `progress` the same way the live chart does — NOT `recovery_from_min`,
    // which is the resting-start minute one tick later (see `arrivalMinAtFrac`).
    restDotTimes: restDots.map(arrivalMinAtFrac),
    driverSignals: {
      drowsiness: (result.signal_series ?? []).map((p) => ({ x: tickToFrac(p.t), y: p.drowsiness })),
      fatigue: (result.signal_series ?? []).map((p) => ({ x: tickToFrac(p.t), y: p.fatigue })),
      monotony: (result.signal_series ?? []).map((p) => ({ x: tickToFrac(p.t), y: p.monotony })),
    },
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
