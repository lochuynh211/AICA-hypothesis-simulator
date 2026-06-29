/**
 * ScenarioBeats — left-panel realtime narrative of the drive, built per tick.
 *
 * Emits ONE beat per status change as the trace advances so the list reads
 * like a running play-by-play:
 *
 *   🏁  Start (first tick)
 *   🚗/⏸️  Motion + road-class change (from per-tick segment_type, skipped during recovery)
 *   🚥  Traffic jam (is_traffic_jam rising edge)
 *   ⚠️  AICA alert (result_type SOFT_WARNING, on first occurrence)
 *   ☕  AICA proposes rest (result_type REST_PROPOSAL)
 *   👉  Driver action (lastAction, injected right after the proposal beat)
 *   😴/🚗/🅿️/🎤/🚙  Recovery phase (recovery_phase change)
 *   🏁  Destination (run completed)
 *
 * Road-type beats are now driven by the tick engine's segmentType (real Google
 * road class on a MAPS route; scenario-derived on local). Fictional route_intent
 * segments are NOT used, eliminating phantom "Yuuko Roadside Station" beats.
 *
 * The most recent beat is labelled "▶ now".
 * Before the run starts, a simple "Ready — press Play to begin" placeholder is shown.
 */
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { TraceEntry } from '../../api/types'

// ── Motion+road helpers ───────────────────────────────────────────────────────

const ROAD_CLASS_LABELS: Record<string, { ja: string; en: string }> = {
  highway:          { ja: '高速道路', en: 'Highway' },
  normal_road:      { ja: '一般道',   en: 'Normal road' },
  mountain_road:    { ja: '山道',     en: 'Mountain road' },
  sightseeing_road: { ja: '観光道路', en: 'Scenic road' },
}

function motionRoadIcon(motionState: string | null): string {
  return motionState === 'STOPPED' ? '⏸️' : '🚗'
}

function motionRoadLabel(motionState: string | null, segType: string | null | undefined, lang: string): string {
  const motionLabel = motionState === 'STOPPED'
    ? t({ ja: '停車中', en: 'Stopped' }, lang)
    : t({ ja: '走行中', en: 'Driving' }, lang)
  const roadEntry = segType ? ROAD_CLASS_LABELS[segType] : null
  return roadEntry ? `${motionLabel} · ${t(roadEntry, lang)}` : motionLabel
}

// ── Recovery-phase beat table ─────────────────────────────────────────────────

const RECOVERY_BEATS: Record<string, { icon: string; label: { ja: string; en: string } }> = {
  wakefulness: { icon: '🚗', label: { ja: 'ドライブ中の覚醒', en: 'Wakefulness en route' } },
  nap:         { icon: '😴', label: { ja: '仮眠中',           en: 'Resting (nap)' } },
  content:     { icon: '🎤', label: { ja: '休憩後カラオケ',   en: 'Karaoke after nap' } },
  resuming:    { icon: '🚙', label: { ja: '再出発',           en: 'Resumed' } },
}

// ── Driver-action label table ─────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { icon: string; label: { ja: string; en: string } }> = {
  accept_rest: { icon: '👉', label: { ja: '休憩を承諾', en: 'Accepted rest' } },
  postpone:    { icon: '👉', label: { ja: '後回し',     en: 'Postponed' } },
  decline:     { icon: '👉', label: { ja: '断る',       en: 'Declined' } },
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

  // ── Pre-run placeholder ───────────────────────────────────────────────────
  if (trace.length === 0) {
    return (
      <ul data-testid="scenario-beats" style={listStyle}>
        <li style={beatStyle(false, false, '#94a3b8')}>
          <span aria-hidden>⏸️</span>
          <span style={{ ...labelCell, fontStyle: 'italic' }}>
            {t({ ja: '準備完了 — 再生して開始', en: 'Ready — press Play to begin' }, uiLanguage)}
          </span>
        </li>
      </ul>
    )
  }

  // ── Realtime projection: one beat per status change ───────────────────────
  const beats: Beat[] = []

  let prevMotionKey: string | null = null
  let prevSegType: string | null = null
  let prevWasTrafficJam = false
  let prevResultType: string | null = null
  let prevRecoveryPhase: string | null = null
  let actionEmitted = false

  trace.forEach((e: TraceEntry, idx: number) => {
    const motionKey = e.motion_state ?? null
    const segType = e.segment_type ?? null
    const hasRecovery = Boolean(e.recovery_phase)

    // 1. Start beat — first tick only
    if (idx === 0) {
      beats.push({
        id: `start-${e.tick_index}`,
        icon: '🏁',
        label: t({ ja: '出発', en: 'Start' }, uiLanguage),
        kind: 'segment',
      })
    }

    // 2. Motion+road state beat — emits on the FIRST non-recovery tick (the
    //    Start→Driving transition) and on every subsequent (motion, road) change.
    //    prev* start as null, so the first driving tick always produces a beat
    //    even when the road class never changes (or segment_type is absent).
    if (!hasRecovery && (motionKey !== prevMotionKey || segType !== prevSegType)) {
      beats.push({
        id: `motion-${e.tick_index}`,
        icon: motionRoadIcon(motionKey),
        label: motionRoadLabel(motionKey, segType, uiLanguage),
        kind: 'segment',
      })
    }

    // Always track prev (even during recovery, so resuming doesn't re-emit)
    prevMotionKey = motionKey
    prevSegType = segType

    // 3. Traffic jam — rising edge only
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

    // 4. SOFT_WARNING alert — emit once on first occurrence
    if (e.result_type === 'SOFT_WARNING' && prevResultType !== 'SOFT_WARNING') {
      beats.push({
        id: `alert-${e.tick_index}`,
        icon: '⚠️',
        label: t({ ja: 'AICA 注意', en: 'AICA alert' }, uiLanguage),
        kind: 'alert',
      })
    }

    // 5. REST_PROPOSAL — emit once, then immediately inject the action beat
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

    // 6. Recovery phase change
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
