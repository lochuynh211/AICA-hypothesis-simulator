/**
 * EventTimeline (P4 T032, US5) — a simple newest-first list of the current
 * run's discrete events (`run_log.events`), each showing its `event_type`,
 * `at` timestamp, and a compact rendering of its `payload`.
 *
 * DISPLAY-ONLY: renders exactly what the backend's append-only log holds —
 * it never recomputes or re-derives events (Constitution I/II; evidence
 * replay renders from the log without recalculating).
 */
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import type { DiscreteEvent } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'イベント・タイムライン', en: 'Event timeline' },
  empty: { ja: 'イベントはまだありません。', en: 'No events yet.' },
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(', ')
}

export default function EventTimeline() {
  const { state } = useProposalStore()
  const { uiLanguage: lang, runLog } = state
  const events: DiscreteEvent[] = runLog?.events ?? []
  // Newest-first, per the brief — the log itself stays append-only/oldest-first.
  const ordered = [...events].reverse()

  return (
    <div data-testid="event-timeline">
      <div style={sectionLabelStyle}>{t(LABELS.title, lang)}</div>
      {ordered.length === 0 ? (
        <p data-testid="event-timeline-empty" style={{ fontSize: '0.8em', color: '#6b7280' }}>
          {t(LABELS.empty, lang)}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ordered.map((ev, index) => (
            <li key={`${ev.event_type}-${index}`} data-testid={`event-row-${index}`} style={eventRowStyle}>
              <span style={{ fontWeight: 700 }}>{ev.event_type}</span>{' '}
              <span style={{ color: '#6b7280' }}>{String(ev.at)}</span>
              {summarizePayload(ev.payload) && (
                <div style={{ fontSize: '0.78em', color: '#4b5563' }}>{summarizePayload(ev.payload)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const eventRowStyle: React.CSSProperties = {
  fontSize: '0.82em',
  padding: '6px 0',
  borderBottom: '1px solid #e5e7eb',
}
