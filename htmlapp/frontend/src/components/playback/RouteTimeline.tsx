import { useLiveTimelineData } from './useLiveTimelineData'
import { useSmoothFraction } from './useSmoothFraction'
import ScoreTimeline from './ScoreTimeline'
import type { ScoreTimelineTestIds } from './ScoreTimeline'
import type { ReplayTick } from '../../replay/replaySource'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'

/**
 * RouteTimeline — the Review-screen progress timeline (FR-016 display-only).
 *
 * Now a real-time, progressive-reveal version of the Setup screen's Instant
 * Result timeline: the road ahead is blurred/dimmed and cleans up to full colour
 * as the 🚗 playhead passes, and the score curve(s) + fire lines reveal only behind
 * it as the run ticks. Constants known up front — the fire threshold and a chosen
 * rest spot — are drawn forward (full width / immediately). Built via the shared
 * ScoreTimeline, with a colour legend. The car aria-label reports the EXACT
 * evaluated route_fraction (matches the evidence log); only the on-screen position
 * is eased via useSmoothFraction. No store writes.
 */
const REVIEW_TEST_IDS: ScoreTimelineTestIds = {
  root: 'route-timeline',
  playhead: 'car-marker',
  fire: 'fire-marker',
  monotonyFire: 'monotony-fire-marker',
  restDot: 'progress-rest-spot-marker',
  curve: 'progress-fill', // the growing rest-propose curve is the "fill" of the bar
  legend: 'route-timeline-legend',
}

export default function RouteTimeline({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const { data, exactFraction } = useLiveTimelineData(replayTick)
  const shown = useSmoothFraction(exactFraction)
  const targetPct = Math.round(exactFraction * 100)
  const lang = useRunStore().state.uiLanguage

  return (
    <div style={{ margin: '12px 0' }}>
      <ScoreTimeline
        data={data}
        revealFraction={shown}
        ghostAhead
        animated
        showPlayhead
        playheadAriaLabel={t({ en: `Route position: ${targetPct}%`, ja: `ルート位置: ${targetPct}%` }, lang)}
        height={112}
        testIds={REVIEW_TEST_IDS}
        restDotAriaLabel={t({ en: 'Chosen rest location', ja: '選択した休憩場所' }, lang)}
        showLegend
        lang={lang}
      />
    </div>
  )
}
