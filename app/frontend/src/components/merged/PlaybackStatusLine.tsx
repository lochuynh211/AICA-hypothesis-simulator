/**
 * PlaybackStatusLine — one READ-ONLY line between the map and the proposals.
 *
 * PLAYBACK ONLY: the car's current status — motion, distance, speed, the
 * road/traffic it is on, whether it is stopped at a rest spot (and in which
 * recovery phase), and the trigger that just fired, if any.
 *
 * It renders NOTHING before playback starts. It used to summarise the first
 * projected trigger there, which the owner review removed: the quickview strip
 * and the map markers already say where the fires are, and a third restatement
 * under the map was noise.
 *
 * It replaced the checkpoint rail + decision band that used to sit here.
 * Choosing WHICH decision the review column examines now happens by clicking a
 * trigger marker on the map, so this line carries no controls of its own.
 */
import type { MergedTriggerTick } from '../../api/mergedClient'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import { CATEGORY_LABELS } from '../../lib/review/reviewVocabulary'

const LABELS = {
  now: { ja: '現在', en: 'Now' },
  fired: { ja: '発火', en: 'fired' },
  jam: { ja: '渋滞', en: 'traffic jam' },
  atRest: { ja: '休憩場所で停車中', en: 'stopped at the rest spot' },
}

/** A `selected_category` the fixed two-entry `CATEGORY_LABELS` table does not
 *  recognise. The type is an open `string | null` on the wire, so this is a
 *  real (if rare) fallback path — shown as a neutral placeholder, never the
 *  raw backend value, matching the sibling fallback in MergedProposalPanel. */
const UNKNOWN_CATEGORY: BilingualLabel = { ja: '(不明)', en: '(Unknown)' }

/** A backend token this file has no translation entry for. Rendered as a
 *  neutral placeholder rather than the raw identifier — no variable name may
 *  reach the screen, even on an unmapped/future value. */
const UNKNOWN_TOKEN: BilingualLabel = { ja: '不明', en: 'unknown' }

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

/** An unmapped backend token is still SHOWN, as a neutral bilingual
 *  placeholder — an untranslated fact still beats a silently dropped one —
 *  but the raw identifier itself must never reach the screen. */
function word(map: Record<string, BilingualLabel>, key: string | null | undefined, lang: 'ja' | 'en'): string | null {
  if (!key) return null
  const label = map[key]
  return t(label ?? UNKNOWN_TOKEN, lang)
}

export function statusParts({
  playback,
  latestTrigger,
  lang,
}: {
  playback: boolean
  latestTrigger: MergedTriggerTick | null
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
      const categoryLabel = CATEGORY_LABELS[decision.selected_category] ?? UNKNOWN_CATEGORY
      parts.push(
        lang === 'ja'
          ? `⚠ ${t(categoryLabel, lang)} ${t(LABELS.fired, lang)}`
          : `⚠ ${t(categoryLabel, lang)} — ${t(LABELS.fired, lang)}`,
      )
    }
    return { lead: t(LABELS.now, lang), parts }
  }

  return null
}

export default function PlaybackStatusLine({
  playback,
  latestTrigger,
}: {
  playback: boolean
  latestTrigger: MergedTriggerTick | null
}): JSX.Element | null {
  const { lang } = useLanguage()
  const status = statusParts({ playback, latestTrigger, lang })

  // Before playback there is no car status to report, and the quickview strip
  // plus the map markers already say where the fires are.
  if (!status) return null

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
      <span style={{ fontWeight: 700, color: '#1e293b' }}>{status.lead}:</span>
      <span data-testid="playback-status-text" style={{ color: '#1d4ed8' }}>
        {status.parts.join(' · ')}
      </span>
    </div>
  )
}
