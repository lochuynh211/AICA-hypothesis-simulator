/**
 * ScenarioBeats — left-panel realtime summary of the drive, built per tick.
 *
 * Walks the evaluated trace in order and emits a beat whenever the *status*
 * changes, so the list reads like a running play-by-play that grows tick by tick:
 *   - road type change   → "Entered Highway" (urban → highway adds a beat)
 *   - drowsiness escalates → "Drowsiness: high"
 *   - a proposal fires     → "AICA — select rest option"
 *
 * Each beat is keyed to the tick that produced it; the most recent is active.
 * Before the run starts, the planned segments are shown faint as a preview.
 * Position comes from the backend route_fraction recorded on each trace entry.
 */
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from '../playback/useRouteProgress'
import { t } from '../../i18n/t'
import type { RouteSegment, TraceEntry } from '../../api/types'

const DROWSY_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  weak: 1,
  mild: 1,
  medium: 2,
  moderate: 2,
  high: 3,
  strong: 3,
  severe: 4,
  critical: 4,
}

function segIcon(seg: RouteSegment): string {
  if (seg.is_rest_facility || seg.type === 'rest') return '☕'
  switch (seg.type) {
    case 'start':
    case 'end':
      return '🏁'
    case 'highway':
      return '🛣️'
    case 'national':
      return '🛤️'
    case 'urban':
      return '🏙️'
    case 'residential':
      return '🏘️'
    default:
      return '📍'
  }
}

type Beat = {
  id: string
  icon: string
  label: string
  kind: 'segment' | 'alert' | 'proposal'
}

export default function ScenarioBeats() {
  const { state } = useRunStore()
  const { trace, uiLanguage } = state
  const { segments, currentFraction, hasRun, fractionAtTick } = useRouteProgress()

  if (segments.length === 0) {
    return <p style={{ padding: '8px', fontSize: '0.85em', color: '#888' }}>No route loaded</p>
  }

  const sortedSegs = [...segments].sort((a, b) => b.at - a.at)
  const segAt = (f: number): RouteSegment | null => sortedSegs.find((s) => s.at <= f) ?? null

  // ── Preview (before the run): planned segments, faint ──────────────────────
  if (!hasRun || trace.length === 0) {
    return (
      <ul data-testid="scenario-beats" style={listStyle}>
        {[...segments]
          .sort((a, b) => a.at - b.at)
          .map((s) => (
            <li key={s.id} data-testid={`beat-seg-${s.id}`} style={beatStyle(false, false, '#2563eb')}>
              <span aria-hidden>{segIcon(s)}</span>
              <span style={labelCell}>{t(s.name, uiLanguage)}</span>
            </li>
          ))}
      </ul>
    )
  }

  // ── Realtime: emit a beat on each status change as the trace advances ───────
  const beats: Beat[] = []
  let prevSegId: string | null = null
  let prevDrowsyRank = -1

  // Seed the starting segment from the first tick.
  trace.forEach((e: TraceEntry) => {
    const f = fractionAtTick(e.tick_index)
    const seg = segAt(f)
    if (seg && seg.id !== prevSegId) {
      beats.push({
        id: `seg-${e.tick_index}-${seg.id}`,
        icon: segIcon(seg),
        label: t(seg.name, uiLanguage),
        kind: 'segment',
      })
      prevSegId = seg.id
    }

    const band = String(e.features?.drowsiness_level ?? '')
    const rank = DROWSY_RANK[band.toLowerCase()] ?? -1
    if (rank > prevDrowsyRank && rank >= 2) {
      beats.push({
        id: `drowsy-${e.tick_index}`,
        icon: '⚠️',
        label: t({ ja: `眠気: ${band}`, en: `Drowsiness: ${band}` }, uiLanguage),
        kind: 'alert',
      })
    }
    if (rank >= 0) prevDrowsyRank = Math.max(prevDrowsyRank, rank)

    if (e.proposal) {
      beats.push({
        id: `proposal-${e.tick_index}`,
        icon: '☕',
        label: t({ ja: 'AICA — 休憩を選択', en: 'AICA — select rest option' }, uiLanguage),
        kind: 'proposal',
      })
    }
  })

  // Append the upcoming segment (the next one ahead) as a faint look-ahead.
  const upcoming = [...segments].sort((a, b) => a.at - b.at).find((s) => s.at > currentFraction)
  const activeId = beats.length > 0 ? beats[beats.length - 1].id : null

  return (
    <ul data-testid="scenario-beats" style={listStyle}>
      {beats.map((b) => {
        const active = b.id === activeId
        const accent = b.kind === 'alert' ? '#f59e0b' : b.kind === 'proposal' ? '#0ea5e9' : '#2563eb'
        return (
          <li key={b.id} data-testid={`beat-${b.id}`} style={beatStyle(true, active, accent)}>
            <span aria-hidden>{b.icon}</span>
            <span style={labelCell}>{b.label}</span>
            {active && <span style={{ color: accent, fontSize: '0.78em', fontWeight: 700 }}>▶ now</span>}
          </li>
        )
      })}
      {upcoming && (
        <li key="upcoming" data-testid="beat-upcoming" style={beatStyle(false, false, '#94a3b8')}>
          <span aria-hidden>{segIcon(upcoming)}</span>
          <span style={{ ...labelCell, fontStyle: 'italic' }}>
            {t({ ja: '次: ', en: 'Next: ' }, uiLanguage)}
            {t(upcoming.name, uiLanguage)}
          </span>
        </li>
      )}
    </ul>
  )
}

// ── styles ───────────────────────────────────────────────────────────────────
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}
const labelCell: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
function beatStyle(reached: boolean, active: boolean, accent: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    borderLeft: `3px solid ${active ? accent : reached ? '#cbd5e1' : '#e5e7eb'}`,
    background: active ? '#dbeafe' : reached ? '#f8fafc' : '#fff',
    fontSize: '0.85em',
    fontWeight: active ? 700 : 400,
    color: reached ? '#111' : '#94a3b8',
  }
}
