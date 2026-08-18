// app/frontend/src/components/playback/mergedLiveTimeline.ts
//
// The LIVE (animation) counterpart of the Combined screen's projection strip.
//
// `mergedInstantResultToTimeline` draws what the run WOULD do, computed head-
// lessly at setup time under auto-accept. This builds the same `TimelineData`
// from the ticks that have ACTUALLY run — so the curves and the driver-state
// band show how the driver responded to each trigger the reviewer answered
// (accepted rest recovers drowsiness; a declined proposal does not), and the
// two charts, stacked and sharing the route-fraction x-axis, can be read
// against each other.
//
// It is deliberately a pure function of the merged coordinator's `triggerTrace`
// (+ accepted rest spots): no fetching, no recomputation, nothing the backend
// did not record on a tick.
import type { RestSpot, TraceEntry } from '../../api/types'
import type { TimelineData, TimelineFire, TimelineJam, TimelineSegment } from './timelineData'

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function fireKind(cat: string | null | undefined): 'rest' | 'monotony' {
  return (cat ?? '').startsWith('rest') ? 'rest' : 'monotony'
}

export type MergedLiveTimelineInput = {
  /** Per-tick trigger trace, oldest first (`state.triggerTrace`). */
  trace: TraceEntry[]
  /** Rest spots the reviewer accepted during THIS run (`state.acceptedRestSpots`). */
  restSpots: RestSpot[]
  /** True once the run reached the end of the route. */
  completed: boolean
  /** Road bands + jam ranges to draw under the curves. Taken from the
   *  projection strip so both charts share one background (same road colours at
   *  the same x) — the live tick stream reports a `segment_type` per tick but
   *  not the route's segmentation ahead of the car, and a background that grows
   *  with the playhead would make the two charts impossible to compare. */
  segments?: TimelineSegment[]
  trafficJams?: TimelineJam[]
}

/** Build live `TimelineData` on the DISTANCE (route_fraction) axis — the same
 *  axis `mergedInstantResultToTimeline` uses, so the live chart lines up
 *  column-for-column with the projection above it and with the map. */
export function mergedLiveTimeline({
  trace, restSpots, completed, segments = [], trafficJams = [],
}: MergedLiveTimelineInput): TimelineData {
  const xOf = (e: TraceEntry) => clamp01(num(e.route_fraction) ?? 0)

  const restScore: TimelineData['restScore'] = []
  const monotonyScore: TimelineData['monotonyScore'] = []
  const drowsiness: TimelineData['restScore'] = []
  const fatigue: TimelineData['restScore'] = []
  const fires: TimelineFire[] = []

  // A fire is the RISING EDGE of an actionable (paused) proposal — the same
  // rule the Trigger screen's live timeline uses, so "a trigger fired here"
  // means one thing across the app.
  let active = false
  for (const e of trace) {
    const x = xOf(e)
    const rest = num(e.scores?.['rest_required_score']) ?? num(e.score)
    if (rest != null) restScore.push({ x, y: rest })
    const mono = num(e.scores?.['monotony_prevention_score'])
    if (mono != null) monotonyScore.push({ x, y: mono })

    const d = num(e.drowsiness)
    if (d != null) drowsiness.push({ x, y: d })
    const f = num(e.fatigue)
    if (f != null) fatigue.push({ x, y: f })
    // Combined screen only: the monotony-level curve is removed from this chart
    // (owner decision) — `monotony_level` is no longer collected here.

    const paused = e.proposal_paused === true
    // `time_min` is the tick's real elapsed minute — the fire's ACTUAL firing
    // time, which shifts with the reviewer's accept/decline answers (a declined
    // rest re-fires at a later tick, hence a later minute). Labelled on the
    // chart on the same clock as the projection above.
    if (paused && !active) fires.push({ x, kind: fireKind(e.selected_category), timeMin: num(e.time_min) })
    active = paused
  }

  // Arrival minute for a rest dot: the elapsed time of the FIRST tick that
  // reached the spot's route position. route_fraction is monotonic (and flat
  // across a stopped rest), so this is exactly when the car ARRIVED — the live
  // analogue of the projection's `recovery_from_min`. Null when the run has not
  // yet reached the spot (dot drawn, no time known yet).
  const arrivalMinAt = (frac: number): number | null => {
    for (const e of trace) {
      const t = num(e.time_min)
      if (t != null && (num(e.route_fraction) ?? 0) >= frac) return t
    }
    return null
  }

  // Thresholds come from the LATEST tick's criteria, on the same 0-1 scale as
  // the rest curve (`rest_required_threshold` normalized / the hybrid's
  // already-0-1 `threshold_suggest`; raw `threshold_fire` only as a last
  // resort) — identical precedence to `useLiveTimelineData`.
  const last = trace.length > 0 ? trace[trace.length - 1] : null
  const restThreshold =
    num(last?.criteria?.['rest_required_threshold']) ??
    num(last?.criteria?.['threshold_suggest']) ??
    num(last?.criteria?.['threshold_fire']) ??
    null
  const monotonyThreshold = num(last?.criteria?.['monotony_suggest_threshold']) ?? null

  return {
    segments,
    trafficJams,
    restScore,
    monotonyScore,
    driverSignals: { drowsiness, fatigue, monotony: [] },
    restThreshold,
    monotonyThreshold,
    // anomaly_events are backend-only bookkeeping → never on a tick response.
    spikes: [],
    fires,
    restDots: restSpots.map((s) => clamp01(s.route_fraction)),
    restDotTimes: restSpots.map((s) => arrivalMinAt(clamp01(s.route_fraction))),
    // Recovery is drawn by the driver-state curves themselves here (drowsiness
    // dropping); the projection's shaded window has no live equivalent, since
    // a recovery's extent is only known once it has finished.
    recoveryWindows: [],
    completionX: completed ? 1 : null,
  }
}
