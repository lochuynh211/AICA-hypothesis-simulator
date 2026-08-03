/**
 * MergedLogPanel — the Combined Simulator's right-panel chronological log
 * (020 Task 11): trigger trace entries + proposal events interleaved by
 * correlation tick index, color-coded by subsystem.
 *
 * Mirrors `DecisionTracePanel`'s own `MergedEntry` union/sort pattern (its
 * LIVE-mode `merged` array over `trace`/`algorithmErrors`/`restHistory`) but
 * across the TWO isolated stores this screen mounts via
 * `useMergedCoordinator()`: `state.triggerTrace` (kind `trace`, tickIndex =
 * `tick_index`) and `state.proposalLog.events` (kind `proposal`, tickIndex =
 * the `CorrelationEntry`'s `trigger_tick_index` for that proposal run —
 * slice-1's merged-runs router creates at most one proposal run/correlation
 * entry per merged run (`current_proposal_run_id is None` guard), so a
 * single `find` by `proposal_run_id` is enough here; a future multi-fire
 * slice would need a finer-grained per-event lookup).
 *
 * Trigger rows are a slim inline row — `DecisionTracePanel`'s own
 * `TraceEntryRow` is not exported — styled the same as that panel's
 * REPLAY-mode row (tick#, result_type, selected_category). Proposal rows are
 * the new `ProposalEventRow` below, using the proposal accent color
 * `#7c3aed`.
 *
 * Task 5 additive: trigger rows also surface `TraceEntry.recovery_phase`
 * (same green recovery line + label set as `DecisionTracePanel`'s
 * `RECOVERY_PHASE_LABELS` — duplicated here rather than imported since that
 * map isn't exported), and proposal rows for the rest-journey event types
 * (`REST_SPOT_ARRIVED`/`REST_STARTED`/`REST_COMPLETED`/`RECOMPUTED`) get an
 * extra bilingual label line so the merged log narrates arrive → nap →
 * recover → after-rest recompute, not just raw event-type constants. The
 * merged screen reads the single global `LanguageProvider` (via
 * `useLanguage()`) and threads `lang` through the rows/helpers.
 */
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import type { MergedCoordinatorState } from '../../state/mergedCoordinator'
import type { TraceEntry } from '../../api/types'
import type { DiscreteEvent } from '../../api/proposalClient'
import { t, type UiLanguage } from '../../i18n/t'
import { useLanguage } from '../../state/language'

const PROPOSAL_ACCENT = '#7c3aed'

const LABELS = {
  header: { ja: '統合ログ', en: 'MERGED LOG' },
  empty: { ja: 'まだエントリはありません。', en: 'No entries yet.' },
}

/** Mirrors `DecisionTracePanel`'s own (unexported) `RECOVERY_PHASE_LABELS`. */
const RECOVERY_PHASE_LABELS: Record<string, { ja: string; en: string }> = {
  wakefulness: { ja: 'ドライブ中の覚醒', en: 'En route to rest' },
  arriving: { ja: '休憩所に到着', en: 'Arriving at rest spot' },
  nap: { ja: '仮眠中', en: 'Resting (nap)' },
  content: { ja: '休憩後コンテンツ', en: 'Rest activity' },
  resuming: { ja: '再出発', en: 'Resuming drive' },
}

/** Bilingual labels for the rest-journey proposal event types (Task 5). */
const REST_JOURNEY_EVENT_LABELS: Record<string, { ja: string; en: string }> = {
  REST_SPOT_ARRIVED: { ja: '休憩場所に到着', en: 'Arrived at the rest location' },
  REST_STARTED: { ja: '休憩開始', en: 'Rest started' },
  REST_COMPLETED: { ja: '休憩完了', en: 'Rest completed' },
  RECOMPUTED: { ja: '休憩後に再計算', en: 'Recomputed after rest' },
}

/**
 * Bilingual friendly labels for `trigger_purpose` (Slice 3 Task 3) — a
 * small, purpose-agnostic lookup so `OPPORTUNITY_OPENED` rows read clearly
 * instead of printing the raw enum. The `ja` text mirrors `WorldPanel`'s own
 * `TRIGGER_PURPOSES` map; unlike that map (whose `en` column is deliberately
 * the raw value, used there as button captions), the `en` text here is a
 * genuine friendly label since this panel always renders English (see
 * module doc). Unknown/future purposes fall back to the raw string in
 * `summarizeProposalEvent` below.
 */
const TRIGGER_PURPOSE_LABELS: Record<string, { ja: string; en: string }> = {
  rest_recommended: { ja: '休憩推奨', en: 'Rest recommended' },
  inattentive_driving_prevention_recovery: {
    ja: '注意力低下防止・回復',
    en: 'Inattentive driving prevention & recovery',
  },
  route_music: { ja: 'ルート音楽', en: 'Route music' },
  child_passenger_experience: { ja: '子ども同乗体験', en: 'Child passenger experience' },
}

type MergedEntry =
  | { kind: 'trace'; tickIndex: number; entry: TraceEntry }
  | { kind: 'proposal'; tickIndex: number; event: DiscreteEvent }

/**
 * Builds the chronological trigger+proposal union, sorted ascending by
 * tickIndex; ties break trigger-before-proposal, then by each source
 * array's own order (`Array#sort` is stable — ES2019+/every runtime this
 * project targets — so within-kind ties keep their original relative order
 * for free, no explicit index tiebreaker needed).
 */
function buildMergedEntries(state: MergedCoordinatorState): MergedEntry[] {
  const traceEntries: MergedEntry[] = state.triggerTrace.map((entry) => ({
    kind: 'trace',
    tickIndex: entry.tick_index,
    entry,
  }))

  const proposalEntries: MergedEntry[] = []
  const proposalLog = state.proposalLog
  if (proposalLog) {
    const correlationEntry = state.correlation.find((c) => c.proposal_run_id === proposalLog.run_id)
    const tickIndex = correlationEntry ? correlationEntry.trigger_tick_index : 0
    for (const event of proposalLog.events) {
      proposalEntries.push({ kind: 'proposal', tickIndex, event })
    }
  }

  return [...traceEntries, ...proposalEntries].sort((a, b) => {
    if (a.tickIndex !== b.tickIndex) return a.tickIndex - b.tickIndex
    if (a.kind !== b.kind) return a.kind === 'trace' ? -1 : 1
    return 0
  })
}

/**
 * One-line payload summary per subsystem event: `SERVICE_SELECTED` -> the
 * selected service id, `CONTENT_SELECTED` -> item count (when the payload
 * carries an `items` list) falling back to the selected service id,
 * `OPPORTUNITY_OPENED` -> the friendly bilingual `trigger_purpose` label
 * (via `TRIGGER_PURPOSE_LABELS` above, English resolved same as elsewhere in
 * this panel), falling back to the raw string for unknown purposes.
 * Anything else falls back to a generic `key=value` dump (mirrors
 * `EventTimeline`'s `summarizePayload`).
 */
function summarizeProposalEvent(event: DiscreteEvent, lang: UiLanguage): string {
  const payload = event.payload
  switch (event.event_type) {
    case 'SERVICE_SELECTED':
      return String(payload.selected_service_id ?? '')
    case 'CONTENT_SELECTED':
      return Array.isArray(payload.items)
        ? `${payload.items.length} items`
        : String(payload.selected_service_id ?? '')
    case 'OPPORTUNITY_OPENED': {
      const purpose = String(payload.trigger_purpose ?? '')
      const label = TRIGGER_PURPOSE_LABELS[purpose]
      return label ? t(label, lang) : purpose
    }
    default: {
      const entries = Object.entries(payload)
      if (entries.length === 0) return ''
      return entries
        .map(([key, value]) => `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
        .join(', ')
    }
  }
}

// ── Sub-components ──────────────────────────────────────────────────────────

const fmt = (v: unknown): string => (typeof v === 'number' ? v.toFixed(3) : String(v))

/** The fire threshold the score is compared against, if the entry carries one. */
function entryThreshold(entry: TraceEntry): number | null {
  const c = entry.criteria ?? {}
  for (const k of ['rest_required_threshold', 'threshold_suggest', 'threshold_fire']) {
    const v = c[k as keyof typeof c]
    if (typeof v === 'number') return v
  }
  return null
}

function explanationText(entry: TraceEntry, lang: UiLanguage): string {
  const e = entry.explanation as unknown
  if (e == null) return ''
  if (typeof e === 'string') return e
  if (typeof e === 'object' && ('en' in (e as object) || 'ja' in (e as object))) {
    return t(e as { en: string; ja: string }, lang)
  }
  return String(e)
}

/** Trigger trace row — mirrors the Trigger screen's DecisionTracePanel so the
 * log is actually useful (score, per-category scores, threshold, fire_control,
 * reason_inputs, explanation) — the same TraceEntry data replay reads. */
function TriggerTraceRow({ entry, lang }: { entry: TraceEntry; lang: UiLanguage }) {
  const fc = entry.fire_control
  const threshold = entryThreshold(entry)
  const scoreEntries = Object.entries(entry.scores ?? {}).filter(([, v]) => typeof v === 'number')
  const reasons = Array.isArray(entry.reason_inputs) ? (entry.reason_inputs as unknown[]).map(String).filter(Boolean) : []
  const explanation = explanationText(entry, lang)
  return (
    <div
      data-testid={`merged-log-trigger-${entry.tick_index}`}
      style={{ borderBottom: '1px solid #2a2a2a', padding: '6px 4px', fontSize: '0.85em', fontFamily: 'monospace' }}
    >
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6af', fontWeight: 700 }}>tick#{entry.tick_index}</span>
        <span style={{ color: '#ffe066', fontWeight: 700 }}>{entry.result_type}</span>
        {entry.selected_category && <span style={{ color: '#8f8' }}>cat={entry.selected_category}</span>}
        {typeof entry.score === 'number' && (
          <span data-testid={`merged-log-score-${entry.tick_index}`} style={{ color: '#7dd3fc' }}>
            score={entry.score.toFixed(3)}
            {threshold != null && <span style={{ color: '#f87171' }}> / thr {threshold.toFixed(2)}</span>}
          </span>
        )}
        {entry.segment_type && <span style={{ color: '#a5b4fc' }}>seg={entry.segment_type}</span>}
        {entry.is_traffic_jam && <span style={{ color: '#fca5a5' }}>🚧jam</span>}
      </div>
      {scoreEntries.length > 0 && (
        <div style={{ color: '#94a3b8', marginTop: '2px', wordBreak: 'break-all' }}>
          {scoreEntries.map(([k, v]) => `${k}=${fmt(v)}`).join('  ')}
        </div>
      )}
      {fc && (
        <div style={{ color: fc.fired ? '#fbbf24' : '#64748b', marginTop: '2px' }}>
          fire: fired={String(fc.fired)} suppressed={String(fc.suppressed)}
          {fc.reason ? ` (${fc.reason})` : ''}
        </div>
      )}
      {reasons.length > 0 && <div style={{ color: '#cbd5e1', marginTop: '2px' }}>{reasons.join(' · ')}</div>}
      {explanation && <div style={{ color: '#e2e8f0', marginTop: '2px', whiteSpace: 'normal' }}>{explanation}</div>}
      {entry.recovery_phase && (
        <div data-testid={`merged-log-recovery-phase-${entry.tick_index}`} style={{ color: '#34d399', marginTop: '2px' }}>
          🛌{' '}
          {t(RECOVERY_PHASE_LABELS[entry.recovery_phase] ?? { ja: entry.recovery_phase, en: entry.recovery_phase }, lang)}
        </div>
      )}
    </div>
  )
}

function ProposalEventRow({
  tickIndex,
  event,
  rowIndex,
  lang,
}: {
  tickIndex: number
  event: DiscreteEvent
  rowIndex: number
  lang: UiLanguage
}) {
  const summary = summarizeProposalEvent(event, lang)
  const journeyLabel = REST_JOURNEY_EVENT_LABELS[event.event_type]
  return (
    <div
      data-testid={`merged-log-proposal-${rowIndex}-${event.event_type}`}
      style={{
        borderBottom: '1px solid #2a2a2a',
        padding: '6px 4px',
        fontSize: '0.85em',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6af', fontWeight: 700 }}>tick#{tickIndex}</span>
        <span style={{ color: PROPOSAL_ACCENT, fontWeight: 700 }}>{event.event_type}</span>
      </div>
      {journeyLabel && (
        <div style={{ color: PROPOSAL_ACCENT, marginTop: '2px', fontWeight: 600 }}>{t(journeyLabel, lang)}</div>
      )}
      {summary && <div style={{ color: PROPOSAL_ACCENT, marginTop: '2px' }}>{summary}</div>}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function MergedLogPanel() {
  const { state } = useMergedCoordinator()
  const { lang } = useLanguage()
  const entries = buildMergedEntries(state)

  return (
    <div
      data-testid="merged-log-panel"
      style={{ background: '#111', color: '#ddd', overflowY: 'auto', height: '100%', minHeight: 0, fontSize: '0.85em' }}
    >
      <div
        style={{
          padding: '4px 8px',
          background: '#1a1a1a',
          fontWeight: 700,
          fontSize: '0.8em',
          letterSpacing: '0.05em',
          color: '#aaa',
          borderBottom: '1px solid #333',
        }}
      >
        {t(LABELS.header, lang)}
      </div>
      {entries.length === 0 ? (
        <div data-testid="merged-log-empty" style={{ padding: '8px', color: '#666' }}>
          {t(LABELS.empty, lang)}
        </div>
      ) : (
        entries.map((item, i) =>
          item.kind === 'trace' ? (
            <TriggerTraceRow key={`t-${i}`} entry={item.entry} lang={lang} />
          ) : (
            <ProposalEventRow key={`p-${i}`} tickIndex={item.tickIndex} event={item.event} rowIndex={i} lang={lang} />
          ),
        )
      )}
    </div>
  )
}
