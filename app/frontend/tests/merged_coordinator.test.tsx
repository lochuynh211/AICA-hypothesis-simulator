/**
 * mergedCoordinator (020 Task 7) — the Combined Simulator's own tick-loop
 * store. Isolated from `runStore`/`proposalStore` (no reducer import from
 * either): it owns the merged-run tick loop itself so it can fold BOTH the
 * trigger tick payload (into `triggerTrace`, built the same way runStore's
 * TICK_APPENDED does) and a fire-spawned proposal run (`proposalLog` /
 * `correlation`) into one state shape.
 *
 * Mirrors runStore.test.tsx / proposal_recompute_panel.test.tsx's
 * vi.mock + renderHook conventions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedProposalAction } from '../src/api/mergedClient'

// ── fixtures ─────────────────────────────────────────────────────────────

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
  ...noTriggerDecision,
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
  explanation: 'Rest recommended',
}

function baseProposalLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
  return {
    run_id: 'prun_20260718-000000_abcdef',
    created_at: '2026-07-18T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['music_playlist'],
      simulation_time: 45,
      run_seed: '7',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: 'mock_content_selector_v1',
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'stopped',
      active_service_id: null,
      active_plan_id: null,
    },
    events: [],
    evidence: [],
    status: 'created',
    ...overrides,
  } as unknown as ProposalRunLog
}

function noProposalTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: noTriggerDecision,
      error: null,
      paused: false,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 80,
      motion_state: 'MOVING',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: null,
    correlation: null,
  }
}

function firedTickWithProposal(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog(),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

/** A fire tick where `create_proposal_run` failed synchronously — mirrors
 * `merged_runs.py`'s `resp.trigger["proposal_error"] = str(exc.detail)` path
 * (Finding 1): the trigger tick itself still succeeds (decision/paused as
 * normal) and no proposal/correlation is produced, but `proposal_error`
 * carries the failure message. */
function firedTickWithProposalError(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
      proposal_error: 'create_proposal_run failed: 422 invalid parameters',
    },
    proposal: null,
    correlation: null,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(MergedCoordinatorProvider, null, children)
}

describe('mergedCoordinator — initial state', () => {
  it('starts empty/idle', () => {
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    const { state } = result.current
    expect(state.mergedRunId).toBeNull()
    expect(state.triggerTrace).toEqual([])
    expect(state.latestTrigger).toBeNull()
    expect(state.proposalLog).toBeNull()
    expect(state.correlation).toEqual([])
    expect(state.paused).toBe(false)
    expect(state.completed).toBe(false)
    expect(state.running).toBe(false)
    expect(state.error).toBeNull()
  })
})

describe('mergedCoordinator — create + step tick loop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('create() sets mergedRunId, then two step()s accumulate triggerTrace and the 2nd tick fold in a fired proposal', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_1',
      trigger_run_id: 'run_1',
    })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(noProposalTick(44))
      .mockResolvedValueOnce(firedTickWithProposal(45))

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    await act(async () => {
      await result.current.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    expect(result.current.state.mergedRunId).toBe('mrun_1')

    await act(async () => {
      await result.current.step()
    })
    expect(result.current.state.triggerTrace).toHaveLength(1)
    expect(result.current.state.proposalLog).toBeNull()

    await act(async () => {
      await result.current.step()
    })

    expect(createMergedRun).toHaveBeenCalledTimes(1)
    expect(tickMergedRun).toHaveBeenCalledTimes(2)
    expect(tickMergedRun).toHaveBeenCalledWith('mrun_1')
    expect(result.current.state.triggerTrace).toHaveLength(2)
    expect(result.current.state.proposalLog).not.toBeNull()
    expect(result.current.state.proposalLog?.run_id).toBe('prun_20260718-000000_abcdef')
    expect(result.current.state.correlation).toHaveLength(1)
    expect(result.current.state.paused).toBe(true)

    // TraceEntry built the same way runStore's TICK_APPENDED does.
    const secondEntry = result.current.state.triggerTrace[1]
    expect(secondEntry.tick_index).toBe(45)
    expect(secondEntry.route_fraction).toBe(0.45)
    expect(secondEntry.motion_state).toBe('STOPPED')
    expect(secondEntry.result_type).toBe('REST_PROPOSAL')
    expect(secondEntry.proposal_paused).toBe(true)
  })

  it('selectService() dispatches select_service and updates proposalLog', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_2',
      trigger_run_id: 'run_2',
    })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({ status: 'service_selected' }),
    )

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    await act(async () => {
      await result.current.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await result.current.step()
    })

    await act(async () => {
      await result.current.selectService('music_playlist')
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_2', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
    expect(result.current.state.proposalLog?.status).toBe('service_selected')
  })

  it('a tick response carrying trigger.proposal_error sets store.error without disguising the tick as failed (Finding 1)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_6',
      trigger_run_id: 'run_6',
    })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposalError(45))

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    await act(async () => {
      await result.current.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await result.current.step()
    })

    expect(result.current.state.error).toBe('create_proposal_run failed: 422 invalid parameters')
    // The trigger tick itself is NOT disguised as failed: the decision still
    // appended to the trace and the tick reports paused, same as any other
    // fired tick — only proposalLog stays null (no proposal run was created).
    expect(result.current.state.triggerTrace).toHaveLength(1)
    expect(result.current.state.paused).toBe(true)
    expect(result.current.state.proposalLog).toBeNull()
  })

  it('a double selectService() call while the first is in flight is ignored (Finding 2 double-submit guard)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_7',
      trigger_run_id: 'run_7',
    })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    let resolveAction!: (log: ProposalRunLog) => void
    const pending = new Promise<ProposalRunLog>((resolve) => {
      resolveAction = resolve
    })
    vi.mocked(mergedProposalAction).mockReturnValue(pending)

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    await act(async () => {
      await result.current.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await result.current.step()
    })

    let firstCall!: Promise<void>
    act(() => {
      firstCall = result.current.selectService('music_playlist')
    })
    expect(result.current.state.choosingId).toBe('music_playlist')

    // Re-entrant call while the first is still in flight — must be a no-op:
    // no second mergedProposalAction call, no throw.
    await act(async () => {
      await result.current.selectService('music_playlist')
    })
    expect(mergedProposalAction).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAction(baseProposalLog({ status: 'service_selected' }))
      await firstCall
    })

    expect(result.current.state.choosingId).toBeNull()
    expect(result.current.state.proposalLog?.status).toBe('service_selected')
  })

  it('play() loops step() until the tick engine reports paused, then stops', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_3',
      trigger_run_id: 'run_3',
    })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(noProposalTick(1))
      .mockResolvedValueOnce(noProposalTick(2))
      .mockResolvedValueOnce(firedTickWithProposal(3))

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    await act(async () => {
      await result.current.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })

    act(() => {
      result.current.play()
    })

    await waitFor(() => expect(result.current.state.paused).toBe(true))

    expect(tickMergedRun).toHaveBeenCalledTimes(3)
    expect(result.current.state.triggerTrace).toHaveLength(3)
    expect(result.current.state.running).toBe(false)
  })
})
