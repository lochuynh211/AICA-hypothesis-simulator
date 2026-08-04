import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { RunStoreProvider, useRunStore, useRunPreview, selectOverridesDiff } from '../src/state/runStore'
import type {
  RunState,
  DecisionResult,
  AlgorithmError,
  PackageSummary,
  ScenarioSummary,
  InstantResult,
} from '../src/api/types'

// ── Feature 009: mock the API client's runPreview (used by useRunPreview) ────
// Only runPreview is mocked/used below; other store tests in this file never
// touch the client module.
vi.mock('../src/api/client', () => ({
  runPreview: vi.fn(),
}))
import * as client from '../src/api/client'

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

describe('runStore — SET_MERGED_JAM_RANGES (feature 020 map overlay)', () => {
  it('starts empty and stores painted jam km ranges', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.mergedJamRangesKm).toEqual([])
    act(() => result.current.dispatch({ type: 'SET_MERGED_JAM_RANGES', ranges: [[10, 25]] }))
    expect(result.current.state.mergedJamRangesKm).toEqual([[10, 25]])
    act(() => result.current.dispatch({ type: 'SET_MERGED_JAM_RANGES', ranges: [] }))
    expect(result.current.state.mergedJamRangesKm).toEqual([])
  })

  it('survives RESET (setup-time paint, not run state)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_MERGED_JAM_RANGES', ranges: [[5, 12]] }))
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.mergedJamRangesKm).toEqual([[5, 12]])
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

  it('SELECT_SCENARIO PRESERVES a maps/preset route but CLEARS a local one', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    const envelope = {
      route_source: 'maps' as const,
      alternatives: [
        { route_id: 'preset-osaka', summary: 'T→O', route_facts: { total_route_distance_km: 515 }, display: {}, notices: [] },
      ],
    }
    // Maps/preset route selected, THEN scenario chosen → route must survive.
    act(() => {
      result.current.dispatch({ type: 'SET_ALTERNATIVES', envelope: envelope as never })
      result.current.dispatch({ type: 'SELECT_ROUTE', routeId: 'preset-osaka' })
      result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })
    expect(result.current.state.routeSource).toBe('maps')
    expect(result.current.state.selectedRouteId).toBe('preset-osaka')
    expect(result.current.state.alternatives).toHaveLength(1)

    // A LOCAL route, by contrast, is scenario-derived → cleared on scenario change.
    act(() => {
      result.current.dispatch({
        type: 'SET_ALTERNATIVES',
        envelope: { route_source: 'local', alternatives: [{ route_id: 'local', summary: '', route_facts: {}, display: null, notices: [] }] } as never,
      })
      result.current.dispatch({ type: 'SELECT_ROUTE', routeId: 'local' })
      result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
    })
    expect(result.current.state.routeSource).toBe('local')
    expect(result.current.state.selectedRouteId).toBeNull()
    expect(result.current.state.alternatives).toHaveLength(0)
  })

  it('SELECT_PACKAGE with a NEW id clears editedParameters/editedHyperparameters', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 })
      result.current.dispatch({ type: 'SET_PARAMETER', key: 'some_param', value: 1 })
    })
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })

    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' }))

    expect(result.current.state.selectedPackageId).toBe('nri_fatigue_score_v1')
    expect(result.current.state.editedParameters).toEqual({})
    expect(result.current.state.editedHyperparameters).toEqual({})
  })

  it('SELECT_PACKAGE with the SAME id preserves editedHyperparameters (bug: test-case selection re-dispatches the same trigger package id)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' })
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 })
    })
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })

    // Re-selecting the SAME package id (what committing a test case does)
    // must preserve the reviewer's tuning, not reset it.
    act(() => result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' }))

    expect(result.current.state.selectedPackageId).toBe('nri_fatigue_score_v1')
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })
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

// ── Feature 009: overrides-diff selector + run_seed + instant-result preview ──

describe('selectOverridesDiff — feature 009', () => {
  it('returns only entries that differ from the manifest defaults', () => {
    const edited = { w_drowsiness: 0.6, w_fatigue: 0.25 }
    const defaults = { w_drowsiness: 0.4, w_fatigue: 0.25, w_anomaly: 0.1 }
    expect(selectOverridesDiff(edited, defaults)).toEqual([
      { key: 'w_drowsiness', default: 0.4, value: 0.6 },
    ])
  })

  it('ignores keys unknown to the manifest defaults', () => {
    expect(selectOverridesDiff({ unknown_key: 1 }, {})).toEqual([])
  })

  it('returns an empty diff when nothing has changed from the defaults', () => {
    const defaults = { w_drowsiness: 0.4 }
    expect(selectOverridesDiff({ w_drowsiness: 0.4 }, defaults)).toEqual([])
  })
})

describe('runStore — SET_HYPERPARAMETER drives the overrides-diff (feature 009)', () => {
  it('the overrides-diff reflects a SET_HYPERPARAMETER edit against manifest defaults', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    const defaults = { w_drowsiness: 0.4, w_fatigue: 0.25 }

    expect(selectOverridesDiff(result.current.state.editedHyperparameters, defaults)).toEqual([])

    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 }),
    )

    expect(selectOverridesDiff(result.current.state.editedHyperparameters, defaults)).toEqual([
      { key: 'w_drowsiness', default: 0.4, value: 0.6 },
    ])
  })
})

describe('runStore — SET_HYPERPARAMETER revert-to-default removes the override (feature 009 FE4 fix)', () => {
  it('overriding then reverting to the manifest default removes the key from editedHyperparameters', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    const defaults = { w_drowsiness: 0.4, w_fatigue: 0.25 }

    // Override away from the default.
    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6, default: 0.4 }),
    )
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6 })
    expect(selectOverridesDiff(result.current.state.editedHyperparameters, defaults)).toEqual([
      { key: 'w_drowsiness', default: 0.4, value: 0.6 },
    ])

    // Revert back to the default — the key must be REMOVED, not merely set
    // to the default value (the bug: it used to stay in the map, sending a
    // stale override to POST /runs/preview and to the real run-plan).
    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.4, default: 0.4 }),
    )
    expect(result.current.state.editedHyperparameters).toEqual({})
    expect('w_drowsiness' in result.current.state.editedHyperparameters).toBe(false)
    expect(selectOverridesDiff(result.current.state.editedHyperparameters, defaults)).toEqual([])
  })

  it('leaves other overrides untouched when reverting one key to its default', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => {
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6, default: 0.4 })
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_fatigue', value: 0.3, default: 0.25 })
    })
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.6, w_fatigue: 0.3 })

    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.4, default: 0.4 }),
    )
    expect(result.current.state.editedHyperparameters).toEqual({ w_fatigue: 0.3 })
  })

  it('back-compat: omitting `default` keeps the old always-set behavior', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.4 }))
    // No default supplied — the reducer cannot know 0.4 is "the default", so
    // it stores it verbatim (existing call sites, e.g. HyperparameterEditor
    // pass `default`; this documents the fallback for any that don't).
    expect(result.current.state.editedHyperparameters).toEqual({ w_drowsiness: 0.4 })
  })

  it('a payload built from the resulting editedHyperparameters is clean after a revert-to-default', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6, default: 0.4 }),
    )
    act(() =>
      result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.4, default: 0.4 }),
    )

    // Simulates the exact payload useRunPreview sends as hyperparameter_overrides.
    const outgoingPayload = { ...result.current.state.editedHyperparameters }
    expect(outgoingPayload).toEqual({})
    expect(JSON.stringify(outgoingPayload)).toBe('{}')
  })
})

describe('runStore — run_seed (feature 009)', () => {
  it('defaults runSeed to 42', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.runSeed).toBe(42)
  })

  it('SET_RUN_SEED sets an explicit seed', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_RUN_SEED', seed: 7 }))
    expect(result.current.state.runSeed).toBe(7)
  })

  it('REROLL_SEED draws a new numeric seed', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'REROLL_SEED' }))
    expect(typeof result.current.state.runSeed).toBe('number')
  })

  it('SELECT_SCENARIO resets runSeed and clears the previous instantResult', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_RUN_SEED', seed: 999 }))
    act(() => result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'other_scenario' }))
    expect(result.current.state.runSeed).toBe(42)
    expect(result.current.state.instantResult).toBeNull()
  })
})

describe('runStore — SET_CONTEXT_OVERRIDE (feature 009 UX-FE1)', () => {
  it('defaults contextOverrides to {}', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.contextOverrides).toEqual({})
  })

  it('setting weather_risk to a non-default value populates contextOverrides', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({
        type: 'SET_CONTEXT_OVERRIDE',
        key: 'weather_risk',
        value: 65,
        default: 0,
      }),
    )
    expect(result.current.state.contextOverrides).toEqual({ weather_risk: 65 })
  })

  it('reverting weather_risk back to the scenario default REMOVES the key (changed-from-default only)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 }),
    )
    act(() =>
      result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 0, default: 0 }),
    )
    expect(result.current.state.contextOverrides).toEqual({})
  })

  it('setting child_passenger to a non-default value populates contextOverrides alongside weather_risk', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 }),
    )
    act(() =>
      result.current.dispatch({
        type: 'SET_CONTEXT_OVERRIDE',
        key: 'child_passenger',
        value: true,
        default: false,
      }),
    )
    expect(result.current.state.contextOverrides).toEqual({ weather_risk: 65, child_passenger: true })
  })

  it('SELECT_SCENARIO and RESET clear contextOverrides', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 }),
    )
    act(() => result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'other_scenario' }))
    expect(result.current.state.contextOverrides).toEqual({})

    act(() =>
      result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 }),
    )
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.contextOverrides).toEqual({})
  })
})

describe('useRunPreview — debounced POST /runs/preview (feature 009)', () => {
  const mockInstantResult: InstantResult = {
    fired: true,
    fire: { category: 'rest_required', strength: 'gentle', tick: 111, time_min: 56.0 },
    peak_score: 0.59,
    threshold: 0.58,
    score_series: [{ t: 0, score: 0.0 }],
    segments: [{ type: 'highway', from_min: 0, to_min: 60 }],
    rest_spot: null,
    rest_option: null,
    completed_min: 111.5,
    seed: 42,
    overrides: [],
    error: null,
  }

  it('debounces, calls runPreview with the right RunConfig, and stores the InstantResult', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockResolvedValue(mockInstantResult)

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
        result.current.dispatch({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6 })
      })

      // Nothing fires before the debounce window elapses.
      expect(client.runPreview).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(500)
        // Flush the microtask queue so the mocked promise resolves.
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(client.runPreview).toHaveBeenCalledTimes(1)
      expect(client.runPreview).toHaveBeenCalledWith({
        package_id: 'pkg1',
        scenario_id: 'scen1',
        hyperparameter_overrides: { w_drowsiness: 0.6 },
        run_seed: 42,
      })
      expect(result.current.state.instantResult).toEqual(mockInstantResult)
      expect(result.current.state.previewLoading).toBe(false)
      expect(result.current.state.previewError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stores an error message when the preview request fails', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockRejectedValue(new Error('boom'))

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
      })

      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      // The failure is STATED in the reviewer's language; the thrown value's
      // own text survives as clearly-labelled technical detail rather than
      // being the message a Japanese reviewer is shown.
      expect(result.current.state.previewError).toContain('Failed to load the preview.')
      expect(result.current.state.previewError).toContain('boom')
      expect(result.current.state.previewLoading).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('UX-FE1: includes contextOverrides as context_overrides in the preview body when set', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockResolvedValue(mockInstantResult)

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
        result.current.dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 })
      })

      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(client.runPreview).toHaveBeenCalledWith({
        package_id: 'pkg1',
        scenario_id: 'scen1',
        hyperparameter_overrides: {},
        run_seed: 42,
        context_overrides: { weather_risk: 65 },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('UX-FE1: includes profileOverrides as profiles in the preview body when set', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockResolvedValue(mockInstantResult)

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
        result.current.dispatch({
          type: 'SET_PROFILE_OVERRIDES',
          overrides: { driver: { drowsiness_model: { base_growth_per_min: 1.1 } } },
        })
      })

      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(client.runPreview).toHaveBeenCalledWith({
        package_id: 'pkg1',
        scenario_id: 'scen1',
        hyperparameter_overrides: {},
        run_seed: 42,
        profiles: { driver: { drowsiness_model: { base_growth_per_min: 1.1 } } },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('includes the selected preset route on the FIRST preview after the package is chosen', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockResolvedValue(mockInstantResult)
      vi.mocked(client.runPreview).mockClear() // module-level spy — isolate from prior tests

      const envelope = {
        route_source: 'maps' as const,
        alternatives: [
          {
            route_id: 'preset-osaka',
            summary: 'Tokyo → Osaka',
            route_facts: { total_route_distance_km: 515, route_segments: [] },
            display: { summary: 'Tokyo → Osaka', encoded_polyline: 'abc', start_label: 'Tokyo', end_label: 'Osaka' },
            notices: [],
          },
        ],
      }

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      // Scenario + preset route selected FIRST (no package yet → no preview fires).
      act(() => {
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
        result.current.dispatch({ type: 'SET_ALTERNATIVES', envelope: envelope as never })
        result.current.dispatch({ type: 'SELECT_ROUTE', routeId: 'preset-osaka' })
      })
      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
      })
      expect(client.runPreview).not.toHaveBeenCalled()

      // Now the user chooses the package — the FIRST preview must carry the route.
      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
      })
      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(client.runPreview).toHaveBeenCalledTimes(1)
      expect(client.runPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          package_id: 'pkg1',
          route_source: 'maps',
          route_id: 'preset-osaka',
          route_facts: { total_route_distance_km: 515, route_segments: [] },
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-fires WITH the route when a preset is selected AFTER an initial (local) preview', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(client.runPreview).mockResolvedValue(mockInstantResult)
      vi.mocked(client.runPreview).mockClear() // module-level spy — isolate from prior tests

      const envelope = {
        route_source: 'maps' as const,
        alternatives: [
          {
            route_id: 'preset-osaka',
            summary: 'Tokyo → Osaka',
            route_facts: { total_route_distance_km: 515, route_segments: [] },
            display: { summary: 'Tokyo → Osaka', encoded_polyline: 'abc', start_label: 'Tokyo', end_label: 'Osaka' },
            notices: [],
          },
        ],
      }

      const { result } = renderHook(
        () => {
          const store = useRunStore()
          useRunPreview()
          return store
        },
        { wrapper },
      )

      // Package + scenario chosen first → an initial LOCAL preview fires.
      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'pkg1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'scen1' })
      })
      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
      })
      expect(client.runPreview).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ route_source: 'maps' }),
      )

      // Then the user selects a preset → a NEW preview must fire WITH the route.
      act(() => {
        result.current.dispatch({ type: 'SET_ALTERNATIVES', envelope: envelope as never })
        result.current.dispatch({ type: 'SELECT_ROUTE', routeId: 'preset-osaka' })
      })
      await act(async () => {
        vi.advanceTimersByTime(500)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(client.runPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ route_source: 'maps', route_id: 'preset-osaka' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
