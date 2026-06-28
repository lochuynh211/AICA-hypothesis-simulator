/**
 * LeftContextPanel — left column of the 3-panel Review screen.
 *
 * Holds everything about the *current route status*:
 *   - RouteStatus      — driving time, position, distance from start
 *   - RouteSegmentList — the scenario steps with the active segment highlighted
 *
 * Driver fatigue/drowsiness lives in the right-panel DriverStatus, not here.
 * Setup editors live on SetupScreen — this panel is active-run context only.
 */
import RouteStatus from '../context/RouteStatus'
import ScenarioBeats from '../context/ScenarioBeats'

export default function LeftContextPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      <section style={{ marginBottom: '16px' }}>
        <h2
          style={{
            fontSize: '0.85em',
            fontWeight: 600,
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Route Status
        </h2>
        <RouteStatus />
      </section>

      <section style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <h2
          style={{
            fontSize: '0.85em',
            fontWeight: 600,
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Scenario Beats
        </h2>
        <ScenarioBeats />
      </section>
    </div>
  )
}
