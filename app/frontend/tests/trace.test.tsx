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

// ── T019: weighted-score richer trace tests ────────────────────────────────────

// A weighted-score style decision: multiple candidates, populated scores, states
const weightedScoreDecision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 0.72,
  features: {},
  scores: {
    base_safety_risk: 0.62,
    rest_required_score: 0.72,
    monotony_prevention_score: 0.45,
  },
  states: {
    rest: 'REST_RECOMMEND',
    monotony: 'MONOTONY_NORMAL',
  },
  criteria: { threshold_suggest: 0.62, threshold_recommend: 0.76, threshold_urgent: 0.88 },
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 0.72,
      state: 'REST_RECOMMEND',
      strength: 'gentle',
      fire_control: { fired: true, suppressed: false, override: false, reason: 'threshold_passed' },
    },
    {
      category: 'monotony_prevention',
      exists: false,
      score: 0.45,
      state: null,
      strength: null,
      fire_control: { fired: false, suppressed: false, override: false, reason: 'below_suggest_threshold' },
    },
  ],
  fire_control: { fired: true, suppressed: false, override: false, reason: 'threshold_passed' },
  proposal: {
    id: 'rest_required_proposal',
    message: { ja: '休憩をお勧めします', en: 'Rest is recommended.' },
    options: ['accept_rest', 'postpone', 'decline'],
  },
  reason_inputs: ['drowsiness_score', 'fatigue_score', 'rest_required_score'],
  explanation: 'rest_required_score=0.720 ≥ threshold; strength=\'gentle\'.',
  next_package_runtime_state: {},
}

// A weighted-score with suppressed rest_required + fired monotony
const weightedScoreSuppressedRestDecision: DecisionResult = {
  result_type: 'NO_PRACTICAL_ACTION_FALLBACK',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {
    base_safety_risk: 0.75,
    rest_required_score: 0.82,
    monotony_prevention_score: 0.50,
  },
  states: { rest: 'REST_RECOMMEND', monotony: 'MONOTONY_NORMAL' },
  criteria: { threshold_suggest: 0.62 },
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 0.82,
      state: 'REST_RECOMMEND',
      strength: 'clear',
      fire_control: {
        fired: false,
        suppressed: true,
        override: false,
        reason: 'actionability_guard_rest_not_reachable',
      },
    },
    {
      category: 'monotony_prevention',
      exists: false,
      score: 0.50,
      state: null,
      strength: null,
      fire_control: { fired: false, suppressed: false, override: false, reason: 'below_suggest_threshold' },
    },
  ],
  fire_control: { fired: false, suppressed: true, override: false, reason: 'actionability_guard_rest_not_reachable' },
  proposal: null,
  reason_inputs: ['base_safety_risk', 'rest_required_score'],
  explanation: 'rest_required_score=0.820 suppressed: no reachable rest spot.',
  next_package_runtime_state: {},
}

describe('DecisionTracePanel — T019 weighted-score richer trace', () => {
  it('(d) renders per-category scores from the scores dict', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 4, status: 'paused', pending_proposal: 'rest_required_proposal' },
        decision: weightedScoreDecision,
        tickIndex: 4,
        paused: true,
        completed: false,
      })
    })

    // Category scores should be rendered
    expect(screen.getByTestId('scores-base_safety_risk')).toBeInTheDocument()
    expect(screen.getByTestId('scores-rest_required_score')).toBeInTheDocument()
    expect(screen.getByTestId('scores-monotony_prevention_score')).toBeInTheDocument()
  })

  it('(e) renders candidate strength and state for each candidate', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 5 },
        decision: weightedScoreDecision,
        tickIndex: 5,
        paused: false,
        completed: false,
      })
    })

    // The fired candidate (rest_required) should show its strength
    expect(screen.getByTestId('candidate-strength-rest_required')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-strength-rest_required')).toHaveTextContent('gentle')

    // The candidate's state label should appear
    expect(screen.getByTestId('candidate-state-rest_required')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-state-rest_required')).toHaveTextContent('REST_RECOMMEND')
  })

  it('(f) renders selected_category with clear visual label in the weighted-score trace', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 6 },
        decision: weightedScoreDecision,
        tickIndex: 6,
        paused: false,
        completed: false,
      })
    })

    // selected_category "rest_required" should be shown
    expect(screen.getAllByText(/rest_required/).length).toBeGreaterThan(0)
  })

  it('(g) suppressed candidate in weighted-score trace is still marked suppressed', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 7 },
        decision: weightedScoreSuppressedRestDecision,
        tickIndex: 7,
        paused: false,
        completed: false,
      })
    })

    expect(screen.getByTestId('candidate-suppressed-label')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-suppressed-label')).toHaveTextContent(/suppressed/i)
  })
})

// ── T013: hybrid state labels + runtime-state indicator (M3) ──────────────────

const hybridDecisionWithStates: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 0.71,
  features: { drowsiness_level: 'moderate' },
  scores: {
    rest_required_score: 0.71,
    monotony_prevention_score: 0.12,
  },
  states: {
    rest: 'REST_SUGGEST',
    monotony: 'MONOTONY_WATCH',
  },
  criteria: {},
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 0.71,
      state: 'REST_SUGGEST',
      strength: 'gentle',
      fire_control: { fired: true, suppressed: false, override: false, reason: null },
    },
  ],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: null,
  reason_inputs: [],
  explanation: 'Hybrid decision.',
  next_package_runtime_state: {
    smoothed_scores: {
      rest_required_score: 0.71,
      monotony_prevention_score: 0.12,
    },
    persistence_counters: {
      rest_required: 2,
      monotony_prevention: 0,
    },
    smoothed_features: { drowsiness_score: 0.65 },
    states: { rest: 'REST_SUGGEST', monotony: 'MONOTONY_WATCH' },
  },
}

const hybridSuppressedDecision: DecisionResult = {
  result_type: 'NO_PRACTICAL_ACTION_FALLBACK',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {
    rest_required_score: 0.82,
    monotony_prevention_score: 0.15,
  },
  states: {
    rest: 'REST_SUGGEST',
    monotony: 'MONOTONY_WATCH',
  },
  criteria: {},
  candidates: [
    {
      category: 'rest_required',
      exists: true,
      score: 0.82,
      state: 'REST_SUGGEST',
      strength: 'clear',
      fire_control: {
        fired: false,
        suppressed: true,
        override: false,
        reason: 'no_rest_spot_reachable',
      },
    },
  ],
  fire_control: { fired: false, suppressed: true, override: false, reason: 'no_rest_spot_reachable' },
  proposal: null,
  reason_inputs: [],
  explanation: 'Python hybrid: suppressed due to no reachable rest spot.',
  next_package_runtime_state: {
    smoothed_scores: {
      rest_required_score: 0.82,
      monotony_prevention_score: 0.15,
    },
    persistence_counters: {
      rest_required: 3,
      monotony_prevention: 0,
    },
    smoothed_features: {},
    states: { rest: 'REST_SUGGEST', monotony: 'MONOTONY_WATCH' },
  },
}

const builtinDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: 0.0,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: false, suppressed: false, override: false, reason: null },
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger.',
  next_package_runtime_state: {},
}

describe('DecisionTracePanel — T013 hybrid state labels + runtime-state indicator', () => {
  it('(h) renders per-tick state labels for hybrid decisions', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 8 },
        decision: hybridDecisionWithStates,
        tickIndex: 8,
        paused: false,
        completed: false,
      })
    })

    expect(screen.getByTestId('state-rest')).toBeInTheDocument()
    expect(screen.getByTestId('state-rest')).toHaveTextContent('REST_SUGGEST')
    expect(screen.getByTestId('state-monotony')).toBeInTheDocument()
    expect(screen.getByTestId('state-monotony')).toHaveTextContent('MONOTONY_WATCH')
  })

  it('(i) renders runtime-state indicator with smoothed_scores and persistence_counters', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 9 },
        decision: hybridDecisionWithStates,
        tickIndex: 9,
        paused: false,
        completed: false,
      })
    })

    const indicator = screen.getByTestId('runtime-state-indicator')
    expect(indicator).toBeInTheDocument()
    // smoothed scores rendered with toFixed(3) formatting
    expect(indicator).toHaveTextContent('0.710')
    expect(indicator).toHaveTextContent('0.120')
    // persistence counter value visible
    expect(indicator).toHaveTextContent('2')
  })

  it('(j) SC-006: Python hybrid suppressed candidate is visibly marked suppressed', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 10 },
        decision: hybridSuppressedDecision,
        tickIndex: 10,
        paused: false,
        completed: false,
      })
    })

    expect(screen.getByTestId('candidate-suppressed-label')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-suppressed-label')).toHaveTextContent(/suppressed/i)
    // The candidate is still visible (not hidden)
    expect(screen.getAllByText(/rest_required/).length).toBeGreaterThan(0)
  })

  it('(k) built-in entry with empty states/runtime_state renders no state labels and no runtime-state indicator', () => {
    renderWithStore(<DecisionTracePanel />, (dispatch) => {
      dispatch({
        type: 'TICK_APPENDED',
        runState: { ...minimalRunState, current_tick: 11 },
        decision: builtinDecision,
        tickIndex: 11,
        paused: false,
        completed: false,
      })
    })

    expect(screen.queryByTestId('state-rest')).not.toBeInTheDocument()
    expect(screen.queryByTestId('state-monotony')).not.toBeInTheDocument()
    expect(screen.queryByTestId('runtime-state-indicator')).not.toBeInTheDocument()
  })
})
