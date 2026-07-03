/**
 * SignalsPanel — feature 009 FE2 + UX-FE1.
 *
 * Tests:
 *  (a) Renders the three tier groups (Fixed / Dynamic / Simulated) with the
 *      expected signal rows once a scenario is selected.
 *  (b) Editable Fixed signals (familiarRoute, childPassenger, weatherRisk)
 *      expose a ✎ edit control; isNight (Fixed, no backend context-override
 *      key) and all Dynamic/Simulated signals do not.
 *  (c) Editing an editable checkbox signal dispatches SET_CONTEXT_OVERRIDE
 *      and updates the store (checkbox reflects the new value).
 *  (d) Simulated signals each expose an ⓘ info button.
 *  (e) UX-FE1: weather_risk is editable — dispatches SET_CONTEXT_OVERRIDE
 *      into contextOverrides.weather_risk; reverting to the scenario default
 *      removes the override key.
 *  (f) UX-FE1: PackageSelector no longer renders inside this panel (moved to
 *      AlgorithmFormulationPanel).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { ScenarioDef } from '../src/api/types'

// ── Mock the full client module ─────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  createRunPlan: vi.fn(),
  regenerateRunPlan: vi.fn(),
  routesAnalyze: vi.fn(),
  actRun: vi.fn(),
  tickRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
  getEvidence: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
  runPreview: vi.fn(),
}))

import * as client from '../src/api/client'
import SignalsPanel from '../src/components/setup/SignalsPanel'

// ── Fixtures ──────────────────────────────────────────────────────────────

const scenarioFixture: ScenarioDef = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona: { name: 'Haruto' },
  route_intent: {
    rest_facility: { label: 'Roadside Station' },
    segments: [],
  },
  initial_state: { drowsiness_level: '20', fatigue_level: '20' },
  event_presets: { drowsiness_schedule: [], signal_duration_at_trigger: 'persistent' },
  driver_signal_params: {
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
  },
  anomaly_signal_params: { lambda_base: 0.02, lambda_gain: 0.15, theta: 40, window_min: 5 },
  run_seed_default: 42,
  total_duration_seconds: 7200,
  tick_seconds: 60,
  allowed_actions: ['accept_rest', 'postpone', 'decline'],
  review_focus: 'Base trigger timing',
  is_night: false,
  child_passenger: true,
  familiar_route: true,
  weather_risk: 30,
}

// ── Render helper ───────────────────────────────────────────────────────────

function StateProbe() {
  const { state } = useRunStore()
  return <div data-testid="state-probe" data-context={JSON.stringify(state.contextOverrides)} />
}

function contextOverrides(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('state-probe').getAttribute('data-context') ?? '{}')
}

function renderInStore(
  ui: React.ReactElement,
  setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void,
) {
  const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }

  function DispatchCapture() {
    const { dispatch } = useRunStore()
    dispatchRef.current = dispatch
    return null
  }

  const result = render(
    <RunStoreProvider>
      <DispatchCapture />
      <StateProbe />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return result
}

describe('SignalsPanel — feature 009 FE2', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('renders no signal groups until a scenario is selected', async () => {
    renderInStore(<SignalsPanel />)
    expect(screen.getByTestId('signals-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('signal-group-fixed')).not.toBeInTheDocument()
    // Let ScenarioSelector's own listScenarios effect settle before the next
    // test renders, so its state update doesn't leak across tests.
    await waitFor(() => expect(client.listScenarios).toHaveBeenCalled())
  })

  it('(f) UX-FE1: PackageSelector no longer renders inside SignalsPanel (moved to AlgorithmFormulationPanel)', async () => {
    renderInStore(<SignalsPanel />)
    expect(screen.queryByLabelText(/Algorithm Package/i)).not.toBeInTheDocument()
    await waitFor(() => expect(client.listScenarios).toHaveBeenCalled())
  })

  it('(a) renders the three tier groups with the expected signal rows once a scenario is selected', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('signal-group-fixed')).toBeInTheDocument()
    })
    expect(screen.getByTestId('signal-group-dynamic')).toBeInTheDocument()
    expect(screen.getByTestId('signal-group-simulated')).toBeInTheDocument()

    // Fixed
    expect(screen.getByTestId('signal-row-isNight')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-familiarRoute')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-childPassenger')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-weatherRisk')).toBeInTheDocument()
    // Dynamic
    expect(screen.getByTestId('signal-row-continuousDrivingMin')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-segmentMotionJam')).toBeInTheDocument()
    // Simulated
    expect(screen.getByTestId('signal-row-drowsiness')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-fatigue')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-anomaly_rate')).toBeInTheDocument()
  })

  it('(b) editable Fixed signals expose a ✎ control; isNight and Dynamic/Simulated signals do not', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('signal-edit-familiarRoute')).toBeInTheDocument()
    })
    expect(screen.getByTestId('signal-edit-childPassenger')).toBeInTheDocument()
    expect(screen.getByTestId('signal-edit-weatherRisk')).toBeInTheDocument()

    // isNight: no edit control
    expect(screen.queryByTestId('signal-edit-isNight')).not.toBeInTheDocument()
    // Dynamic/Simulated: no edit control
    expect(screen.queryByTestId('signal-edit-continuousDrivingMin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-segmentMotionJam')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-drowsiness')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-fatigue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-anomaly_rate')).not.toBeInTheDocument()
  })

  it('(c) editing an editable signal dispatches SET_CONTEXT_OVERRIDE and updates the store', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const checkbox = (await screen.findByTestId('signal-edit-childPassenger')) as HTMLInputElement
    // Default (from scenario.child_passenger = true) is checked.
    expect(checkbox.checked).toBe(true)

    fireEvent.click(checkbox)

    // The checkbox reflects the new (unchecked) value — proves the change
    // round-tripped through SET_CONTEXT_OVERRIDE back into contextOverrides.
    await waitFor(() => {
      expect((screen.getByTestId('signal-edit-childPassenger') as HTMLInputElement).checked).toBe(false)
    })
    expect(contextOverrides().child_passenger).toBe(false)

    // Reverting back to the scenario default (true) removes the override key
    // entirely — changed-from-default only (mirrors SET_HYPERPARAMETER).
    fireEvent.click(screen.getByTestId('signal-edit-childPassenger'))
    await waitFor(() => expect(contextOverrides().child_passenger).toBeUndefined())
  })

  it('(e) UX-FE1: weather_risk is editable — dispatches SET_CONTEXT_OVERRIDE, revert-to-default removes the key', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const input = (await screen.findByTestId('signal-edit-weatherRisk')) as HTMLInputElement
    // Pre-filled from the scenario's own weather_risk default (30).
    expect(input.value).toBe('30')

    fireEvent.change(input, { target: { value: '65' } })
    await waitFor(() => expect(contextOverrides().weather_risk).toBe(65))

    // Reverting to the scenario default (30) removes the override key.
    fireEvent.change(screen.getByTestId('signal-edit-weatherRisk'), { target: { value: '30' } })
    await waitFor(() => expect(contextOverrides().weather_risk).toBeUndefined())
  })

  it('(d) each Simulated signal exposes an ⓘ info button', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('signal-info-btn-drowsiness')).toBeInTheDocument()
    })
    expect(screen.getByTestId('signal-info-btn-fatigue')).toBeInTheDocument()
    expect(screen.getByTestId('signal-info-btn-anomaly_rate')).toBeInTheDocument()
  })
})
