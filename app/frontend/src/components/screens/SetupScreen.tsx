/**
 * SetupScreen — the dedicated setup view (M6 three-view shell, T003).
 *
 * Three equal-width panels laid out side by side:
 *   - Left   : run essentials — package, route/map, tick duration, and the
 *              Plan Preview + Start Run button.
 *   - Middle : algorithm tuning — setup parameters and hyperparameters.
 *   - Right  : context profiles — scenario selection and driver/vehicle/speed
 *              profile overrides.
 *
 * Each panel scrolls independently so a long section in one column never pushes
 * the others off-screen.
 *
 * "Start Run" in PlanPreview dispatches RUN_CREATED, which auto-transitions the
 * store's viewMode to 'review' — no explicit navigation needed here.
 */

import type { CSSProperties, ReactNode } from 'react'
import PackageSelector from '../setup/PackageSelector'
import ScenarioSelector from '../setup/ScenarioSelector'
import ParameterEditor from '../setup/ParameterEditor'
import HyperparameterEditor from '../setup/HyperparameterEditor'
import ProfileEditor from '../setup/ProfileEditor'
import TickSecondsEditor from '../setup/TickSecondsEditor'
import MapKeyAndRouteInput from '../setup/MapKeyAndRouteInput'
import PlanPreview from '../setup/PlanPreview'

const sectionHeadingStyle: CSSProperties = {
  fontSize: '0.78em',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#6b7280',
  marginBottom: '10px',
}

/** A titled group of editors within a panel. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '20px' }}>
      <h2 style={sectionHeadingStyle}>{title}</h2>
      {children}
    </section>
  )
}

/** One of the three equal-width, independently-scrolling columns. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflowY: 'auto',
        padding: '20px 16px',
        background: '#fafafa',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
      }}
    >
      <h2
        style={{
          fontSize: '0.92em',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#374151',
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  )
}

export default function SetupScreen() {
  return (
    <div
      data-testid="setup-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '20px',
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
          marginBottom: '16px',
        }}
      >
        Run Setup
      </h1>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
        }}
      >
        {/* Left — run essentials */}
        <Panel title="Run Essentials">
          <Section title="Package">
            <PackageSelector />
          </Section>
          <Section title="Route (optional: Google Maps)">
            <MapKeyAndRouteInput />
          </Section>
          <Section title="Timing">
            <TickSecondsEditor />
          </Section>
          <Section title="Plan Preview">
            <PlanPreview />
          </Section>
        </Panel>

        {/* Middle — algorithm tuning */}
        <Panel title="Algorithm Parameters">
          <Section title="Parameters">
            <ParameterEditor />
          </Section>
          <Section title="Hyperparameters">
            <HyperparameterEditor />
          </Section>
        </Panel>

        {/* Right — context profiles */}
        <Panel title="Profiles">
          <Section title="Scenario Profile">
            <ScenarioSelector />
          </Section>
          <Section title="Driver &amp; Vehicle Profiles">
            <ProfileEditor />
          </Section>
        </Panel>
      </div>
    </div>
  )
}
