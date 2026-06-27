/**
 * RunLogViewer — T027
 *
 * Loads the persisted run log via getRunLog(runId) on demand and renders it as
 * a static, readable JSON display.  No replay, no auto-refresh loop.
 * The evidence view is a static display of the saved log JSON only.
 */

import { useState } from 'react'
import { getRunLog } from '../../api/client'
import { useRunStore } from '../../state/runStore'
import type { RunLog } from '../../api/types'

export default function RunLogViewer() {
  const { state } = useRunStore()
  const runId = state.runState?.run_id ?? null

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
      <div
        style={{
          padding: '4px 8px',
          background: '#1a1a1a',
          fontWeight: 700,
          fontSize: '0.8em',
          letterSpacing: '0.05em',
          color: '#aaa',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>RUN LOG</span>
        <button
          onClick={handleLoad}
          disabled={!runId || loading}
          style={{
            fontSize: '0.85em',
            padding: '1px 8px',
            cursor: runId && !loading ? 'pointer' : 'not-allowed',
            background: '#333',
            color: runId ? '#ccc' : '#666',
            border: '1px solid #555',
            borderRadius: '3px',
          }}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
        {runId && (
          <span style={{ color: '#666', fontSize: '0.85em' }}>{runId}</span>
        )}
      </div>

      {error && (
        <div
          data-testid="runlog-error"
          style={{ color: '#f66', padding: '6px 8px', background: '#200' }}
        >
          Error: {error}
        </div>
      )}

      {log && (
        <pre
          data-testid="runlog-content"
          style={{
            margin: 0,
            padding: '8px',
            background: '#0d0d0d',
            color: '#bbb',
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: '60vh',
            fontSize: '0.8em',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(log, null, 2)}
        </pre>
      )}

      {!log && !error && !loading && runId && (
        <div style={{ padding: '6px 8px', color: '#555', fontSize: '0.85em' }}>
          Click Load to view the persisted run log.
        </div>
      )}

      {!runId && (
        <div style={{ padding: '6px 8px', color: '#555', fontSize: '0.85em' }}>
          No active run.
        </div>
      )}
    </div>
  )
}
