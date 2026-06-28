/**
 * LeftContextPanel — left column of the 3-panel Review screen (M6 T003).
 *
 * Now shows context-only content: live readouts and the route segment list.
 * The setup editors (PackageSelector, ScenarioSelector, ParameterEditor,
 * HyperparameterEditor, MapKeyAndRouteInput, PlanPreview) have been relocated
 * to SetupScreen — this panel is de-cluttered for the active-run context.
 */
import RouteSegmentList from '../context/RouteSegmentList'
import LiveReadouts from '../context/LiveReadouts'

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
          Live Readouts
        </h2>
        <LiveReadouts />
      </section>

      <section style={{ flex: 1, overflow: 'auto' }}>
        <h2
          style={{
            fontSize: '0.85em',
            fontWeight: 600,
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Route
        </h2>
        <RouteSegmentList />
      </section>
    </div>
  )
}
