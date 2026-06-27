/**
 * T026 TDD — DecisionTracePanel (RED → GREEN)
 *
 * Tests:
 *  (a) A trace entry with result_type=REST_PROPOSAL renders its result_type,
 *      selected_category, and score.
 *  (b) A trace entry whose candidate has fire_control.suppressed=true renders
 *      that candidate visibly marked as "suppressed" (not hidden).
 *  (c) An algorithmError entry renders as an error (not a normal decision row).
 */

import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { DecisionResult, RunState } from '../src/api/types'

// ── RED: this file is imported before the component exists ────────────────────
import DecisionTracePanel from '../src/components/trace/DecisionTracePanel'

// ── Shared minimal RunState ───────────────────────────────────────────────────

const minimalRunState: RunState = {
  run_id: 'run-trace-test',
  status: 'playing',
  current_tick: 1,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const restProposalDecision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  features: { drowsiness_level: 'moderate' },
  scores: {},
  states: {},
  criteria: { proposal_cut: 3.0 },
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 3.2,
      state: null,
      strength: 'clear',
      fire_control: { fired: true, suppressed: false, override: false, reason: 'proposal_cut_passed_rest_reachable' },
    },
  ],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: {
    id: 'rest_guidance',
    message: { ja: '...', en: 'Take a rest' },
    options: ['accept_rest', 'postpone'],
  },
  reason_inputs: ['drowsiness_level'],
  explanation: 'Drowsiness threshold exceeded.',
  next_package_runtime_state: {},
}

const suppressedDecision: DecisionResult = {
  result_type: 'NO_PRACTICAL_ACTION_FALLBACK',
  trigger_candidate: false,
  selected_category: null,
  score: 3.5,
  features: { drowsiness_level: 'moderate', rest_spot_eta: 'none' },
  scores: {},
  states: {},
  criteria: { proposal_cut: 3.0 },
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 3.5,
      state: null,
      strength: 'clear',
      fire_control: {
        fired: false,
        suppressed: true,
        override: false,
        reason: 'actionability_guard_rest_not_reachable',
      },
    },
  ],
  fire_control: { fired: false, suppressed: true, override: false, reason: 'actionability_guard_rest_not_reachable' },
  proposal: null,
  reason_inputs: ['drowsiness_level', 'rest_spot_eta'],
  explanation: 'Damped blend passed threshold but no rest spot reachable.',
  next_package_runtime_state: {},
}

// ── Helper: render component inside the store and apply setup actions ─────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DecisionTracePanel', () => {
  it('(a) renders result_type, selected_category, and score for a REST_PROPOSAL trace entry', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 1, status: 'paused', pending_proposal: 'rest_guidance' },
        decision: restProposalDecision,
        tickIndex: 1,
        paused: true,
        completed: false,
      })
    })

    expect(screen.getByText(/REST_PROPOSAL/)).toBeInTheDocument()
    // rest_required appears in both the header (selected_category) and the candidate row
    expect(screen.getAllByText(/rest_required/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/3\.2/).length).toBeGreaterThan(0)
  })

  it('(b) renders a suppressed candidate visibly marked "suppressed" (not hidden)', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 2 },
        decision: suppressedDecision,
        tickIndex: 2,
        paused: false,
        completed: false,
      })
    })

    // The suppressed candidate must appear with an explicit suppressed label (data-testid)
    expect(screen.getByTestId('candidate-suppressed-label')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-suppressed-label')).toHaveTextContent(/suppressed/i)
    // The candidate category is still rendered (not hidden) — may appear in multiple places
    expect(screen.getAllByText(/rest_required/).length).toBeGreaterThan(0)
  })

  it('(c) renders algorithm error entries as errors, not as normal decision rows', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'ALGORITHM_ERROR_APPENDED',
        runState: { ...minimalRunState, current_tick: 3 },
        error: { tick_index: 3, error_type: 'algorithm_exception', message: 'injected error for test' },
      })
    })

    // Error label visible
    expect(screen.getByText(/algorithm.?error/i)).toBeInTheDocument()
    // Error message visible
    expect(screen.getByText(/injected error for test/)).toBeInTheDocument()
    // Normal decision fields (result_type from a decision) NOT present
    expect(screen.queryByText(/REST_PROPOSAL/)).not.toBeInTheDocument()
    expect(screen.queryByText(/NO_TRIGGER/)).not.toBeInTheDocument()
  })
})
