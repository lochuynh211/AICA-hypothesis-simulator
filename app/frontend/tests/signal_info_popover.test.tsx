/**
 * SignalInfoPopover — feature 009 FE2.
 *
 * Tests: opening the ⓘ for each simulated signal (drowsiness, fatigue,
 * anomaly_rate) shows its explanation text; closed by default.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RunStoreProvider } from '../src/state/runStore'
import SignalInfoPopover from '../src/components/setup/SignalInfoPopover'

describe('SignalInfoPopover — feature 009 FE2', () => {
  it('is closed by default (no explanation text shown)', () => {
    render(
      <RunStoreProvider>
        <SignalInfoPopover signalKey="drowsiness" label="Drowsiness" />
      </RunStoreProvider>,
    )
    expect(screen.queryByTestId('signal-info-drowsiness')).not.toBeInTheDocument()
  })

  it('drowsiness: opening the ⓘ shows its explanation', () => {
    render(
      <RunStoreProvider>
        <SignalInfoPopover signalKey="drowsiness" label="Drowsiness" />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-drowsiness'))
    expect(screen.getByTestId('signal-info-drowsiness')).toHaveTextContent(/Deterministic/)
  })

  it('fatigue: opening the ⓘ shows its explanation', () => {
    render(
      <RunStoreProvider>
        <SignalInfoPopover signalKey="fatigue" label="Fatigue" />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-fatigue'))
    expect(screen.getByTestId('signal-info-fatigue')).toHaveTextContent(/60 min/)
  })

  it('anomaly_rate: opening the ⓘ shows its explanation', () => {
    render(
      <RunStoreProvider>
        <SignalInfoPopover signalKey="anomaly_rate" label="Anomaly Rate" />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-anomaly_rate'))
    expect(screen.getByTestId('signal-info-anomaly_rate')).toHaveTextContent(/seeded/i)
  })

  it('toggles closed again on a second click', () => {
    render(
      <RunStoreProvider>
        <SignalInfoPopover signalKey="drowsiness" label="Drowsiness" />
      </RunStoreProvider>,
    )
    const btn = screen.getByTestId('signal-info-btn-drowsiness')
    fireEvent.click(btn)
    expect(screen.getByTestId('signal-info-drowsiness')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByTestId('signal-info-drowsiness')).not.toBeInTheDocument()
  })

  it('renders the Japanese explanation when uiLanguage is ja', () => {
    render(
      <RunStoreProvider initialLanguage="ja">
        <SignalInfoPopover signalKey="fatigue" label="疲労" />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-fatigue'))
    expect(screen.getByTestId('signal-info-fatigue')).toHaveTextContent(/蓄積/)
  })
})
