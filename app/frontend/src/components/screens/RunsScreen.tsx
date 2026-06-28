/**
 * RunsScreen — browse past runs (M6 T003, T007, T010/T011 S7 replay).
 *
 * Lists persisted runs via GET /api/runs (through RunList).  Selecting a row
 * opens that run's evidence read-only: ReplayViewer (S7 visual replay),
 * RunLogViewer (timeline) + EvidencePanel (export), all driven by an explicit
 * runId prop so they read the past run's log — NOT the active run's store state.
 *
 * Read-only invariant: no Restart, no live controls in this view.
 */

import { useState } from 'react'
import RunList from '../runs/RunList'
import RunLogViewer from '../runs/RunLogViewer'
import EvidencePanel from '../evidence/EvidencePanel'
import ReplayViewer from '../replay/ReplayViewer'

export default function RunsScreen() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  return (
    <div
      data-testid="runs-screen"
      style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '24px 20px',
        overflowY: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <h1
        style={{
          fontSize: '1em',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#374151',
          marginBottom: '20px',
          paddingBottom: '8px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        Past Runs
      </h1>

      <RunList onSelect={setSelectedRunId} selectedRunId={selectedRunId} />

      {selectedRunId && (
        <div
          data-testid="past-run-evidence"
          style={{
            marginTop: '24px',
            borderTop: '1px solid #e5e7eb',
            paddingTop: '16px',
          }}
        >
          <div
            style={{
              fontSize: '0.8em',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#6b7280',
              marginBottom: '12px',
            }}
          >
            Evidence — {selectedRunId}
            <span
              style={{
                marginLeft: '8px',
                fontWeight: 400,
                textTransform: 'none',
                color: '#9ca3af',
                fontSize: '0.9em',
              }}
            >
              (read-only)
            </span>
          </div>

          {/* S7: Visual replay — fetches RunLog via getRunLog, no new endpoint */}
          <ReplayViewer runId={selectedRunId} />

          {/* RunLogViewer with explicit past-run id */}
          <RunLogViewer runId={selectedRunId} />

          {/* EvidencePanel with explicit past-run id — export only, no live controls */}
          <div style={{ marginTop: '8px' }}>
            <EvidencePanel runId={selectedRunId} />
          </div>
        </div>
      )}
    </div>
  )
}
