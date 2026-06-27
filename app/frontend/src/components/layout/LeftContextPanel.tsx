import PackageSelector from '../setup/PackageSelector'
import ScenarioSelector from '../setup/ScenarioSelector'
import ParameterEditor from '../setup/ParameterEditor'
import HyperparameterEditor from '../setup/HyperparameterEditor'
import PlanPreview from '../setup/PlanPreview'
import RouteSegmentList from '../context/RouteSegmentList'
import LiveReadouts from '../context/LiveReadouts'

type Props = {
  healthStatus?: string
}

export default function LeftContextPanel({ healthStatus }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      {/* M0 health indicator — kept alive */}
      {healthStatus && (
        <p style={{ fontSize: '0.75em', color: '#888', marginBottom: '8px' }}>{healthStatus}</p>
      )}

      <section style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Setup
        </h2>
        <PackageSelector />
        <ScenarioSelector />
        <ParameterEditor />
        <HyperparameterEditor />
        <PlanPreview />
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Live Readouts
        </h2>
        <LiveReadouts />
      </section>

      <section style={{ flex: 1, overflow: 'auto' }}>
        <h2 style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Route
        </h2>
        <RouteSegmentList />
      </section>
    </div>
  )
}
