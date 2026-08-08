import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from './useRouteProgress'
import type { TimelineData, TimelineFire, TimelineSegment } from './timelineData'
import type { ReplayTick } from '../../replay/replaySource'
import type { TraceEntry } from '../../api/types'

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function restY(e: TraceEntry): number {
  return num(e.scores?.['rest_required_score']) ?? num(e.score) ?? 0
}
function fireKind(cat: string | null): 'rest' | 'monotony' {
  return (cat ?? '').startsWith('rest') ? 'rest' : 'monotony'
}

/** Build the review-screen TimelineData live from state.trace (or the replay log). */
export function useLiveTimelineData(replayTick?: ReplayTick | null): {
  data: TimelineData
  revealFraction: number
  exactFraction: number
} {
  const { state } = useRunStore()
  const progress = useRouteProgress()

  // Road bands — known geometry, ghosted ahead. Prefer the SELECTED alternative's
  // route_facts.route_segments: that is the exact same data (segmentation + types)
  // MapSurface draws the coloured route from, so the timeline follows the Google
  // route 1:1. Fall back to the scenario's route_intent segments on the local
  // no-Maps-key path (where route_segments is empty).
  const selectedAlt = state.alternatives.find((a) => a.route_id === state.selectedRouteId)
  const routeSegs = selectedAlt?.route_facts?.route_segments ?? []
  const totalKm = selectedAlt?.route_facts?.total_route_distance_km ?? 0

  let segments: TimelineSegment[]
  if (routeSegs.length > 0 && totalKm > 0) {
    segments = routeSegs.map((s) => ({
      fromX: s.start_km / totalKm,
      toX: (s.start_km + s.length_km) / totalKm,
      type: s.segment_type,
    }))
  } else {
    const sorted = [...progress.segments].sort((a, b) => a.at - b.at)
    segments = sorted.map((s, i) => ({
      fromX: s.at,
      toX: i + 1 < sorted.length ? sorted[i + 1].at : 1,
      type: s.type ?? null,
    }))
  }

  // Replay: reveal to the recorded tick; live: reveal to the latest evaluated fraction.
  const exactFraction = replayTick != null ? replayTick.route_fraction : progress.currentFraction

  // Curves + fires accumulate from the trace up to "now".
  const trace = state.trace
  const upTo = replayTick != null ? trace.filter((e) => e.tick_index <= replayTick.tick_index) : trace
  const fracFor = (e: TraceEntry) =>
    typeof e.route_fraction === 'number' ? e.route_fraction : progress.fractionAtTick(e.tick_index)

  const restScore = upTo.map((e) => ({ x: fracFor(e), y: restY(e) }))
  const monotonyScore = upTo
    .filter((e) => num(e.scores?.['monotony_prevention_score']) != null)
    .map((e) => ({ x: fracFor(e), y: num(e.scores?.['monotony_prevention_score']) as number }))

  const last = upTo.length > 0 ? upTo[upTo.length - 1] : null
  // The rest curve plots the NORMALIZED rest_required_score (0-1); the threshold
  // line must share that scale. Prefer NRI's normalized `rest_required_threshold`
  // and the hybrid's already-0-1 `threshold_suggest`. Raw `threshold_fire` (s_total
  // scale, e.g. 80) is a last resort only — pairing it with a 0-1 curve flattens it.
  const restThreshold =
    num(last?.criteria?.['rest_required_threshold']) ??
    num(last?.criteria?.['threshold_suggest']) ??
    num(last?.criteria?.['threshold_fire']) ??
    null
  const monotonyThreshold = num(last?.criteria?.['monotony_suggest_threshold']) ?? null

  // Fires: rising-edge episodes of an actionable (paused) proposal.
  const fires: TimelineFire[] = []
  let active = false
  for (const e of upTo) {
    const paused = e.proposal_paused === true
    if (paused && !active) fires.push({ x: fracFor(e), kind: fireKind(e.selected_category) })
    active = paused
  }

  const restDots = state.restHistory.map((r) => r.spot.route_fraction)

  const data: TimelineData = {
    segments,
    trafficJams: [], // jam ranges are a preview/quickview-only overlay (feature 020)
    restScore,
    monotonyScore,
    // The live animation has no driver-signal series (it plots only what the
    // running tick reports); the lower band is a quickview/preview feature.
    driverSignals: { drowsiness: [], fatigue: [], monotony: [] },
    restThreshold,
    monotonyThreshold,
    spikes: [], // anomaly_events are backend-only → never available live
    fires,
    restDots,
    recoveryWindows: [],
    completionX: state.completed ? 1 : null,
  }
  return { data, revealFraction: exactFraction, exactFraction }
}
