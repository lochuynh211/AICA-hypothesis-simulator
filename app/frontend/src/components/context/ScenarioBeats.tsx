/**
 * ScenarioBeats — left-panel realtime narrative of the drive, built per tick.
 *
 * Emits ONE beat per status change as the trace advances so the list reads
 * like a running play-by-play, NOT a drowsiness-band spam:
 *
 *   🏁  Start (first segment beat — type "start")
 *   🛣️  Road-type change (active segment boundary crossed)
 *   🚥  Traffic jam (is_traffic_jam rising edge)
 *   ⚠️  AICA alert (result_type SOFT_WARNING, on first occurrence)
 *   ☕  AICA proposes rest (result_type REST_PROPOSAL)
 *   👉  Driver action (lastAction, injected right after the proposal beat)
 *   😴/🚗/🅿️/🎤/🚙  Recovery phase (recovery_phase change)
 *   🏁  Destination (run completed)
 *
 * Drowsiness-band beats have been REMOVED (Task 10) — drowsiness is a driver
 * state indicator shown in DriverStatus, not a scenario narrative event.
 *
 * The most recent beat is labelled "▶ now".
 * Before the run starts, planned segments are shown faint as a preview.
 */
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from '../playback/useRouteProgress'
import { t } from '../../i18n/t'
import type { RouteSegment, TraceEntry } from '../../api/types'

// ── Icon helpers ─────────────────────────────────────────────────────────────

function segIcon(seg: RouteSegment): string {
  if (seg.is_rest_facility || seg.type === 'rest') return '☕'
  switch (seg.type) {
    case 'start':
    case 'end':
      return '🏁'
    default:
      return '🚗'  // all driving types: urban, highway, national, residential, etc.
  }
}

function segBeatLabel(seg: RouteSegment, lang: string): string {
  if (seg.is_rest_facility || seg.type === 'rest') return t(seg.name, lang)
  switch (seg.type) {
    case 'start':        return t({ ja: '出発', en: 'Start' }, lang)
    case 'end':          return t({ ja: '目的地', en: 'Destination' }, lang)
    case 'urban':        return t({ ja: '市街地', en: 'Driving · Urban zone' }, lang)
    case 'highway':      return t({ ja: '高速道路', en: 'Driving · Highway' }, lang)
    case 'national':     return t({ ja: '国道', en: 'Driving · National road' }, lang)
    case 'residential':  return t({ ja: '住宅地', en: 'Driving · Residential area' }, lang)
    default:             return t({ ja: '走行中', en: 'Driving · Road' }, lang)
  }
}

// ── Recovery-phase beat table ─────────────────────────────────────────────────

const RECOVERY_BEATS: Record<string, { icon: string; label: { ja: string; en: string } }> = {
  wakefulness: { icon: '🚗', label: { ja: 'ドライブ中の覚醒', en: 'Wakefulness en route' } },
  nap:         { icon: '😴', label: { ja: '仮眠中', en: 'Resting (nap)' } },
  content:     { icon: '🎤', label: { ja: '休憩後カラオケ', en: 'Karaoke after nap' } },
  resuming:    { icon: '🚙', label: { ja: '再出発', en: 'Resumed' } },
}

// ── Driver-action label table ─────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { icon: string; label: { ja: string; en: string } }> = {
  accept_rest: { icon: '👉', label: { ja: '休憩を承諾', en: 'Accepted rest' } },
  postpone:    { icon: '👉', label: { ja: '後回し', en: 'Postponed' } },
  decline:     { icon: '👉', label: { ja: '断る', en: 'Declined' } },
}

// ── Beat type ─────────────────────────────────────────────────────────────────

type BeatKind = 'segment' | 'traffic' | 'alert' | 'propose' | 'action' | 'recovery' | 'destination'

type Beat = {
  id: string
  icon: string
  label: string
  kind: BeatKind
}

function kindAccent(kind: BeatKind): string {
  switch (kind) {
    case 'alert':       return '#f59e0b'
    case 'propose':     return '#0ea5e9'
    case 'action':      return '#8b5cf6'
    case 'recovery':    return '#10b981'
    case 'traffic':     return '#ef4444'
    case 'destination': return '#2563eb'
    default:            return '#2563eb' // segment
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScenarioBeats() {
  const { state } = useRunStore()
  const { trace, uiLanguage, lastAction, completed } = state
  const { segments, currentFraction, hasRun, fractionAtTick } = useRouteProgress()

  if (segments.length === 0) {
    return <p style={{ padding: '8px', fontSize: '0.85em', color: '#888' }}>No route loaded</p>
  }

  const sortedSegsDesc = [...segments].sort((a, b) => b.at - a.at)
  const segAt = (f: number): RouteSegment | null => sortedSegsDesc.find((s) => s.at <= f) ?? null

  // ── Preview (before the run): planned segments, faint ──────────────────────
  if (!hasRun || trace.length === 0) {
    return (
      <ul data-testid="scenario-beats" style={listStyle}>
        {[...segments]
          .sort((a, b) => a.at - b.at)
          .map((s) => (
            <li key={s.id} data-testid={`beat-seg-${s.id}`} style={beatStyle(false, false, '#2563eb')}>
              <span aria-hidden>{segIcon(s)}</span>
              <span style={labelCell}>{segBeatLabel(s, uiLanguage)}</span>
            </li>
          ))}
      </ul>
    )
  }

  // ── Realtime projection: one beat per status change ───────────────────────
  const beats: Beat[] = []

  let prevSegId: string | null = null
  let prevWasTrafficJam = false
  let prevResultType: string | null = null
  let prevRecoveryPhase: string | null = null
  let actionEmitted = false
  let earlyDrivingEmitted = false

  trace.forEach((e: TraceEntry) => {
    // 1. Road-type / segment change — emits start beat on tick 0 (type "start")
    const f = fractionAtTick(e.tick_index)
    const seg = segAt(f)
    if (seg && seg.id !== prevSegId) {
      beats.push({
        id: `seg-${e.tick_index}-${seg.id}`,
        icon: segIcon(seg),
        label: segBeatLabel(seg, uiLanguage),
        kind: 'segment',
      })
      prevSegId = seg.id
    }

    // Early driving beat: emit 🚗 "Driving" once on the first MOVING tick
    // while the active segment is still 'start' (handles long start segments).
    if (
      seg?.type === 'start' &&
      seg.id === prevSegId &&
      e.motion_state === 'MOVING' &&
      !earlyDrivingEmitted
    ) {
      earlyDrivingEmitted = true
      beats.push({
        id: `driving-early-${e.tick_index}`,
        icon: '🚗',
        label: t({ ja: '走行中', en: 'Driving' }, uiLanguage),
        kind: 'segment',
      })
    }

    // 2. Traffic jam — rising edge only
    const isJam = Boolean(e.is_traffic_jam)
    if (isJam && !prevWasTrafficJam) {
      beats.push({
        id: `traffic-${e.tick_index}`,
        icon: '🚥',
        label: t({ ja: '渋滞', en: 'Traffic jam' }, uiLanguage),
        kind: 'traffic',
      })
    }
    prevWasTrafficJam = isJam

    // 3. SOFT_WARNING alert — emit once on first occurrence
    if (e.result_type === 'SOFT_WARNING' && prevResultType !== 'SOFT_WARNING') {
      beats.push({
        id: `alert-${e.tick_index}`,
        icon: '⚠️',
        label: t({ ja: 'AICA 注意', en: 'AICA alert' }, uiLanguage),
        kind: 'alert',
      })
    }

    // 4. REST_PROPOSAL — emit once, then immediately inject the action beat
    //    (if the reviewer already responded) so order is: propose → action → recovery
    if (e.result_type === 'REST_PROPOSAL' && prevResultType !== 'REST_PROPOSAL') {
      beats.push({
        id: `propose-${e.tick_index}`,
        icon: '☕',
        label: t({ ja: 'AICA — 休憩を提案', en: 'AICA proposes rest' }, uiLanguage),
        kind: 'propose',
      })
      if (lastAction && !actionEmitted) {
        const al = ACTION_LABELS[lastAction]
        beats.push({
          id: `action-${e.tick_index}`,
          icon: al ? al.icon : '👉',
          label: al ? t(al.label, uiLanguage) : lastAction,
          kind: 'action',
        })
        actionEmitted = true
      }
    }

    prevResultType = e.result_type ?? null

    // 5. Recovery phase change
    const phase = e.recovery_phase ?? null
    if (phase && phase !== prevRecoveryPhase) {
      const rb = RECOVERY_BEATS[phase]
      beats.push({
        id: `recovery-${e.tick_index}-${phase}`,
        icon: rb ? rb.icon : '🔄',
        label: rb ? t(rb.label, uiLanguage) : phase,
        kind: 'recovery',
      })
    }
    prevRecoveryPhase = phase
  })

  // Trailing action beat: if there was an action but no proposal was seen in the trace
  // (edge case: action after a pre-existing run loaded from evidence)
  if (lastAction && !actionEmitted) {
    const al = ACTION_LABELS[lastAction]
    beats.push({
      id: 'action-trailing',
      icon: al ? al.icon : '👉',
      label: al ? t(al.label, uiLanguage) : lastAction,
      kind: 'action',
    })
  }

  // Destination beat when run is completed
  if (completed) {
    beats.push({
      id: 'destination',
      icon: '🏁',
      label: t({ ja: '目的地', en: 'Destination' }, uiLanguage),
      kind: 'destination',
    })
  }

  // Upcoming segment look-ahead (faint, next boundary not yet reached)
  const upcoming = [...segments].sort((a, b) => a.at - b.at).find((s) => s.at > currentFraction)
  const activeId = beats.length > 0 ? beats[beats.length - 1].id : null

  return (
    <ul data-testid="scenario-beats" style={listStyle}>
      {beats.map((b) => {
        const active = b.id === activeId
        const accent = kindAccent(b.kind)
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
            {segBeatLabel(upcoming, uiLanguage)}
          </span>
        </li>
      )}
    </ul>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
