/**
 * RouteStatus — left-panel "current route status" readout.
 *
 * Driving time (elapsed), position %, and distance from start — all from the
 * shared useRouteProgress hook so the value matches the progress bar and map.
 * Display-only; driver bands live in the right-panel DriverStatus.
 */
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from '../playback/useRouteProgress'

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#2563eb',
  fontWeight: 700,
}
const valueStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 700,
  color: '#1e3a8a',
  fontVariantNumeric: 'tabular-nums',
  marginBottom: '8px',
}

export default function RouteStatus() {
  const { state } = useRunStore()
  const { currentFraction, elapsedSeconds, hasRun } = useRouteProgress()

  const elapsed = formatElapsed(elapsedSeconds)
  const positionPct = `${Math.round(currentFraction * 100)}%`

  // Distance from start — only when route_facts carries a total distance.
  const rf = state.runState?.route_facts as { total_distance_km?: number } | undefined
  const totalKm = typeof rf?.total_distance_km === 'number' ? rf.total_distance_km : null
  const distanceKm = totalKm != null ? `${(totalKm * currentFraction).toFixed(1)} km` : null

  return (
    <div
      data-testid="route-status"
      style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: '6px' }}
    >
      <div style={labelStyle}>Driving time</div>
      <div data-testid="route-status-time" style={valueStyle}>
        {hasRun ? elapsed : '—'}
      </div>

      <div style={labelStyle}>Position</div>
      <div data-testid="route-status-position" style={valueStyle}>
        {hasRun ? positionPct : '—'}
      </div>

      {distanceKm && (
        <>
          <div style={labelStyle}>Distance from start</div>
          <div data-testid="route-status-distance" style={{ ...valueStyle, marginBottom: 0 }}>
            {distanceKm}
          </div>
        </>
      )}
    </div>
  )
}
