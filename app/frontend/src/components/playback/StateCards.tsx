/**
 * StateCards — middle-panel "car status + current environment" cards.
 *
 * Two side-by-side cards (mirrors the prototype state panels):
 *   - In-car status     : drowsiness band bar + vehicle motion (moving/stopped)
 *   - Driving environment: road type + speed band of the active route segment
 *
 * Drowsiness comes from the backend decision features; road type / speed band /
 * motion come from the active route segment (the segment whose `at` is the
 * greatest ≤ current route_fraction). Display-only.
 */
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from './useRouteProgress'
import { bandViz } from '../common/bands'

const cardStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#fff',
  padding: '10px 12px',
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6b7280',
  marginBottom: '8px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.82em',
  marginBottom: '6px',
  gap: '8px',
}
const keyStyle: React.CSSProperties = { color: '#6b7280' }
const valStyle: React.CSSProperties = { color: '#111', fontWeight: 600 }

export default function StateCards() {
  const { state } = useRunStore()
  const { latestDecision } = state
  const { activeSegment, hasRun } = useRouteProgress()

  const drowsiness = latestDecision?.features?.drowsiness_level ?? null
  const viz = bandViz(drowsiness)
  const stopped = activeSegment?.is_rest_facility ?? false

  return (
    <div data-testid="state-cards" style={{ display: 'flex', gap: '12px', margin: '12px 0' }}>
      {/* In-car status */}
      <div style={cardStyle}>
        <div style={cardTitle}>🚗 In-car status</div>
        <div style={rowStyle}>
          <span style={keyStyle}>Drowsiness</span>
          <span style={{ ...valStyle, color: viz.color }}>{drowsiness ?? '—'}</span>
        </div>
        <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
          <div
            style={{
              height: '100%',
              width: `${viz.pct}%`,
              background: viz.color,
              transition: 'width 0.5s ease, background 0.5s ease',
            }}
          />
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <span style={keyStyle}>Vehicle</span>
          <span style={valStyle}>{hasRun ? (stopped ? 'stopped' : 'moving') : '—'}</span>
        </div>
      </div>

      {/* Driving environment */}
      <div style={cardStyle}>
        <div style={cardTitle}>🛣️ Driving environment</div>
        <div style={rowStyle}>
          <span style={keyStyle}>Road type</span>
          <span style={valStyle}>{activeSegment?.type ?? '—'}</span>
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <span style={keyStyle}>Speed band</span>
          <span style={valStyle}>{activeSegment?.speed_band ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}
