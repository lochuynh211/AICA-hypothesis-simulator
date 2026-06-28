/**
 * DecisionTracePanel — T026 + T019
 *
 * Renders the live decision trace from the run store:
 *   - Each tick entry (TraceEntry) with result_type, selected_category, score,
 *     candidates (suppressed candidates visibly marked), fire_control, reason_inputs,
 *     and explanation.
 *   - Per-category scores (scores dict) and per-candidate strength + state labels
 *     for weighted-score entries (T019 richer trace).
 *   - algorithmErrors rendered as distinct error entries (never disguised as decisions).
 */

import { useState } from 'react'
import type { TraceEntry, AlgorithmError, Candidate } from '../../api/types'
import { useRunStore } from '../../state/runStore'
import FeedbackForm from '../feedback/FeedbackForm'
import { t } from '../../i18n/t'

// ── Sub-components ────────────────────────────────────────────────────────────

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const { fire_control, category, score, strength, state } = candidate
  const suppressed = fire_control.suppressed

  return (
    <div
      style={{
        marginLeft: '12px',
        padding: '2px 6px',
        borderLeft: suppressed ? '3px solid #e87c00' : '3px solid #555',
        marginBottom: '2px',
        fontSize: '0.82em',
      }}
    >
      <span style={{ fontWeight: 600 }}>{category}</span>
      {' '}
      <span style={{ color: '#aaa' }}>score={score}</span>
      {strength && (
        <span
          data-testid={`candidate-strength-${category}`}
          style={{ marginLeft: '6px', color: '#8cf', fontStyle: 'italic' }}
        >
          [{strength}]
        </span>
      )}
      {state && (
        <span
          data-testid={`candidate-state-${category}`}
          style={{ marginLeft: '6px', color: '#9d9', fontSize: '0.85em' }}
        >
          {state}
        </span>
      )}
      {suppressed && (
        <span
          data-testid="candidate-suppressed-label"
          style={{
            marginLeft: '6px',
            color: '#e87c00',
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: '0.78em',
            letterSpacing: '0.05em',
          }}
        >
          [suppressed]
        </span>
      )}
      {fire_control.reason && (
        <span style={{ marginLeft: '6px', color: '#888', fontStyle: 'italic' }}>
          {fire_control.reason}
        </span>
      )}
    </div>
  )
}

function ScoresRow({ scores }: { scores: Record<string, unknown> }) {
  const entries = Object.entries(scores)
  if (entries.length === 0) return null

  return (
    <div style={{ marginTop: '3px', fontSize: '0.80em', color: '#9b9' }}>
      {entries.map(([key, val]) => (
        <span
          key={key}
          data-testid={`scores-${key}`}
          style={{ marginRight: '10px' }}
        >
          {key}={typeof val === 'number' ? val.toFixed(3) : String(val)}
        </span>
      ))}
    </div>
  )
}

function StateLabelsRow({ states }: { states: Record<string, unknown> }) {
  const entries = Object.entries(states)
  if (entries.length === 0) return null

  return (
    <div style={{ marginTop: '3px', fontSize: '0.80em', color: '#c9f' }}>
      {entries.map(([key, val]) => (
        <span
          key={key}
          data-testid={`state-${key}`}
          style={{ marginRight: '10px' }}
        >
          {key}={String(val)}
        </span>
      ))}
    </div>
  )
}

type PackageRuntimeState = {
  smoothed_scores?: Record<string, number>
  persistence_counters?: Record<string, number>
  smoothed_features?: Record<string, unknown>
  states?: Record<string, unknown>
}

function RuntimeStateIndicator({ runtimeState }: { runtimeState: Record<string, unknown> }) {
  if (Object.keys(runtimeState).length === 0) return null

  const rs = runtimeState as PackageRuntimeState
  const smoothedScores = rs.smoothed_scores ?? {}
  const persistenceCounters = rs.persistence_counters ?? {}

  const scoreEntries = Object.entries(smoothedScores)
  const counterEntries = Object.entries(persistenceCounters)

  return (
    <div
      data-testid="runtime-state-indicator"
      style={{ marginTop: '3px', fontSize: '0.78em', color: '#88b', borderLeft: '2px solid #448', paddingLeft: '6px' }}
    >
      {scoreEntries.length > 0 && (
        <span style={{ marginRight: '8px' }}>
          scores:{' '}
          {scoreEntries.map(([k, v]) => (
            <span key={k} style={{ marginRight: '6px' }}>
              {k}={typeof v === 'number' ? v.toFixed(3) : String(v)}
            </span>
          ))}
        </span>
      )}
      {counterEntries.length > 0 && (
        <span>
          persist:{' '}
          {counterEntries.map(([k, v]) => (
            <span key={k} style={{ marginRight: '6px' }}>
              {k}={typeof v === 'number' ? String(v) : String(v)}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

function TraceEntryRow({ entry }: { entry: TraceEntry }) {
  const hasScores = entry.scores && Object.keys(entry.scores).length > 0
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const { state } = useRunStore()
  const { uiLanguage } = state

  return (
    <div
      style={{
        borderBottom: '1px solid #2a2a2a',
        padding: '6px 4px',
        fontSize: '0.85em',
        fontFamily: 'monospace',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#6af', fontWeight: 700 }}>tick#{entry.tick_index}</span>
        <span style={{ color: '#ffe066', fontWeight: 700 }}>{entry.result_type}</span>
        {entry.selected_category && (
          <span style={{ color: '#8f8' }}>cat={entry.selected_category}</span>
        )}
        {entry.score !== null && entry.score !== undefined && (
          <span style={{ color: '#fc9' }}>score={entry.score}</span>
        )}
        {/* Per-decision feedback affordance */}
        <button
          data-testid={`feedback-toggle-tick-${entry.tick_index}`}
          onClick={() => setFeedbackOpen((prev) => !prev)}
          style={{
            marginLeft: 'auto',
            fontSize: '0.78em',
            padding: '1px 6px',
            cursor: 'pointer',
            background: feedbackOpen ? '#2a2a4a' : '#1a1a1a',
            color: feedbackOpen ? '#9cf' : '#666',
            border: '1px solid #444',
            borderRadius: '3px',
          }}
          aria-expanded={feedbackOpen}
          aria-label={`Give feedback on tick ${entry.tick_index}`}
        >
          {feedbackOpen ? 'Close feedback' : 'Give feedback'}
        </button>
      </div>

      {/* Per-category scores (weighted-score richer trace) */}
      {hasScores && <ScoresRow scores={entry.scores} />}

      {/* Per-tick state labels (hybrid algorithm) */}
      <StateLabelsRow states={entry.states ?? {}} />

      {/* Candidates */}
      {entry.candidates.length > 0 && (
        <div style={{ marginTop: '2px' }}>
          {entry.candidates.map((c, i) => (
            <CandidateRow key={i} candidate={c} />
          ))}
        </div>
      )}

      {/* fire_control outcome */}
      <div style={{ color: '#aaa', marginTop: '2px' }}>
        fire_control: fired={String(entry.fire_control.fired)}{' '}
        suppressed={String(entry.fire_control.suppressed)}
        {entry.fire_control.reason && ` (${entry.fire_control.reason})`}
      </div>

      {/* reason_inputs */}
      {entry.reason_inputs.length > 0 && (
        <div style={{ color: '#888', marginTop: '2px' }}>
          inputs: {entry.reason_inputs.join(', ')}
        </div>
      )}

      {/* explanation */}
      <div style={{ color: '#ccc', marginTop: '2px', fontStyle: 'italic' }}>
        {t(entry.explanation as Parameters<typeof t>[0], uiLanguage)}
      </div>

      {/* Runtime-state indicator (hybrid algorithm — recorded output this tick) */}
      <RuntimeStateIndicator runtimeState={entry.next_package_runtime_state ?? {}} />

      {/* Inline feedback form for this decision tick */}
      {feedbackOpen && (
        <div
          data-testid={`decision-feedback-form-tick-${entry.tick_index}`}
          style={{
            marginTop: '6px',
            padding: '6px',
            background: '#0f0f1a',
            border: '1px solid #333',
            borderRadius: '4px',
          }}
        >
          <FeedbackForm
            target={{ scope: 'decision', tick_index: entry.tick_index }}
            onSuccess={() => setFeedbackOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

function AlgorithmErrorRow({ error }: { error: AlgorithmError }) {
  return (
    <div
      style={{
        borderBottom: '1px solid #2a2a2a',
        padding: '6px 4px',
        fontSize: '0.85em',
        fontFamily: 'monospace',
        background: '#2a0a0a',
      }}
    >
      <div style={{ display: 'flex', gap: '10px' }}>
        <span style={{ color: '#6af', fontWeight: 700 }}>tick#{error.tick_index}</span>
        <span style={{ color: '#f66', fontWeight: 700 }}>Algorithm Error</span>
        <span style={{ color: '#f88' }}>{error.error_type}</span>
      </div>
      <div style={{ color: '#faa', marginTop: '2px' }}>{error.message}</div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function DecisionTracePanel() {
  const { state } = useRunStore()
  const { trace, algorithmErrors } = state

  const hasEntries = trace.length > 0 || algorithmErrors.length > 0

  if (!hasEntries) {
    return (
      <div style={{ padding: '8px', color: '#666', fontSize: '0.85em', fontFamily: 'monospace' }}>
        No trace entries yet.
      </div>
    )
  }

  // Merge trace entries and algorithm errors into a unified timeline by tick_index.
  // TraceEntry has tick_index; AlgorithmError has tick_index.
  type MergedEntry =
    | { kind: 'trace'; tickIndex: number; entry: TraceEntry }
    | { kind: 'error'; tickIndex: number; error: AlgorithmError }

  const merged: MergedEntry[] = [
    ...trace.map((e) => ({ kind: 'trace' as const, tickIndex: e.tick_index, entry: e })),
    ...algorithmErrors.map((e) => ({ kind: 'error' as const, tickIndex: e.tick_index, error: e })),
  ].sort((a, b) => a.tickIndex - b.tickIndex)

  return (
    <div
      style={{
        background: '#111',
        color: '#ddd',
        overflowY: 'auto',
        maxHeight: '100%',
        fontSize: '0.85em',
      }}
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
        DECISION TRACE
      </div>
      {merged.map((item, i) =>
        item.kind === 'trace' ? (
          <TraceEntryRow key={`t-${i}`} entry={item.entry} />
        ) : (
          <AlgorithmErrorRow key={`e-${i}`} error={item.error} />
        ),
      )}
    </div>
  )
}
