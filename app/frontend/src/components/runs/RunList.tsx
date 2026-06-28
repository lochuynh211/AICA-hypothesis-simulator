/**
 * RunList (M6 T007) — browse past runs from GET /api/runs.
 *
 * Fetches listRuns on mount; renders rows (run_id, package, scenario, status,
 * created_at) sorted newest-first.  Clicking a row selects it (or deselects
 * it if already selected); the parent RunsScreen renders evidence for the
 * selected run.
 *
 * Read-only listing: no restart, no live controls — those belong to the active
 * run on the Review screen.  No new deps.
 */

import { useState, useEffect } from 'react'
import { listRuns } from '../../api/client'
import type { RunSummary } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice'

const C = {
  bg: '#fff',
  header: '#f8fafc',
  border: '1px solid #e5e7eb',
  rowHover: '#f1f5f9',
  rowSelected: '#dbeafe',
  muted: '#6b7280',
  text: '#111827',
}

type RunListProps = {
  onSelect: (runId: string | null) => void
  selectedRunId: string | null
}

export default function RunList({ onSelect, selectedRunId }: RunListProps) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    listRuns()
      .then(({ runs: fetched }) => {
        // Sort newest first by created_at (ISO string lexicographic comparison)
        const sorted = [...fetched].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        )
        setRuns(sorted)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load runs')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '12px', color: C.muted, fontSize: '0.9em' }}>
        Loading runs…
      </div>
    )
  }

  if (error) {
    return <ErrorNotice testid="run-list-error" message={`Error: ${error}`} />
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: '12px', color: C.muted, fontSize: '0.9em' }}>
        No past runs found. Complete a run to see it here.
      </div>
    )
  }

  return (
    <table
      data-testid="run-list"
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.85em',
        background: C.bg,
        border: C.border,
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      <thead>
        <tr
          style={{
            background: C.header,
            borderBottom: C.border,
          }}
        >
          {['Run ID', 'Package', 'Scenario', 'Status', 'Created'].map((col) => (
            <th
              key={col}
              style={{
                padding: '6px 10px',
                textAlign: 'left',
                fontWeight: 600,
                color: C.muted,
                fontSize: '0.8em',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                borderRight: C.border,
              }}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => {
          const isSelected = selectedRunId === run.run_id
          return (
            <tr
              key={run.run_id}
              data-testid={`run-row-${run.run_id}`}
              onClick={() => onSelect(isSelected ? null : run.run_id)}
              style={{
                cursor: 'pointer',
                background: isSelected ? C.rowSelected : C.bg,
                borderBottom: C.border,
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLTableRowElement).style.background = C.rowHover
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLTableRowElement).style.background = isSelected
                  ? C.rowSelected
                  : C.bg
              }}
            >
              <td
                style={{
                  padding: '6px 10px',
                  fontFamily: 'monospace',
                  color: C.text,
                  maxWidth: '220px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {run.run_id}
              </td>
              <td style={{ padding: '6px 10px', color: C.text }}>{run.package_id}</td>
              <td style={{ padding: '6px 10px', color: C.text }}>{run.scenario_id}</td>
              <td style={{ padding: '6px 10px', color: C.muted }}>{run.status}</td>
              <td
                style={{
                  padding: '6px 10px',
                  color: C.muted,
                  fontFamily: 'monospace',
                  fontSize: '0.9em',
                }}
              >
                {run.created_at}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
