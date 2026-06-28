/**
 * SetupScreen — the dedicated setup view (M6 three-view shell, T003).
 *
 * Hosts all setup editors that were previously crammed into LeftContextPanel:
 * PackageSelector, ScenarioSelector, ParameterEditor, HyperparameterEditor,
 * ProfileEditor (T009 — scenario profile field overrides), TickSecondsEditor
 * (setup-time tick duration override), MapKeyAndRouteInput (M4 — key stays
 * in-memory only), and PlanPreview.
 *
 * "Start Run" in PlanPreview dispatches RUN_CREATED, which auto-transitions
 * the store's viewMode to 'review' — no explicit navigation needed here.
 */

import PackageSelector from '../setup/PackageSelector'
import ScenarioSelector from '../setup/ScenarioSelector'
import ParameterEditor from '../setup/ParameterEditor'
import HyperparameterEditor from '../setup/HyperparameterEditor'
import ProfileEditor from '../setup/ProfileEditor'
import TickSecondsEditor from '../setup/TickSecondsEditor'
import MapKeyAndRouteInput from '../setup/MapKeyAndRouteInput'
import PlanPreview from '../setup/PlanPreview'

export default function SetupScreen() {
  return (
    <div
      data-testid="setup-screen"
      style={{
        maxWidth: '600px',
        margin: '0 auto',
        padding: '24px 20px',
        overflowY: 'auto',
        height: '100%',
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
        Run Setup
      </h1>

      <section style={{ marginBottom: '20px' }}>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Package &amp; Scenario
        </h2>
        <PackageSelector />
        <ScenarioSelector />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Algorithm Parameters
        </h2>
        <ParameterEditor />
        <HyperparameterEditor />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Driver &amp; Vehicle Profiles
        </h2>
        <ProfileEditor />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Timing
        </h2>
        <TickSecondsEditor />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Route (optional: Google Maps)
        </h2>
        <MapKeyAndRouteInput />
      </section>

      <section>
        <h2
          style={{
            fontSize: '0.78em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6b7280',
            marginBottom: '10px',
          }}
        >
          Plan Preview
        </h2>
        <PlanPreview />
      </section>
    </div>
  )
}
