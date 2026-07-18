/**
 * MergedRunsScreen — browse past merged runs (feature 020, Slice-2c, Task 6).
 *
 * Lists persisted merged runs via `listMergedRuns()` (`GET /api/merged-runs`).
 * Selecting a row mounts `MergedReplayViewer` with an explicit
 * `mergedRunId` prop — the SAME screen-level read-only discipline
 * `RunsScreen` uses for the trigger-only Simulator (no restart, no live
 * controls; the viewer reads a past run's persisted logs, never the live
 * `mergedCoordinator` state).
 */
import { useEffect, useState } from 'react'
import { listMergedRuns, type MergedRunSummary } from '../../api/mergedClient'
import MergedReplayViewer from './MergedReplayViewer'

export default function MergedRunsScreen() {
  const [runs, setRuns] = useState<MergedRunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listMergedRuns()
      .then((list) => {
        if (!cancelled) setRuns(list)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Load once on mount — this screen owns its own data, independent of the
    // live mergedCoordinator state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      data-testid="merged-runs-screen"
      style={{ padding: '16px', overflow: 'auto', height: '100%', color: '#ddd', background: '#111' }}
    >
      <h3 style={{ margin: '0 0 10px', color: '#eee', fontSize: '1em' }}>Merged runs</h3>

      {error && (
        <p role="alert" style={{ color: '#f66', fontSize: '0.85em' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p data-testid="merged-runs-loading" style={{ color: '#888' }}>
          Loading…
        </p>
      ) : runs.length === 0 ? (
        <p data-testid="merged-runs-empty" style={{ color: '#888' }}>
          No persisted merged runs yet.
        </p>
      ) : (
        <table data-testid="merged-run-list" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
              <th style={thStyle}>Merged run ID</th>
              <th style={thStyle}>Trigger run</th>
              <th style={thStyle}>Proposal runs</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const isSelected = selectedId === run.merged_run_id
              return (
                <tr
                  key={run.merged_run_id}
                  data-testid={`merged-run-row-${run.merged_run_id}`}
                  onClick={() => setSelectedId(isSelected ? null : run.merged_run_id)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#1e3a5f' : 'transparent',
                    borderBottom: '1px solid #222',
                  }}
                >
                  <td style={tdStyle}>
                    <code>{run.merged_run_id}</code>
                  </td>
                  <td style={tdStyle}>{run.trigger_run_id ?? '—'}</td>
                  <td style={tdStyle}>{run.proposal_run_ids_count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {selectedId && (
        <div data-testid="merged-run-detail" style={{ marginTop: '16px' }}>
          <MergedReplayViewer mergedRunId={selectedId} />
        </div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.78em', color: '#888' }
const tdStyle: React.CSSProperties = { padding: '6px 10px', color: '#ddd' }
