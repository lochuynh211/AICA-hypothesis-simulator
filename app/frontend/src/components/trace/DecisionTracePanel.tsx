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

import type { TraceEntry, AlgorithmError, Candidate } from '../../api/types'
import { useRunStore } from '../../state/runStore'

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

function TraceEntryRow({ entry }: { entry: TraceEntry }) {
  const hasScores = entry.scores && Object.keys(entry.scores).length > 0

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
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ color: '#6af', fontWeight: 700 }}>tick#{entry.tick_index}</span>
        <span style={{ color: '#ffe066', fontWeight: 700 }}>{entry.result_type}</span>
        {entry.selected_category && (
          <span style={{ color: '#8f8' }}>cat={entry.selected_category}</span>
        )}
        {entry.score !== null && entry.score !== undefined && (
          <span style={{ color: '#fc9' }}>score={entry.score}</span>
        )}
      </div>

      {/* Per-category scores (weighted-score richer trace) */}
      {hasScores && <ScoresRow scores={entry.scores} />}

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
        {entry.explanation}
      </div>
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
