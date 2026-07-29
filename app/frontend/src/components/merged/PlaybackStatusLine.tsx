/**
 * PlaybackStatusLine — one READ-ONLY line between the map and the proposals.
 *
 * Two modes, mirroring what the map is showing:
 *
 *  - **Playback** (a run exists): the car's current status — motion, distance,
 *    speed, the road/traffic it is on, whether it is stopped at a rest spot
 *    (and in which recovery phase), and the trigger that just fired, if any.
 *  - **Quickview** (no run yet): the FIRST projected trigger — the one the
 *    proposals below are showing by default.
 *
 * It replaced the checkpoint rail + decision band that used to sit here.
 * Choosing WHICH decision the review column examines now happens by clicking a
 * trigger marker on the map, so this line carries no controls of its own.
 */
import type { MergedTriggerTick } from '../../api/mergedClient'
import type { FirePoint } from '../../api/types'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'

const LABELS = {
  idle: {
    ja: '実行またはクイックビューを開始すると、ここに状況が表示されます。',
    en: 'Run or preview the case to see the status here.',
  },
  noFire: {
    ja: 'この設定ではトリガーは発火しませんでした。',
    en: 'No trigger fired for this setup.',
  },
  firstTrigger: { ja: '最初のトリガー', en: 'First trigger' },
  now: { ja: '現在', en: 'Now' },
  fired: { ja: '発火', en: 'fired' },
  jam: { ja: '渋滞', en: 'traffic jam' },
  atRest: { ja: '休憩地点で停車中', en: 'stopped at the rest spot' },
}

const MOTION: Record<string, BilingualLabel> = {
  MOVING: { ja: '走行中', en: 'driving' },
  STOPPED: { ja: '停車中', en: 'stopped' },
}

const PHASE: Record<string, BilingualLabel> = {
  nap: { ja: '仮眠', en: 'nap' },
  content: { ja: 'コンテンツ', en: 'content' },
  wakefulness: { ja: '覚醒確認', en: 'wakefulness' },
}

const SEGMENT: Record<string, BilingualLabel> = {
  highway: { ja: '高速道路', en: 'highway' },
  normal_road: { ja: '一般道', en: 'normal road' },
  mountain_road: { ja: '山道', en: 'mountain road' },
  sightseeing_road: { ja: '観光道路', en: 'scenic road' },
}

/** A raw backend token we have no translation for is shown as-is rather than
 *  hidden — an untranslated fact still beats a silently dropped one. */
function word(map: Record<string, BilingualLabel>, key: string | null | undefined, lang: 'ja' | 'en'): string | null {
  if (!key) return null
  const label = map[key]
  return label ? t(label, lang) : key
}

function minutesLabel(timeMin: number, lang: 'ja' | 'en'): string {
  const m = Math.round(timeMin)
  return lang === 'ja' ? `${m}分` : `${m} min`
}

export function statusParts({
  playback,
  latestTrigger,
  firstFire,
  lang,
}: {
  playback: boolean
  latestTrigger: MergedTriggerTick | null
  firstFire: FirePoint | null
  lang: 'ja' | 'en'
}): { lead: string; parts: string[] } | null {
  if (playback && latestTrigger) {
    const parts: string[] = []
    const phase = word(PHASE, latestTrigger.recovery_phase, lang)
    if (phase) {
      // Stopped for a rest: the phase is the headline, not the speed.
      parts.push(`${t(LABELS.atRest, lang)}（${phase}）`)
    } else {
      const motion = word(MOTION, latestTrigger.motion_state, lang)
      if (motion) parts.push(motion)
      if (latestTrigger.speed_kph != null) parts.push(`${Math.round(latestTrigger.speed_kph)} km/h`)
    }
    if (latestTrigger.distance_km != null) parts.push(`${latestTrigger.distance_km.toFixed(1)} km`)
    const segment = word(SEGMENT, latestTrigger.segment_type, lang)
    if (segment) parts.push(segment)
    if (latestTrigger.is_traffic_jam) parts.push(t(LABELS.jam, lang))

    const decision = latestTrigger.decision
    if (decision?.selected_category) {
      parts.push(`⚠ ${decision.selected_category} ${t(LABELS.fired, lang)}`)
    }
    return { lead: t(LABELS.now, lang), parts }
  }

  if (!playback && firstFire) {
    const parts = [firstFire.category ?? '—']
    if (firstFire.strength) parts.push(firstFire.strength)
    parts.push(minutesLabel(firstFire.time_min, lang))
    return { lead: t(LABELS.firstTrigger, lang), parts }
  }

  return null
}

export default function PlaybackStatusLine({
  playback,
  latestTrigger,
  firstFire,
  hasProjection,
}: {
  playback: boolean
  latestTrigger: MergedTriggerTick | null
  firstFire: FirePoint | null
  /** A quickview ran — so "no fire" is a RESULT, not "nothing has happened". */
  hasProjection: boolean
}): JSX.Element {
  const { lang } = useLanguage()
  const status = statusParts({ playback, latestTrigger, firstFire, lang })

  const message = status
    ? null
    : hasProjection && !playback
      ? t(LABELS.noFire, lang)
      : t(LABELS.idle, lang)

  return (
    <div
      data-testid="playback-status-line"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        padding: '5px 10px',
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: '7px',
        fontSize: '0.8em',
        whiteSpace: 'nowrap',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {status ? (
        <>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>{status.lead}:</span>
          <span data-testid="playback-status-text" style={{ color: '#1d4ed8' }}>
            {status.parts.join(' · ')}
          </span>
        </>
      ) : (
        <span data-testid="playback-status-text" style={{ color: '#64748b' }}>{message}</span>
      )}
    </div>
  )
}
