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

  // Full route bands are known upfront (geometry, not a decision) → ghosted ahead.
  const sorted = [...progress.segments].sort((a, b) => a.at - b.at)
  const segments: TimelineSegment[] = sorted.map((s, i) => ({
    fromX: s.at,
    toX: i + 1 < sorted.length ? sorted[i + 1].at : 1,
    type: s.type ?? null,
  }))

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
  const restThreshold =
    num(last?.criteria?.['threshold_fire']) ?? num(last?.criteria?.['threshold_suggest']) ?? null
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
    restScore,
    monotonyScore,
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
