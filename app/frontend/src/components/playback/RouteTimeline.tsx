import { useLiveTimelineData } from './useLiveTimelineData'
import { useSmoothFraction } from './useSmoothFraction'
import ScoreTimeline from './ScoreTimeline'
import type { ScoreTimelineTestIds } from './ScoreTimeline'
import type { ReplayTick } from '../../replay/replaySource'

/**
 * RouteTimeline — the Review-screen progress timeline (FR-016 display-only).
 *
 * Now a real-time, progressive-reveal version of the Setup screen's Instant
 * Result timeline: road bands ghost ahead (geometry is known), while the score
 * curve(s), fire lines, and rest dots reveal only behind the 🚗 playhead as the
 * run ticks. Built via the shared ScoreTimeline. The car aria-label reports the
 * EXACT evaluated route_fraction (matches the evidence log); only the on-screen
 * position is eased via useSmoothFraction. No store writes.
 */
const REVIEW_TEST_IDS: ScoreTimelineTestIds = {
  root: 'route-timeline',
  playhead: 'car-marker',
  fire: 'fire-marker',
  restDot: 'progress-rest-spot-marker',
  curve: 'progress-fill', // the growing rest-propose curve is the "fill" of the bar
}

export default function RouteTimeline({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const { data, exactFraction } = useLiveTimelineData(replayTick)
  const shown = useSmoothFraction(exactFraction)
  const targetPct = Math.round(exactFraction * 100)

  return (
    <div style={{ margin: '12px 0' }}>
      <ScoreTimeline
        data={data}
        revealFraction={shown}
        ghostAhead
        animated
        showPlayhead
        playheadAriaLabel={`Route position: ${targetPct}%`}
        height={112}
        testIds={REVIEW_TEST_IDS}
      />
    </div>
  )
}
