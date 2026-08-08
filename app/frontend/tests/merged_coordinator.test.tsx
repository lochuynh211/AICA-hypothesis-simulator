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
  // fixbug-0806: rejectProposal() is a distinct client fn from
  // mergedProposalAction (its own endpoint, `/reject-proposal`) — mocked
  // here so the "rejectProposal" describe block below can drive it directly.
  rejectProposal: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedProposalAction, rejectProposal } from '../src/api/mergedClient'

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

  /**
   * fixbug-0806. The trigger run registry (`services/run_manager.py::_registry`)
   * is in-memory only and there is no resume endpoint, so an API restart — a
   * container recreate, or a dev `--reload` picking up an edited backend file —
   * drops every run in flight and every later tick 404s. Surfaced verbatim that
   * read "API error (404)" against an intact-looking screen, with nothing to
   * say the only way forward is Reset.
   */
  it('a 404 from tick reports that the run is gone (and how to recover), not a bare status code', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_1',
      trigger_run_id: 'run_1',
    })
    vi.mocked(tickMergedRun).mockRejectedValueOnce(
      Object.assign(new Error('API error: 404'), {
        bilingual: { ja: 'API エラー（404）', en: 'API error (404)' },
        status: 404,
      }),
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

    expect(result.current.state.error).toMatch(/no longer exists on the server/i)
    expect(result.current.state.error).toMatch(/Reset/i)
    expect(result.current.state.running).toBe(false)
  })

  it('a non-404 tick failure still reports the underlying API error', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_1',
      trigger_run_id: 'run_1',
    })
    vi.mocked(tickMergedRun).mockRejectedValueOnce(
      Object.assign(new Error('API error: 500'), {
        bilingual: { ja: 'API エラー（500）', en: 'API error (500)' },
        status: 500,
      }),
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

    expect(result.current.state.error).toBe('API error (500)')
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

    let returned: ProposalRunLog | null = null
    await act(async () => {
      returned = await result.current.selectService('music_playlist')
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_2', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
    expect(result.current.state.proposalLog?.status).toBe('service_selected')
    // fixbug-0806: selectService() now RETURNS the updated log (not void) —
    // MergedCenterPanel.handleChooseService needs it in the SAME tick to
    // decide whether a content step follows, without waiting on a re-render.
    expect(returned).not.toBeNull()
    expect(returned!.status).toBe('service_selected')
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
      // 4× = a 250ms inter-tick pace (the play loop now throttles to 1000/speed
      // ms, owner review) — keeps this 3-tick loop fast + deterministic.
      result.current.setSpeed(4)
      result.current.play()
    })

    await waitFor(() => expect(result.current.state.paused).toBe(true), { timeout: 3000 })

    expect(tickMergedRun).toHaveBeenCalledTimes(3)
    expect(result.current.state.triggerTrace).toHaveLength(3)
    expect(result.current.state.running).toBe(false)
  })

  it('paces the FIRST run at the default speed, without waiting to be told', async () => {
    // The loop reads a ref, which was hardcoded to 1x while the reducer's
    // default (and therefore the dropdown) said 4x. The displayed speed was a
    // lie until the reviewer touched the control: a 3-tick run took ~3s
    // instead of ~0.75s. `setSpeed` is deliberately NOT called here — calling
    // it would paper over exactly the bug this covers.
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_speed', trigger_run_id: 'run_speed' })
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

    expect(result.current.state.speed).toBe(4)

    const startedAt = performance.now()
    act(() => { result.current.play() })
    await waitFor(() => expect(result.current.state.paused).toBe(true), { timeout: 3000 })
    const elapsed = performance.now() - startedAt

    // Two inter-tick waits: 4x → ~500ms, 1x → ~2000ms. The midpoint separates
    // them without being tight enough to flake on a loaded machine.
    expect(elapsed).toBeLessThan(1250)
  })
})

describe('mergedCoordinator — pausedByUser distinguishes manual from proposal pause', () => {
  function firedPausedTick(): MergedTickResponse {
    return {
      trigger: {
        decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 10, route_fraction: 0.1, distance_km: null, speed_kph: 0,
        motion_state: 'STOPPED', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
      },
      proposal: baseProposalLog(), correlation: null,
    }
  }

  it('is false initially and after create', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    expect(result.current.state.pausedByUser).toBe(false)
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    expect(result.current.state.pausedByUser).toBe(false)
  })

  it('pause() sets pausedByUser true; play() clears it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(firedPausedTick())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    act(() => { result.current.pause() })
    expect(result.current.state.pausedByUser).toBe(true)
    await act(async () => {
      result.current.play()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(result.current.state.pausedByUser).toBe(false)
  })

  it('a fire-driven pause leaves pausedByUser false', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(firedPausedTick())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.step() })
    expect(result.current.state.paused).toBe(true)
    expect(result.current.state.pausedByUser).toBe(false)
  })

  // Finding 1: a manual pause can race an in-flight tick that turns out to be
  // a FIRE. If pausedByUser stayed true, BOTH the top Continue button and the
  // fire's own overlay would render — and pressing Continue would resume
  // WITHOUT answering the proposal, the exact bypass this feature exists to
  // prevent. A fire's pause is a PROPOSAL pause, never a manual one, so
  // pausedByUser must be false whenever the tick brings a fresh actionable
  // proposal (`trigger.paused && proposal?.opportunity != null`).
  it('a manual pause racing a fire clears pausedByUser so Continue cannot bypass the fresh proposal (Finding 1)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(firedPausedTick())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    // Reviewer clicks Pause while a tick's network round-trip is in flight...
    act(() => { result.current.pause() })
    expect(result.current.state.pausedByUser).toBe(true)
    // ...and that in-flight tick turns out to be a FIRE with an actionable proposal.
    await act(async () => { await result.current.step() })
    expect(result.current.state.pausedByUser).toBe(false)
  })

  // Guard against over-clearing: a QUIET tick (no fresh actionable proposal)
  // arriving after a manual pause must leave pausedByUser alone.
  it('a quiet (non-fire) tick after a manual pause does NOT clear pausedByUser (Finding 1 guard)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: {
        decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.15, distance_km: null, speed_kph: 0, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
      },
      proposal: null, correlation: null,
    })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    act(() => { result.current.pause() })
    expect(result.current.state.pausedByUser).toBe(true)
    await act(async () => { await result.current.step() })
    expect(result.current.state.pausedByUser).toBe(true)
  })
})

describe('mergedCoordinator — nowPlaying badge', () => {
  function movingTick(recovery: string | null, oppId: string): MergedTickResponse {
    return {
      trigger: {
        decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 20, route_fraction: 0.2, distance_km: null, speed_kph: 30,
        motion_state: recovery ? 'STOPPED' : 'DRIVING', recovery_phase: recovery,
        is_traffic_jam: false, segment_type: 'highway',
      },
      proposal: baseProposalLog({ opportunity: { opportunity_id: oppId, trigger_purpose: 'inattentive_driving_prevention_recovery', lifecycle_stage: 'active_driving_content', allowed_service_ids: ['music_playlist'], simulation_time: 20, run_seed: '7' } as never }),
      correlation: null,
    }
  }

  it('acceptContentAndResume starts the content plan (journey_action: accept), records nowPlaying, and resumes', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    // fixbug-0806: acceptContentAndResume now awaits acceptContent() FIRST —
    // a real POST (`journey_action: accept`) that must resolve before the
    // "now playing" badge is recorded, so this needs an explicit resolved
    // value (a bare `vi.fn()` would resolve to `undefined`, which is legal
    // JS but would mask a real regression in the sequencing).
    vi.mocked(mergedProposalAction).mockResolvedValue(baseProposalLog())
    vi.mocked(tickMergedRun).mockResolvedValue({ ...movingTick(null, 'opp-a'), trigger: { ...movingTick(null,'opp-a').trigger, paused: true } })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => {
      await result.current.acceptContentAndResume('music_playlist', 'opp-a')
    })
    expect(mergedProposalAction).toHaveBeenCalledWith('m', { kind: 'journey_action', action_type: 'accept' })
    expect(result.current.state.nowPlaying).toEqual({ serviceId: 'music_playlist', opportunityId: 'opp-a' })
  })

  it('clears nowPlaying when recovery begins', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(mergedProposalAction).mockResolvedValue(baseProposalLog())
    vi.mocked(tickMergedRun).mockResolvedValue(movingTick('nap', 'opp-a'))
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.acceptContentAndResume('music_playlist', 'opp-a') })
    await act(async () => { await result.current.step() })
    expect(result.current.state.nowPlaying).toBeNull()
  })

  it('pause clears nowPlaying', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(mergedProposalAction).mockResolvedValue(baseProposalLog())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    // acceptContentAndResume is now async (awaits acceptContent() first) —
    // it must be awaited here so nowPlaying is ACTUALLY set before pause()
    // clears it; otherwise this test would trivially pass with nowPlaying
    // never having been set at all.
    await act(async () => { await result.current.acceptContentAndResume('music_playlist', 'opp-a') })
    act(() => { result.current.pause() })
    expect(result.current.state.nowPlaying).toBeNull()
  })
})

// ── fixbug-0806: rejectProposal (Bugs 2/3) ──────────────────────────────────
//
// `rejectProposal()` is a PROPOSAL-side reject (`POST .../reject-proposal`),
// distinct from `declineRest()` (a trigger-side rest decline). Its behavior
// branches on the backend's `declined` flag — see
// `routers/merged_runs.py::reject_proposal_endpoint`'s docstring for why:
// `declined=true` means the trigger's pending proposal was ALSO cleared
// (fire guard re-armed), so the coordinator treats it exactly like a rest
// decline (REST_DECLINED — drop the log, unpause); `declined=false` means
// the SAME proposal run is still current with only its service/content
// answer changed (SERVICE_REJECTED appended), so the coordinator keeps it
// (PROPOSAL_UPDATED) rather than discarding a still-live run.
describe('mergedCoordinator — rejectProposal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('declined=true drops the proposal log, unpauses, and resumes ticking (mirrors declineRest)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(rejectProposal).mockResolvedValue({ proposal: baseProposalLog(), declined: true })
    // The resumed play() loop needs a paused tick to halt on, or the test hangs.
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.3, distance_km: null, speed_kph: 20, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: null, correlation: null,
    })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.rejectProposal() })

    expect(rejectProposal).toHaveBeenCalledWith('m')
    expect(result.current.state.proposalLog).toBeNull()
    // Resumed (play() was called) — the mocked tick ran at least once. NOTE:
    // `state.paused` is NOT asserted here — REST_DECLINED sets it `false`,
    // but the resumed play() loop immediately ticks once (mocked
    // `paused: true` so the loop halts, mirroring
    // `merged_rest_journey.test.tsx`'s declineRest tests), and that tick's
    // OWN `paused` overwrites it right back to `true`. Resumption is proven
    // by the tick call itself, not by the transient `paused` value.
    expect(tickMergedRun).toHaveBeenCalled()
  })

  it('declined=false keeps the (updated) proposal log rather than discarding it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    const updatedLog = baseProposalLog({ status: 'service_selected' })
    vi.mocked(rejectProposal).mockResolvedValue({ proposal: updatedLog, declined: false })
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.3, distance_km: null, speed_kph: 20, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: null, correlation: null,
    })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.rejectProposal() })

    expect(result.current.state.proposalLog).toBe(updatedLog)
  })

  it('opts.resume === false skips the resume — no tick is fired (the after-rest conversation resumes via its own Continue control)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(rejectProposal).mockResolvedValue({ proposal: baseProposalLog(), declined: true })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.rejectProposal({ resume: false }) })

    expect(tickMergedRun).not.toHaveBeenCalled()
    expect(result.current.state.running).toBe(false)
  })
})
