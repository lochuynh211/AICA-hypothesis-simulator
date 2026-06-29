/**
 * T009 TDD — RecoveryVisualization + MotionBadge (RED → GREEN)
 *
 * Tests:
 *   1. Shows karaoke visual during 'content' phase when STOPPED
 *   2. Shows sleep visual during 'nap' phase when STOPPED
 *   3. Shows wakefulness visual during 'wakefulness' phase when MOVING
 *   4. Renders null (no testid) in other combinations
 *   5. MotionBadge shows 'Stopped' when motion_state is STOPPED
 *   6. MotionBadge shows 'Driving' when motion_state is MOVING
 *   7. MotionBadge renders nothing when no motion_state in trace
 */

import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, DecisionResult } from '../src/api/types'

// These components make no API calls — minimal mock to satisfy module
vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
}))

import RecoveryVisualization from '../src/components/playback/RecoveryVisualization'
import MotionBadge from '../src/components/playback/MotionBadge'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseRunState: RunState = {
  run_id: 'run-rv-test-001',
  status: 'playing',
  current_tick: 5,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_test', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const baseDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: false, suppressed: false, override: false, reason: null },
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

// ── Store helper ──────────────────────────────────────────────────────────────

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

/** Seed a single TICK_APPENDED with the given phase + motion. */
function seedTick(
  dispatch: React.Dispatch<RunStoreAction>,
  phase: string | null,
  motion: string | null,
) {
  dispatch({ type: 'RUN_CREATED', runState: baseRunState })
  dispatch({
    type: 'TICK_APPENDED',
    runState: baseRunState,
    decision: baseDecision,
    tickIndex: 5,
    paused: false,
    completed: false,
    recoveryPhase: phase ?? undefined,
    motionState: motion ?? undefined,
  })
}

// ── RecoveryVisualization tests ───────────────────────────────────────────────

describe('RecoveryVisualization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows the karaoke visual during the content stage when stopped', () => {
    renderWithStore(<RecoveryVisualization />, (dispatch) => {
      seedTick(dispatch, 'content', 'STOPPED')
    })
    expect(screen.getByTestId('recovery-karaoke')).toBeInTheDocument()
  })

  it('shows the sleep visual during the nap stage when stopped', () => {
    renderWithStore(<RecoveryVisualization />, (dispatch) => {
      seedTick(dispatch, 'nap', 'STOPPED')
    })
    expect(screen.getByTestId('recovery-sleep')).toBeInTheDocument()
  })

  it('shows the wakefulness visual during wakefulness when moving', () => {
    renderWithStore(<RecoveryVisualization />, (dispatch) => {
      seedTick(dispatch, 'wakefulness', 'MOVING')
    })
    expect(screen.getByTestId('recovery-wakefulness')).toBeInTheDocument()
  })

  it('renders nothing for other phase/motion combinations', () => {
    renderWithStore(<RecoveryVisualization />, (dispatch) => {
      seedTick(dispatch, 'arriving', 'MOVING')
    })
    expect(screen.queryByTestId('recovery-sleep')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-karaoke')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-wakefulness')).not.toBeInTheDocument()
  })

  it('renders nothing when no trace entries exist', () => {
    renderWithStore(<RecoveryVisualization />)
    expect(screen.queryByTestId('recovery-sleep')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-karaoke')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-wakefulness')).not.toBeInTheDocument()
  })

  it('renders nothing when phase is nap but motion is MOVING (wrong combo)', () => {
    renderWithStore(<RecoveryVisualization />, (dispatch) => {
      seedTick(dispatch, 'nap', 'MOVING')
    })
    expect(screen.queryByTestId('recovery-sleep')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-karaoke')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recovery-wakefulness')).not.toBeInTheDocument()
  })
})

// ── MotionBadge tests ─────────────────────────────────────────────────────────

describe('MotionBadge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows "Stopped" when motion_state is STOPPED', () => {
    renderWithStore(<MotionBadge />, (dispatch) => {
      seedTick(dispatch, null, 'STOPPED')
    })
    const badge = screen.getByTestId('motion-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Stopped')
  })

  it('shows "Driving" when motion_state is MOVING', () => {
    renderWithStore(<MotionBadge />, (dispatch) => {
      seedTick(dispatch, null, 'MOVING')
    })
    const badge = screen.getByTestId('motion-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Driving')
  })

  it('renders nothing when no motion_state in trace', () => {
    renderWithStore(<MotionBadge />)
    expect(screen.queryByTestId('motion-badge')).not.toBeInTheDocument()
  })
})
