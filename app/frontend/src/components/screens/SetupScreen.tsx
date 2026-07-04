/**
 * SetupScreen — the setup-screen skeleton (feature 009, signal-tier redesign, FE1).
 *
 * Replaces the M6 three-equal-column layout with the two-editor +
 * full-width-instant-result-strip layout from others/aica_setup_screen_uiux.md:
 *
 *   ┌─ Scenario & Signals ──────────┬─ Algorithm (formulation) ─────────┐
 *   │        SignalsPanel           │      AlgorithmFormulationPanel    │
 *   ├────────────────────────────────┴───────────────────────────────────┤
 *   │                        InstantResultStrip                          │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * SignalsPanel / AlgorithmFormulationPanel / InstantResultStrip are FE1
 * plumbing stubs — FE2/FE3/FE4 implement their internals. See each
 * component's file for its props/store contract.
 *
 * useRunPreview() is wired here (once, at the screen level) so the debounced
 * POST /runs/preview fires on any setup change regardless of which panel
 * triggered it — see state/runStore.ts.
 */

import type { CSSProperties, ReactNode } from 'react'
import SignalsPanel from '../setup/SignalsPanel'
import AlgorithmFormulationPanel from '../setup/AlgorithmFormulationPanel'
import InstantResultStrip from '../setup/InstantResultStrip'
import { useRunPreview } from '../../state/runStore'

/** One of the two equal-width, independently-scrolling editor panels. */
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

const stripStyle: CSSProperties = {
  marginTop: '16px',
  // Quick-review panel is content-sized and kept THIN (a slim score curve over a
  // thin road band, like the Review progress bar); scrolls if it ever overflows.
  flexShrink: 0,
  maxHeight: '40vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: '16px',
  background: '#fafafa',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
}

export default function SetupScreen() {
  // Debounced POST /runs/preview on any setup change (package/scenario/
  // hyperparameter-overrides/run_seed) — see state/runStore.ts.
  useRunPreview()

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

      {/* Two balanced editor panels on top */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
        }}
      >
        <Panel title="Scenario & Signals">
          <SignalsPanel />
        </Panel>
        <Panel title="Algorithm">
          <AlgorithmFormulationPanel />
        </Panel>
      </div>

      {/* Full-width instant-result strip pinned across the bottom */}
      <div style={stripStyle}>
        <InstantResultStrip />
      </div>
    </div>
  )
}
