/**
 * Review-screen panel rebuild — RouteStatus, DriverStatus, StateCards, MusicOverlay.
 *
 * Covers the data each new panel derives from the store:
 *  - RouteStatus: driving time (tick_index × tick_seconds) + position % from the
 *    frozen event_plan + last trace entry.
 *  - DriverStatus: drowsiness / fatigue bands from latestDecision.features.
 *  - StateCards: drowsiness + vehicle motion + active-segment road type / speed band.
 *  - MusicOverlay: visible only when the active segment is a rest facility.
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, DecisionResult, ScenarioDef } from '../src/api/types'

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn(),
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
}))

import * as client from '../src/api/client'
import RouteStatus from '../src/components/context/RouteStatus'
import ScenarioBeats from '../src/components/context/ScenarioBeats'
import DriverStatus from '../src/components/context/DriverStatus'
import StateCards from '../src/components/playback/StateCards'
import MusicOverlay from '../src/components/playback/MusicOverlay'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const runState: RunState = {
  run_id: 'run-panels-001',
  status: 'paused',
  current_tick: 2,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'a' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'b' },
  },
  // tick 2 → 50% along route; 60s ticks → 02:00 elapsed at tick_index 2
  event_plan: { tick_seconds: 60, ticks: [{ route_fraction: 0 }, { route_fraction: 0.25 }, { route_fraction: 0.5 }] },
  route_facts: { total_distance_km: 100 },
}

const decision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 0.7,
  features: { drowsiness_level: 'high', fatigue_level: 'moderate' },
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: null,
  reason_inputs: [],
  explanation: 'rest',
  next_package_runtime_state: {},
}

const scenarioDef: ScenarioDef = {
  id: 'sc1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona: {},
  route_intent: {
    rest_facility: { label: 'SA' },
    segments: [
      { id: 's0', name: { ja: '出発', en: 'Start' }, type: 'start', at: 0, speed_band: 'low', length_band: 'short', is_rest_facility: false },
      { id: 's1', name: { ja: '高速', en: 'Highway' }, type: 'highway', at: 0.3, speed_band: 'high', length_band: 'long', is_rest_facility: false },
      { id: 's2', name: { ja: 'SA鶴ヶ島', en: 'Tsurugashima SA' }, type: 'rest', at: 0.5, speed_band: 'low', length_band: 'short', is_rest_facility: true },
    ],
  },
  initial_state: {},
  event_presets: { drowsiness_schedule: [], signal_duration_at_trigger: 'short' },
  driver_profile: {},
  vehicle_profile: {},
  total_duration_seconds: 3600,
  tick_seconds: 60,
  allowed_actions: [],
  review_focus: 'x',
}

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
  if (setupFn && dispatchRef.current) act(() => setupFn(dispatchRef.current!))
  return result
}

/** Seed an active run with one evaluated tick + a decision. */
function seedRun(dispatch: React.Dispatch<RunStoreAction>) {
  dispatch({ type: 'SELECT_SCENARIO', id: 'sc1' })
  dispatch({ type: 'RUN_CREATED', runState })
  dispatch({ type: 'TICK_APPENDED', decision, tickIndex: 2, runState, paused: true, completed: false })
}

// ── RouteStatus ────────────────────────────────────────────────────────────────

describe('RouteStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getScenario).mockResolvedValue(scenarioDef)
  })

  it('shows placeholders when no run is active', () => {
    renderWithStore(<RouteStatus />)
    expect(screen.getByTestId('route-status-time')).toHaveTextContent('—')
    expect(screen.getByTestId('route-status-position')).toHaveTextContent('—')
  })

  it('shows driving time, position, and distance from the evaluated tick', () => {
    renderWithStore(<RouteStatus />, seedRun)
    expect(screen.getByTestId('route-status-time')).toHaveTextContent('02:00')
    expect(screen.getByTestId('route-status-position')).toHaveTextContent('50%')
    expect(screen.getByTestId('route-status-distance')).toHaveTextContent('50.0 km')
  })
})

// ── ScenarioBeats ───────────────────────────────────────────────────────────────

describe('ScenarioBeats', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getScenario).mockResolvedValue(scenarioDef)
  })

  it('emits a beat per status change as the trace advances (road-type, proposal, recovery)', async () => {
    // Drive: start (tick 0) → highway MOVING (tick 1) → REST_PROPOSAL (tick 2) → nap (tick 3) → content (tick 4)
    const driveThrough = (dispatch: React.Dispatch<RunStoreAction>) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'sc1' })
      dispatch({ type: 'RUN_CREATED', runState })
      const noTrigger = { ...decision, result_type: 'NO_TRIGGER' as const, trigger_candidate: false, selected_category: null as null }
      const proposalDecision = { ...decision, result_type: 'REST_PROPOSAL' as const }
      // Tick 0: Start — MOVING on normal_road
      dispatch({ type: 'TICK_APPENDED', decision: noTrigger, tickIndex: 0, runState, paused: false, completed: false, motionState: 'MOVING', segmentType: 'normal_road' })
      // Tick 1: Road class changes to highway — state beat emitted
      dispatch({ type: 'TICK_APPENDED', decision: noTrigger, tickIndex: 1, runState, paused: false, completed: false, motionState: 'MOVING', segmentType: 'highway' })
      // Tick 2: REST_PROPOSAL fires (still on highway)
      dispatch({ type: 'TICK_APPENDED', decision: proposalDecision, tickIndex: 2, runState, paused: true, completed: false, motionState: 'MOVING', segmentType: 'highway' })
      // Driver accepts rest
      dispatch({ type: 'ACTION_APPLIED', runState, action: 'accept_rest' })
      // Tick 3: recovery nap phase
      dispatch({ type: 'TICK_APPENDED', decision: noTrigger, tickIndex: 3, runState, paused: false, completed: false, motionState: 'STOPPED', segmentType: 'highway', recoveryPhase: 'nap' })
      // Tick 4: content (karaoke) phase
      dispatch({ type: 'TICK_APPENDED', decision: noTrigger, tickIndex: 4, runState, paused: false, completed: false, motionState: 'STOPPED', segmentType: 'highway', recoveryPhase: 'content' })
    }
    renderWithStore(<ScenarioBeats />, driveThrough)
    await waitFor(() => {
      expect(screen.getByText('Driving · Highway')).toBeInTheDocument()
    })
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('AICA proposes rest')).toBeInTheDocument()
    expect(screen.getByText('Resting (nap)')).toBeInTheDocument()
    expect(screen.getByText(/Karaoke after nap/)).toBeInTheDocument()
    // Drowsiness beats must NOT appear
    expect(screen.queryByText(/Drowsiness:/)).not.toBeInTheDocument()
    // No route_intent segment name ("Yuuko" or "Highway" from route_intent) appears as a standalone beat
    expect(screen.queryByText('Yuuko Roadside Station')).not.toBeInTheDocument()
    // The latest beat is active ("▶ now").
    expect(screen.getByTestId('scenario-beats')).toHaveTextContent('now')
  })
})

// ── DriverStatus ────────────────────────────────────────────────────────────────

describe('DriverStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders drowsiness and fatigue bands from the latest decision', () => {
    renderWithStore(<DriverStatus />, seedRun)
    expect(screen.getByTestId('driver-drowsiness-band')).toHaveTextContent('high')
    expect(screen.getByTestId('driver-fatigue-band')).toHaveTextContent('moderate')
  })
})

// ── StateCards ──────────────────────────────────────────────────────────────────

describe('StateCards', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getScenario).mockResolvedValue(scenarioDef)
  })

  it('shows the active segment road type / speed band and vehicle motion', async () => {
    renderWithStore(<StateCards />, seedRun)
    // route_fraction 0.5 → active segment s2 (rest facility) → stopped, road type "rest"
    await waitFor(() => {
      expect(screen.getByTestId('state-cards')).toHaveTextContent('rest')
    })
    expect(screen.getByTestId('state-cards')).toHaveTextContent('stopped')
    expect(screen.getByTestId('state-cards')).toHaveTextContent('high') // drowsiness band
  })
})

// ── MusicOverlay ────────────────────────────────────────────────────────────────

describe('MusicOverlay', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getScenario).mockResolvedValue(scenarioDef)
  })

  it('appears at a rest facility with the now-playing recovery label', async () => {
    renderWithStore(<MusicOverlay />, seedRun)
    await waitFor(() => {
      expect(screen.getByTestId('music-overlay')).toBeInTheDocument()
    })
    expect(screen.getByTestId('music-overlay')).toHaveTextContent(/now playing/i)
  })

  it('is hidden when the active segment is not a rest facility', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioDef)
    renderWithStore(<MusicOverlay />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'sc1' })
      const rs = { ...runState, current_tick: 1 } // fraction 0.25 → highway, not rest
      dispatch({ type: 'RUN_CREATED', runState: rs })
      dispatch({ type: 'TICK_APPENDED', decision, tickIndex: 1, runState: rs, paused: false, completed: false })
    })
    // let any scenario fetch settle, then assert absence
    await waitFor(() => expect(client.getScenario).toHaveBeenCalled())
    expect(screen.queryByTestId('music-overlay')).not.toBeInTheDocument()
  })
})
