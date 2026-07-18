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
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

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

  render(
    <MergedCoordinatorProvider>
      <Capture />
      <MergedCenterPanel />
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

  it('swaps to the content result overlay once a service is chosen', async () => {
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
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()
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
