/**
 * T008 TDD — RecoveryPicker (RED → GREEN)
 *
 * Tests:
 *   1. Selecting a rest spot + a non-postpone recovery option calls actRun
 *      with ('r1', 'accept_rest', { recovery_option_id, rest_spot }).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, ScenarioDef, DecisionResult } from '../src/api/types'

// ── Mock the client module ──────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn(),
  getRestSpots: vi.fn(),
  actRun: vi.fn(),
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  getPackage: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
  tickRun: vi.fn(),
}))

import * as client from '../src/api/client'
import RecoveryPicker from '../src/components/playback/RecoveryPicker'

// ── Fixtures ────────────────────────────────────────────────────────────────

const pausedRunState: RunState = {
  run_id: 'r1',
  status: 'paused',
  current_tick: 5,
  pending_proposal: 'rest_required',
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_test', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
  allowed_actions: ['accept_rest', 'postpone'],
}

const proposalDecision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.5,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: {
    id: 'rest_required',
    message: { ja: '休憩を取ってください', en: 'Please take a rest' },
    options: ['accept_rest', 'postpone'],
  },
  reason_inputs: [],
  explanation: 'Drowsiness detected.',
  next_package_runtime_state: {},
}

const resolvedRunState: RunState = {
  ...pausedRunState,
  status: 'playing',
  pending_proposal: null,
}

const mockScenario: ScenarioDef = {
  id: 'uc01_test',
  version: '0.1.0',
  type: 'uc01',
  persona: {},
  route_intent: { rest_facility: { label: 'Test Rest' }, segments: [] },
  initial_state: {},
  event_presets: { drowsiness_schedule: [], signal_duration_at_trigger: '10' },
  run_seed_default: 42,
  total_duration_seconds: 3600,
  tick_seconds: 60,
  allowed_actions: ['accept_rest', 'postpone'],
  review_focus: '',
  recovery_options: [
    { id: 'nap_karaoke', label: { ja: 'カラオケ仮眠', en: 'Karaoke Nap' }, postpone: false },
    { id: 'postpone', label: { ja: '延期', en: 'Postpone' }, postpone: true },
  ],
}

// ── Helper: render with RunStore ─────────────────────────────────────────────

function renderWithStore(
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

  return result
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RecoveryPicker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('selecting an option + spot calls actRun with the recovery payload', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(mockScenario)
    vi.mocked(client.getRestSpots).mockResolvedValue({
      rest_spots: [
        {
          id: 'p1',
          label: { ja: 'パーキング1', en: 'Parking 1' },
          route_fraction: 0.5,
          distance_km: 12.3,
          eta_min: 8,
          reachable: true,
        },
      ],
      notice: null,
    })
    vi.mocked(client.actRun).mockResolvedValue(resolvedRunState)

    renderWithStore(
      <RecoveryPicker />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_test' })
        dispatch({ type: 'RUN_CREATED', runState: pausedRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: pausedRunState,
          decision: proposalDecision,
          tickIndex: 5,
          paused: true,
          completed: false,
        })
      },
    )

    // Wait for async data (getScenario + getRestSpots) to resolve and render
    await screen.findByTestId('rest-spot-p1')
    await screen.findByTestId('recovery-option-nap_karaoke')

    // Name is shown
    expect(screen.getByText('Parking 1')).toBeInTheDocument()
    // Distance and ETA are shown
    expect(screen.getByText(/12\.3 km/)).toBeInTheDocument()
    expect(screen.getByText(/8 min/)).toBeInTheDocument()

    // Select the rest spot first, then the option
    fireEvent.click(screen.getByTestId('rest-spot-p1'))
    fireEvent.click(screen.getByTestId('recovery-option-nap_karaoke'))

    await waitFor(() =>
      expect(vi.mocked(client.actRun)).toHaveBeenCalledWith(
        'r1',
        'accept_rest',
        { recovery_option_id: 'nap_karaoke', rest_spot: expect.objectContaining({ id: 'p1' }) },
      ),
    )
  })

  it('does not pass a ceiling arg to getRestSpots (reachability is ETA-based only)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(mockScenario)
    vi.mocked(client.getRestSpots).mockResolvedValue({
      rest_spots: [
        {
          id: 'p1',
          label: { ja: 'パーキング1', en: 'Parking 1' },
          route_fraction: 0.5,
          distance_km: 12.3,
          eta_min: 8,
          reachable: true,
        },
      ],
      notice: null,
    })

    renderWithStore(
      <RecoveryPicker />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_test' })
        dispatch({ type: 'RUN_CREATED', runState: pausedRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: pausedRunState,
          decision: proposalDecision,
          tickIndex: 5,
          paused: true,
          completed: false,
        })
        // Set the min-spacing override in store before the effect fires — the
        // ceiling override no longer exists (Task 9).
        dispatch({ type: 'SET_MIN_REST_SPACING_KM', value: 5 })
      },
    )

    await screen.findByTestId('rest-spot-p1')

    // getRestSpots is called as (runId, mapsKey, minRestSpacingKm) — no ceiling
    // arg. We don't assert the exact mapsKey (may come from
    // VITE_GOOGLE_MAPS_KEY env) — just verify run_id, arg count, and spacing.
    const calls = vi.mocked(client.getRestSpots).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0]).toBe('r1')
    expect(lastCall).toHaveLength(3)
    expect(lastCall[2]).toBe(5)
  })

  it('disables a rest spot with reachable:false and shows "too far"', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(mockScenario)
    vi.mocked(client.getRestSpots).mockResolvedValue({
      rest_spots: [
        {
          id: 'far1',
          label: { ja: '遠い SA', en: 'Far SA' },
          route_fraction: 0.9,
          distance_km: 95.0,
          eta_min: null,
          reachable: false,
        },
      ],
      notice: null,
    })

    renderWithStore(
      <RecoveryPicker />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_test' })
        dispatch({ type: 'RUN_CREATED', runState: pausedRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: pausedRunState,
          decision: proposalDecision,
          tickIndex: 5,
          paused: true,
          completed: false,
        })
      },
    )

    await screen.findByTestId('rest-spot-far1')

    // Button is disabled
    expect(screen.getByTestId('rest-spot-far1')).toBeDisabled()
    // "too far" note visible
    expect(screen.getByText(/too far/i)).toBeInTheDocument()
    // ETA shows — when null
    expect(screen.getByText(/ETA: —/)).toBeInTheDocument()
  })

  it('shows no-rest-spots-notice when rest_spots is empty and notice=no_rest_stops_found, postpone still available', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(mockScenario)
    vi.mocked(client.getRestSpots).mockResolvedValue({
      rest_spots: [],
      notice: 'no_rest_stops_found',
    })

    renderWithStore(
      <RecoveryPicker />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_test' })
        dispatch({ type: 'RUN_CREATED', runState: pausedRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: pausedRunState,
          decision: proposalDecision,
          tickIndex: 5,
          paused: true,
          completed: false,
        })
      },
    )

    // Notice is rendered
    await screen.findByTestId('no-rest-spots-notice')
    expect(screen.getByTestId('no-rest-spots-notice')).toHaveTextContent(
      /No rest locations found for this route/i,
    )

    // Postpone button is still available (not disabled)
    const postponeBtn = screen.getByTestId('recovery-option-postpone')
    expect(postponeBtn).not.toBeDisabled()
  })
})
