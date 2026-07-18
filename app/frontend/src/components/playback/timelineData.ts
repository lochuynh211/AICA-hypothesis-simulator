// app/frontend/src/components/playback/timelineData.ts
import type { InstantResult } from '../../api/types'
import type { MergedInstantResult } from '../../api/mergedClient'

export type TimelinePoint = { x: number; y: number }
export type TimelineFire = { x: number; kind: 'rest' | 'monotony' }
export type TimelineSegment = { fromX: number; toX: number; type: string | null }

export type TimelineData = {
  segments: TimelineSegment[]
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

/** Map a merged quickview projection (feature 020, Slice-2c Task 5) to a
 * resolution-independent `TimelineData` — `MergedInstantResult` is
 * `InstantResult`-shaped (its `fires` carry a `MergedFirePoint` per entry,
 * which is a `FirePoint` plus an ignored per-fire `proposal`/`proposal_error`),
 * so this reuses `instantResultToTimeline`'s derivation verbatim rather than
 * duplicating the tick/minute-domain and y-axis normalization it already does. */
export function mergedInstantResultToTimeline(result: MergedInstantResult): TimelineData {
  return instantResultToTimeline(result)
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
