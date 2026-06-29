import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunState, DecisionResult, AlgorithmError, PackageSummary, ScenarioSummary } from '../src/api/types'

// ── fixtures ─────────────────────────────────────────────────────────────────

const pkgSummary: PackageSummary = {
  id: 'rest_rule_based_v0_1',
  version: '0.1.0',
  label: { ja: 'テスト', en: 'Test' },
  algorithm_type: 'declarative_rule',
  compatible_scenario_types: ['uc01_fatigue'],
}

const scenarioSummary: ScenarioSummary = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona_label: 'Friend Drive',
  review_focus: 'Base trigger timing',
}

const createdRun: RunState = {
  run_id: 'run-abc',
  status: 'created',
  current_tick: 0,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_fatigue_friend_drive_v0_1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const playingRun: RunState = { ...createdRun, status: 'playing', current_tick: 1 }
const pausedRun: RunState = {
  ...playingRun,
  status: 'paused',
  current_tick: 5,
  pending_proposal: 'rest_guidance',
}
const resumedRun: RunState = { ...pausedRun, status: 'playing', pending_proposal: null }
const completedRun: RunState = { ...playingRun, status: 'completed', current_tick: 60 }

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const noTriggerDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
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
  proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
  reason_inputs: ['drowsiness_level'],
  explanation: 'Proposal threshold passed.',
  next_package_runtime_state: {},
}

const algError: AlgorithmError = {
  tick_index: 3,
  error_type: 'invalid_return',
  message: 'Algorithm returned invalid shape',
}

// ── wrapper ───────────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(RunStoreProvider, null, children)

// ── tests ─────────────────────────────────────────────────────────────────────

describe('runStore — initial state', () => {
  it('starts with empty lists and null selections', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    const { state } = result.current
    expect(state.packages).toEqual([])
    expect(state.scenarios).toEqual([])
    expect(state.selectedPackageId).toBeNull()
    expect(state.selectedScenarioId).toBeNull()
    expect(state.runState).toBeNull()
    expect(state.trace).toEqual([])
    expect(state.latestDecision).toBeNull()
    expect(state.paused).toBe(false)
    expect(state.completed).toBe(false)
    expect(state.errors).toEqual([])
    expect(state.algorithmErrors).toEqual([])
  })
})

describe('runStore — LOAD_PACKAGES / LOAD_SCENARIOS', () => {
  it('stores package list after LOAD_PACKAGES', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'LOAD_PACKAGES', packages: [pkgSummary] }))
    expect(result.current.state.packages).toHaveLength(1)
    expect(result.current.state.packages[0].id).toBe('rest_rule_based_v0_1')
  })

  it('stores scenario list after LOAD_SCENARIOS', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'LOAD_SCENARIOS', scenarios: [scenarioSummary] }))
    expect(result.current.state.scenarios).toHaveLength(1)
    expect(result.current.state.scenarios[0].persona_label).toBe('Friend Drive')
  })
})

describe('runStore — SELECT_PACKAGE / SELECT_SCENARIO', () => {
  it('sets selectedPackageId', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' }))
    expect(result.current.state.selectedPackageId).toBe('rest_rule_based_v0_1')
  })

  it('sets selectedScenarioId', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' }))
    expect(result.current.state.selectedScenarioId).toBe('uc01_fatigue_friend_drive_v0_1')
  })
})

describe('runStore — RUN_CREATED', () => {
  it('sets runState and resets trace', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    expect(result.current.state.runState?.run_id).toBe('run-abc')
    expect(result.current.state.runState?.status).toBe('created')
    expect(result.current.state.trace).toEqual([])
    expect(result.current.state.latestDecision).toBeNull()
    expect(result.current.state.paused).toBe(false)
    expect(result.current.state.completed).toBe(false)
  })
})

describe('runStore — TICK_APPENDED (normal decision)', () => {
  it('appends decision to trace and updates paused/completed/latestDecision', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: playingRun,
      decision: noTriggerDecision,
      tickIndex: 1,
      paused: false,
      completed: false,
    }))
    expect(result.current.state.trace).toHaveLength(1)
    expect(result.current.state.trace[0].result_type).toBe('NO_TRIGGER')
    expect(result.current.state.trace[0].tick_index).toBe(1)
    expect(result.current.state.latestDecision?.result_type).toBe('NO_TRIGGER')
    expect(result.current.state.paused).toBe(false)
    expect(result.current.state.completed).toBe(false)
    expect(result.current.state.runState?.status).toBe('playing')
  })

  it('sets paused=true when a proposal fires', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: pausedRun,
      decision: restProposalDecision,
      tickIndex: 5,
      paused: true,
      completed: false,
    }))
    expect(result.current.state.paused).toBe(true)
    expect(result.current.state.latestDecision?.result_type).toBe('REST_PROPOSAL')
    expect(result.current.state.runState?.status).toBe('paused')
    expect(result.current.state.runState?.pending_proposal).toBe('rest_guidance')
  })

  it('sets completed=true when route ends', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: completedRun,
      decision: noTriggerDecision,
      tickIndex: 60,
      paused: false,
      completed: true,
    }))
    expect(result.current.state.completed).toBe(true)
    expect(result.current.state.runState?.status).toBe('completed')
  })
})

describe('runStore — ACTION_APPLIED', () => {
  it('updates runState and clears paused after action', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: pausedRun }))
    // Simulate a paused state first
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: pausedRun,
      decision: restProposalDecision,
      tickIndex: 5,
      paused: true,
      completed: false,
    }))
    expect(result.current.state.paused).toBe(true)

    act(() => result.current.dispatch({ type: 'ACTION_APPLIED', runState: resumedRun, action: 'accept_rest' }))
    expect(result.current.state.runState?.status).toBe('playing')
    expect(result.current.state.runState?.pending_proposal).toBeNull()
    expect(result.current.state.paused).toBe(false)
  })
})

describe('runStore — restHistory (accepted rests persist)', () => {
  const restChoice = {
    tickIndex: 3,
    optionId: 'nap_karaoke',
    optionLabel: { ja: '仮眠＋カラオケ', en: 'Nap + Karaoke' },
    spot: {
      id: 'p1',
      label: { ja: '優子道の駅', en: 'Yuuko Roadside Station' },
      route_fraction: 0.5,
      distance_km: 49.5,
    },
  }

  it('appends restChoice on accept_rest and leaves history untouched for actions without one', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: playingRun }))
    act(() =>
      result.current.dispatch({
        type: 'ACTION_APPLIED',
        runState: playingRun,
        action: 'accept_rest',
        restChoice,
      }),
    )
    expect(result.current.state.restHistory).toHaveLength(1)
    expect(result.current.state.restHistory[0].spot.label.en).toBe('Yuuko Roadside Station')

    // A later non-accept action (postpone/decline) carries no restChoice.
    act(() =>
      result.current.dispatch({
        type: 'ACTION_APPLIED',
        runState: playingRun,
        action: 'postpone',
      }),
    )
    expect(result.current.state.restHistory).toHaveLength(1)
  })

  it('clears restHistory on a new run, scenario change, and reset', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    const seed = () => {
      act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: playingRun }))
      act(() =>
        result.current.dispatch({
          type: 'ACTION_APPLIED',
          runState: playingRun,
          action: 'accept_rest',
          restChoice,
        }),
      )
      expect(result.current.state.restHistory).toHaveLength(1)
    }

    seed()
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: playingRun }))
    expect(result.current.state.restHistory).toEqual([])

    seed()
    act(() => result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'other_scenario' }))
    expect(result.current.state.restHistory).toEqual([])

    seed()
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.restHistory).toEqual([])
  })
})

describe('runStore — ALGORITHM_ERROR_APPENDED', () => {
  /**
   * MIGRATED from M1/M2 continue-on-error to pause-by-default (M3 T010).
   * ALGORITHM_ERROR_APPENDED now carries a `paused: boolean` field;
   * the reducer sets state.paused accordingly.
   */
  it('non_blocking algorithm error appends error, does NOT set latestDecision, paused stays false', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))

    // First tick with normal decision
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: playingRun,
      decision: noTriggerDecision,
      tickIndex: 1,
      paused: false,
      completed: false,
    }))
    const decisionBefore = result.current.state.latestDecision

    // Non-blocking algorithm error (error_mode="non_blocking" on the package)
    act(() => result.current.dispatch({
      type: 'ALGORITHM_ERROR_APPENDED',
      runState: playingRun,
      error: algError,
      paused: false,   // non_blocking: run continues, not paused
    }))

    expect(result.current.state.algorithmErrors).toHaveLength(1)
    expect(result.current.state.algorithmErrors[0].error_type).toBe('invalid_return')
    // latestDecision must NOT change from what it was before the error
    expect(result.current.state.latestDecision).toEqual(decisionBefore)
    // non_blocking → paused stays false
    expect(result.current.state.paused).toBe(false)
  })

  it('blocking algorithm error appends error, does NOT set latestDecision, paused becomes true', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))

    // First tick with normal decision
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: playingRun,
      decision: noTriggerDecision,
      tickIndex: 1,
      paused: false,
      completed: false,
    }))
    const decisionBefore = result.current.state.latestDecision

    // Blocking algorithm error (default error_mode="blocking")
    act(() => result.current.dispatch({
      type: 'ALGORITHM_ERROR_APPENDED',
      runState: { ...playingRun, status: 'paused' as const },
      error: algError,
      paused: true,   // blocking: run is halted
    }))

    expect(result.current.state.algorithmErrors).toHaveLength(1)
    expect(result.current.state.algorithmErrors[0].error_type).toBe('invalid_return')
    // latestDecision must NOT change from what it was before the error
    expect(result.current.state.latestDecision).toEqual(decisionBefore)
    // blocking → paused becomes true; run halted
    expect(result.current.state.paused).toBe(true)
  })
})

describe('runStore — viewMode transitions (T002)', () => {
  it('initial state: viewMode === "setup"', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.viewMode).toBe('setup')
  })

  it('SET_VIEW_MODE "review" → viewMode becomes "review"', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_VIEW_MODE', mode: 'review' }))
    expect(result.current.state.viewMode).toBe('review')
  })

  it('SET_VIEW_MODE "runs" → viewMode becomes "runs"', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_VIEW_MODE', mode: 'runs' }))
    expect(result.current.state.viewMode).toBe('runs')
  })

  it('SET_VIEW_MODE "setup" → viewMode becomes "setup"', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_VIEW_MODE', mode: 'review' }))
    act(() => result.current.dispatch({ type: 'SET_VIEW_MODE', mode: 'setup' }))
    expect(result.current.state.viewMode).toBe('setup')
  })

  it('RUN_CREATED automatically transitions viewMode to "review"', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.viewMode).toBe('setup')
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    expect(result.current.state.viewMode).toBe('review')
  })

  it('RESET transitions viewMode back to "setup" (new-run / setup semantics)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    expect(result.current.state.viewMode).toBe('review')
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.viewMode).toBe('setup')
  })
})

describe('runStore — RESET', () => {
  it('clears run state and trace but preserves lists', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'LOAD_PACKAGES', packages: [pkgSummary] }))
    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' }))
    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: createdRun }))
    act(() => result.current.dispatch({
      type: 'TICK_APPENDED',
      runState: playingRun,
      decision: noTriggerDecision,
      tickIndex: 1,
      paused: false,
      completed: false,
    }))

    act(() => result.current.dispatch({ type: 'RESET' }))

    const { state } = result.current
    expect(state.runState).toBeNull()
    expect(state.trace).toEqual([])
    expect(state.latestDecision).toBeNull()
    expect(state.paused).toBe(false)
    expect(state.completed).toBe(false)
    expect(state.algorithmErrors).toEqual([])
    // Lists and selection preserved
    expect(state.packages).toHaveLength(1)
    expect(state.selectedPackageId).toBe('rest_rule_based_v0_1')
  })
})
