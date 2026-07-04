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
  listRoutePresets: vi.fn(() => Promise.resolve({ presets: [] })),
  loadRoutePreset: vi.fn(),
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
      sleep: { drowsiness: 35, fatigue: 30 },
      audio_karaoke: { drowsiness: 8, fatigue: 5 },
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
  speed_profile: {
    normal_road_kph: 60,
    highway_kph: 100,
    mountain_road_kph: 40,
    sightseeing_road_kph: 30,
    traffic_jam_kph: 20,
  },
  recovery_options: [
    {
      id: 'nap_karaoke',
      label: { ja: '仮眠＋カラオケ', en: 'Nap + Karaoke' },
      stages: [
        { phase: 'wakefulness', content: 'audio_karaoke', motion: 'MOVING' },
        { phase: 'nap', content: 'sleep', motion: 'STOPPED', ticks: 3 },
        { phase: 'content', content: 'audio_karaoke', motion: 'STOPPED', ticks: 3 },
      ],
    },
  ],
}

// ── Render helper ───────────────────────────────────────────────────────────

function StateProbe() {
  const { state } = useRunStore()
  return (
    <div
      data-testid="state-probe"
      data-context={JSON.stringify(state.contextOverrides)}
      data-profiles={JSON.stringify(state.profileOverrides)}
      data-tick={String(state.tickSecondsOverride)}
    />
  )
}

function contextOverrides(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('state-probe').getAttribute('data-context') ?? '{}')
}

function tickOverride(): string {
  return screen.getByTestId('state-probe').getAttribute('data-tick') ?? 'null'
}

function profileOverrides(): Record<string, unknown> | null {
  return JSON.parse(screen.getByTestId('state-probe').getAttribute('data-profiles') ?? 'null')
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

  return { ...result, dispatch: dispatchRef.current as React.Dispatch<RunStoreAction> }
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

  it('(i) UX-FE4: the Route (Google Maps) surface is restored in the left panel', async () => {
    renderInStore(<SignalsPanel />)
    expect(await screen.findByTestId('route-section')).toBeInTheDocument()
    expect(screen.getByTestId('map-key-route-input')).toBeInTheDocument()
    await waitFor(() => expect(client.listScenarios).toHaveBeenCalled())
  })

  it('(t) tick-duration setup is restored below the route section and edits dispatch SET_TICK_SECONDS', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const input = (await screen.findByTestId('tick-seconds-input')) as HTMLInputElement
    // Defaults to the scenario's tick_seconds (60), no override yet.
    expect(input.value).toBe('60')
    expect(tickOverride()).toBe('null')

    // It sits below the route section in DOM order.
    const panel = screen.getByTestId('signals-panel')
    const route = screen.getByTestId('route-section')
    const tick = screen.getByTestId('tick-section')
    const order = Array.from(panel.querySelectorAll('[data-testid]'))
    expect(order.indexOf(route)).toBeLessThan(order.indexOf(tick))

    // Editing to a non-default value dispatches the override.
    fireEvent.change(input, { target: { value: '30' } })
    await waitFor(() => expect(tickOverride()).toBe('30'))

    // Reverting to the scenario default clears the override.
    fireEvent.change(input, { target: { value: '60' } })
    await waitFor(() => expect(tickOverride()).toBe('null'))
  })

  it('(t2) tick-duration default reflects the package algorithm.tick_seconds override (not the scenario)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture) // scenario tick_seconds = 60
    // The hybrid package overrides the cadence via algorithm.tick_seconds — the
    // value the backend actually runs at. The setup default must show THAT (30),
    // not the scenario's 60, so setup matches the run + review clock.
    vi.mocked(client.getPackage).mockResolvedValue({
      id: 'aica_transparent_hybrid_trigger_v1',
      features: [],
      algorithm: { type: 'python_module', entrypoint: 'algorithm.py', tick_seconds: 30 },
    } as never)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
      dispatch({ type: 'SELECT_PACKAGE', id: 'aica_transparent_hybrid_trigger_v1' })
    })

    const input = (await screen.findByTestId('tick-seconds-input')) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('30'))
    expect(tickOverride()).toBe('null')

    // Typing the package default (30) is a no-op override; a different value sets it.
    fireEvent.change(input, { target: { value: '30' } })
    await waitFor(() => expect(tickOverride()).toBe('null'))
    fireEvent.change(input, { target: { value: '90' } })
    await waitFor(() => expect(tickOverride()).toBe('90'))
  })

  it('(j) UX-FE5: editing a speed-profile field dispatches SET_PROFILE_OVERRIDES(speed.<field>); revert removes it', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const highway = (await screen.findByTestId('speed-field-highway_kph')) as HTMLInputElement
    expect(highway.value).toBe('100') // scenario default

    fireEvent.change(highway, { target: { value: '120' } })
    await waitFor(() => expect(profileOverrides()).toEqual({ speed: { highway_kph: 120 } }))

    // Reverting to the scenario default removes the override entirely.
    fireEvent.change(screen.getByTestId('speed-field-highway_kph'), { target: { value: '100' } })
    await waitFor(() => expect(profileOverrides()).toBeNull())
  })

  it('(k) UX-FE7: editing an activity recovery dispatches SET_PROFILE_OVERRIDES(driver.recovery_model.<activity>.<field>); revert clears it', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const sleepDrowsiness = (await screen.findByTestId('rest-recovery-field-sleep-drowsiness')) as HTMLInputElement
    expect(sleepDrowsiness.value).toBe('35') // scenario recovery_model.sleep.drowsiness

    fireEvent.change(sleepDrowsiness, { target: { value: '50' } })
    await waitFor(() =>
      expect(profileOverrides()).toEqual({ driver: { recovery_model: { sleep: { drowsiness: 50 } } } }),
    )

    // Reverting to the scenario default removes the whole sparse override.
    fireEvent.change(screen.getByTestId('rest-recovery-field-sleep-drowsiness'), { target: { value: '35' } })
    await waitFor(() => expect(profileOverrides()).toBeNull())
  })

  it('(dim) signals a package does not consume render dimmed (data-dimmed=true)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)
    // NRI has no env_load feature and never links weatherRisk → weatherRisk dims.
    vi.mocked(client.getPackage).mockResolvedValue({
      id: 'nri_fatigue_score_v1',
      features: [
        'drowsiness', 'fatigue', 'driving_anomaly', 'future_fatigue', 'rest_window',
        'rest_scarcity', 'monotony', 'familiar_route', 'attention_drop', 'traffic_jam', 'long_highway',
      ].map((key) => ({ key, band_values: [] })),
    } as never)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
      dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' })
    })

    const weatherRow = await screen.findByTestId('signal-row-weatherRisk')
    await waitFor(() => expect(weatherRow.getAttribute('data-dimmed')).toBe('true'))
    // A signal NRI does use stays undimmed.
    expect(screen.getByTestId('signal-row-drowsiness').getAttribute('data-dimmed')).toBe('false')
  })

  it('(dim) nothing is dimmed when no package is selected', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)
    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })
    const weatherRow = await screen.findByTestId('signal-row-weatherRisk')
    expect(weatherRow.getAttribute('data-dimmed')).toBe('false')
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
    // Dynamic — clearer per-signal rows (was a single cryptic "Segment / Motion / Jam").
    // speedKph is intentionally NOT shown here: no algorithm reads it and the
    // editable Speed Profile section already covers speed.
    expect(screen.getByTestId('signal-row-continuousDrivingMin')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-segmentType')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-isTrafficJam')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-nextRestSpotMin')).toBeInTheDocument()
    expect(screen.queryByTestId('signal-row-speedKph')).not.toBeInTheDocument()
    // Speed profile (restored "speed setup")
    expect(screen.getByTestId('speed-profile-section')).toBeInTheDocument()
    expect(screen.getByTestId('speed-field-highway_kph')).toBeInTheDocument()
    // Rest options — per-activity recovery
    expect(screen.getByTestId('rest-options-section')).toBeInTheDocument()
    expect(screen.getByTestId('rest-activity-sleep')).toBeInTheDocument()
    // Simulated
    expect(screen.getByTestId('signal-row-drowsiness')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-fatigue')).toBeInTheDocument()
    expect(screen.getByTestId('signal-row-anomaly_rate')).toBeInTheDocument()
  })

  it('(h) UX-FE3: signal labels are localized (not raw keys) and switch when uiLanguage toggles', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    const { dispatch } = renderInStore(<SignalsPanel />, (d) => {
      d({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('signal-row-isNight')).toBeInTheDocument()
    })

    // English default — human label, never the raw key.
    expect(screen.getByTestId('signal-row-isNight')).toHaveTextContent('Night')
    expect(screen.getByTestId('signal-row-isNight')).not.toHaveTextContent('isNight')
    expect(screen.getByTestId('signal-row-anomaly_rate')).toHaveTextContent('Anomaly Rate')

    // Toggling uiLanguage switches the shown text to the Japanese label.
    act(() => dispatch({ type: 'SET_LANGUAGE', lang: 'ja' }))
    await waitFor(() => {
      expect(screen.getByTestId('signal-row-isNight')).toHaveTextContent('夜間')
    })
    expect(screen.getByTestId('signal-row-anomaly_rate')).toHaveTextContent('異常発生率')
  })

  it('(b) editable Fixed signals (isNight/familiarRoute/childPassenger/weatherRisk) expose a ✎ control; Dynamic/Simulated do not', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('signal-edit-familiarRoute')).toBeInTheDocument()
    })
    expect(screen.getByTestId('signal-edit-childPassenger')).toBeInTheDocument()
    expect(screen.getByTestId('signal-edit-weatherRisk')).toBeInTheDocument()
    // isNight is now editable (is_night boolean context override).
    expect(screen.getByTestId('signal-edit-isNight')).toBeInTheDocument()

    // Dynamic/Simulated: no edit control
    expect(screen.queryByTestId('signal-edit-continuousDrivingMin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-segmentMotionJam')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-drowsiness')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-fatigue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-edit-anomaly_rate')).not.toBeInTheDocument()
  })

  it('(b2) toggling isNight dispatches SET_CONTEXT_OVERRIDE(is_night); revert-to-default clears it', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const checkbox = (await screen.findByTestId('signal-edit-isNight')) as HTMLInputElement
    // Scenario default is_night is false → unchecked.
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    await waitFor(() => expect(contextOverrides().is_night).toBe(true))

    // Reverting back to the scenario default (false) removes the override key.
    fireEvent.click(screen.getByTestId('signal-edit-isNight'))
    await waitFor(() => expect(contextOverrides().is_night).toBeUndefined())
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

  it('(e) UX-FE5: weather_risk is a 0–1 slider mapping ×100 to the stored [0,100] value; revert removes the key', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const slider = (await screen.findByTestId('signal-edit-weatherRisk')) as HTMLInputElement
    // The slider shows the 0–1 fraction of the scenario default (30 → 0.3).
    expect(slider.type).toBe('range')
    expect(slider.value).toBe('0.3')

    // Sliding to 0.65 stores 65 (the exact weight env_load applies).
    fireEvent.change(slider, { target: { value: '0.65' } })
    await waitFor(() => expect(contextOverrides().weather_risk).toBe(65))

    // Back to the scenario default fraction (0.3 → 30) removes the override key.
    fireEvent.change(screen.getByTestId('signal-edit-weatherRisk'), { target: { value: '0.3' } })
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

  it('(g) UX-FE4: a Simulated signal shows its formula INLINE with editable params; editing dispatches SET_PROFILE_OVERRIDES', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    // The formula line and its param fields are visible WITHOUT clicking the ⓘ
    // (inline, mirroring the right panel — no popover to open).
    const drowsinessInput = (await screen.findByTestId(
      'signal-formula-field-drowsiness-base_growth_per_min',
    )) as HTMLInputElement
    // The state-update recurrence is shown, Δt explained in words, and the
    // named params are visible inline without opening the ⓘ.
    expect(screen.getByTestId('signal-formula-equation-drowsiness')).toHaveTextContent('drowsiness[t] = drowsiness[t−1]')
    expect(screen.getByTestId('signal-formula-lead-drowsiness')).toHaveTextContent(/Δt/)
    expect(drowsinessInput.value).toBe('0.9')

    fireEvent.change(drowsinessInput, { target: { value: '1.4' } })
    await waitFor(() =>
      expect(profileOverrides()).toEqual({ driver: { drowsiness_model: { base_growth_per_min: 1.4 } } }),
    )

    // Revert to the scenario default removes the override entirely.
    fireEvent.change(screen.getByTestId('signal-formula-field-drowsiness-base_growth_per_min'), {
      target: { value: '0.9' },
    })
    await waitFor(() => expect(profileOverrides()).toBeNull())

    // anomaly_rate: editing lambda_base sets anomaly.lambda_base (also inline).
    const lambdaInput = screen.getByTestId('signal-formula-field-anomaly_rate-lambda_base') as HTMLInputElement
    expect(lambdaInput.value).toBe('0.02')
    fireEvent.change(lambdaInput, { target: { value: '0.08' } })
    await waitFor(() => expect(profileOverrides()).toEqual({ anomaly: { lambda_base: 0.08 } }))
  })

  it('(g2) UX-FE4: the ⓘ icon shows a brief words-only explanation (not the editable formula)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioFixture)

    renderInStore(<SignalsPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: scenarioFixture.id })
    })

    const infoBtn = await screen.findByTestId('signal-info-btn-drowsiness')
    // Explanation is hidden until the ⓘ is clicked.
    expect(screen.queryByTestId('signal-explain-drowsiness')).not.toBeInTheDocument()

    fireEvent.click(infoBtn)
    expect(screen.getByTestId('signal-explain-drowsiness')).toHaveTextContent(/Accumulates over driving time/)
  })
})
