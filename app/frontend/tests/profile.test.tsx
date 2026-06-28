/**
 * T009 — ProfileEditor: setup-time profile field editor.
 *
 * Tests (written FIRST — must fail before implementation exists):
 * (a) Renders all driver/vehicle/speed fields prefilled from scenario profiles.
 * (b) Editing one field → createRunPlan called with sparse override containing only that field.
 * (c) No edits → createRunPlan called WITHOUT profiles (back-compat, byte-identical).
 * (d) Reset-to-default restores scenario values and clears override.
 * (e) Changing the selected scenario re-prefills all fields.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'

// ── Mock the full client module ────────────────────────────────────────────────

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
}))

import * as client from '../src/api/client'
import ProfileEditor from '../src/components/setup/ProfileEditor'
import PlanPreview from '../src/components/setup/PlanPreview'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const driverProfileA = {
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
  attention_model: {
    base_recovery_per_min: 0.1,
    monotony_drop_per_min: 0.15,
    drowsiness_drop_factor: 0.3,
    active_content_recovery_per_min: 0.5,
  },
  recovery_model: {
    short_rest_drowsiness_recovery: 20.0,
    short_rest_fatigue_recovery: 15.0,
    long_rest_drowsiness_recovery: 35.0,
    long_rest_fatigue_recovery: 30.0,
  },
}

const vehicleProfileA = {
  rolling_window_seconds: 300,
  steering_instability: {
    base_level: 5.0,
    drowsiness_factor: 0.25,
    fatigue_factor: 0.15,
    mountain_road_add: 8.0,
    traffic_jam_reduce: 4.0,
  },
  lane_departure: {
    enabled_on: ['highway', 'normal_road'],
    drowsiness_threshold: 60.0,
    fatigue_threshold: 70.0,
    count_when_threshold_exceeded: 1,
  },
  pedal_abnormality: {
    base_level: 3.0,
    fatigue_factor: 0.12,
    traffic_jam_add: 10.0,
    mountain_road_add: 5.0,
  },
  adas_warning: {
    lane_departure_warning_threshold: 1.0,
    steering_instability_warning_threshold: 55.0,
  },
}

const speedProfileA = {
  normal_road_kph: 60,
  highway_kph: 100,
  mountain_road_kph: 40,
  sightseeing_road_kph: 30,
  traffic_jam_kph: 20,
}

const scenarioWithProfiles = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.2.0',
  type: 'uc01_fatigue',
  persona: { name: 'Haruto Tanaka', description: 'Test persona' },
  route_intent: {
    rest_facility: { label: { ja: '道の駅', en: 'Roadside Station' } },
    segments: [],
  },
  initial_state: {},
  event_presets: { signal_duration_at_trigger: 'sustained' },
  total_duration_seconds: 7200,
  tick_seconds: 60,
  allowed_actions: ['accept', 'decline'],
  review_focus: 'Base trigger timing',
  driver_profile: driverProfileA,
  vehicle_profile: vehicleProfileA,
  speed_profile: speedProfileA,
}

const routeEnvelopeFixture = {
  route_source: 'local' as const,
  alternatives: [
    {
      route_id: 'local',
      summary: 'Local route',
      route_facts: {
        total_route_distance_km: 120,
        estimated_route_duration_min: 120,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: null,
      notices: [],
    },
  ],
}

const planResponse = {
  plan_id: 'plan-test-001',
  draft_plan: {},
  effective_setup: { run_mode: 'standard' },
  validation_errors: [],
}

// ── Render helpers ─────────────────────────────────────────────────────────────

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
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return { ...result, dispatchRef }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileEditor — T009', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
    vi.mocked(client.getPackage).mockResolvedValue({
      id: 'rest_weighted_score_v0_1',
      version: '0.1.0',
      label: { ja: '', en: '' },
      compatible_scenario_types: ['uc01_fatigue'],
      algorithm: { type: 'weighted_score', entrypoint: 'builtin' },
      parameters: [],
      features: [],
      hyperparameters: [],
      trigger_categories: [],
      rules: [],
      fire_control: { threshold_source: 'x', actionability_guard: {} },
      proposals: [],
      feedback_schema: [],
      evidence_metrics: [],
    })
  })

  it('(a) renders all driver/vehicle/speed fields prefilled from scenario profiles', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioWithProfiles)

    renderInStore(<ProfileEditor />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    // Wait for fields to appear (scenario def loaded)
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toBeInTheDocument()
    })

    // Container
    expect(screen.getByTestId('profile-editor')).toBeInTheDocument()

    // ── Driver — drowsiness_model (4 fields) ──────────────────────────────
    expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toHaveValue(0.9)
    expect(screen.getByTestId('profile-field-driver-drowsiness_model-night_add_per_min')).toHaveValue(0.3)
    expect(screen.getByTestId('profile-field-driver-drowsiness_model-monotony_add_per_min')).toHaveValue(0.3)
    expect(screen.getByTestId('profile-field-driver-drowsiness_model-traffic_jam_add_per_min')).toHaveValue(0.1)

    // ── Driver — fatigue_model (4 fields) ─────────────────────────────────
    expect(screen.getByTestId('profile-field-driver-fatigue_model-base_growth_per_min')).toHaveValue(0.3)
    expect(screen.getByTestId('profile-field-driver-fatigue_model-continuous_driving_add_per_min_after_60_min')).toHaveValue(0.2)
    expect(screen.getByTestId('profile-field-driver-fatigue_model-mountain_road_add_per_min')).toHaveValue(0.2)
    expect(screen.getByTestId('profile-field-driver-fatigue_model-traffic_jam_add_per_min')).toHaveValue(0.05)

    // ── Driver — attention_model (4 fields) ───────────────────────────────
    expect(screen.getByTestId('profile-field-driver-attention_model-base_recovery_per_min')).toHaveValue(0.1)
    expect(screen.getByTestId('profile-field-driver-attention_model-monotony_drop_per_min')).toHaveValue(0.15)
    expect(screen.getByTestId('profile-field-driver-attention_model-drowsiness_drop_factor')).toHaveValue(0.3)
    expect(screen.getByTestId('profile-field-driver-attention_model-active_content_recovery_per_min')).toHaveValue(0.5)

    // ── Driver — recovery_model (4 fields) ────────────────────────────────
    expect(screen.getByTestId('profile-field-driver-recovery_model-short_rest_drowsiness_recovery')).toHaveValue(20.0)
    expect(screen.getByTestId('profile-field-driver-recovery_model-short_rest_fatigue_recovery')).toHaveValue(15.0)
    expect(screen.getByTestId('profile-field-driver-recovery_model-long_rest_drowsiness_recovery')).toHaveValue(35.0)
    expect(screen.getByTestId('profile-field-driver-recovery_model-long_rest_fatigue_recovery')).toHaveValue(30.0)

    // ── Vehicle — rolling_window_seconds (1 field) ────────────────────────
    expect(screen.getByTestId('profile-field-vehicle-rolling_window_seconds')).toHaveValue(300)

    // ── Vehicle — steering_instability (5 fields) ─────────────────────────
    expect(screen.getByTestId('profile-field-vehicle-steering_instability-base_level')).toHaveValue(5.0)
    expect(screen.getByTestId('profile-field-vehicle-steering_instability-drowsiness_factor')).toHaveValue(0.25)
    expect(screen.getByTestId('profile-field-vehicle-steering_instability-fatigue_factor')).toHaveValue(0.15)
    expect(screen.getByTestId('profile-field-vehicle-steering_instability-mountain_road_add')).toHaveValue(8.0)
    expect(screen.getByTestId('profile-field-vehicle-steering_instability-traffic_jam_reduce')).toHaveValue(4.0)

    // ── Vehicle — lane_departure (3 numeric + 1 text = 4 fields) ─────────
    expect(screen.getByTestId('profile-field-vehicle-lane_departure-enabled_on')).toHaveValue('highway,normal_road')
    expect(screen.getByTestId('profile-field-vehicle-lane_departure-drowsiness_threshold')).toHaveValue(60.0)
    expect(screen.getByTestId('profile-field-vehicle-lane_departure-fatigue_threshold')).toHaveValue(70.0)
    expect(screen.getByTestId('profile-field-vehicle-lane_departure-count_when_threshold_exceeded')).toHaveValue(1)

    // ── Vehicle — pedal_abnormality (4 fields) ────────────────────────────
    expect(screen.getByTestId('profile-field-vehicle-pedal_abnormality-base_level')).toHaveValue(3.0)
    expect(screen.getByTestId('profile-field-vehicle-pedal_abnormality-fatigue_factor')).toHaveValue(0.12)
    expect(screen.getByTestId('profile-field-vehicle-pedal_abnormality-traffic_jam_add')).toHaveValue(10.0)
    expect(screen.getByTestId('profile-field-vehicle-pedal_abnormality-mountain_road_add')).toHaveValue(5.0)

    // ── Vehicle — adas_warning (2 fields) ─────────────────────────────────
    expect(screen.getByTestId('profile-field-vehicle-adas_warning-lane_departure_warning_threshold')).toHaveValue(1.0)
    expect(screen.getByTestId('profile-field-vehicle-adas_warning-steering_instability_warning_threshold')).toHaveValue(55.0)

    // ── Speed (5 fields) ─────────────────────────────────────────────────
    expect(screen.getByTestId('profile-field-speed-normal_road_kph')).toHaveValue(60)
    expect(screen.getByTestId('profile-field-speed-highway_kph')).toHaveValue(100)
    expect(screen.getByTestId('profile-field-speed-mountain_road_kph')).toHaveValue(40)
    expect(screen.getByTestId('profile-field-speed-sightseeing_road_kph')).toHaveValue(30)
    expect(screen.getByTestId('profile-field-speed-traffic_jam_kph')).toHaveValue(20)
  })

  it('(b) editing one driver field sends sparse profiles with only that field in createRunPlan', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioWithProfiles)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <ProfileEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    // Wait for profiles to load
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toBeInTheDocument()
    })

    // Edit exactly one field (default was 0.9, change to 1.5)
    const input = screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')
    fireEvent.change(input, { target: { value: '1.5' } })

    // Click Preview Plan
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalledWith(
        expect.objectContaining({
          profiles: {
            driver: {
              drowsiness_model: { base_growth_per_min: 1.5 },
            },
          },
        }),
      )
    })
  })

  it('(c) no edits → createRunPlan called without profiles (back-compat)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioWithProfiles)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <ProfileEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    // Wait for profiles to load
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toBeInTheDocument()
    })

    // No edits — click Preview directly
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      const calls = vi.mocked(client.createRunPlan).mock.calls
      expect(calls.length).toBeGreaterThan(0)
    })

    // The call body must NOT contain 'profiles'
    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    expect(callArg).not.toHaveProperty('profiles')
  })

  it('(d) reset-to-default restores scenario values and clears override', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioWithProfiles)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <ProfileEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    // Wait for profiles to load
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toBeInTheDocument()
    })

    // Edit a field
    const input = screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(input).toHaveValue(1.5)

    // Reset to defaults
    fireEvent.click(screen.getByRole('button', { name: /reset.*default/i }))

    // Value should be restored to scenario's original
    expect(input).toHaveValue(0.9)

    // Preview → no profiles (reset cleared the override)
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      const calls = vi.mocked(client.createRunPlan).mock.calls
      expect(calls.length).toBeGreaterThan(0)
    })

    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    expect(callArg).not.toHaveProperty('profiles')
  })

  it('(e) changing the selected scenario re-prefills all fields', async () => {
    const scenarioB = {
      ...scenarioWithProfiles,
      id: 'uc01_overtime_driver_v0_1',
      driver_profile: {
        ...driverProfileA,
        id: 'overtime_driver_v1',
        drowsiness_model: {
          ...driverProfileA.drowsiness_model,
          base_growth_per_min: 2.0, // different from A's 0.9
        },
      },
      speed_profile: {
        ...speedProfileA,
        normal_road_kph: 80, // different from A's 60
      },
    }

    vi.mocked(client.getScenario)
      .mockResolvedValueOnce(scenarioWithProfiles)
      .mockResolvedValueOnce(scenarioB)

    const { dispatchRef } = renderInStore(<ProfileEditor />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    // Wait for scenario A to load
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toHaveValue(0.9)
    })
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-speed-normal_road_kph')).toHaveValue(60)
    })

    // Switch to scenario B
    act(() => {
      dispatchRef.current!({ type: 'SELECT_SCENARIO', id: 'uc01_overtime_driver_v0_1' })
    })

    // Fields should be re-prefilled with scenario B's values
    await waitFor(() => {
      expect(screen.getByTestId('profile-field-driver-drowsiness_model-base_growth_per_min')).toHaveValue(2.0)
    })
    expect(screen.getByTestId('profile-field-speed-normal_road_kph')).toHaveValue(80)
    // Unchanged fields from scenario B's vehicle (same as A)
    expect(screen.getByTestId('profile-field-vehicle-rolling_window_seconds')).toHaveValue(300)
  })
})
