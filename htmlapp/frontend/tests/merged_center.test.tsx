/**
 * MergedCenterPanel (htmlapp port) — Bug 1 + Bug 2b component test, mirroring
 * `app/frontend/tests/merged_center.test.tsx`'s `describe('MergedCenterPanel —
 * monotony decline')` block (the reference/already-fixed app/ file). Rendered
 * inside a REAL `MergedCoordinatorProvider` (same pattern as the reference and
 * as `htmlapp/frontend/tests/merged_setup_basic_tiers.test.tsx`'s sibling
 * fixtures) — only the network boundary (`api/mergedClient.ts`) is mocked, so
 * `state.proposalLog`/`state.triggerTrace` are populated via the coordinator's
 * real create()/step()/declineRest() — never a stand-in spy.
 *
 * Bug 1: a monotony fire (`trigger_purpose: 'inattentive_driving_prevention_
 * recovery'`) has no rest step of its own, so its ONLY pause (the guided
 * service/content overlay) must still offer a decline (drop the proposal,
 * keep driving) — mirrored via `guided-decline-button` -> `coordinator.
 * declineRest()` -> `declineRest` client call.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  declineRest: vi.fn(),
}))

import { createMergedRun, tickMergedRun, declineRest } from '../src/api/mergedClient'

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
} as unknown as DecisionResult

const restProposalDecision: DecisionResult = {
  ...noTriggerDecision,
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
  explanation: 'Rest recommended',
} as unknown as DecisionResult

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
  } as unknown as MergedTickResponse
}

/** A monotony fire (`inattentive_driving_prevention_recovery`) paused on the
 *  service step — no rest opportunity, so `showRestAccept` is false and the
 *  center panel's rest-spot fetch effect no-ops without needing a mock. */
function monotonyFireTick(tickIndex: number): MergedTickResponse {
  return {
    ...firedTickWithProposal(tickIndex),
    proposal: baseProposalLog({
      opportunity: { opportunity_id: 'opp-mono', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
      journey_state: {
        lifecycle_stage: 'active_driving_content',
        motion_state: 'driving',
        active_service_id: null,
        active_plan_id: null,
      },
      evidence: [serviceEvidence()],
    }),
  }
}

/** A quiet subsequent tick (no new fire) — lets `play()`'s resumed loop
 *  (declineRest() calls play() to resume ticking) halt immediately so the
 *  test doesn't hang. */
function quietTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: null,
      error: null,
      paused: true,
      completed: false,
      tick_index: null,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 10,
      motion_state: 'DRIVING',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: null,
    correlation: null,
  } as unknown as MergedTickResponse
}

function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  // MergedCenterPanel renders MergedProposalPanel itself, as a SIBLING of its
  // animated playback subtree — no separate mount needed. The center's
  // <MapSurface/> needs a RunStoreProvider, and the checkpoint rail/decision
  // band it also renders need a ReviewStoreProvider — same nesting the
  // reference test uses.
  render(
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <ReviewStoreProvider>
              <Capture />
              <MergedCenterPanel />
            </ReviewStoreProvider>
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>,
  )

  return coordinatorRef
}

// ── Bug 1: a monotony fire has no rest step, so its ONLY pause must still
//    offer a decline (drop the proposal, keep driving) ─────────────────────
describe('MergedCenterPanel — monotony decline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('offers a decline control on the guided overlay for a monotony fire', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono1', trigger_run_id: 'run_mono1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(monotonyFireTick(45))

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

    expect(screen.getByTestId('guided-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('guided-decline-button')).toBeInTheDocument()
  })

  it('clicking the guided decline button calls declineRest and clears the overlay', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono2', trigger_run_id: 'run_mono2' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(monotonyFireTick(45)).mockResolvedValue(quietTick(46))
    vi.mocked(declineRest).mockResolvedValue({} as never)

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
    expect(screen.getByTestId('guided-decline-button')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-decline-button'))
      // Let declineRest's resumed play() settle.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(declineRest).toHaveBeenCalledWith('mrun_mono2')
    // REST_DECLINED clears proposalLog, which pulls the whole guided overlay
    // (there is no longer an opportunity to guide the reviewer through).
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })

  it('does NOT show the monotony decline control on a rest_recommended fire (its own reject lives in rest-accept-panel)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono3', trigger_run_id: 'run_mono3' })
    // The shared fixture (firedTickWithProposal) is already a rest_recommended
    // / before_rest_until_stop fire — its guided overlay opens on 'rest',
    // which is a DIFFERENT block (rest-accept-panel) than guided-overlay
    // above; this asserts guided-decline-button never leaks into that flow.
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

    expect(screen.queryByTestId('guided-decline-button')).toBeNull()
  })
})
