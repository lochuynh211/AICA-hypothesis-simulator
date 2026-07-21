/**
 * RunLogViewer — T009 (evidence timeline upgrade)
 *
 * Loads the persisted run log via getRunLog(runId) on demand and renders it as
 * an ordered, expandable evidence timeline.  Each event is shown as a compact
 * header that expands to reveal detail.  Feedback events are rendered visually
 * distinct from simulator facts (different background/border + "HUMAN REVIEW" marker).
 *
 * Read-only: rendered entirely from the saved log — no algorithm recalculation,
 * no live store writes, no engine calls.
 */

import { useState } from 'react'
import { getRunLog } from '../../api/client'
import { useRunStore } from '../../state/runStore'
import type {
  RunLog,
  TickEvent,
  ActionEvent,
  AlgorithmErrorEvent,
  FeedbackEvent,
  FeedbackTarget,
} from '../../api/types'
import ErrorNotice from '../common/ErrorNotice'
import { t, type UiLanguage } from '../../i18n/t'

const LABELS = {
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm Error' },
  runFallback: { ja: '実行', en: 'run' },
  humanReview: { ja: 'HUMAN REVIEW', en: 'HUMAN REVIEW' },
  feedback: { ja: 'フィードバック', en: 'Feedback' },
  noEvents: { ja: '記録されたイベントはありません。', en: 'No events recorded.' },
  runLog: { ja: 'RUN LOG', en: 'RUN LOG' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  load: { ja: '読み込み', en: 'Load' },
  clickLoad: { ja: '「読み込み」をクリックして保存済みの実行ログを表示します。', en: 'Click Load to view the persisted run log.' },
  noActiveRun: { ja: 'アクティブな実行はありません。', en: 'No active run.' },
}

// ── Colour tokens (dark-theme, matches DecisionTracePanel palette) ─────────────

const C = {
  border: '1px solid #2a2a2a',
  bg: '#111',
  bgHeader: '#1a1a1a',
  bgError: '#2a0a0a',
  bgFeedback: '#0f0f1a',
  tick: '#6af',
  resultType: '#ffe066',
  cat: '#8f8',
  score: '#fc9',
  err: '#f66',
  errLight: '#f88',
  errMsg: '#faa',
  action: '#9cf',
  muted: '#aaa',
  faint: '#666',
  feedbackBorder: '#446',
  feedbackAccent: '#9cf',
  feedbackMarker: '#c8a',
}

// ── Shared expand/collapse button ─────────────────────────────────────────────

function ExpandButton({
  testId,
  open,
  onToggle,
}: {
  testId: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      data-testid={testId}
      onClick={onToggle}
      aria-expanded={open}
      style={{
        fontSize: '0.75em',
        padding: '1px 6px',
        cursor: 'pointer',
        background: open ? '#1a1a2a' : '#1a1a1a',
        color: open ? '#9cf' : C.faint,
        border: `1px solid ${open ? '#446' : '#333'}`,
        borderRadius: '3px',
        marginLeft: 'auto',
        flexShrink: 0,
      }}
    >
      {open ? '▲' : '▼'}
    </button>
  )
}

// ── Tick event row ─────────────────────────────────────────────────────────────

function TickEventRow({ event }: { event: TickEvent }) {
  const [open, setOpen] = useState(false)
  const dr = event.trace.decision_result
  const ti = event.tick_index

  return (
    <div
      data-testid={`timeline-tick-${ti}`}
      style={{ borderBottom: C.border, fontFamily: 'monospace' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          padding: '5px 8px',
          background: C.bgHeader,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: C.tick, fontWeight: 700 }}>tick#{ti}</span>
        <span style={{ color: C.resultType, fontWeight: 700 }}>{dr.result_type}</span>
        {dr.selected_category && (
          <span style={{ color: C.cat }}>cat={dr.selected_category}</span>
        )}
        {dr.score !== null && dr.score !== undefined && (
          <span style={{ color: C.score }}>score={dr.score}</span>
        )}
        <ExpandButton
          testId={`timeline-expand-tick-${ti}`}
          open={open}
          onToggle={() => setOpen((p) => !p)}
        />
      </div>

      {/* Detail */}
      {open && (
        <div
          data-testid={`timeline-tick-detail-${ti}`}
          style={{ padding: '6px 10px', background: C.bg, fontSize: '0.82em' }}
        >
          <div>
            <span style={{ color: C.muted }}>result_type: </span>
            <span style={{ color: C.resultType }}>{dr.result_type}</span>
          </div>
          {dr.selected_category && (
            <div>
              <span style={{ color: C.muted }}>category: </span>
              <span style={{ color: C.cat }}>{dr.selected_category}</span>
            </div>
          )}
          {dr.score !== null && dr.score !== undefined && (
            <div>
              <span style={{ color: C.muted }}>score: </span>
              <span style={{ color: C.score }}>{dr.score}</span>
            </div>
          )}
          <div style={{ color: C.muted, marginTop: '2px' }}>
            fire_control: fired={String(dr.fire_control.fired)}{' '}
            suppressed={String(dr.fire_control.suppressed)}
            {dr.fire_control.reason && ` (${dr.fire_control.reason})`}
          </div>
          {dr.candidates.length > 0 && (
            <div style={{ color: C.faint, marginTop: '2px' }}>
              candidates: {dr.candidates.map((c) => c.category).join(', ')}
            </div>
          )}
          {dr.reason_inputs.length > 0 && (
            <div style={{ color: '#888', marginTop: '2px' }}>
              inputs: {dr.reason_inputs.join(', ')}
            </div>
          )}
          <div style={{ color: '#ccc', marginTop: '2px', fontStyle: 'italic' }}>
            {typeof dr.explanation === 'string'
              ? dr.explanation
              : JSON.stringify(dr.explanation)}
          </div>
          {dr.proposal && (
            <div style={{ color: '#9fc', marginTop: '2px' }}>
              proposal: {dr.proposal.id}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Action event row ──────────────────────────────────────────────────────────

function ActionEventRow({ event }: { event: ActionEvent }) {
  const [open, setOpen] = useState(false)
  const ti = event.tick_index

  return (
    <div
      data-testid={`timeline-action-${ti}`}
      style={{ borderBottom: C.border, fontFamily: 'monospace' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          padding: '5px 8px',
          background: C.bgHeader,
        }}
      >
        <span style={{ color: C.tick, fontWeight: 700 }}>tick#{ti}</span>
        <span style={{ color: C.action, fontWeight: 700 }}>action</span>
        <span style={{ color: '#ddd' }}>{event.action}</span>
        <ExpandButton
          testId={`timeline-expand-action-${ti}`}
          open={open}
          onToggle={() => setOpen((p) => !p)}
        />
      </div>

      {/* Detail */}
      {open && (
        <div
          data-testid={`timeline-action-detail-${ti}`}
          style={{ padding: '6px 10px', background: C.bg, fontSize: '0.82em' }}
        >
          <div>
            <span style={{ color: C.muted }}>action: </span>
            <span style={{ color: C.action }}>{event.action}</span>
          </div>
          <div>
            <span style={{ color: C.muted }}>resulting_status: </span>
            <span style={{ color: '#ddd' }}>{event.resulting_status}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Algorithm-error event row ─────────────────────────────────────────────────

function AlgorithmErrorEventRow({ event, lang }: { event: AlgorithmErrorEvent; lang: UiLanguage }) {
  const [open, setOpen] = useState(false)
  const ti = event.tick_index

  return (
    <div
      data-testid={`timeline-algorithm-error-${ti}`}
      style={{ borderBottom: C.border, fontFamily: 'monospace', background: C.bgError }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          padding: '5px 8px',
        }}
      >
        <span style={{ color: C.tick, fontWeight: 700 }}>tick#{ti}</span>
        <span style={{ color: C.err, fontWeight: 700 }}>{t(LABELS.algorithmError, lang)}</span>
        <span style={{ color: C.errLight }}>{event.error_type}</span>
        <ExpandButton
          testId={`timeline-expand-algorithm-error-${ti}`}
          open={open}
          onToggle={() => setOpen((p) => !p)}
        />
      </div>

      {/* Detail */}
      {open && (
        <div
          data-testid={`timeline-algorithm-error-detail-${ti}`}
          style={{ padding: '6px 10px', fontSize: '0.82em' }}
        >
          <div>
            <span style={{ color: C.muted }}>error_type: </span>
            <span style={{ color: C.errLight }}>{event.error_type}</span>
          </div>
          <div style={{ color: C.errMsg, marginTop: '2px' }}>{event.message}</div>
        </div>
      )}
    </div>
  )
}

// ── Feedback label value rendering ────────────────────────────────────────────

function LabelValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span style={{ color: C.faint }}>—</span>

  // Note-field value: {choice, note}
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { choice?: unknown; note?: unknown }
    return (
      <span>
        <span style={{ color: '#ddd' }}>{String(v.choice ?? '')}</span>
        {v.note && (
          <span style={{ color: '#bbb', fontStyle: 'italic' }}> / {String(v.note)}</span>
        )}
      </span>
    )
  }

  return <span style={{ color: '#ddd' }}>{String(value)}</span>
}

function renderTargetLabel(target: FeedbackTarget, lang: UiLanguage): string {
  switch (target.scope) {
    case 'decision':
      return `decision${target.tick_index !== null && target.tick_index !== undefined ? ` (tick#${target.tick_index})` : ''}`
    case 'proposal':
      return `proposal${target.proposal_id ? ` (${target.proposal_id})` : ''}`
    case 'action':
      return `action${target.action ? ` (${target.action})` : ''}`
    case 'run':
      return t(LABELS.runFallback, lang)
    default:
      return target.scope
  }
}

// ── Feedback event row ────────────────────────────────────────────────────────

function FeedbackEventRow({ event, fbIdx, lang }: { event: FeedbackEvent; fbIdx: number; lang: UiLanguage }) {
  const [open, setOpen] = useState(false)
  const targetLabel = renderTargetLabel(event.target, lang)

  return (
    <div
      data-testid="timeline-feedback"
      style={{
        borderBottom: C.border,
        borderLeft: `3px solid ${C.feedbackBorder}`,
        fontFamily: 'monospace',
        background: C.bgFeedback,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          padding: '5px 8px',
        }}
      >
        <span
          style={{
            color: C.feedbackMarker,
            fontWeight: 700,
            fontSize: '0.78em',
            letterSpacing: '0.06em',
          }}
        >
          {t(LABELS.humanReview, lang)}
        </span>
        <span style={{ color: C.feedbackAccent }}>{t(LABELS.feedback, lang)}</span>
        <span style={{ color: C.muted }}>→</span>
        <span style={{ color: '#ccc' }}>{targetLabel}</span>
        <ExpandButton
          testId={`timeline-expand-feedback-${fbIdx}`}
          open={open}
          onToggle={() => setOpen((p) => !p)}
        />
      </div>

      {/* Detail */}
      {open && (
        <div
          data-testid={`timeline-feedback-detail-${fbIdx}`}
          style={{ padding: '6px 10px', fontSize: '0.82em' }}
        >
          {/* Target */}
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: C.muted }}>scope: </span>
            <span style={{ color: C.feedbackAccent }}>{event.target.scope}</span>
            {event.target.tick_index !== null && event.target.tick_index !== undefined && (
              <span style={{ color: C.muted }}> tick#{event.target.tick_index}</span>
            )}
            {event.target.proposal_id && (
              <span style={{ color: C.muted }}> proposal={event.target.proposal_id}</span>
            )}
            {event.target.action && (
              <span style={{ color: C.muted }}> action={event.target.action}</span>
            )}
          </div>

          {/* Labels */}
          {Object.keys(event.labels).length > 0 && (
            <div style={{ marginBottom: '4px' }}>
              {Object.entries(event.labels).map(([key, val]) => (
                <div key={key}>
                  <span style={{ color: '#8af' }}>{key}</span>
                  <span style={{ color: C.faint }}>: </span>
                  <LabelValue value={val} />
                </div>
              ))}
            </div>
          )}

          {/* Comment */}
          {event.comment && (
            <div style={{ color: '#ccc', marginTop: '4px', fontStyle: 'italic' }}>
              &ldquo;{event.comment}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ log, lang }: { log: RunLog; lang: UiLanguage }) {
  let fbCounter = 0

  return (
    <div
      data-testid="runlog-content"
      style={{
        background: C.bg,
        color: '#ddd',
        overflowY: 'auto',
        maxHeight: '60vh',
        fontSize: '0.82em',
      }}
    >
      {log.events.length === 0 && (
        <div style={{ padding: '8px', color: C.faint }}>{t(LABELS.noEvents, lang)}</div>
      )}
      {log.events.map((event, idx) => {
        if (event.kind === 'feedback') {
          const fi = fbCounter++
          return <FeedbackEventRow key={idx} event={event} fbIdx={fi} lang={lang} />
        }
        if (event.kind === 'tick') return <TickEventRow key={idx} event={event} />
        if (event.kind === 'action') return <ActionEventRow key={idx} event={event} />
        if (event.kind === 'algorithm_error') return <AlgorithmErrorEventRow key={idx} event={event} lang={lang} />
        return null
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type RunLogViewerProps = {
  /** Explicit run_id to load — overrides the active run from the store.
   *  Pass this when viewing a past run from the Runs screen. */
  runId?: string
}

export default function RunLogViewer({ runId: runIdProp }: RunLogViewerProps = {}) {
  const { state } = useRunStore()
  const runId = runIdProp ?? state.runState?.run_id ?? null
  const { uiLanguage } = state

  const [log, setLog] = useState<RunLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLoad = async () => {
    if (!runId) return
    setLoading(true)
    setError(null)
    setLog(null)
    try {
      const result = await getRunLog(runId)
      setLog(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '0.82em' }}>
      {/* Header bar */}
      <div
        style={{
          padding: '4px 8px',
          background: C.bgHeader,
          fontWeight: 700,
          fontSize: '0.8em',
          letterSpacing: '0.05em',
          color: C.muted,
          borderBottom: C.border,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{t(LABELS.runLog, uiLanguage)}</span>
        <button
          onClick={handleLoad}
          disabled={!runId || loading}
          style={{
            fontSize: '0.85em',
            padding: '1px 8px',
            cursor: runId && !loading ? 'pointer' : 'not-allowed',
            background: '#333',
            color: runId ? '#ccc' : C.faint,
            border: '1px solid #555',
            borderRadius: '3px',
          }}
        >
          {loading ? t(LABELS.loading, uiLanguage) : t(LABELS.load, uiLanguage)}
        </button>
        {runId && <span style={{ color: C.faint, fontSize: '0.85em' }}>{runId}</span>}
      </div>

      {/* Error */}
      {error && (
        <ErrorNotice testid="runlog-error" message={`Error: ${error}`} />
      )}

      {/* Timeline */}
      {log && <Timeline log={log} lang={uiLanguage} />}

      {/* Empty-state prompts */}
      {!log && !error && !loading && runId && (
        <div style={{ padding: '6px 8px', color: C.faint, fontSize: '0.85em' }}>
          {t(LABELS.clickLoad, uiLanguage)}
        </div>
      )}
      {!runId && (
        <div style={{ padding: '6px 8px', color: C.faint, fontSize: '0.85em' }}>
          {t(LABELS.noActiveRun, uiLanguage)}
        </div>
      )}
    </div>
  )
}
