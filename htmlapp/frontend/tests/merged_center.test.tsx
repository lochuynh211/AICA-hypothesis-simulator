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

import { createMergedRun, tickMergedRun, mergedProposalAction, declineRest } from '../src/api/mergedClient'

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

// ---------------------------------------------------------------------------
// Task 4: no Step button; Continue only after a manual pause; hidden during
// a proposal (fire) pause.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — controls: no Step, Continue only after manual pause', () => {
  it('renders no Step button', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('merged-step-button')).toBeNull()
  })

  it('after a manual pause the Play button reads Continue and is enabled', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_p', trigger_run_id: 'run_p' })
    // A quiet tick so play()'s loop halts without a fire on screen.
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.3, distance_km: null, speed_kph: 20, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: null, correlation: null,
    } as unknown as MergedTickResponse)
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    act(() => { coordinatorRef.current!.pause() })
    const btn = screen.getByTestId('merged-play-button') as HTMLButtonElement
    expect(btn).toHaveTextContent('Continue')
    expect(btn).not.toBeDisabled()
  })

  it('hides the Play/Continue button during a proposal pause (fire on screen)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_pp', trigger_run_id: 'run_pp' })
    // A monotony fire → guided overlay is up (proposal pause), not a manual one.
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-pp', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: null, active_plan_id: null },
        evidence: [serviceEvidence()],
      }),
    })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    expect(screen.getByTestId('guided-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-play-button')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 5: OK/Reject under the content song list (moving conversation only) +
// the now-playing badge on the map.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — content OK/Reject + now-playing badge (moving)', () => {
  async function driveToMonotonySongs(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    const logWithPlan = baseProposalLog({
      opportunity: { opportunity_id: `opp-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
      journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: 'music_playlist', active_plan_id: 'plan_1' },
      evidence: [serviceEvidence(), contentEvidence()],
    })
    // firedTickWithProposal's shared trigger defaults to a STOPPED rest-fire
    // shape; a monotony fire keeps the car DRIVING, so the trigger-level
    // motion_state is overridden to match (and to exercise the now-playing
    // badge's `latestTrigger.motion_state !== 'STOPPED'` gate below). The
    // fire happens ONCE; any resumed tick after that (OK/Reject both call
    // play()) gets a quiet DRIVING tick with no proposal, so the loop halts
    // immediately instead of replaying the same fire forever (mirrors the
    // monotony-decline describe block's own `quietTick` above).
    const base = firedTickWithProposal(45)
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce({
        ...base,
        trigger: { ...base.trigger, motion_state: 'DRIVING' },
        proposal: logWithPlan,
      })
      .mockResolvedValue({
        trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
          route_fraction: 0.46, distance_km: null, speed_kph: 15, motion_state: 'DRIVING',
          recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
        proposal: null, correlation: null,
      } as unknown as MergedTickResponse)
    vi.mocked(mergedProposalAction).mockResolvedValue(logWithPlan)
    vi.mocked(declineRest).mockResolvedValue({} as never)
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    return coordinatorRef
  }

  it('shows OK and Reject under the content song list', async () => {
    await driveToMonotonySongs('ok1')
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-ok')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-reject')).toBeInTheDocument()
  })

  // Fix round 1: the legacy `guided-decline-button` (a monotony fire's
  // service-step decline) must NOT double up with the new content-step
  // guided-content-reject — exactly one reject-style control per step.
  it('shows exactly ONE reject control at the content step (no legacy guided-decline-button duplicate)', async () => {
    await driveToMonotonySongs('mutex1')
    expect(screen.getByTestId('guided-content-reject')).toBeInTheDocument()
    expect(screen.queryByTestId('guided-decline-button')).toBeNull()
  })

  it('OK dismisses the songs, resumes, and shows the now-playing badge', async () => {
    const coordinatorRef = await driveToMonotonySongs('ok2')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-ok'))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
    expect(coordinatorRef.current!.state.nowPlaying).toEqual({ serviceId: 'music_playlist', opportunityId: 'opp-ok2' })
    // Badge shows while the car is moving.
    expect(screen.getByTestId('now-playing-badge')).toBeInTheDocument()
  })

  it('Reject on the content step calls declineRest and clears the overlay', async () => {
    await driveToMonotonySongs('rej1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-reject'))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(declineRest).toHaveBeenCalledWith('mrun_rej1')
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Finding 2 (final whole-branch review): the backend legitimately leaves
// `journey_state.active_service_id` null when the service matrix yields zero
// eligible candidates (NO_ELIGIBLE_CANDIDATE / T017a path). `guidedState`
// still returns step 'rest' (isRestFlow && !restDecided depends only on
// trigger_purpose + lifecycle_stage), so `guidedActive` is true — but the
// rest chooser overlay never renders because `showRestAccept` additionally
// requires `liveActiveServiceId != null`. Without the fix, the reviewer is
// paused with NO Continue button and NO rest overlay — stranded (only Reset,
// which discards the run).
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — rest-step stranding when zero services are eligible (Finding 2)', () => {
  it('offers Continue (never strands the reviewer) when the rest fire has zero eligible services', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_f2a', trigger_run_id: 'run_f2a' })
    // firedTickWithProposal's default fixture already carries
    // journey_state.active_service_id: null — exactly the zero-eligible-
    // candidate shape (T017a: NO_ELIGIBLE_CANDIDATE).
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

    // No rest chooser was ever shown (nothing eligible to choose)...
    expect(screen.queryByTestId('rest-accept-panel')).toBeNull()
    // ...so the defensive Continue fallback must offer the reviewer a way
    // to advance rather than leaving them stuck with only Reset.
    const btn = screen.getByTestId('merged-play-button') as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  // Companion (protects the matrix): a NORMAL rest fire — active_service_id
  // non-null — must still show the rest chooser and must NOT also show
  // Continue (no double control).
  it('shows the rest chooser (and hides Continue) when the rest fire HAS an eligible service', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_f2b', trigger_run_id: 'run_f2b' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        evidence: [serviceEvidence()],
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: null,
        },
      }),
    })

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

    expect(screen.getByTestId('rest-accept-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-play-button')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 6: the post-rest proposal reopens the service/content conversation;
// resolving it shows "Continue driving" instead of auto-resuming.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — after-rest conversation + Continue driving', () => {
  function afterRestLog(suffix: string, active: string | null) {
    return baseProposalLog({
      opportunity: { opportunity_id: `opp-post-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'after_rest_before_restart' } as never,
      journey_state: { lifecycle_stage: 'after_rest_before_restart', motion_state: 'stopped',
        active_service_id: active, active_plan_id: active ? 'plan_1' : null },
      evidence: active ? [serviceEvidence(), contentEvidence()] : [serviceEvidence()],
    })
  }

  async function driveToAfterRest(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    // The post-rest proposal arrives on a stopped, paused tick (backend recompute).
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 80, route_fraction: 0.8, distance_km: null, speed_kph: 0, motion_state: 'STOPPED',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: afterRestLog(suffix, null), correlation: null,
    } as unknown as MergedTickResponse)
    vi.mocked(mergedProposalAction).mockResolvedValue(afterRestLog(suffix, 'music_playlist'))
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    return coordinatorRef
  }

  it('reopens the service step for the post-rest proposal (car stopped)', async () => {
    await driveToAfterRest('ar1')
    const guided = screen.getByTestId('guided-overlay')
    expect(guided.textContent).toContain('Service proposal')
    expect(screen.getByTestId('guided-choose-music_playlist')).toBeInTheDocument()
  })

  it('after resolving the post-rest content, shows Continue driving; clicking it resumes', async () => {
    const coordinatorRef = await driveToAfterRest('ar2')
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    // On the content step, an after-rest OK resolves the conversation.
    await act(async () => { fireEvent.click(screen.getByTestId('guided-content-ok')) })
    const cont = screen.getByTestId('guided-continue-driving')
    expect(cont).toBeInTheDocument()
    const playSpy = vi.spyOn(coordinatorRef.current!, 'continueDriving')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-continue-driving'))
      await Promise.resolve(); await Promise.resolve()
    })
    // Clicking Continue driving actually calls the coordinator's resume path,
    // not just visually hiding the button.
    expect(playSpy).toHaveBeenCalled()
    // The overlay is gone (conversation done) after Continue driving.
    expect(screen.queryByTestId('guided-continue-driving')).toBeNull()
  })
})
