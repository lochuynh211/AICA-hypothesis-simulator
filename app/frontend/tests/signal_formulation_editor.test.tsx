/**
 * SignalFormulationEditor — feature 009 UX-FE2.
 *
 * Tests:
 *  (a) The formula text renders for each Tier-3 signal (drowsiness, fatigue,
 *      anomaly_rate) once its ⓘ is opened.
 *  (b) Editing a drowsiness param to a non-default value dispatches
 *      SET_PROFILE_OVERRIDES with `driver.drowsiness_model.<field>` set;
 *      reverting to the scenario default removes the override entirely
 *      (changed-from-default discipline, mirrors SET_HYPERPARAMETER /
 *      SET_CONTEXT_OVERRIDE).
 *  (c) Same for fatigue (`driver.fatigue_model.<field>`).
 *  (d) Editing an anomaly param sets `anomaly.<field>`.
 *  (e) Editing two different sub-models in sequence preserves both overrides
 *      (proves the "patch only my field, keep the rest" merge is correct
 *      given SET_PROFILE_OVERRIDES replaces the whole object).
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import SignalFormulationEditor from '../src/components/setup/SignalFormulationEditor'
import type { DriverSignalParams, AnomalySignalParams } from '../src/api/types'

const driverDefaults: DriverSignalParams = {
  id: 'friend_drive_driver_v1',
  drowsiness_model: {
    base_growth_per_min: 0.9,
    night_add_per_min: 0.3,
    monotony_add_per_min: 0.3,
    traffic_jam_add_per_min: 0.1,
  },
  fatigue_model: {
    base_growth_per_min: 0.3,
    continuous_driving_add_per_min_after_60_min: 0.2,
    mountain_road_add_per_min: 0.2,
    traffic_jam_add_per_min: 0.05,
  },
  recovery_model: {
    short_rest_drowsiness_recovery: 20,
    short_rest_fatigue_recovery: 15,
    long_rest_drowsiness_recovery: 35,
    long_rest_fatigue_recovery: 30,
  },
}

const anomalyDefaults: AnomalySignalParams = { lambda_base: 0.02, lambda_gain: 0.15, theta: 40, window_min: 5 }

const scenarioFixture = { driver_signal_params: driverDefaults, anomaly_signal_params: anomalyDefaults }

function StateProbe() {
  const { state } = useRunStore()
  return <div data-testid="state-probe" data-profiles={JSON.stringify(state.profileOverrides)} />
}

function profileOverrides(): Record<string, unknown> | null {
  const raw = screen.getByTestId('state-probe').getAttribute('data-profiles') ?? 'null'
  return JSON.parse(raw)
}

describe('SignalFormulationEditor — feature 009 UX-FE2', () => {
  it('(a) drowsiness: opening the ⓘ shows the formula text', () => {
    render(
      <RunStoreProvider>
        <SignalFormulationEditor signalKey="drowsiness" label="Drowsiness" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-drowsiness'))
    expect(screen.getByTestId('signal-formula-text-drowsiness')).toHaveTextContent(/night/i)
    expect(screen.getByTestId('signal-formula-text-drowsiness')).toHaveTextContent(/Δt\/60/)
  })

  it('(a) fatigue: opening the ⓘ shows the formula text', () => {
    render(
      <RunStoreProvider>
        <SignalFormulationEditor signalKey="fatigue" label="Fatigue" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-fatigue'))
    expect(screen.getByTestId('signal-formula-text-fatigue')).toHaveTextContent(/mountain/i)
  })

  it('(a) anomaly_rate: opening the ⓘ shows the formula text', () => {
    render(
      <RunStoreProvider>
        <SignalFormulationEditor signalKey="anomaly_rate" label="Anomaly Rate" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-anomaly_rate'))
    expect(screen.getByTestId('signal-formula-text-anomaly_rate')).toHaveTextContent(/lambda_base/)
    expect(screen.getByTestId('signal-formula-text-anomaly_rate')).toHaveTextContent(/window_min/)
  })

  it('(b) editing a drowsiness param dispatches SET_PROFILE_OVERRIDES with driver.drowsiness_model.<field>; revert removes it', () => {
    render(
      <RunStoreProvider>
        <StateProbe />
        <SignalFormulationEditor signalKey="drowsiness" label="Drowsiness" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-drowsiness'))

    const input = screen.getByTestId('signal-formula-field-drowsiness-night_add_per_min') as HTMLInputElement
    expect(input.value).toBe('0.3')

    fireEvent.change(input, { target: { value: '0.6' } })
    expect(profileOverrides()).toEqual({ driver: { drowsiness_model: { night_add_per_min: 0.6 } } })

    // Revert to the scenario default removes the override key entirely.
    fireEvent.change(screen.getByTestId('signal-formula-field-drowsiness-night_add_per_min'), {
      target: { value: '0.3' },
    })
    expect(profileOverrides()).toBeNull()
  })

  it('(c) editing a fatigue param dispatches SET_PROFILE_OVERRIDES with driver.fatigue_model.<field>', () => {
    render(
      <RunStoreProvider>
        <StateProbe />
        <SignalFormulationEditor signalKey="fatigue" label="Fatigue" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-fatigue'))

    fireEvent.change(screen.getByTestId('signal-formula-field-fatigue-mountain_road_add_per_min'), {
      target: { value: '0.5' },
    })
    expect(profileOverrides()).toEqual({ driver: { fatigue_model: { mountain_road_add_per_min: 0.5 } } })
  })

  it('(d) editing an anomaly param dispatches SET_PROFILE_OVERRIDES with anomaly.<field>; revert removes it', () => {
    render(
      <RunStoreProvider>
        <StateProbe />
        <SignalFormulationEditor signalKey="anomaly_rate" label="Anomaly Rate" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-anomaly_rate'))

    const input = screen.getByTestId('signal-formula-field-anomaly_rate-lambda_base') as HTMLInputElement
    expect(input.value).toBe('0.02')

    fireEvent.change(input, { target: { value: '0.05' } })
    expect(profileOverrides()).toEqual({ anomaly: { lambda_base: 0.05 } })

    fireEvent.change(screen.getByTestId('signal-formula-field-anomaly_rate-lambda_base'), {
      target: { value: '0.02' },
    })
    expect(profileOverrides()).toBeNull()
  })

  it('(e) editing drowsiness then anomaly preserves both overrides (SET_PROFILE_OVERRIDES replace-whole-object patched correctly)', () => {
    render(
      <RunStoreProvider>
        <StateProbe />
        <SignalFormulationEditor signalKey="drowsiness" label="Drowsiness" scenario={scenarioFixture} />
        <SignalFormulationEditor signalKey="anomaly_rate" label="Anomaly Rate" scenario={scenarioFixture} />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('signal-info-btn-drowsiness'))
    fireEvent.click(screen.getByTestId('signal-info-btn-anomaly_rate'))

    fireEvent.change(screen.getByTestId('signal-formula-field-drowsiness-base_growth_per_min'), {
      target: { value: '1.2' },
    })
    fireEvent.change(screen.getByTestId('signal-formula-field-anomaly_rate-theta'), {
      target: { value: '50' },
    })

    expect(profileOverrides()).toEqual({
      driver: { drowsiness_model: { base_growth_per_min: 1.2 } },
      anomaly: { theta: 50 },
    })
  })
})
