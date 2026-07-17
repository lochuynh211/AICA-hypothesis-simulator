/**
 * EventTimeline (P4 T032, US5; extended P7 T032/T036, US5) — a newest-first
 * list of the current run's discrete events (`run_log.events`), each
 * showing its `event_type`, `at` timestamp, and a compact rendering of its
 * `payload`. Grouped into decision-point sections by opportunity_id — P7
 * recomputes append a fresh `OPPORTUNITY_OPENED`/`RECOMPUTED` pair rather
 * than replacing the run, so a recomputed run's events span more than one
 * opportunity (FR-023); the section for the run's CURRENT head opportunity
 * is marked distinctly from historical ones.
 *
 * DISPLAY-ONLY: renders exactly what the backend's append-only log holds —
 * it never recomputes or re-derives events (Constitution I/II; evidence
 * replay renders from the log without recalculating).
 */
import { t, type BilingualLabel } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import type { DiscreteEvent } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'イベント・タイムライン', en: 'Event timeline' },
  empty: { ja: 'イベントはまだありません。', en: 'No events yet.' },
  decisionPoint: { ja: '意思決定ポイント', en: 'Decision point' },
  current: { ja: '（現在）', en: '(current)' },
}

/** Bilingual captions for the two P7-added event types (FR-024) — shown
 * ALONGSIDE the raw backend `event_type` string (never replacing it: other
 * event types stay untranslated exactly as before, and existing tests
 * assert the raw type text is present verbatim). */
const EVENT_TYPE_CAPTIONS: Record<string, BilingualLabel> = {
  RECOMPUTED: { ja: '再計算されました', en: 'Recomputed' },
  CONTEXT_EDITED: { ja: 'コンテキストが編集されました', en: 'Context edited' },
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(', ')
}

/**
 * One opportunity_id per event (oldest-first, same order/length as
 * `events`) — the decision point that event belongs to. `OPPORTUNITY_OPENED`
 * starts a new group from its own payload; every other event inherits the
 * most recently opened group. A `CONTEXT_EDITED` is the reviewer edit that
 * TRIGGERS the following recompute, so it is grouped with the opportunity
 * it produces (the next `OPPORTUNITY_OPENED`), not the one it was read
 * from.
 */
function opportunityGroupIds(events: DiscreteEvent[]): string[] {
  const afterIds: string[] = []
  let current = ''
  for (const ev of events) {
    if (ev.event_type === 'OPPORTUNITY_OPENED') {
      current = String(ev.payload.opportunity_id ?? current)
    }
    afterIds.push(current)
  }
  const groupIds = afterIds.slice()
  for (let i = 0; i < events.length; i++) {
    if (events[i].event_type === 'CONTEXT_EDITED' && i + 1 < events.length) {
      groupIds[i] = afterIds[i + 1]
    }
  }
  return groupIds
}

export default function EventTimeline() {
  const { state } = useProposalStore()
  const { uiLanguage: lang, runLog } = state
  const events: DiscreteEvent[] = runLog?.events ?? []
  const groupIds = opportunityGroupIds(events)
  const currentOpportunityId = runLog?.opportunity.opportunity_id ?? null

  // Newest-first, per the brief — the log itself stays append-only/oldest-first.
  const ordered = [...events].reverse()
  const orderedGroupIds = [...groupIds].reverse()

  return (
    <div data-testid="event-timeline">
      <div style={sectionLabelStyle}>{t(LABELS.title, lang)}</div>
      {ordered.length === 0 ? (
        <p data-testid="event-timeline-empty" style={{ fontSize: '0.8em', color: '#6b7280' }}>
          {t(LABELS.empty, lang)}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ordered.map((ev, index) => {
            const groupId = orderedGroupIds[index]
            const isNewGroup = index === 0 || orderedGroupIds[index - 1] !== groupId
            const caption = EVENT_TYPE_CAPTIONS[ev.event_type]
            return (
              <li key={`${ev.event_type}-${index}`}>
                {isNewGroup && groupId && (
                  <div data-testid={`decision-point-${groupId}`} style={decisionPointHeaderStyle}>
                    {t(LABELS.decisionPoint, lang)} <code>{groupId}</code>
                    {groupId === currentOpportunityId && (
                      <span style={currentBadgeStyle}>{t(LABELS.current, lang)}</span>
                    )}
                  </div>
                )}
                <div data-testid={`event-row-${index}`} style={eventRowStyle}>
                  <span style={{ fontWeight: 700 }}>{ev.event_type}</span>{' '}
                  {caption && <span style={captionStyle}>{t(caption, lang)}</span>}{' '}
                  <span style={{ color: '#6b7280' }}>{String(ev.at)}</span>
                  {summarizePayload(ev.payload) && (
                    <div style={{ fontSize: '0.78em', color: '#4b5563' }}>{summarizePayload(ev.payload)}</div>
                  )}
                </div>
              </li>
            )
          })}
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

const decisionPointHeaderStyle: React.CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 800,
  color: '#1d4ed8',
  background: '#eef2ff',
  borderRadius: '6px',
  padding: '4px 8px',
  margin: '10px 0 2px',
}

const currentBadgeStyle: React.CSSProperties = {
  marginLeft: '6px',
  fontWeight: 800,
  color: '#059669',
}

const captionStyle: React.CSSProperties = {
  fontSize: '0.86em',
  color: '#4b5563',
  fontStyle: 'italic',
}
