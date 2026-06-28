import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, DecisionResult, TickResponse } from '../src/api/types'

// ── Mock the client module ────────────────────────────────────────────────────
vi.mock('../src/api/client', () => ({
  tickRun: vi.fn(),
  actRun: vi.fn(),
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
  // FeedbackForm (rendered inside CockpitView when paused) calls this on mount
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
}))

import * as client from '../src/api/client'

// ── Import components under test (RED: these don't exist yet) ─────────────────
import PlaybackControls from '../src/components/playback/PlaybackControls'
import RouteTimeline from '../src/components/playback/RouteTimeline'
import CockpitView from '../src/components/playback/CockpitView'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const playingRun: RunState = {
  run_id: 'run-test-001',
  status: 'playing',
  current_tick: 1,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'scen1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {
    ticks: [
      { tick_index: 0, drowsiness_band: 'none', route_fraction: 0.0, signal_duration: 'short', rest_spot_eta: 'far' },
      { tick_index: 1, drowsiness_band: 'none', route_fraction: 0.1, signal_duration: 'short', rest_spot_eta: 'far' },
    ],
  },
  route_facts: {},
}

const pausedRun: RunState = {
  ...playingRun,
  status: 'paused',
  current_tick: 5,
  pending_proposal: 'rest_guidance',
  event_plan: {
    ticks: [
      { tick_index: 5, drowsiness_band: 'moderate', route_fraction: 0.4, signal_duration: 'medium', rest_spot_eta: 'near' },
    ],
  },
}

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const noTriggerDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: { drowsiness_level: 'none', fatigue_level: 'low' },
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: fireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

const restProposalDecision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  features: { drowsiness_level: 'moderate' },
  scores: {},
  states: {},
  criteria: { proposal_cut: 3.0 },
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: {
    id: 'rest_guidance',
    message: { ja: '休憩を取ってください', en: 'Take a rest' },
    options: ['accept_rest', 'postpone'],
  },
  reason_inputs: ['drowsiness_level: moderate'],
  explanation: 'Drowsiness threshold exceeded.',
  next_package_runtime_state: {},
}

// ── Store helper ──────────────────────────────────────────────────────────────

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

  return result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlaybackControls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('(a) Step button calls tickRun once and renders the resulting decision', async () => {
    const tickResponse: TickResponse = {
      run_state: { ...playingRun, current_tick: 2 },
      decision: noTriggerDecision,
      paused: false,
      completed: false,
      tick_index: 1, // evaluated tick (pre-increment); run_state.current_tick is 2 (post-increment)
    }
    vi.mocked(client.tickRun).mockResolvedValue(tickResponse)

    renderInStore(
      <>
        <PlaybackControls />
        <CockpitView />
      </>,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: playingRun })
      },
    )

    const stepButton = await screen.findByRole('button', { name: /step/i })
    fireEvent.click(stepButton)

    await waitFor(() => {
      expect(client.tickRun).toHaveBeenCalledTimes(1)
      expect(client.tickRun).toHaveBeenCalledWith('run-test-001')
    })

    // Decision explanation rendered in cockpit nav view
    await screen.findByTestId('decision-explanation')
    expect(screen.getByTestId('decision-explanation')).toHaveTextContent('No trigger')
  })

  it('disables Step when no runState is present', async () => {
    renderInStore(<PlaybackControls />)
    const stepButton = await screen.findByRole('button', { name: /step/i })
    expect(stepButton).toBeDisabled()
  })

  it('(e) dispatches tickIndex from resp.tick_index (not run_state.current_tick)', async () => {
    // playingRun.current_tick = 1; after tick, post-increment current_tick = 2.
    // The evaluated tick_index = 1 (pre-increment).  The store trace entry must
    // carry tick_index = 1, NOT 2, so it matches the persisted TickEvent.
    const evaluatedTickIndex = 1
    const tickResponse: TickResponse = {
      run_state: { ...playingRun, current_tick: 2 }, // post-increment
      decision: noTriggerDecision,
      paused: false,
      completed: false,
      tick_index: evaluatedTickIndex, // pre-increment — the persisted value
    }
    vi.mocked(client.tickRun).mockResolvedValue(tickResponse)

    let capturedTrace: Array<{ tick_index: number }> | null = null

    function TraceCapture() {
      const { state } = useRunStore()
      capturedTrace = state.trace as Array<{ tick_index: number }>
      return null
    }

    renderInStore(
      <>
        <TraceCapture />
        <PlaybackControls />
      </>,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: playingRun })
      },
    )

    const stepButton = await screen.findByRole('button', { name: /step/i })
    fireEvent.click(stepButton)

    await waitFor(() => {
      expect(client.tickRun).toHaveBeenCalledTimes(1)
    })

    // The trace entry's tick_index must equal resp.tick_index (1), not run_state.current_tick (2)
    await waitFor(() => {
      expect(capturedTrace).not.toBeNull()
      expect(capturedTrace!.length).toBe(1)
      expect(capturedTrace![0].tick_index).toBe(evaluatedTickIndex)
    })
  })
})

describe('CockpitView', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // FeedbackForm is now rendered inside CockpitView when a proposal is active.
    // Return an empty schema so the form mounts without errors.
    vi.mocked(client.getFeedbackSchema).mockResolvedValue({ fields: [] })
  })

  it('(b) shows proposal overlay when latestDecision has a proposal and store is paused', async () => {
    renderInStore(<CockpitView />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: playingRun })
      dispatch({
        type: 'TICK_APPENDED',
        runState: pausedRun,
        decision: restProposalDecision,
        tickIndex: 5,
        paused: true,
        completed: false,
      })
    })

    const overlay = await screen.findByTestId('proposal-overlay')
    expect(overlay).toBeInTheDocument()
    expect(screen.getByText(/Take a rest/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept rest/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /postpone/i })).toBeInTheDocument()
  })

  it('(c) Accept rest button calls actRun with "accept_rest"', async () => {
    const resumedRun: RunState = { ...pausedRun, status: 'playing', pending_proposal: null }
    vi.mocked(client.actRun).mockResolvedValue(resumedRun)

    renderInStore(<CockpitView />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: pausedRun })
      dispatch({
        type: 'TICK_APPENDED',
        runState: pausedRun,
        decision: restProposalDecision,
        tickIndex: 5,
        paused: true,
        completed: false,
      })
    })

    const acceptButton = await screen.findByRole('button', { name: /accept rest/i })
    fireEvent.click(acceptButton)

    await waitFor(() => {
      expect(client.actRun).toHaveBeenCalledWith('run-test-001', 'accept_rest')
    })
  })

  it('(f) shows Decline button when "decline" is in allowed_actions', async () => {
    const runWithDecline: RunState = { ...pausedRun, allowed_actions: ['accept_rest', 'postpone', 'decline'] }

    renderInStore(<CockpitView />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: runWithDecline })
      dispatch({
        type: 'TICK_APPENDED',
        runState: runWithDecline,
        decision: restProposalDecision,
        tickIndex: 5,
        paused: true,
        completed: false,
      })
    })

    await screen.findByTestId('proposal-overlay')
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
  })

  it('(g) Decline button is absent when "decline" not in allowed_actions', async () => {
    renderInStore(<CockpitView />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: pausedRun })
      dispatch({
        type: 'TICK_APPENDED',
        runState: pausedRun,
        decision: restProposalDecision,
        tickIndex: 5,
        paused: true,
        completed: false,
      })
    })

    await screen.findByTestId('proposal-overlay')
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument()
  })

  it('(h) Decline button calls actRun with "decline"', async () => {
    const runWithDecline: RunState = { ...pausedRun, allowed_actions: ['accept_rest', 'postpone', 'decline'] }
    const resumedRun: RunState = { ...runWithDecline, status: 'playing', pending_proposal: null }
    vi.mocked(client.actRun).mockResolvedValue(resumedRun)

    renderInStore(<CockpitView />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: runWithDecline })
      dispatch({
        type: 'TICK_APPENDED',
        runState: runWithDecline,
        decision: restProposalDecision,
        tickIndex: 5,
        paused: true,
        completed: false,
      })
    })

    const declineButton = await screen.findByRole('button', { name: /decline/i })
    fireEvent.click(declineButton)

    await waitFor(() => {
      expect(client.actRun).toHaveBeenCalledWith('run-test-001', 'decline')
    })
  })
})

describe('RouteTimeline — FR-016 display-only animation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('(d) display-only animation does NOT mutate decision/trace state in the store', async () => {
    vi.useFakeTimers()

    let capturedState: { trace: unknown; latestDecision: unknown } | null = null

    function StateCapture() {
      const { state } = useRunStore()
      capturedState = { trace: state.trace, latestDecision: state.latestDecision }
      return null
    }

    render(
      <RunStoreProvider>
        <StateCapture />
        <RouteTimeline />
      </RunStoreProvider>,
    )

    // Pre-populate the store with a tick
    const { result: _ } = { result: null } // unused; dispatch via act below
    // We must get dispatch from the rendered tree
    // Use a ref captured during render
    const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }

    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef.current = dispatch
      return null
    }

    // Re-render with dispatch capture included
    const { unmount } = render(
      <RunStoreProvider>
        <DispatchCapture />
        <StateCapture />
        <RouteTimeline />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchRef.current!({ type: 'RUN_CREATED', runState: playingRun })
      dispatchRef.current!({
        type: 'TICK_APPENDED',
        runState: playingRun,
        decision: noTriggerDecision,
        tickIndex: 1,
        paused: false,
        completed: false,
      })
    })

    const traceBefore = capturedState!.trace
    const decisionBefore = capturedState!.latestDecision

    // Advance timers — RouteTimeline uses only CSS transitions, no JS timers
    // so store state must remain identical references
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(capturedState!.trace).toBe(traceBefore)
    expect(capturedState!.latestDecision).toBe(decisionBefore)

    unmount()
    vi.useRealTimers()
  })
})
