/**
 * MergedCenterPanel (020 Task 9) — the Combined Simulator's center column:
 * Play/Pause/Step bar + a trigger-trace-fed `ScoreTimeline` + a
 * `position:relative` dock that docks `ServiceResultOverlay`/
 * `ContentResultOverlay` (Task 10) straight off `state.proposalLog`, mirroring
 * `CenterPlaybackPanel`'s dock (lines 87-114).
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (the same pattern
 * `merged_coordinator.test.tsx`/`merged_setup.test.tsx` use): only the
 * network boundary (`api/mergedClient.ts`) is mocked, so `state.proposalLog`/
 * `state.triggerTrace` are populated via the coordinator's real
 * create()/step()/selectService() — never a stand-in spy.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { RunStoreProvider } from '../src/state/runStore'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'
import MergedProposalPanel from '../src/components/merged/MergedProposalPanel'

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

function serviceEvidence(): AlgorithmEvidence {
  return {
    step: 'service',
    package_id: 'mock_service_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {
      eligible_candidates: [{ candidate_id: 'music_playlist' }],
      excluded_candidates: [],
    },
    output: {
      decision_type: 'ranked_candidates',
      ranked_candidates: [
        {
          rank: 1,
          candidate_id: 'music_playlist',
          score: 0.77,
          rationale: ['一位の理由', 'Top rank rationale'],
          supporting_feature_ids: [],
          opposing_feature_ids: [],
          uncertainty: null,
          feature_contributions: [],
        },
      ],
    },
    error: null,
    used_feature_ids: [],
    unused_available_features: [],
    missing_features: [],
  }
}

function serviceEvidenceWithError(): AlgorithmEvidence {
  return {
    step: 'service',
    package_id: 'mock_service_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {
      eligible_candidates: [{ candidate_id: 'music_playlist' }],
      excluded_candidates: [],
    },
    output: null,
    error: { category: 'algorithm_error', message: 'boom: division by zero' },
    used_feature_ids: [],
    unused_available_features: [],
    missing_features: [],
  }
}

function contentEvidence(): AlgorithmEvidence {
  return {
    step: 'content',
    package_id: 'mock_content_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {},
    output: {
      decision_type: 'complete_plan',
      selected_service_id: 'music_playlist',
      requested_item_count: 1,
      returned_item_count: 1,
      ordered_items: [
        {
          position: 1,
          item_id: 'track-1',
          item_fit: 0.81,
          trait_values: null,
          feature_contributions: [],
          rationale: ['一曲目', 'first track'],
        },
      ],
      mode: {
        service_id: 'music_playlist',
        mode_kind: 'playlist',
        chorus_only: null,
        guide_vocal: null,
        driving_lyrics: null,
        fixed_segment_sec: null,
        stopped_only: null,
        simulated_queue: null,
      },
      expected_duration_sec: 300,
      lighting_configuration: null,
      approval_policy: 'explicit_opt_in',
      completion_rule: 'plan_exhausted',
      next_transition_policy: 'await_user',
      excluded_items: [],
      unused_available_features: [],
      missing_features: [],
      algorithm_provenance: {},
    },
    error: null,
    used_feature_ids: [],
    unused_available_features: [],
    missing_features: [],
  }
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
    proposal: baseProposalLog({ evidence: [serviceEvidence()] }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

function firedTickWithServiceError(tickIndex: number): MergedTickResponse {
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
    proposal: baseProposalLog({ evidence: [serviceEvidenceWithError()] }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

/** Captures the real coordinator context (rendered inside the same Provider
 * as `MergedCenterPanel`) so the test can drive create()/step()/
 * selectService() directly — mirrors `playback.test.tsx`'s
 * `DispatchCapture`/`renderInStore` pattern, adapted to the coordinator's
 * async action functions (it has no raw `dispatch`). */
function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  // The proposal output moved to the RIGHT panel (MergedProposalPanel, owner
  // layout); the center's <MapSurface/> needs a RunStoreProvider. Both panels
  // share the coordinator, so the dock assertions still find the overlays.
  render(
    <MergedCoordinatorProvider>
      <RunStoreProvider>
        <Capture />
        <MergedCenterPanel />
        <MergedProposalPanel />
      </RunStoreProvider>
    </MergedCoordinatorProvider>,
  )

  return coordinatorRef
}

describe('MergedCenterPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('docks the service result overlay once proposalLog has service evidence and no service is chosen', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('content-result-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-music_playlist')).toBeInTheDocument()
  })

  it('shows service AND content side-by-side once a service is chosen (owner review — no either/or swap)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_2', trigger_run_id: 'run_2' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()

    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_2', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
    // Side-by-side (owner review): the service panel STAYS (left) while the
    // content plan appears (right) — no longer an either/or recency swap.
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('content-result-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('plan-item-track-1')).toBeInTheDocument()
  })

  it('clicking Choose on the docked overlay calls coordinator.selectService', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_3', trigger_run_id: 'run_3' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))
    vi.mocked(mergedProposalAction).mockResolvedValue(baseProposalLog({ status: 'service_selected' }))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('choose-candidate-music_playlist'))
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_3', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
  })

  it('surfaces a service algorithm_error as an alert instead of silently swallowing it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_5', trigger_run_id: 'run_5' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithServiceError(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('boom: division by zero')
  })

  it('disables the Choose button while selectService is in flight (choosingId wired through, Finding 2)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_6', trigger_run_id: 'run_6' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    let resolveAction: (log: ProposalRunLog) => void = () => {}
    const pending = new Promise<ProposalRunLog>((resolve) => {
      resolveAction = resolve
    })
    vi.mocked(mergedProposalAction).mockReturnValue(pending)

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    const chooseButton = screen.getByTestId('choose-candidate-music_playlist') as HTMLButtonElement
    expect(chooseButton).not.toBeDisabled()

    act(() => {
      fireEvent.click(chooseButton)
    })

    // Passing `choosingId={null}` unconditionally (the pre-fix bug) would
    // leave this button always enabled/idle no matter what — asserting it
    // goes busy+disabled here proves `state.choosingId` from the coordinator
    // is actually threaded through to `<ServiceResultOverlay>`.
    expect(chooseButton).toBeDisabled()
    expect(chooseButton).toHaveTextContent('…')

    // A second click while disabled must not fire a second request (jsdom
    // does not dispatch click handlers for disabled buttons).
    fireEvent.click(chooseButton)
    expect(mergedProposalAction).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAction(baseProposalLog({ status: 'service_selected' }))
    })
  })

  it('the 1×/2×/4× speed selector drives coordinator.setSpeed', async () => {
    const coordinatorRef = renderCenterPanel()
    const select = screen.getByTestId('merged-speed-select') as HTMLSelectElement
    expect(select.value).toBe('1')

    await act(async () => {
      fireEvent.change(select, { target: { value: '4' } })
    })

    expect(coordinatorRef.current!.state.speed).toBe(4)
    expect((screen.getByTestId('merged-speed-select') as HTMLSelectElement).value).toBe('4')
  })

  it('the Reset button clears the run (proposalLog + overlays gone, mergedRunId null)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_reset', trigger_run_id: 'run_reset' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('merged-reset-button'))
    })

    expect(coordinatorRef.current!.state.mergedRunId).toBeNull()
    expect(coordinatorRef.current!.state.proposalLog).toBeNull()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()
  })

  it('the Play button drives coordinator.play() (ticks until the trigger pauses)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_4', trigger_run_id: 'run_4' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('merged-play-button'))
      // Let the coordinator's internal tick loop settle (it stops itself once
      // the mocked tick reports paused: true).
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(tickMergedRun).toHaveBeenCalledWith('mrun_4')
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
  })
})
